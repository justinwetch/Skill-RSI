---
name: skill-rsi
description: Use when the user wants to create, improve, evaluate, inspect, run, schedule, automate, or export Skill RSI projects or Agent Skill improvement loops. In Codex desktop, every Skill RSI invocation must open the local Skill RSI web app/sidebar first.
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

This plugin provides a Skill RSI operator skill, the local Skill RSI web app, a local MCP control plane, and an optional MCP-UI cockpit through `skill_rsi_cockpit` where the host robustly supports MCP Apps/UI rendering. In Codex desktop, the local web app in the in-app browser/sidebar is the product surface.

Use the existing surfaces:

- Local app: default Codex surface for every Skill RSI request in Codex desktop, and best for project setup, watching live runs, reviewing evidence, viewing visual screenshots, and inspecting skill packages.
- `skill_rsi_open`: returns the local app URL for Browser/sidebar launch. It does not inspect projects or start loops.
- MCP tools: prepare state for the local app or perform explicit follow-up actions only after the user asks.
- MCP-UI cockpit: optional explicit existing-project inspection fallback. Do not use it as the default Codex desktop launch path.
- CLI: best for reproducible local operation, scheduling, hooks, and export when a MCP tool does not cover the task.
- Documentation: use `docs/HOW_IT_WORKS.md`, `docs/SCHEDULING.md`, `docs/CODEX_HOOKS.md`, and `docs/CODEX_PLUGIN_SURFACE_PLAN.md` as source-of-truth context.

## App-First Invariant

If the user's request invokes Skill RSI in Codex desktop, the first visible outcome must be the local web app in the Codex sidebar. This applies to creating projects, improving a baseline skill, inspecting evidence, viewing history, scheduling, hook setup, exporting champions, or starting a guided project flow.

The chat should not become the primary Skill RSI control surface. Use chat only to resolve missing required inputs, report failures, or state the one action just taken.

Use this sequence for every Skill RSI request:

1. If a fresh project/import is needed, call `skill_rsi_prepare_project` with any known name, goal, baseline path, model, and output type. This prepares the create screen; it does not create a project.
2. Call `skill_rsi_open` with the existing project ID or with `create: true` and the prepared draft ID.
3. If `skill_rsi_open` reports the server is not reachable, start `npm run server` from the Skill RSI repository root, then call `skill_rsi_open` again.
4. Use the Browser plugin to show the returned `launchUrl` in the Codex in-app browser/sidebar.
5. Reply with one terse line such as `Opened Skill RSI setup.`

After opening the app, stop. Do not summarize project choices, conduct a parameter interview, recommend a run, inspect progress, create the project, or inspect old projects unless the user explicitly asks.

Use `skill_rsi_create_project` only when the user explicitly provides or requests the setup choices in chat and asks Codex to create the project directly. Plain "improve this skill" requests should land on the prefilled setup screen so the user can choose output artifact type, model, and other irreversible setup choices in the UI.

Use `skill_rsi_cockpit` only when the user specifically asks for the MCP console/cockpit or the local web app cannot be opened. It requires explicit existing-project intent.

## Fresh-Run Default

Default to a new Skill RSI run/project flow when the user says "improve this skill", "use Skill RSI on this", "run Skill RSI", or otherwise invokes Skill RSI without naming an existing project or past run.

Do not inspect, summarize, or select from past Skill RSI projects before starting that fresh flow unless the user explicitly asks for prior results, history, evidence, an existing champion, a named project, or a specific run. Existing projects are relevant only when the user refers to them.

When a target skill path or package is clear, treat it as a new baseline input. Prepare a fresh setup draft for the local app, then open the app. If a generated project name would collide with an existing project, use a fresh suffixed project name such as `<base>-2` for the draft; do not inspect the old project and do not turn the interaction into a review of old projects.

Name collisions are not a reason to inspect past projects. For fresh flows, use a new project name instead.

## Operating Rules

