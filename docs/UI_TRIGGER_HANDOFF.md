# UI Automation Notes

This note records how cron and Codex hooks appear in the Skill RSI UI after the trigger-layer v1 work. It is implementation context, not a separate product proposal.

## Product model

- Manual runs remain available from the project page.
- Scheduled runs are installed outside Skill RSI through cron or LaunchAgent.
- The UI generates copyable setup commands, but it does not install, enable, disable, or edit operating-system scheduler jobs.
- Codex hooks queue local context only. They never start Skill RSI and never spend model budget.
- A later manual or scheduled run consumes queued hook context and feeds it into planning.
- Repeated non-promotions are normal RSI evidence. The UI path keeps iterating until the configured run ceiling or a real failure.

## What the UI surfaces

- Current automation state: manual only, running, scheduled observed, Codex context waiting, max-runs ceiling, or current failure.
- Pending hook context: event count, latest received time, changed files, optional reason, and optional focus parameters.
- Hook queue counts for `inbox`, `processing`, `processed`, `skipped`, and `failed`.
- Copyable bounded cron/LaunchAgent command using `--max-runs` and `--max-new-runs 1`.
- Copyable Codex Stop hook command requiring an explicit `SKILL_RSI_PROJECT`.

The UI should not show queued hook events as completed runs. Queued context shapes the next loop; it is not itself progress.

## Existing code paths

- `readProjectSummary` returns `automation` summary data for project detail.
- `POST /api/projects/:project/step` consumes queued hooks by default before starting a manual UI run.
- `continuous <project> --consume-hooks` consumes queued hooks for CLI or scheduled runs.
- `scripts/skill-rsi-cron-runner.mjs` wraps `continuous` for cron/LaunchAgent use and consumes hooks by default.
- `scripts/codex-skill-rsi-hook.mjs` is the Codex-specific adapter. It requires `SKILL_RSI_PROJECT`, records sanitized event metadata, and never runs Skill RSI directly.

## Constraints

- Do not add human approval, accept-champion, or review-gate language.
- Do not add plateau state. A kept champion is an experimental result, not a special pause state.
- Do not promote `--patience` or `--max-inconclusive` in UI-generated setup. Those remain CLI-only operator flags.
- Do not infer the project from `cwd` in the Codex hook adapter.
- Keep hook payloads compact and local. Raw Codex payloads are not retained.

## Related docs

- [Scheduling](SCHEDULING.md)
- [Codex hooks](CODEX_HOOKS.md)
- [How it works](HOW_IT_WORKS.md)
