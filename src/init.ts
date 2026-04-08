#!/usr/bin/env node
/**
 * tracestax init — Auto-Instrumentation Wizard
 *
 * Detects the user's job-queue framework from project files, then prints
 * a ready-to-paste instrumentation snippet. Optionally writes a config file.
 */

import { createInterface } from 'node:readline';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Framework detection ─────────────────────────────────────────────

interface DetectedFramework {
  id: string;
  label: string;
  language: string;
  snippet: (apiKey: string) => string;
}

const FRAMEWORKS: DetectedFramework[] = [
  {
    id: 'bullmq',
    label: 'BullMQ (Node.js)',
    language: 'typescript',
    snippet: (apiKey) => `import { Queue, Worker } from 'bullmq';
import { configure } from '@tracestax/node';

const queue = new Queue('my-queue');
const worker = new Worker('my-queue', async (job) => {
  // your job handler
});

configure(queue, { apiKey: '${apiKey}' }, worker);`,
  },
  {
    id: 'celery',
    label: 'Celery (Python)',
    language: 'python',
    snippet: (apiKey) => `from celery import Celery
import tracestax

app = Celery('myapp', broker='redis://localhost:6379/0')
tracestax.configure(app, api_key='${apiKey}')`,
  },
  {
    id: 'sidekiq',
    label: 'Sidekiq (Ruby)',
    language: 'ruby',
    snippet: (apiKey) => `require 'tracestax'

Tracestax.configure do |config|
  config.api_key = '${apiKey}'
end

# Add middleware in your Sidekiq initializer:
Sidekiq.configure_server do |config|
  config.server_middleware do |chain|
    chain.add Tracestax::SidekiqMiddleware
  end
end`,
  },
  {
    id: 'temporal',
    label: 'Temporal (Node.js)',
    language: 'typescript',
    snippet: (apiKey) => `import { Worker } from '@temporalio/worker';
import { TraceStaxTemporalInterceptor } from '@tracestax/node';

const worker = await Worker.create({
  taskQueue: 'my-task-queue',
  interceptors: {
    workflowModules: [require.resolve('./temporal-interceptors')],
    activityInbound: [() => new TraceStaxTemporalInterceptor({ apiKey: '${apiKey}' })],
  },
});`,
  },
  {
    id: 'sqs',
    label: 'AWS SQS (Node.js)',
    language: 'typescript',
    snippet: (apiKey) => `import { SQSClient } from '@aws-sdk/client-sqs';
import { TraceStaxSQSConsumer } from '@tracestax/node';

const consumer = new TraceStaxSQSConsumer({
  apiKey: '${apiKey}',
  queueUrl: process.env.SQS_QUEUE_URL!,
  sqs: new SQSClient({ region: 'us-east-1' }),
  handleMessage: async (msg) => {
    // your message handler
  },
});
consumer.start();`,
  },
  {
    id: 'bull',
    label: 'Bull v3/v4 (Node.js)',
    language: 'typescript',
    snippet: (apiKey) => `import Bull from 'bull';
import { TraceStaxBullMonitor } from '@tracestax/node';

const queue = new Bull('my-queue');
const monitor = new TraceStaxBullMonitor({ apiKey: '${apiKey}' });
monitor.monitorQueue(queue);`,
  },
  {
    id: 'asynq',
    label: 'Asynq (Go)',
    language: 'go',
    snippet: (apiKey) => `import "github.com/tracestax/sdk-go/tracestax"

client := tracestax.NewClient(tracestax.Config{APIKey: "${apiKey}"})
defer client.Close()

// Wrap your asynq handler:
handler := tracestax.WrapAsynqHandler(client, myHandler)`,
  },
  {
    id: 'generic',
    label: 'Other / Generic',
    language: 'shell',
    snippet: (apiKey) => `# Use tracestax-run to monitor any script:
TRACESTAX_API_KEY='${apiKey}' tracestax-run \\
  --task-name "my-task" \\
  --queue "default" \\
  -- python my_script.py`,
  },
];

function detectFromPackageJson(): DetectedFramework | null {
  const pkgPath = join(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps['bullmq']) return FRAMEWORKS.find((f) => f.id === 'bullmq') ?? null;
  if (deps['bull'])   return FRAMEWORKS.find((f) => f.id === 'bull') ?? null;
  if (deps['@temporalio/worker']) return FRAMEWORKS.find((f) => f.id === 'temporal') ?? null;
  if (deps['@aws-sdk/client-sqs'] || deps['@aws-sdk/sqs']) return FRAMEWORKS.find((f) => f.id === 'sqs') ?? null;
  return null;
}

