# Codex Hooks

Skill RSI treats Codex hooks as deterministic event capture, not as a place to run model-backed improvement loops. The hook entrypoint records Codex stdin JSON into a project queue. A later manual run, MCP console action, cron invocation, or LaunchAgent invocation decides whether a Skill RSI loop should run.

Official references:

- [Codex hooks](https://developers.openai.com/codex/hooks): hooks run from Codex lifecycle events, receive JSON on stdin, and require user trust review.
- [Codex noninteractive mode](https://developers.openai.com/codex/noninteractive): use `codex exec` for scripted Codex work when needed.
- [Codex GitHub Action](https://developers.openai.com/codex/github-action): use `openai/codex-action` for hosted GitHub automation later.

## Safety Model

- Codex hooks only record events.
- Manual and scheduled runners decide model spend.
- Hook payloads are sanitized to a small allowlisted event shape.
- Raw payloads are not retained; Skill RSI stores only a SHA-256 hash for debugging.
- `transcriptPath` is retained as an opaque audit reference, not parsed as a stable API.
- `sourceEventPath` may be retained for manually recorded event files; workspace `cwd` is not retained in queue payloads.
- The hook script never runs `continuous`, `run`, `agent`, or any other model-backed command.

## Local Hook

Prefer a `Stop` hook for v1. It captures the final state of a Codex turn without firing repeatedly during every command or file edit.

Set the project name explicitly. The Codex adapter fails closed when `SKILL_RSI_PROJECT` is missing, so hook events are never silently queued to a project inferred from the repository folder name:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "SKILL_RSI_PROJECT=ux-design node \"/absolute/path/to/Skill RSI/scripts/codex-skill-rsi-hook.mjs\""
          }
        ]
      }
    ]
  }
}
```

PowerShell command variant for Windows hook configuration:

```text
$env:SKILL_RSI_PROJECT='ux-design'; node 'C:\path\to\Skill RSI\scripts\codex-skill-rsi-hook.mjs'
```

The Codex adapter reads the Codex hook payload from stdin, adds changed files from the payload or local git diff when available, sanitizes it, and writes one JSON file to:

```text
.skill-rsi/projects/<project>/hooks/inbox/
```

For `Stop`, the script writes a neutral JSON response to stdout and writes the queue path to stderr, because Codex expects JSON stdout for that event.

## Manual Recording

Use `hook-record` when testing without Codex:

```bash
printf '{"hook_event_name":"Stop","changedFiles":["SKILL.md"],"transcript_path":"/tmp/codex.jsonl"}' \
  | node src/cli.js hook-record ux-design --event -
```

PowerShell:

```powershell
'{"hook_event_name":"Stop","changedFiles":["SKILL.md"],"transcript_path":"C:/Temp/codex.jsonl"}' |
  node src/cli.js hook-record ux-design --event -
```

The normalized event keeps `transcriptPath` only as audit context and stores `rawPayloadSha256` instead of the raw payload.

## Scheduled Consumption

Use the cron runner for unattended execution:

```bash
node scripts/skill-rsi-cron-runner.mjs ux-design \
  --agentic \
  --real-eval \
  --max-runs 20 \
  --max-new-runs 1 \
  --agent-model gpt-5.5
```

The runner forwards to:

```bash
node src/cli.js continuous ux-design --consume-hooks ...
```

`--max-runs` is the total project ceiling. Add `--max-new-runs` when a scheduled invocation should start only a bounded number of new loops. Omit `--max-new-runs` for batch RSI mode.

## Queue Lifecycle

| Transition | Meaning |
| --- | --- |
| `inbox -> processing -> processed` | A manual or scheduled run claimed the event and completed at least one loop. |
| `inbox -> processing -> skipped` | The event was claimed, but no loop ran because the project was already at budget. |
| `inbox -> processing -> failed` | The event was claimed, and the manual or scheduled invocation failed. |
| `processing -> inbox` | A stale processing event was reclaimed after 30 minutes while the project was unlocked. |
| `processing -> inbox` | A newly claimed event was requeued because another run already held `run.lock`. |

Manual, MCP console, and scheduled invocations claim all current `inbox` events as one hook-signal batch. The MCP console's "Run one loop with queued Codex context" action starts at most one loop. `--max-new-runs 1` caps a scheduler tick to one new RSI loop; it does not create one loop per hook event.

Reliability behavior:

- Processing events older than 30 minutes are reclaimed into `hooks/inbox/` on the next `--consume-hooks` run, unless `run.lock` shows an active project run.
- Project lock contention is treated as retryable: claimed events move back to `hooks/inbox/` and the scheduler exits cleanly.

## Troubleshooting

- Inspect queued events with `ls .skill-rsi/projects/<project>/hooks/inbox/`.
- Inspect active claims with `ls .skill-rsi/projects/<project>/hooks/processing/`.
- Inspect skipped events when a project is already at its run budget.
- Inspect failed events for `queueError` and compare with cron or LaunchAgent logs.
- If `run.lock` exists, confirm whether a Skill RSI process is still active before removing it.
- If queue files repeatedly return to `inbox`, check for overlapping scheduler invocations or stale project locks.

## Hosted Automation

Do not copy the local hook script into GitHub Actions as-is. If hosted automation is needed, use `openai/codex-action` and keep the same separation of responsibilities:

- GitHub/Codex automation records or opens follow-up work.
- Manual or scheduled Skill RSI runs decide when to spend model budget.
