# Codex Plugin Surface Plan

This document is the source of truth for expanding Skill RSI into a Codex-native product surface through Codex Plugins, MCP tools, hooks, and MCP-UI.

Skill RSI already has a local app and CLI. The Codex plugin surface should not replace those. It should make Skill RSI feel native inside Codex: easy to open, easy to operate, able to receive Codex context, and able to show enough state that a user does not need to know the CLI or product internals before getting value.

## Current platform assumptions

Codex Plugins are reusable extension packs. Current official Codex plugin docs describe plugins as bundles that can include skills, MCP servers, hooks, apps/connectors, and marketplace metadata.

Relevant platform references:

- [Codex Plugins](https://developers.openai.com/codex/plugins)
- [Build Codex Plugins](https://developers.openai.com/codex/plugins/build)
- [Codex Skills](https://developers.openai.com/codex/skills)
- [Codex Hooks](https://developers.openai.com/codex/hooks)
- [MCP-UI Introduction](https://mcpui.dev/guide/introduction)
- [MCP-UI Protocol Details](https://mcpui.dev/guide/protocol-details)
- [MCP-UI Supported Hosts](https://mcpui.dev/guide/supported-hosts)

Important constraint: MCP tools are broadly useful in Codex. MCP-UI rendering is host-dependent and, in Codex desktop today, not robust enough to be the default Skill RSI UI. The plugin should default to opening the local web app in the Codex sidebar, while MCP-UI remains an optional embedded cockpit for hosts that render MCP Apps UI resources reliably.

## Product thesis

Skill RSI improves Agent Skill packages. Codex Plugins package skills, tools, hooks, and extension behavior for Codex.

That makes Codex Plugins a natural surface for Skill RSI:

- A plugin can distribute Skill RSI's Codex-facing instructions and tools.
- MCP tools can let Codex operate Skill RSI without fragile shell-command prompting.
- Hooks can queue Codex session context into Skill RSI projects.
- The local web app can provide the default guided cockpit inside Codex's browser/sidebar.
- MCP-UI can provide an optional compact embedded cockpit for project creation, loop control, progress, evidence, and champion export where host support is reliable.

The goal is not to make users memorize tool names. The goal is:

```text
User says or clicks: Open Skill RSI
Skill RSI shows the next useful action.
```

## Core decision

Build a **Skill RSI Codex Plugin** as a companion product surface.

The plugin should provide:

1. A Skill RSI operating skill that teaches Codex when and how to use Skill RSI.
2. A local MCP server that exposes Skill RSI control and read-model tools.
3. Optional hook configuration that records Codex context into a project queue.
4. MCP-UI resources that render a guided Skill RSI cockpit where supported.

The plugin should not:

- Reimplement the RSI engine.
- Replace the local app.
- Run full RSI loops directly inside a Codex hook process.
- Require users to know low-level commands before they can use the product.
- Hide model-budget spend behind ambiguous lifecycle events.

## User experience north star

The user should be able to start with one of these:

```text
Open Skill RSI.
```

```text
Improve my frontend design skill.
```

```text
Use this skill as a baseline and run three improvement loops.
```

Codex should then open the local Skill RSI web app in the sidebar, or drive a guided Skill RSI cockpit where the host reliably supports MCP-UI.

The cockpit is state-driven. It shows the next valid action based on the project state:

| State | Primary UI |
| --- | --- |
| No projects | Create or import first skill. |
| Draft project | Confirm goal, output type, model, and loop count. |
| No champion | Start an iteration to create version 1. |
| Champion exists | Show next loop plan and run controls. |
| Hook context queued | Show pending Codex context and offer to run with it. |
| Run active | Show live stage, timeline, and current output. |
| Run complete | Show promote/keep result, evidence, next loop plan, and export action. |
| Budget ceiling reached | Explain ceiling and show how to raise/run manually. |
| Failure | Show error, affected stage, and recovery path. |

This is the primary design guardrail: the plugin surface should guide the user by state, not by documentation.

## Relationship to existing surfaces

The local app remains the full evidence console. It is better for:

- Dense prompt-level evidence.
- Rendered screenshot inspection.
- Long run histories.
- Artifact browsing.
- Project management across many projects.
- Local environment and visual-runner troubleshooting.

The CLI remains the reproducible operator surface. It is better for:

- Automation.
- Cron/LaunchAgent setup.
- Scripting.
- CI-style checks.
- Direct local export/import.

The Codex plugin surface is the embedded control surface. It is better for:

- Creating or importing a project from a Codex conversation.
- Running the next loop without remembering CLI commands.
- Capturing Codex session context as future loop premise.
- Showing compact evidence and next-loop state in the same place the user is already working.

## Plugin package shape

Target structure:

```text
plugins/skill-rsi/
  .codex-plugin/
    plugin.json
  assets/
    icon.svg
    preview.svg
  skills/
    skill-rsi/
      SKILL.md
  hooks/
    codex-stop-hook.example.json
  mcp/
    server.mjs
    ui/
      cockpit.html.js
  README.md
```

The plugin can live in this repository initially. If distribution constraints make a separate repository cleaner later, the implementation should still treat it as a thin wrapper around the core Skill RSI app/CLI/library.

Future-only additions, if they prove useful, include a separate maintainer skill, more granular UI modules, apps connector metadata, and public marketplace packaging. They are not part of the current repo-tracked plugin package.

## Skill layer

The plugin should include a user-facing Skill RSI operator skill.

Responsibilities:

- Explain when Codex should use Skill RSI.
- Prefer the MCP tools over ad hoc shell commands.
- Treat the local app and CLI as the system of record.
- Preserve Skill RSI's core mental model: research/ontology, deconstruction, champion challenge, evaluation, promotion, history.
- Avoid inventing features not present in the project.
- Avoid presenting human approval as part of the default RSI loop.

The plugin may also include a maintainer skill for contributors working on Skill RSI itself. That skill should be separate so normal users do not get internal development instructions.

## MCP tool layer

The MCP server is the plugin's reliable control plane.

Initial tools:

| Tool | Purpose |
| --- | --- |
| `skill_rsi_doctor` | Report local readiness, API key presence, model defaults, visual runner availability, and plugin/MCP status. |
| `skill_rsi_open` | Return the local app launch URL and server readiness without reading project state. |
| `skill_rsi_cockpit` | Return the optional MCP-UI cockpit for explicit existing-project inspection. |
| `skill_rsi_list_projects` | List projects and concise state only after explicit existing-project intent. |
| `skill_rsi_prepare_project` | Prepare a fresh setup draft and return a `?create=1&draft=<id>` local-app URL. This is the default for plain Codex "improve this skill" requests so setup choices stay visible. |
| `skill_rsi_create_project` | Create a fresh scratch or baseline project using the same logic as the UI/CLI. Baseline import is handled through this tool's `baselinePath`; collisions use suffixed fresh names. Use only for explicit direct-create requests. |
| `skill_rsi_run_next` | Start bounded manual loop execution through existing run machinery only after explicit run intent. |
| `skill_rsi_run_with_context` | Consume queued Codex context and start one explicit hook-informed loop only after explicit run intent. |
| `skill_rsi_progress` | Read current/latest run progress only after explicit existing-project intent. |
| `skill_rsi_get_run_detail` | Return detailed run artifacts, timeline, recommendation, and eval references. |
| `skill_rsi_get_run_comparison` | Return champion/challenger or Candidate A/B comparison metadata. |
| `skill_rsi_get_skill_content` | Return selected champion, challenger, or cold-start candidate package files. |
| `skill_rsi_get_next_loop_plan` | Return the current next loop plan and where it came from. |
| `skill_rsi_get_evidence` | Return compact run evidence and prompt-level detail. |
| `skill_rsi_get_champion` | Return current champion metadata and selected file content. |
| `skill_rsi_export_champion` | Export champion package to a requested local directory. |
| `skill_rsi_record_context` | Queue explicit context into a project without running a loop. |

Tool rules:

- Tools should call existing project creation, run, read, export, hook, and progress services rather than duplicating logic.
- Every UI-backed tool must also return a useful text fallback.
- Mutating tools must be explicit about project id, budget, and whether a model-backed run will start.
- Project-state read tools require explicit existing-project intent; run tools require explicit run intent.
- Tool outputs should be compact by default and support detail expansion through follow-up calls.

## MCP-UI layer

MCP-UI should be one guided cockpit first, not a set of disconnected cards.

Primary UI-backed tool:

```text
skill_rsi_cockpit
```

Primary resource:

```text
ui://skill-rsi/cockpit
```

The cockpit should support the happy path end to end:

1. Select existing project or create/import a new one.
2. Configure goal, output artifact, model, and target loops.
3. Start the first or next iteration.
4. Watch current run state.
5. See champion status.
6. Read next loop plan.
7. Inspect latest evidence summary.
8. Export champion.
9. See automation and pending Codex context state.

MCP-UI should use progressive disclosure:

- Overview first.
- Evidence on demand.
- Champion package on demand.
- Automation/context on demand.
- Full app link for deep inspection.

The cockpit should not require the user to know terms like `run-detail`, `timeline`, `hook-record`, or `continuous`.

## Cockpit layout

Recommended embedded layout:

```text
Skill RSI

[Project picker / create project]

Primary state
  Champion vN / no champion / running / failed / at ceiling

Next action
  Start iteration
  Run next iteration(s)
  Continue with queued Codex context
  Export champion
  Open full app

Next loop plan
  What will be tested
  What will be preserved
  What evidence will matter

Latest evidence
  Last outcome
  Score summary
  Prompt evidence summary
  Screenshot summary when available

Automation and context
  Manual / scheduled observed / hook context waiting
  Event count and changed files
```

Actions should call MCP tools, not hardcoded shell commands.

## Hook layer

Codex hooks should remain context producers.

Current good behavior to preserve:

- Require explicit project selection.
- Sanitize payloads.
- Queue event metadata.
- Do not retain raw payloads.
- Do not run model-backed loops directly inside the hook process.

Revised automation stance:

- Hooks should not be the execution host.
- Hooks may be an autorun trigger source.
- A hook-triggered run must go through Skill RSI's normal queue, lock, budget, and run-recording machinery.

Acceptable future mode:

```text
Codex Stop hook -> queue event -> Skill RSI automation runner sees eligible event -> run one bounded loop
```

Unacceptable mode:

```text
Codex Stop hook -> run full RSI loop inline inside hook process
```

If hook autorun is added, it must be explicit and visible:

- Project-level opt-in.
- Max one new loop per hook batch by default.
- Debounce window.
- Project lock check.
- Budget and max-runs check.
- UI state such as "Codex context triggered run-004".
- Failure recorded without retry storms.

## Context model

Codex context should become run premise, not hidden prompt stuffing.

Queued context summary should include:

- Event count.
- Event names.
- Changed files.
- Optional reason/focus.
- Transcript/source references when available.
- Latest timestamp.

The planner should receive this as hook context and decide whether it changes the next experiment focus. The UI should say when queued context will shape the next loop.

## Visual evidence

For code + visuals projects, MCP-UI can show screenshot thumbnails, render status, prompt-level summaries, and full-size embedded image inspection. The local app remains useful for longer evidence sessions, but ordinary screenshot inspection should not require leaving the plugin console.

MCP-UI visual evidence should include:

- Winner.
- Render status.
- Viewport labels.
- Screenshot previews where host/resource support allows.
- Full-size embedded image viewing when screenshots can be safely read from `.skill-rsi` artifacts.

Do not make MCP-UI the only way to inspect visual evidence.

## Security and trust model

Plugins, hooks, and MCP servers run locally with meaningful permissions. Keep the surface explicit.

Rules:

- Never print or expose API key values.
- Store API keys through existing local mechanisms only.
- Require explicit project ids for hook configuration.
- Avoid arbitrary shell passthrough tools.
- Avoid broad filesystem write tools.
- Export only to user-provided paths.
- Prefer existing Skill RSI services over shelling out where possible.
- Show when an action will start model-backed work.

## Implementation phases

### Phase 1: Plugin shell

- Add plugin manifest.
- Add Skill RSI operator skill.
- Add README for local plugin install.
- Include hook config example, but do not auto-enable it.
- No MCP-UI yet.

Goal: installable Codex plugin that teaches Codex how to use Skill RSI correctly.

### Phase 2: MCP control plane

- Add local MCP server.
- Expose read-only tools first: doctor, list projects, progress, next loop plan, champion.
- Add mutating tools after read tools are stable: create project, run next, export champion, record context.
- Add tests around tool inputs, outputs, and failure states.

Goal: Codex can operate Skill RSI through tools instead of brittle command suggestions.

### Phase 3: Guided cockpit

- Add `skill_rsi_open` for local app launch and `skill_rsi_cockpit` for optional MCP-UI.
- Render one MCP-UI cockpit with text fallback.
- Support project picker, current state, next action, next loop plan, latest evidence, and champion export.
- Keep implementation lightweight and mostly server-rendered unless complexity demands a bundled UI.

Goal: a user can use the common Skill RSI flow from inside a host that supports MCP-UI.

### Phase 4: Native evidence console

- Extend `skill_rsi_cockpit` into view-aware console navigation.
- Add history, detailed evidence, skill package, and automation views.
- Show prompt-level scores, judge reasoning, outputs, and visual screenshots.
- Add read tools for run detail, run comparison, skill content, and evidence fallback.

Goal: core local-app inspection parity inside native MCP-UI without embedding the local HTTP app.

### Phase 5: Manual hook-informed runs

- Surface pending Codex context in the MCP-UI console.
- Allow an explicit manual "run one loop with queued context" action.
- Keep hook autorun as future work unless it can use normal Skill RSI budget/lock/run machinery.

Goal: Codex activity can naturally feed RSI without making hooks opaque execution hosts.

### Phase 6: Distribution polish

- Add static plugin assets and clearer plugin metadata.
- Add repo scripts for plugin validation and MCP tool-surface smoke checks.
- Document local install, update, troubleshooting, fallback behavior, and release checks.
- Keep public marketplace publishing, personal marketplace mutation, and repo splitting out of scope until distribution requirements demand them.

Goal: a clean install path for users outside this development checkout.

## Test plan

### Plugin

- Plugin manifest validates.
- Local plugin install succeeds.
- Skill files load and do not contradict current Skill RSI behavior.
- Hook config examples require explicit project selection.

### MCP

- Read tools return compact, accurate state.
- Mutating tools call existing services and record normal project artifacts.
- `run_next` respects locks, budgets, target iterations, and model config.
- Tool errors are actionable and do not expose secrets.
- Nonexistent projects fail clearly.

### MCP-UI

- `skill_rsi_open` returns a local app launch URL without reading project state.
- `skill_rsi_cockpit` returns useful text fallback.
- UI resource renders in an MCP-UI host.
- Cockpit state matches project read model.
- Buttons call MCP tools rather than shell commands.
- No-project, no-champion, champion, running, failed, hook-context, and at-ceiling states are all represented.

### Hooks

- Hook script queues context only.
- Missing project env fails closed.
- Queued context appears in MCP cockpit.
- Hook-triggered autorun, if implemented, uses normal queue/lock/budget machinery.

### Regression

- Local app still works.
- CLI still works.
- Existing hook queue behavior still works.
- Code + visuals evidence still works in the app.
- No documentation implies human approval is required for promotion.

## Open questions

- Does the target Codex host render MCP Apps UI resources directly, or should MCP-UI initially target other hosts plus text fallback in Codex?
- Should the plugin live in this repo long term, or move to a separate distribution repo after the API stabilizes?
- Should hook autorun be a project config option, a generated scheduler command, or both?
- How much local app deep-linking can we support consistently from embedded MCP-UI?
- Should the plugin include a self-improvement template for improving its own bundled skills?

## Success criteria

The plugin surface succeeds when a user with no Skill RSI command knowledge can:

1. Install the plugin.
2. Say "Open Skill RSI."
3. Create or import a skill project.
4. Run an improvement loop.
5. Understand what happened.
6. See what the next loop will do.
7. Export the champion.

It succeeds as a Codex-native surface when Codex context can feed the next loop without forcing the user to wire raw hooks, remember CLI commands, or inspect hidden files.
