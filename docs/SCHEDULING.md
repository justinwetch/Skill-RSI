# Skill RSI Scheduling

Skill RSI does not need a resident daemon for unattended runs. Schedule the CLI command you already trust, and use hard stop rules on every scheduled invocation.

## Recommended Command

```bash
cd /absolute/path/to/Skill\ RSI
node src/cli.js continuous ux-design \
  --agentic \
  --real-eval \
  --max-runs 20 \
  --patience 3 \
  --max-inconclusive 2 \
  --agent-model gpt-5.4-mini
```

Rules:

- Always include `--max-runs`.
- Use `--patience` to stop after repeated non-promotions.
- Use `--max-inconclusive` to stop after repeated `request_new_experiment` outcomes.
- Keep `.env` in the workspace with provider keys; it is loaded automatically and gitignored.
- Inspect the latest run with `node src/cli.js timeline <project>` or `node src/cli.js report <project>`.

## Cron

Run once per day at 2:15 AM:

```cron
15 2 * * * cd /absolute/path/to/Skill\ RSI && /usr/bin/env node src/cli.js continuous ux-design --agentic --real-eval --max-runs 20 --patience 3 --max-inconclusive 2 --agent-model gpt-5.4-mini >> .skill-rsi/cron.log 2>&1
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
    <string>src/cli.js</string>
    <string>continuous</string>
    <string>ux-design</string>
    <string>--agentic</string>
    <string>--real-eval</string>
    <string>--max-runs</string>
    <string>20</string>
    <string>--patience</string>
    <string>3</string>
    <string>--max-inconclusive</string>
    <string>2</string>
    <string>--agent-model</string>
    <string>gpt-5.4-mini</string>
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

## Failure Handling

Each run writes `runs/<run-id>/timeline.jsonl`. If a run throws, Skill RSI appends `run.failed` with the error name and message before rethrowing. The project lock is released in a `finally` block, so the next scheduled invocation can proceed after the underlying issue is fixed.
