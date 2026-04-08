#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { request } from './http';
import { runInit } from './init';
import { runDev } from './dev';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'api-key':      { type: 'string', short: 'k' },
    endpoint:       { type: 'string', default: 'https://api.tracestax.com' },
    'compose-file': { type: 'string' },
    profile:        { type: 'string' },
    interval:       { type: 'string' },
    help:           { type: 'boolean', short: 'h' },
  },
});

const apiKey = values['api-key'] || process.env.TRACESTAX_API_KEY;
const endpoint = (values.endpoint || process.env.TRACESTAX_ENDPOINT || 'https://api.tracestax.com').replace(/\/$/, '');

const [command, subcommand, ...args] = positionals;

// Commands that don't require an API key upfront
const NO_AUTH_COMMANDS = new Set(['init', 'dev']);

async function main() {
  if (values.help || !command) {
    printHelp();
    return;
  }

  if (!NO_AUTH_COMMANDS.has(command) && !apiKey) {
    console.error('Error: API key required. Set TRACESTAX_API_KEY or use --api-key.');
    process.exit(1);
  }

  switch (command) {
    case 'status':
      await cmdStatus();
      break;
    case 'alerts':
      await cmdAlerts();
      break;
    case 'projects':
      await cmdProjects();
      break;
    case 'workers':
      await cmdWorkers();
      break;
    case 'replay':
      await cmdReplay();
      break;
    case 'ping':
      await cmdPing();
      break;
    case 'tail':
      await cmdTail();
      break;
    case 'retry':
      await cmdRetry();
      break;
    case 'init':
      await runInit(apiKey);
      break;
    case 'dev':
      runDev({ composeFile: values['compose-file'], profile: values['profile'] });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

function printHelp() {
  console.log(`
TraceStax CLI v0.1.0

Usage: tracestax <command> [options]

Commands:
  status                       Show workspace overview
  alerts                       List firing alerts
  alerts mute <id> <mins>      Mute an alert
  projects list                List projects
  workers list <projectId>     List workers for a project
  tail <projectId>             Stream recent run events (polls every 3s)
  replay <projectId> <msgId>   Replay a failed DLQ message
  retry <runId>                Retry a failed run
  ping                         Verify API key is valid
  init                         Auto-instrumentation wizard
  dev                          Start local TraceStax stack (docker compose)

Options:
  -k, --api-key <key>          API key (or set TRACESTAX_API_KEY)
  --endpoint <url>             API endpoint (default: https://api.tracestax.com)
  --compose-file <path>        Compose file for \`dev\` (default: docker-compose.app.yml)
  --profile <name>             Docker Compose profile for \`dev\`
  --interval <seconds>         Poll interval for \`tail\` (default: 3)
  -h, --help                   Show help
  `.trim());
}

async function cmdStatus() {
  const data = await request(endpoint, '/v1/workspace', apiKey!);
  console.log(`Workspace: ${data.id}`);
  console.log(`Plan: ${data.plan_tier}  |  Events: ${data.events_this_month}/${data.plan_event_limit}`);
  console.log(`Projects: ${data.project_count ?? 0}`);
  if (data.projects) {
    for (const p of data.projects) {
      console.log(`  - ${p.name} (${p.id})`);
    }
  }
}

async function cmdAlerts() {
  if (subcommand === 'mute') {
    const [alertId, minutes] = args;
    if (!alertId || !minutes) {
      console.error('Usage: tracestax alerts mute <alertId> <minutes>');
      process.exit(1);
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(alertId)) {
      console.error('Error: Invalid alert ID format.');
      process.exit(1);
    }
    if (isNaN(Number(minutes)) || Number(minutes) <= 0) {
      console.error('Error: minutes must be a positive number.');
      process.exit(1);
    }
    // Acknowledge alert (closest action to muting)
    const projects = await request(endpoint, '/v1/workspace', apiKey!);
    // Try to ack across all projects
    for (const p of projects.projects || []) {
      try {
        await request(endpoint, `/v1/projects/${p.id}/alerts/${alertId}/ack`, apiKey!, 'POST');
        console.log(`Alert ${alertId} acknowledged.`);
        return;
      } catch {
        // Try next project
      }
    }
    console.error(`Alert ${alertId} not found in any project.`);
    process.exit(1);
    return;
  }

  // List alerts across all projects
  const workspace = await request(endpoint, '/v1/workspace', apiKey!);
  let totalAlerts = 0;
  for (const p of workspace.projects || []) {
    const alerts = await request(endpoint, `/v1/projects/${p.id}/alerts?status=open`, apiKey!);
    if (alerts.length > 0) {
      console.log(`\n${p.name}:`);
      for (const a of alerts) {
        console.log(`  [${a.severity.toUpperCase()}] ${a.title}  (${a.id})`);
        totalAlerts++;
      }
    }
  }
  if (totalAlerts === 0) {
    console.log('No firing alerts.');
  }
}

async function cmdProjects() {
  const workspace = await request(endpoint, '/v1/workspace', apiKey!);
  if (!workspace.projects?.length) {
    console.log('No projects found.');
    return;
  }
  console.log('Projects:');
  for (const p of workspace.projects) {
    console.log(`  ${p.name}  ${p.id}`);
  }
}

async function cmdWorkers() {
  const projectId = subcommand || args[0];
  if (!projectId) {
    console.error('Usage: tracestax workers list <projectId>');
    process.exit(1);
  }
  // Get the project ID - might be 'list' followed by the actual ID
  const pid = subcommand === 'list' ? args[0] : subcommand;
  if (!pid) {
    console.error('Usage: tracestax workers list <projectId>');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(pid)) {
    console.error('Error: Invalid project ID format.');
    process.exit(1);
  }
  const workers = await request(endpoint, `/v1/projects/${pid}/workers`, apiKey!);
  if (!workers.length) {
    console.log('No active workers.');
    return;
  }
  console.log('Workers:');
  for (const w of workers) {
    const ago = Math.round((Date.now() - new Date(w.last_seen_at).getTime()) / 1000);
    console.log(`  ${w.worker_key}  ${w.hostname}  pid=${w.pid}  last_seen=${ago}s ago`);
  }
}

async function cmdReplay() {
  // Expects: tracestax replay <projectId> <dlqMessageId>
  const projectId = subcommand;
  const dlqId = args[0];
  if (!projectId || !dlqId) {
    console.error('Usage: tracestax replay <projectId> <dlqMessageId>');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId) || !/^[a-zA-Z0-9_-]+$/.test(dlqId)) {
    console.error('Error: Invalid ID format.');
    process.exit(1);
  }
  try {
    await request(endpoint, `/v1/projects/${projectId}/dlq/${dlqId}/replay`, apiKey!, 'POST');
    console.log(`DLQ message ${dlqId} replayed successfully.`);
  } catch (err) {
    console.error(`Failed to replay: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdPing() {
  try {
    const ingestEndpoint = endpoint.replace('api.tracestax.com', 'ingest.tracestax.com');
    const data = await request(ingestEndpoint, '/v1/ping', apiKey!);
    console.log(`Connected successfully.`);
    console.log(`  Project: ${data.project_name} (${data.project_id})`);
    console.log(`  Plan: ${data.plan_tier}`);
    console.log(`  Workspace: ${data.workspace_id}`);
  } catch (err) {
    console.error(`Ping failed: ${(err as Error).message}`);
    console.error('Check your API key and try again.');
    process.exit(1);
  }
}

async function cmdTail() {
  const projectId = subcommand || args[0];
  if (!projectId) {
    console.error('Usage: tracestax tail <projectId>');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    console.error('Error: Invalid project ID format.');
    process.exit(1);
  }

  const intervalSecs = Math.max(1, parseInt(values.interval ?? '3', 10) || 3);
  let lastTimestamp = new Date(Date.now() - 10_000).toISOString(); // seed: last 10s

  console.log(`Tailing runs for project ${projectId} (Ctrl+C to stop)…\n`);

  const STATUS_COLORS: Record<string, string> = {
    succeeded: '\x1b[32m', // green
    failed:    '\x1b[31m', // red
    stalled:   '\x1b[33m', // yellow
    timeout:   '\x1b[33m', // yellow
    started:   '\x1b[36m', // cyan
    retried:   '\x1b[35m', // magenta
  };
  const RESET = '\x1b[0m';

  const poll = async () => {
    try {
      const runs: Array<{
        id: string;
        task_name: string;
        status: string;
        duration_ms: number | null;
        timestamp: string;
        queue: string | null;
      }> = await request(endpoint, `/v1/projects/${projectId}/runs?limit=20&after=${encodeURIComponent(lastTimestamp)}`, apiKey!);

      // Sort ascending so oldest prints first
      const sorted = [...runs].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

      for (const run of sorted) {
        const color = STATUS_COLORS[run.status] ?? '';
        const dur = run.duration_ms != null ? `${run.duration_ms}ms` : '—';
        const ago = new Date(run.timestamp).toLocaleTimeString();
        console.log(
          `${color}[${run.status.padEnd(9)}]${RESET} ${run.task_name.padEnd(40)} ${dur.padStart(8)}  ${run.queue ?? '—'}  ${ago}`,
        );
        if (run.timestamp > lastTimestamp) lastTimestamp = run.timestamp;
      }
    } catch {
      // Network hiccups are expected — keep polling
    }
  };

  await poll();
  const timer = setInterval(poll, intervalSecs * 1_000);

  process.on('SIGINT', () => {
    clearInterval(timer);
    console.log('\nStopped.');
    process.exit(0);
  });
}

async function cmdRetry() {
  const runId = subcommand;
  if (!runId) {
    console.error('Usage: tracestax retry <runId>');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    console.error('Error: Invalid run ID format.');
    process.exit(1);
  }

  // Scan projects to find the one containing this run
  const workspace = await request(endpoint, '/v1/workspace', apiKey!);
  for (const p of workspace.projects || []) {
    try {
      const result = await request(endpoint, `/v1/projects/${p.id}/runs/${runId}/retry`, apiKey!, 'POST');
      console.log(`Run ${runId} queued for retry (attempt #${result.new_attempt}).`);
      return;
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('404') || msg.includes('not found')) continue;
      // Re-throw non-404 errors (e.g. 422 "not retryable")
      console.error(`Failed to retry: ${msg}`);
      process.exit(1);
    }
  }
  console.error(`Run ${runId} not found in any project.`);
  process.exit(1);
}

main().catch((err) => {
  if (err?.message?.includes('fetch failed') || err?.message?.includes('ECONNREFUSED')) {
    console.error(`Connection error: Could not reach ${endpoint}`);
    console.error('Check your network connection and endpoint URL.');
  } else {
    console.error(err.message || err);
  }
  process.exit(1);
});
