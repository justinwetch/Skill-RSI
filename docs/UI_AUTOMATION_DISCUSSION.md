# UI Automation Discussion Brief

This brief is a handoff for discussing UI support for cron and Codex hook automation. It is not an implementation spec yet.

## Current Backend Capabilities

- Codex hook events can be recorded without starting model-backed work.
- Hook payloads are sanitized and queued under `.skill-rsi/projects/<project>/hooks/`.
- Scheduled runs can consume hook events with `--consume-hooks`.
- `--max-runs` sets the total project run ceiling.
- `--max-new-runs` optionally caps how many new loops a scheduler tick can start.
- Queue states are explicit: `inbox`, `processing`, `processed`, `skipped`, and `failed`.
- Stale processing events are reclaimed only when the project is not locked.
- Project lock contention requeues claimed events instead of marking them failed.

## Data The UI Could Expose

- Queue counts by state.
- Most recent hook event timestamp, event name, changed files, and queue status.
- Most recent scheduled run outcome from CLI output or run timeline.
- Whether `run.lock` currently exists.
- Suggested cron and LaunchAgent command snippets for the selected project.
- Setup checklist:
  - Codex hook project name is explicit.
  - Scheduler command includes `--max-runs`.
  - Cadence-limited schedules include `--max-new-runs`.
  - Logs point under `.skill-rsi/`.

## Recommended V1 Surface

Build observability and setup guidance first:

- Read-only Automation panel within the project view.
- Queue status summary with small counts and last updated times.
- Last hook event summary.
- Last scheduled outcome summary.
- Copyable command snippets for cron and LaunchAgent.
- Setup checklist with pass/warn states derived from project files where possible.

## Controls To Defer

Do not include these in v1:

- Run automation now buttons.
- Editing cron or LaunchAgent files from the UI.
- Requeue, delete, or mutate queue events.
- System-level installer flows.
- Parsing Codex transcripts.

## Risks To Discuss Before UI Implementation

- UI controls can make model-spend actions feel casual; read-only status avoids that initially.
- Queue mutation needs stronger operator affordances than project status display.
- Scheduler installation is platform-specific and should not be hidden behind a generic button.
- Automation state currently lives in files, so the UI needs a small backend API before it can display queue state cleanly.

## Open Product Questions

- Should automation status live as a tab in the project view or as a compact card near run controls?
- Should v1 only show local filesystem-derived state, or should it also infer configured cron/LaunchAgent status?
- Should command snippets default to cadence-limited mode or batch RSI mode?
- How prominent should skipped and failed queue states be in the main project surface?

UI_DISCUSSION_READY
