# UI Trigger Integration Handoff

This note is context for discussing how cron and Codex hooks should appear in the Skill RSI UI. It is not a UI proposal.

## Current Trigger Model

Skill RSI now separates event capture from loop execution:

- Cron/LaunchAgent is the unattended execution path.
- Codex hooks are event capture only.
- Hook events are queued locally under the project.
- A later manual or scheduled run consumes queued hook context and feeds it into planning.

This avoids spending model budget inside a Codex lifecycle hook and keeps all RSI runs bounded by project budgets and stop rules.

## What Exists In Code

- `continuous <project> --max-runs N --max-new-runs N` supports scheduled, bounded progress.
- `continuous <project> --consume-hooks` consumes queued hook events before running.
- `hook-record <project> --event hook.json|-` queues a hook event without running a loop.
- `scripts/skill-rsi-cron-runner.mjs` wraps `continuous` for cron/LaunchAgent use and consumes hooks by default.
- `scripts/codex-skill-rsi-hook.mjs` is the Codex-specific adapter. It requires `SKILL_RSI_PROJECT`, records sanitized event metadata, and never runs Skill RSI directly.
- Queued hook summaries include event count, event names, changed files, transcript/source references, optional focus parameter IDs, optional parameter IDs, and optional reason text.

## Product Meaning

The UI should treat these as project trigger settings and project trigger state, not as a separate automation product:

- A project can be run manually.
- A project can be scheduled to continue periodically.
- A project can receive Codex hook events that shape the next run.
- Queued hook events should be understandable as pending context, not as runs that already happened.
- Reaching `max-runs`, patience, or inconclusive stop rules can prevent a scheduled wakeup from starting a new loop.

## Important Constraints

- Hooks must not imply instant RSI execution.
- A queued hook is not a loop and should not be displayed as one.
- Cron should always be shown with explicit run ceilings.
- `--max-new-runs 1` means one new loop per scheduler tick, not one loop per hook event.
- Codex hook setup requires an explicit Skill RSI project name.
- Hook payloads are sanitized; raw Codex hook payloads are not retained.
- Transcript paths are audit references only, not stable APIs.
- Local `.env` provider keys still gate real agentic/eval runs.

## Discussion Questions For UI

- Where should users see the current trigger mode and run ceiling?
- How should a user understand “scheduled but stopped by budget or policy”?
- How should pending hook context be surfaced without making it look like completed progress?
- Should the UI expose hook queue folders/states directly, or summarize them?
- What is the right affordance for copying/installing a Codex hook command?
- How should the UI explain the difference between manual run, scheduled run, and hook-informed run?
- What diagnostics should appear when Codex hooks are configured but no scheduled/manual run has consumed them yet?
- What should happen visually when a scheduler invocation finds the project locked?

## Suggested Sources To Read

- `docs/SCHEDULING.md`
- `docs/CODEX_HOOKS.md`
- `src/lib/hooks.js`
- `src/cli.js`
- `scripts/codex-skill-rsi-hook.mjs`
- `scripts/skill-rsi-cron-runner.mjs`
- `test/triggers.test.js`
