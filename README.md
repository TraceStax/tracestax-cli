# @tracestax/cli

Command-line interface for TraceStax — inspect workers, stream run events, manage alerts, and wrap shell scripts with zero-code instrumentation.

## Installation

```bash
npm install -g @tracestax/cli
```

This installs two binaries:

- `tracestax` — interactive CLI for inspecting your workspace
- `tracestax-run` — process wrapper for instrumenting any shell command

## Authentication

Set your API key as an environment variable:

```bash
export TRACESTAX_API_KEY=ts_live_...
```

Or pass it inline with `--api-key`:

```bash
tracestax --api-key ts_live_... status
```

Get your project API key from the TraceStax dashboard under **Project → Rotate Key**. Project API keys (`ts_live_...` / `ts_test_...`) are used for project-scoped commands and are sent as Bearer tokens to either the control-plane API (`api.tracestax.com`) or the ingest API (`ingest.tracestax.com`). Control-plane commands (`status`, `alerts`, `projects list`) require Clerk authentication via your workspace session rather than a static API key.

## Commands

### `tracestax status`

Show a workspace overview: plan, event quota, and project list.

```
$ tracestax status
Workspace: ws_abc123
Plan: pro  |  Events: 142,300/1,000,000
Projects: 2
  - payments (proj_xyz)
  - notifications (proj_abc)
```

### `tracestax alerts`

List all firing alerts across projects.

```
$ tracestax alerts
payments:
  [CRITICAL] Worker failure rate exceeded 5%  (alert_xyz)
```

### `tracestax alerts mute <alertId> <minutes>`

Acknowledge a firing alert.

```bash
tracestax alerts mute alert_xyz 30
```

### `tracestax projects list`

List all projects in your workspace.

### `tracestax workers list <projectId>`

Show active workers for a project.

```
$ tracestax workers list proj_xyz
Workers:
  worker-1.internal  ip-10-0-0-1  pid=4521  last_seen=8s ago
  worker-2.internal  ip-10-0-0-2  pid=4522  last_seen=12s ago
```

### `tracestax tail <projectId>`

Stream recent run events for a project (polls every 3 seconds).

```
$ tracestax tail proj_xyz
[succeeded ] charge_card                              142ms  payments  10:04:01
[failed    ] send_invoice                              89ms  invoices  10:04:03
[succeeded ] sync_customer                            310ms  default   10:04:06
```

Press `Ctrl+C` to stop.

Options:
- `--interval <seconds>` — poll interval (default: 3)

### `tracestax retry <runId>`

Retry a failed run.

```bash
tracestax retry run_abc123
```

### `tracestax replay <runId>`

Replay a failed DLQ message.

```bash
tracestax replay run_abc123
```

### `tracestax ping`

Verify your API key is valid and check which project it belongs to.

```
$ tracestax ping
Connected successfully.
  Project: payments (proj_xyz)
  Plan: pro
  Workspace: ws_abc123
```

### `tracestax init`

Auto-instrumentation wizard. Detects your job queue framework from project files and prints a ready-to-paste setup snippet. Optionally writes a `tracestax.setup.ts` file.

```bash
tracestax init
```

Supports: BullMQ, Bull, Celery, Sidekiq, Temporal, AWS SQS, Asynq (Go), and generic shell scripts.

### `tracestax dev`

Start the local TraceStax stack via Docker Compose. Useful during development.

```bash
tracestax dev
tracestax dev --compose-file docker-compose.app.yml --profile sim
```

---

## `tracestax-run` — Zero-code process wrapper

Wrap any shell command to send `started` / `succeeded` / `failed` events to TraceStax — no code changes required.

```bash
tracestax-run \
  --project-id proj_xyz \
  --task-name nightly-sync \
  --queue cron \
  -- python sync.py --full
```

Options:

| Flag | Env var | Description |
|------|---------|-------------|
| `--api-key` | `TRACESTAX_API_KEY` | API key |
| `--project-id` | `TRACESTAX_PROJECT_ID` | Project ID |
| `--task-name` | `TRACESTAX_TASK_NAME` | Task name shown in dashboard |
| `--queue` | `TRACESTAX_QUEUE` | Queue label (default: `default`) |

The wrapped process's exit code is preserved — `tracestax-run` never swallows failures.

---

## Options (all commands)

| Flag | Description |
|------|-------------|
| `-k, --api-key <key>` | API key (overrides `TRACESTAX_API_KEY`) |
| `--endpoint <url>` | Control-plane API endpoint (default: `https://api.tracestax.com`). `ping` and `tracestax-run` derive the ingest endpoint from this value automatically. |
| `-h, --help` | Show help |

## Documentation

Full documentation at [docs.tracestax.com](https://docs.tracestax.com).
