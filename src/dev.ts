/**
 * tracestax dev — Local Simulation Launcher
 *
 * Spawns `docker compose` with the TraceStax app stack so engineers can run
 * a fully local ingest + API + dashboard environment without deploying to
 * Cloudflare. Exits cleanly on Ctrl+C.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_COMPOSE_FILE = 'docker-compose.app.yml';

export function runDev(opts: {
  composeFile?: string;
  profile?: string;
}): void {
  const composeFile = resolve(process.cwd(), opts.composeFile ?? DEFAULT_COMPOSE_FILE);

  if (!existsSync(composeFile)) {
    console.error(`Error: Compose file not found: ${composeFile}`);
    console.error('Run this command from the TraceStax project root, or pass --compose-file <path>.');
    process.exit(1);
  }

  const args = ['compose', '-f', composeFile];
  if (opts.profile) {
    args.push('--profile', opts.profile);
  }
  args.push('up');

  console.log(`Starting local TraceStax stack (${composeFile})…`);
  console.log(`  docker ${args.join(' ')}\n`);

  const child = spawn('docker', args, { stdio: 'inherit' });

  const shutdown = () => {
    child.kill('SIGTERM');
  };

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error('Error: docker not found. Install Docker Desktop or Docker Engine first.');
    } else {
      console.error(`Failed to start docker: ${err.message}`);
    }
    process.exit(1);
  });
}