- Keep model-backed runs explicit and bounded.
- Do not run full RSI loops from a Codex hook process.
- Treat hooks as context capture unless the project later implements explicit hook-autorun through normal Skill RSI queue, lock, budget, and run-recording machinery.
- Keep `SKILL_RSI_PROJECT` explicit in hook setup; never infer the project from the current working directory.
- Do not claim apps connector or plugin autorun exist until the repository actually implements them.
- Do not invent project state. Use the app, CLI, or project files to inspect current truth.
- Preserve Skill RSI terminology: champion, challenger, cold-start duel, next loop plan, prompt bank, ontology, deconstruction, promotion gate.

## No Manual Skill Editing

When this Skill RSI plugin is invoked, never substitute normal Codex file editing for Skill RSI improvement.

If the user says "improve this skill", "improve a skill", references a `SKILL.md`, attaches a skill package, or asks to make an Agent Skill better in a Skill RSI context:

- Treat the referenced skill as a Skill RSI baseline/input, not as a file to patch by hand.
- Do not manually rewrite, patch, copy over, or create a replacement `SKILL.md` for the target skill.
- Do not edit adjacent skill files, project files, or package contents to "fold in" ideas from Skill RSI evidence.
- Do not use `apply_patch`, shell writes, file copies, or editor actions to modify the target skill package.
- Do not inspect other local skills and synthesize a direct manual rewrite unless the user explicitly stops using Skill RSI and asks for ordinary file editing.
- For plain "improve this skill" requests, prepare a fresh Skill RSI setup draft with that skill as the baseline and open the setup screen.
- Inspect or export an existing champion only when the user explicitly asks for prior project data or export.

Allowed actions in Skill RSI mode are limited to:

- opening the local Skill RSI web app,
- preparing or creating/importing Skill RSI projects,
- inspecting project state, progress, history, evidence, champions, challengers, and next-loop plans only after explicit existing-project intent,
- running explicit bounded Skill RSI loops only after explicit run intent,
- queueing or consuming hook/context through Skill RSI machinery,
- exporting a promoted champion package through Skill RSI.

Only export a champion to a user-specified destination when the user asks for export. Exporting is not the same as silently overwriting the original baseline skill.

## Model-Budget Language

Do not invent "budget approval" gates for ordinary Skill RSI operations.

Opening the app, checking readiness, listing projects, creating a project, importing a baseline, inspecting evidence, reading a champion, queueing context, or exporting a champion does not require model-budget approval.

Starting a real/agentic improvement loop can spend API budget. If the user explicitly asks to run a bounded loop, proceed and state that it is starting model-backed work. If the user only asks to inspect, open, create/import, or prepare a project, do not ask for run approval and do not start a loop.

## MCP Tool Boundaries

- `skill_rsi_open` is always safe: it returns a local app URL and server readiness only.
- `skill_rsi_prepare_project` is the default fresh-flow tool. It writes a setup draft and returns a `?create=1&draft=<id>` URL so the user can confirm output type and model before project creation.
- `skill_rsi_create_project` creates immediately. Use it only when the user explicitly asks Codex to create the project directly after setup choices are clear; it is fresh by default and auto-suffixes name collisions.
- `skill_rsi_list_projects`, `skill_rsi_progress`, `skill_rsi_get_*`, `skill_rsi_export_champion`, and `skill_rsi_cockpit` are follow-up inspection/export tools. Use them only when the user explicitly asks for existing project data, and pass `existingProjectIntent: true`.
- `skill_rsi_run_next` and `skill_rsi_run_with_context` start bounded run machinery. Use them only when the user explicitly asks Codex to run, and pass `runIntent: true`.
- Do not describe hook autorun as available; Codex hooks queue context only unless the user explicitly invokes a normal Skill RSI runner.

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

1. For any Skill RSI request in Codex desktop, open the local web app in the in-app browser/sidebar first.
2. If the user did not explicitly ask for prior project data, assume a fresh Skill RSI run/project flow.
3. If a target skill is referenced, keep it as a Skill RSI baseline/input and never hand-edit it.
4. Do not recommend a next action after launch unless the user asks.
5. Use existing app/CLI/docs behavior.
6. State when an action will start model-backed work, but do not ask for budget approval for non-run operations.
7. Keep implementation details concise unless the user asks for a deeper audit.
8. Prefer a one-line handoff after opening the app, such as `Opened Skill RSI for <project>.`
