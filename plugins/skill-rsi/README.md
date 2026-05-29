# Skill RSI Codex Plugin

This is the repo-tracked Codex Plugin for Skill RSI. It gives Codex a native way to create, improve, inspect, schedule, and export Skill RSI projects without asking the user to memorize CLI commands.

The plugin includes:

- A validated plugin manifest.
- A Skill RSI operator skill for Codex.
- Static plugin assets in `assets/`.
- A Codex `Stop` hook example for queueing project context.
- A local stdio MCP server with structured Skill RSI control tools.
- A native MCP-UI console through `skill_rsi_open` for hosts that render MCP Apps/UI resources.

This plugin does not yet include:

- Apps connector metadata.
- Automatic hook-triggered RSI execution.
- Personal marketplace mutation.
- Public marketplace packaging.

## Install Locally

From the repository root:

```bash
codex plugins install ./plugins/skill-rsi
```

This installs the local plugin so Codex can load the operator skill and declared MCP server.

If the plugin is installed outside the repository layout, set `SKILL_RSI_ROOT` to the Skill RSI repository path so the MCP server can find the app services:

```bash
SKILL_RSI_ROOT="/absolute/path/to/Skill RSI"
```

## Verify

From the repository root:

```bash
npm run plugin:validate
npm run plugin:smoke
```

For a full release confidence check:

```bash
npm run plugin:check
```

`plugin:validate` runs the Codex plugin validator against `plugins/skill-rsi`. It looks for the validator under `SKILL_RSI_PLUGIN_VALIDATOR`, then `CODEX_HOME`, then `~/.codex`. `plugin:smoke` verifies that the local MCP server registers the expected tool surface, including `skill_rsi_open` and `skill_rsi_run_with_context`.

## MCP Tools

The plugin declares one local MCP server in `.mcp.json`:

```text
skill-rsi
```

From the plugin root, it runs:

```bash
node mcp/server.mjs
```

The server exposes tools for project listing, creation, progress, next-loop plans, champion reads, champion export, explicit context queueing, and bounded manual loop execution.

Use `skill_rsi_open` to open the native console. It returns a text fallback in every host and an embedded MCP-UI resource in hosts that support MCP Apps/UI rendering. The console can create/import projects, show current state, inspect history, read prompt-level evidence, view rendered screenshots, inspect skill packages, run the target loop batch, run one explicit loop with queued Codex context, queue visible context, and export the champion through MCP tool calls.

MCP-UI host support varies. When a host does not render MCP Apps/UI resources, tool calls still return readable text and structured JSON fallback content.

## Hook Example

`hooks/codex-stop-hook.example.json` shows how to wire a Codex `Stop` hook to Skill RSI context capture.

Keep `SKILL_RSI_PROJECT` explicit. The hook records sanitized context into the project's hook queue. It does not run an RSI loop directly and does not spend model budget. Queued context can later be consumed by the scheduler/CLI or by the explicit `skill_rsi_run_with_context` MCP action.

See `../../docs/CODEX_HOOKS.md` for the full hook model.

## Update Flow

During local development, update the repo files first, then rerun:

```bash
npm run plugin:check
codex plugins install ./plugins/skill-rsi
```

This phase intentionally does not edit personal marketplace files. If Codex plugin publishing or marketplace cachebusting becomes required later, treat that as a separate distribution step and validate it against the current Codex plugin tooling.

## Troubleshooting

- If Codex cannot find Skill RSI services, set `SKILL_RSI_ROOT` to the repository path.
- If `skill_rsi_open` only shows text, the host likely does not render MCP-UI resources yet; use the fallback output or the local web app.
- If visual evidence is unavailable, run the main app's `doctor` command to check browser screenshot runner availability.
- If queued hook context does not appear, confirm the hook command sets `SKILL_RSI_PROJECT` explicitly and that the project exists.
- If a command would start model-backed work, the MCP tool output marks that explicitly. Hooks alone never spend model budget.

## Expansion Plan

The source-of-truth plan for the Codex Plugin, MCP tools, MCP-UI cockpit, and later automation work is:

```text
../../docs/CODEX_PLUGIN_SURFACE_PLAN.md
```
