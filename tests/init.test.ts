/**
 * Tests for the init wizard's framework auto-detection logic.
 *
 * Strategy: create real temp directories with project files, then change cwd
 * into them so the detection functions (which read from process.cwd()) produce
 * the right results. readline is mocked to avoid blocking on stdin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Mock readline so runInit never blocks on stdin ────────────────────────────
// `answers` is consumed in order by each `question()` call.
let answers: string[] = [];

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
      cb(answers.shift() ?? '');
    }),
    close: vi.fn(),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
const originalCwd = process.cwd();
const capturedLogs: string[] = [];
const origLog = console.log;

function captureLog() {
  capturedLogs.length = 0;
  console.log = (...args: unknown[]) => capturedLogs.push(args.map(String).join(' '));
}

function restoreLog() {
  console.log = origLog;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'tracestax-init-'));
  process.chdir(tmpDir);
  answers = [];
  captureLog();
});

afterEach(() => {
  restoreLog();
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ── Node.js / package.json detection ─────────────────────────────────────────

describe('init — Node.js framework detection', () => {
  it('detects BullMQ and includes it in the confirmation prompt', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { bullmq: '^5.0.0' } }));
    answers = ['']; // accept detected framework
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    const output = capturedLogs.join('\n');
    expect(output).toContain('BullMQ');
  });

  it('detects Bull v3 from dependencies', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { bull: '^4.0.0' } }));
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Bull');
  });

  it('detects Temporal from @temporalio/worker', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { '@temporalio/worker': '^1.0.0' } }),
    );
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Temporal');
  });

  it('detects SQS from @aws-sdk/client-sqs in devDependencies', async () => {
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { '@aws-sdk/client-sqs': '^3.0.0' } }),
    );
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('SQS');
  });
});

// ── Python detection ──────────────────────────────────────────────────────────

describe('init — Python framework detection', () => {
  it('detects Celery from requirements.txt', async () => {
    writeFileSync(join(tmpDir, 'requirements.txt'), 'celery==5.3.0\nredis>=5\n');
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Celery');
  });

  it('detects Celery from pyproject.toml', async () => {
    writeFileSync(join(tmpDir, 'pyproject.toml'), '[tool.poetry.dependencies]\ncelery = "^5.3"\n');
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Celery');
  });
});

// ── Ruby detection ────────────────────────────────────────────────────────────

describe('init — Ruby framework detection', () => {
  it('detects Sidekiq from Gemfile', async () => {
    writeFileSync(join(tmpDir, 'Gemfile'), "source 'https://rubygems.org'\ngem 'sidekiq'\n");
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Sidekiq');
  });
});

// ── Go detection ──────────────────────────────────────────────────────────────

describe('init — Go framework detection', () => {
  it('detects Asynq from go.mod', async () => {
    writeFileSync(
      join(tmpDir, 'go.mod'),
      'module example.com/app\n\ngo 1.21\n\nrequire github.com/hibiken/asynq v0.24.1\n',
    );
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Asynq');
  });
});

// ── No detection / manual selection ──────────────────────────────────────────

describe('init — fallback to manual selection', () => {
  it('prints could not auto-detect when no project files present', async () => {
    // Empty temp dir — no framework files
    answers = ['8']; // pick "Generic" (last in list)
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    expect(capturedLogs.join('\n')).toContain('Could not auto-detect');
  });

  it('user can reject the detected framework and pick manually', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { bullmq: '^5.0.0' } }));
    answers = ['n', '8']; // reject BullMQ, pick Generic
    const { runInit } = await import('../src/init');
    await runInit('ts_test_key');
    const output = capturedLogs.join('\n');
    expect(output).toContain('tracestax-run'); // Generic snippet uses tracestax-run
  });
});

// ── Snippet contains API key ──────────────────────────────────────────────────

describe('init — snippet output', () => {
  it('embeds the provided API key in the generated snippet', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { bullmq: '^5.0.0' } }));
    answers = [''];
    const { runInit } = await import('../src/init');
    await runInit('ts_live_testkey123');
    expect(capturedLogs.join('\n')).toContain('ts_live_testkey123');
  });

  it('falls back to placeholder when no API key supplied and user skips input', async () => {
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ dependencies: { bullmq: '^5.0.0' } }));
    answers = ['', '']; // confirm framework, skip API key input
    const { runInit } = await import('../src/init');
    await runInit(undefined); // no env key
    expect(capturedLogs.join('\n')).toContain('YOUR_API_KEY');
  });
});
