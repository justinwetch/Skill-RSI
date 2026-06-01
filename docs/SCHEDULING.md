# Skill RSI Scheduling

Skill RSI does not need a resident daemon for unattended runs. Schedule the CLI command you already trust, keep explicit run ceilings on every invocation, and choose whether a scheduled wakeup should make batch RSI progress or only start a small number of new loops.

The UI Automation panel can generate bounded cron/LaunchAgent and Codex hook commands for a project, but it does not install, enable, disable, or edit operating-system scheduler jobs. Treat the copied command as setup guidance: paste it into your own cron or LaunchAgent configuration, then the UI reports observed queue and run state as those invocations happen.

UI-generated scheduled commands intentionally use the core RSI ceiling flags (`--max-runs` and `--max-new-runs 1`) and omit advanced stop flags by default. Repeated non-promoting loops are normal RSI evidence; unattended runs stop when they hit an explicit run ceiling or a real failure.

## Recommended Cadence-Limited Command

Use this when each scheduler tick should start at most one new loop while the project still has total budget remaining:

```bash
cd /absolute/path/to/Skill\ RSI
node scripts/skill-rsi-cron-runner.mjs ux-design \
  --agentic \
  --real-eval \
  --max-runs 20 \
  --max-new-runs 1 \
  --agent-model gpt-5.5
```

PowerShell:

```powershell
Set-Location 'C:\path\to\Skill RSI'
node scripts/skill-rsi-cron-runner.mjs ux-design `
  --agentic `
  --real-eval `
  --max-runs 20 `
  --max-new-runs 1 `
  --agent-model gpt-5.5
```

Rules:

- Always include `--max-runs`; it is the total project ceiling.
- Add `--max-new-runs` when a scheduler tick should cap how many new loops it can start.
- Omit `--max-new-runs` for batch RSI mode, where one invocation may run all remaining loops up to `--max-runs`.
- The cron runner forwards to `node src/cli.js continuous <project> --consume-hooks`; use `--no-consume-hooks` only for a purely time-based run.
- Keep `.env` in the workspace with provider keys; it is loaded automatically and gitignored.
- Inspect the latest run with `node src/cli.js timeline <project>` or `node src/cli.js report <project>`.

Advanced stop flags exist for CLI-only operator experiments, but they are not the default RSI automation model. The UI-generated path keeps iterating until `--max-runs` or a real failure.

## Operator Modes

| Mode | Command shape | Behavior |
| --- | --- | --- |
| Cadence-limited | `--max-runs 20 --max-new-runs 1` | Start at most one new loop this scheduler tick, until the project reaches total run 20. |
| Batch RSI | `--max-runs 20` | Run all remaining loops now, until total run 20. |
| Queue drain | `--max-runs 0 --consume-hooks` | Claim queued hook events, mark them skipped, and start no loops. |

## Cron

Run once per day at 2:15 AM, with one new loop per tick:

```cron
15 2 * * * cd /absolute/path/to/Skill\ RSI && /usr/bin/env node scripts/skill-rsi-cron-runner.mjs ux-design --agentic --real-eval --max-runs 20 --max-new-runs 1 --agent-model gpt-5.5 >> .skill-rsi/cron.log 2>&1
```

Run batch RSI progress instead by omitting `--max-new-runs`:

```bash
node scripts/skill-rsi-cron-runner.mjs ux-design \
  --agentic \
  --real-eval \
  --max-runs 20 \
  --agent-model gpt-5.5
```

Drain queued Codex hook events without starting a loop:

```bash
node src/cli.js continuous ux-design \
  --consume-hooks \
  --max-runs 0
```

PowerShell:

```powershell
node src/cli.js continuous ux-design `
  --consume-hooks `
  --max-runs 0
```

## macOS LaunchAgent

Create `~/Library/LaunchAgents/com.local.skill-rsi.ux-design.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.skill-rsi.ux-design</string>

  <key>WorkingDirectory</key>
  <string>/absolute/path/to/Skill RSI</string>

  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>scripts/skill-rsi-cron-runner.mjs</string>
    <string>ux-design</string>
    <string>--agentic</string>
    <string>--real-eval</string>
    <string>--max-runs</string>
    <string>20</string>
    <string>--max-new-runs</string>
    <string>1</string>
    <string>--agent-model</string>
    <string>gpt-5.5</string>
  </array>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>2</integer>
    <key>Minute</key>
    <integer>15</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>/absolute/path/to/Skill RSI/.skill-rsi/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>/absolute/path/to/Skill RSI/.skill-rsi/launchd.err.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.local.skill-rsi.ux-design.plist
```

Unload it:

```bash
launchctl unload ~/Library/LaunchAgents/com.local.skill-rsi.ux-design.plist
```

## Windows Task Scheduler

For Windows, configure Task Scheduler to run PowerShell with a bounded command:

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Set-Location 'C:\path\to\Skill RSI'; node scripts/skill-rsi-cron-runner.mjs ux-design --agentic --real-eval --max-runs 20 --max-new-runs 1 --agent-model gpt-5.5"
```

Use the same ceiling rules as cron: keep `--max-runs` explicit, add `--max-new-runs 1` when each scheduled wakeup should start at most one new loop, and keep API keys in `.env` or the browser-local UI key field rather than in the scheduled command.

## Queue Lifecycle

Queued hook events live under `.skill-rsi/projects/<project>/hooks/`.

| Transition | Meaning |
| --- | --- |
| `inbox -> processing -> processed` | A manual or scheduled run claimed the event and completed at least one loop. |
| `inbox -> processing -> skipped` | The event was claimed, but no loop ran because the project was already at budget. |
| `inbox -> processing -> failed` | The event was claimed, and the manual or scheduled invocation failed. |
| `processing -> inbox` | A stale processing event was reclaimed after 30 minutes while the project was unlocked. |
| `processing -> inbox` | A newly claimed event was requeued because another run already held `run.lock`. |

Codex hooks only record events. Manual or scheduled invocations decide whether to spend model budget.
Each manual or scheduled invocation claims the current `inbox` contents as one hook-signal batch. `--max-new-runs 1` limits a scheduled invocation to one new RSI loop; it does not mean one loop per hook event.

## Troubleshooting

- Inspect queue folders with `ls .skill-rsi/projects/<project>/hooks/`.
- `processing` means an invocation claimed the event and is expected to finish it.
- `processed` means at least one loop completed with the event context.
- `skipped` means no loop ran; inspect `queueReason` in the event JSON.
- `failed` means the manual or scheduled invocation threw; inspect `queueError` in the event JSON and the server, cron, or LaunchAgent log.
- If `run.lock` exists, another run is active or a prior run did not release its lock. Do not delete it until you verify no Skill RSI process is still running.
- Cron logs should be redirected to `.skill-rsi/cron.log`.
- LaunchAgent stdout and stderr should point to stable files under `.skill-rsi/`, as shown above.

## Failure Handling

Each run writes `runs/<run-id>/timeline.jsonl`. If a run throws, Skill RSI appends `run.failed` with the error name and message before rethrowing. The project lock is released in a `finally` block, so the next manual or scheduled invocation can proceed after the underlying issue is fixed.

If an invocation crashes after claiming events, processing files older than 30 minutes are reclaimed back into `hooks/inbox/` on the next `--consume-hooks` run, but only when the project is not currently locked. If the project is already locked by another run, newly claimed events are immediately requeued instead of being marked failed.