function detectFromPython(): DetectedFramework | null {
  const files = ['pyproject.toml', 'requirements.txt', 'Pipfile'];
  for (const file of files) {
    const p = join(process.cwd(), file);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8').toLowerCase();
    if (text.includes('celery'))  return FRAMEWORKS.find((f) => f.id === 'celery') ?? null;
  }
  return null;
}

function detectFromRuby(): DetectedFramework | null {
  const gemfile = join(process.cwd(), 'Gemfile');
  if (!existsSync(gemfile)) return null;
  const text = readFileSync(gemfile, 'utf8').toLowerCase();
  if (text.includes('sidekiq')) return FRAMEWORKS.find((f) => f.id === 'sidekiq') ?? null;
  return null;
}

function detectFromGo(): DetectedFramework | null {
  const gomod = join(process.cwd(), 'go.mod');
  if (!existsSync(gomod)) return null;
  const text = readFileSync(gomod, 'utf8');
  if (text.includes('hibiken/asynq') || text.includes('riverqueue/river')) {
    return FRAMEWORKS.find((f) => f.id === 'asynq') ?? null;
  }
  return null;
}

function autoDetect(): DetectedFramework | null {
  return detectFromPackageJson() ?? detectFromPython() ?? detectFromRuby() ?? detectFromGo();
}

// ── Prompt helpers ──────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

// ── Main wizard ─────────────────────────────────────────────────────

export async function runInit(envApiKey?: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nTraceStax Init — Auto-Instrumentation Wizard\n');

  // Step 1: detect framework
  const detected = autoDetect();
  let framework: DetectedFramework;

  if (detected) {
    console.log(`Detected: ${detected.label}`);
    const confirm = await ask(rl, `Use ${detected.label}? [Y/n] `);
    if (confirm.trim().toLowerCase() === 'n') {
      framework = await pickFramework(rl);
    } else {
      framework = detected;
    }
  } else {
    console.log('Could not auto-detect framework.');
    framework = await pickFramework(rl);
  }

  // Step 2: get API key
  let apiKey = envApiKey ?? process.env.TRACESTAX_API_KEY ?? '';
  if (!apiKey) {
    apiKey = await ask(rl, 'TraceStax API key (or set TRACESTAX_API_KEY): ');
    apiKey = apiKey.trim();
    if (!apiKey) {
      apiKey = 'YOUR_API_KEY';
    }
  } else {
    console.log(`Using API key from environment: ${apiKey.slice(0, 8)}••••`);
  }

  rl.close();

  // Step 3: print snippet
  const snippet = framework.snippet(apiKey);
  console.log('\n─────────────────────────────────────────────────');
  console.log(`Instrumentation snippet (${framework.label}):\n`);
  console.log(snippet);
  console.log('─────────────────────────────────────────────────\n');

  // Step 4: offer config file for TypeScript/Node projects
  if (framework.language === 'typescript' && existsSync(join(process.cwd(), 'package.json'))) {
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const write = await ask(rl2, 'Write snippet to tracestax.setup.ts? [y/N] ');
    rl2.close();
    if (write.trim().toLowerCase() === 'y') {
      const outPath = join(process.cwd(), 'tracestax.setup.ts');
      writeFileSync(outPath, `// Generated by tracestax init\n${snippet}\n`);
      console.log(`Written to ${outPath}`);
    }
  }

  console.log('Done! Run `tracestax ping` to verify your connection.\n');
}

async function pickFramework(rl: ReturnType<typeof createInterface>): Promise<DetectedFramework> {
  console.log('\nAvailable frameworks:');
  FRAMEWORKS.forEach((f, i) => console.log(`  ${i + 1}. ${f.label}`));
  const choice = await ask(rl, '\nPick a number: ');
  const idx = parseInt(choice.trim(), 10) - 1;
  if (idx >= 0 && idx < FRAMEWORKS.length) return FRAMEWORKS[idx];
  console.log('Invalid choice, defaulting to Generic.');
  return FRAMEWORKS[FRAMEWORKS.length - 1];
}
