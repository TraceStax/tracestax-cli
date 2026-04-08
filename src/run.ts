#!/usr/bin/env node
/**
 * tracestax-run — Zero-Dependency Process Wrapper
 *
 * Wraps any shell command and sends started / succeeded / failed trace events
 * to the TraceStax ingest API. Lets legacy scripts be observed without any
 * code changes.
 *
 * Usage:
 *   tracestax-run --project-id <id> --task-name <name> -- <command> [args...]
 *
 * Env-var equivalents:
 *   TRACESTAX_API_KEY, TRACESTAX_PROJECT_ID, TRACESTAX_TASK_NAME,
 *   TRACESTAX_QUEUE, TRACESTAX_INGEST_URL
 */

import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';

const SDK_VERSION = '0.1.0';

// ── Parse arguments ─────────────────────────────────────────────────

// Split argv at '--' separator
const rawArgv = process.argv.slice(2);
const separatorIdx = rawArgv.indexOf('--');
const wrapperArgv = separatorIdx === -1 ? rawArgv : rawArgv.slice(0, separatorIdx);
const commandArgv = separatorIdx === -1 ? [] : rawArgv.slice(separatorIdx + 1);

const { values } = parseArgs({
  args: wrapperArgv,
  allowPositionals: false,
  options: {
    'api-key':    { type: 'string', short: 'k' },
    'project-id': { type: 'string' },
    'task-name':  { type: 'string' },
    'queue':      { type: 'string', default: 'default' },
    'help':       { type: 'boolean', short: 'h' },
  },
});

if (values.help || commandArgv.length === 0) {
  console.log(`
tracestax-run — Wrap any command with TraceStax tracing

Usage: tracestax-run [options] -- <command> [args...]

Options:
  -k, --api-key <key>        API key (or TRACESTAX_API_KEY)
  --project-id <id>          Project ID (or TRACESTAX_PROJECT_ID)
  --task-name  <name>        Task name shown in dashboard (or TRACESTAX_TASK_NAME)
  --queue      <name>        Queue label (default: "default")
  -h, --help                 Show help

Example:
  tracestax-run --task-name nightly-sync -- python sync.py --full
  `.trim());
  process.exit(0);
}

const apiKey    = (values['api-key'] || process.env.TRACESTAX_API_KEY || '').trim();
const projectId = (values['project-id'] || process.env.TRACESTAX_PROJECT_ID || '').trim();
const taskName  = (values['task-name'] || process.env.TRACESTAX_TASK_NAME || commandArgv[0] || 'shell-task').trim();
const queue     = (values['queue'] || process.env.TRACESTAX_QUEUE || 'default').trim();
const ingestUrl = (process.env.TRACESTAX_INGEST_URL || 'https://ingest.tracestax.com').replace(/\/$/, '');

if (!apiKey) {
  console.error('Error: API key required. Set TRACESTAX_API_KEY or use --api-key.');
  process.exit(1);
}
if (!projectId) {
  console.error('Error: --project-id required (or set TRACESTAX_PROJECT_ID).');
  process.exit(1);
}
if (commandArgv.length === 0) {
  console.error('Error: No command specified. Use -- <command> to specify the wrapped command.');
  process.exit(1);
}

// ── Ingest helpers ───────────────────────────────────────────────────

const workerKey = `${hostname()}:${process.pid}`;
const runId = `shell-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

async function sendEvent(status: 'started' | 'succeeded' | 'failed', durationMs?: number, exitCode?: number): Promise<void> {
  const payload: Record<string, unknown> = {
    framework: 'generic',
    language: 'shell',
    sdk_version: SDK_VERSION,
    type: 'task_event',
    worker: { key: workerKey, hostname: hostname(), pid: process.pid, concurrency: 1, queues: [queue] },
    task: { name: taskName, id: runId, queue, attempt: 1 },
    status,
    metrics: { duration_ms: durationMs ?? 0 },
  };

  if (status === 'failed' && exitCode !== undefined) {
    payload.error = {
      type: 'ExitError',
      message: `Process exited with code ${exitCode}`,
    };
  }

  try {
    const res = await fetch(`${ingestUrl}/v1/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': `tracestax-run/${SDK_VERSION}`,
      },
      body: JSON.stringify({ events: [payload] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      // Non-fatal: warn but don't block the child process exit
      console.warn(`[tracestax-run] Ingest responded ${res.status}`);
    }
  } catch {
    // Never block the wrapped process due to tracing errors
  }
}

// ── Run the wrapped command ───────────────────────────────────────────

const [cmd, ...cmdArgs] = commandArgv;
const startedAt = Date.now();

// Send started event (fire-and-forget — don't block process start)
sendEvent('started').catch(() => {});

const child = spawn(cmd, cmdArgs, { stdio: 'inherit' });

child.on('error', async (err) => {
  const duration = Date.now() - startedAt;
  console.error(`[tracestax-run] Failed to start process: ${err.message}`);
  await sendEvent('failed', duration, 1);
  process.exit(1);
});

child.on('close', async (code) => {
  const duration = Date.now() - startedAt;
  const exitCode = code ?? 1;
  const status = exitCode === 0 ? 'succeeded' : 'failed';
  await sendEvent(status, duration, exitCode === 0 ? undefined : exitCode);
  process.exit(exitCode);
});
