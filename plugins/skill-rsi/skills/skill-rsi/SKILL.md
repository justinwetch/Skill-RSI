---
name: skill-rsi
description: Use when the user wants to create, improve, evaluate, inspect, run, schedule, automate, or export Skill RSI projects or Agent Skill improvement loops. Prefer Skill RSI's existing UI and CLI surfaces until MCP tools are available.
---

# Skill RSI Operator

Skill RSI is a local recursive self-improvement system for Agent Skill packages. Use it when a user wants to create a new skill, improve an existing skill, run improvement loops, inspect evidence, schedule bounded runs, queue Codex context, or export a champion skill.

## Product Model

Skill RSI improves skills through controlled experiments:

- Scratch projects have no champion, so the first run creates Candidate A and Candidate B. The winner becomes the first champion only if the evaluation evidence is usable.
- After a champion exists, Skill RSI creates one challenger and evaluates that challenger directly against the current champion.
- Baseline-upload projects start with the uploaded skill as champion v0 and skip the cold-start A/B bootstrap.
- Promotion is evidence-gated. A numerical edge alone is not enough if the challenger regresses on stable prompts, fails package review, or lacks sufficient evaluation evidence.

Do not describe human approval as part of the default RSI loop. The user sets goals, budget, and constraints; Skill RSI records evidence and promotes or keeps champions through its policy gate.

## Current Surfaces

This plugin provides a Skill RSI operator skill, a local MCP control plane, and a guided MCP-UI cockpit through `skill_rsi_open` where the host supports MCP Apps/UI rendering.

Use the existing surfaces:

- Local app: best for project setup, watching live runs, reviewing evidence, viewing visual screenshots, and inspecting skill packages.
- CLI: best for reproducible local operation, project creation, baseline import, progress checks, scheduling, hooks, and export.
- MCP tools: best for structured Codex operation of common project actions without shell-command guessing.
- MCP-UI cockpit: best for guided embedded project setup, current state, next loop plan, target-batch runs, context queueing, and champion export when host support is available.
- Documentation: use `docs/HOW_IT_WORKS.md`, `docs/SCHEDULING.md`, `docs/CODEX_HOOKS.md`, and `docs/CODEX_PLUGIN_SURFACE_PLAN.md` as source-of-truth context.

Prefer MCP tools for supported project operations. Prefer exact Skill RSI CLI commands over invented workflows when no MCP tool covers the task. If you are uncertain whether a command exists, inspect `node src/cli.js --help` before suggesting it.

## Operating Rules

- Keep model-backed runs explicit and bounded.
- Do not run full RSI loops from a Codex hook process.
- Treat hooks as context capture unless the project later implements explicit hook-autorun through normal Skill RSI queue, lock, budget, and run-recording machinery.
- Keep `SKILL_RSI_PROJECT` explicit in hook setup; never infer the project from the current working directory.
- Do not claim apps connector, plugin autorun, detailed embedded evidence panels, or full MCP-UI visual screenshot inspection exist until the repository actually implements them.
- Do not invent project state. Use the app, CLI, or project files to inspect current truth.
- Preserve Skill RSI terminology: champion, challenger, cold-start duel, next loop plan, prompt bank, ontology, deconstruction, promotion gate.

## MCP Tool Preference

When available, prefer these tools for supported actions:

- `skill_rsi_doctor`: inspect local readiness without exposing secrets.
- `skill_rsi_open`: open the guided cockpit or return a text fallback.
- `skill_rsi_list_projects`: list local projects.
- `skill_rsi_create_project`: create a scratch or baseline project.
- `skill_rsi_run_next`: start bounded manual loop execution.
- `skill_rsi_progress`: inspect run progress.
- `skill_rsi_get_next_loop_plan`: read the current next-loop premise.
- `skill_rsi_get_champion`: read champion metadata and `SKILL.md`.
- `skill_rsi_export_champion`: export the champion package.
- `skill_rsi_record_context`: queue explicit context without running a loop.

Tell the user before using `skill_rsi_run_next` or the cockpit's run action, because either can start model-backed work depending on mode and eval settings.

## Useful CLI Shapes

Use these as patterns, adapting project names and options to the user's request:

```bash
node src/cli.js init my-skill --goal "Help agents write better..." --output text --model gpt-5.4-mini --target-iterations 3
node src/cli.js run my-skill --agentic --real-eval
node src/cli.js progress my-skill
node src/cli.js report my-skill
node src/cli.js skill my-skill --source champion
node src/cli.js export-skill my-skill --source champion --out ./exported-skill
node scripts/skill-rsi-cron-runner.mjs my-skill --agentic --real-eval --max-runs 20 --max-new-runs 1 --agent-model gpt-5.4-mini
```

For Codex hook context capture, prefer the example in `plugins/skill-rsi/hooks/codex-stop-hook.example.json` and the detailed explanation in `docs/CODEX_HOOKS.md`.

## Response Style

When helping a user operate Skill RSI:

1. Identify the project state first.
2. Recommend the next valid action.
3. Use existing app/CLI/docs behavior.
4. State when an action will spend model budget.
5. Keep implementation details concise unless the user asks for a deeper audit.
