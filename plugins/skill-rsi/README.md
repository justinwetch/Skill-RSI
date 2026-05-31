# Skill RSI Codex Plugin

This is the repo-tracked Codex Plugin for Skill RSI. It gives Codex a native way to create, improve, inspect, schedule, and export Skill RSI projects without asking the user to memorize CLI commands.

The plugin includes:

- A validated plugin manifest.
- A Skill RSI operator skill for Codex.
- Static plugin assets in `assets/`.
- A Codex `Stop` hook example for queueing project context.
- A local stdio MCP server with structured Skill RSI control tools.
- A default local web-app launch path for Codex desktop.
- A local-app launch tool through `skill_rsi_open`.
- An optional MCP-UI console through `skill_rsi_cockpit` for hosts that render MCP Apps/UI resources robustly.

This plugin does not yet include:

- Apps connector metadata.
- Automatic hook-triggered RSI execution.
- Personal marketplace mutation.
- Public marketplace packaging.

## Install From A Local Checkout

The plugin expects a local Skill RSI repository checkout because the MCP server opens and controls the local Skill RSI app.

Agent-assisted setup prompt:

```text
Set up Skill RSI from https://github.com/justinwetch/Skill-RSI. Clone the repo, read AGENTS.md, install dependencies, build the UI, configure and install the Codex plugin, run the plugin smoke checks, and tell me when to start a fresh Codex thread. Do not start any model-backed Skill RSI run yet.
```

The root [AGENTS.md](../../AGENTS.md) file is the source of truth for agent-assisted install behavior. It tells setup agents to install the plugin, avoid manual target-skill edits, and stop before model-backed RSI work begins.

Manual setup from a fresh checkout:

```bash
git clone https://github.com/justinwetch/Skill-RSI.git
cd Skill-RSI
npm install
npm run build:ui
cp .env.example .env
# Add OPENAI_API_KEY to .env
npm run plugin:configure
codex plugin marketplace add .
codex plugin add skill-rsi@skill-rsi
```

Start a new Codex thread after installing or updating the plugin so Codex picks up the latest skill and MCP tools.

Skill RSI model-backed runs use the OpenAI API key in `.env` or the browser-local UI key field. A ChatGPT Plus/Pro subscription does not fund local Skill RSI API calls.

## Verify

From the repository root:

```bash
npm run plugin:configure -- --check
npm run plugin:validate
npm run plugin:smoke
```

For a full release confidence check:

```bash
npm run plugin:check
```

`plugin:validate` runs the Codex plugin validator against `plugins/skill-rsi`. It looks for the validator under `SKILL_RSI_PLUGIN_VALIDATOR`, then `CODEX_HOME`, then `~/.codex`. `plugin:smoke` verifies that the local MCP server registers the expected tool surface, including `skill_rsi_open`, `skill_rsi_cockpit`, and `skill_rsi_run_with_context`.

## MCP Tools

The plugin declares one local MCP server in `.mcp.json`:

```text
skill-rsi
```

From the plugin root, it runs:

```bash
node mcp/server.mjs
```

The server exposes tools for local app launch, fresh setup drafts, direct project creation, explicit existing-project inspection, champion export, context queueing, and bounded manual loop execution.

In Codex desktop, the operator skill defaults to opening the local web app in the in-app browser/sidebar for any Skill RSI request at:

```text
http://127.0.0.1:8765/
```

It should start or reuse `npm run server` from the Skill RSI repository root, call `skill_rsi_open` to get the focused launch URL, then open that URL with the Browser plugin. This applies to creating projects, improving a baseline skill, inspecting evidence, scheduling/hooks, exporting champions, and guided project flows. This is currently more reliable than depending on embedded MCP-UI rendering in Codex desktop.

The chat layer should stay light: prepare the requested Skill RSI setup/action through MCP or CLI when clear, open the local app, and then get out of the way.

When the user invokes Skill RSI without naming an existing project or prior run, the operator skill should assume a fresh setup flow. It should call `skill_rsi_prepare_project`, then open the returned `?create=1&draft=<id>` URL so the user can choose output artifact type and model before the project exists. It should not inspect or choose from past projects unless the user explicitly asks for history, evidence, a champion, a named project, or a specific run. If a generated project name collides, use a fresh suffixed draft name instead of inspecting the existing one.

`skill_rsi_open` returns only the local app launch URL and server readiness; it does not inspect project state or start loops. `skill_rsi_create_project` still exists for explicit direct-create requests after setup choices are clear, but it is not the default for plain "improve this skill" flows. Use `skill_rsi_cockpit` only when the user explicitly asks for the MCP console, when the local web app cannot be opened, or when the host is known to render MCP Apps/UI resources robustly. It returns a text fallback in every host and an embedded MCP-UI resource in compatible hosts.

Project inspection tools require `existingProjectIntent: true`. Run tools require `runIntent: true`. Plain "improve this skill" requests should prepare a fresh setup draft, open the local app, and stop.

MCP-UI host support varies. When a host does not render MCP Apps/UI resources, tool calls still return readable text and structured JSON fallback content.

## Hook Example

`hooks/codex-stop-hook.example.json` shows how to wire a Codex `Stop` hook to Skill RSI context capture.

Keep `SKILL_RSI_PROJECT` explicit. The hook records sanitized context into the project's hook queue. It does not run an RSI loop directly and does not spend model budget. Queued context can later be consumed by the scheduler/CLI or by the explicit `skill_rsi_run_with_context` MCP action.

See `../../docs/CODEX_HOOKS.md` for the full hook model.

## Update Flow

During local development, update the repo files first, then rerun:

```bash
npm run plugin:check
codex plugin add skill-rsi@skill-rsi
```

This phase intentionally does not edit personal marketplace files. If Codex plugin publishing or marketplace cachebusting becomes required later, treat that as a separate distribution step and validate it against the current Codex plugin tooling.

## Troubleshooting

- If Codex cannot find Skill RSI services, run `npm run plugin:configure` from the repository root and reinstall with `codex plugin add skill-rsi@skill-rsi`.
- If the local web app does not open, check whether `http://127.0.0.1:8765/api/capabilities` is reachable, then start `npm run server` from the repository root.
- If `skill_rsi_cockpit` only shows text, the host likely does not render MCP-UI resources robustly yet; use the local web app.
- If visual evidence is unavailable, run the main app's `doctor` command to check browser screenshot runner availability.
- If queued hook context does not appear, confirm the hook command sets `SKILL_RSI_PROJECT` explicitly and that the project exists.
- If a command would start model-backed work, the MCP tool output marks that explicitly. Hooks alone never spend model budget.

## Expansion Plan

The source-of-truth plan for the Codex Plugin, MCP tools, MCP-UI cockpit, and later automation work is:

```text
../../docs/CODEX_PLUGIN_SURFACE_PLAN.md
```
