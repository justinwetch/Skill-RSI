# Skill RSI Codex Plugin

This is the repo-tracked Codex Plugin shell for Skill RSI.

Current plugin shell includes:

- A validated plugin manifest.
- One Skill RSI operator skill for Codex.
- A Codex `Stop` hook example for queueing project context.
- A local stdio MCP server with structured Skill RSI control tools.
- A native MCP-UI console through `skill_rsi_open` for hosts that render MCP Apps/UI resources.

This plugin does not yet include:

- Apps connector metadata.
- Automatic hook-triggered RSI execution.
- Personal marketplace mutation.

## Install Locally

From the repository root:

```bash
codex plugins install ./plugins/skill-rsi
```

This installs the local plugin shell so Codex can load the Skill RSI operator skill.

## MCP Tools

The plugin declares one local MCP server in `.mcp.json`:

```text
skill-rsi
```

It runs:

```bash
node plugins/skill-rsi/mcp/server.mjs
```

The server exposes tools for project listing, creation, progress, next-loop plans, champion reads, champion export, explicit context queueing, and bounded manual loop execution.

Use `skill_rsi_open` to open the native console. It returns a text fallback in every host and an embedded MCP-UI resource in hosts that support MCP Apps/UI rendering. The console can create/import projects, show current state, inspect history, read prompt-level evidence, view rendered screenshots, inspect skill packages, run the target loop batch, queue visible context, and export the champion through MCP tool calls.

If the plugin is installed outside the repository layout, set `SKILL_RSI_ROOT` to the Skill RSI repository path so the MCP server can find the app services:

```bash
SKILL_RSI_ROOT="/absolute/path/to/Skill RSI"
```

## Validate

From the repository root:

```bash
python3 /Users/justinwetch/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/skill-rsi
```

## Hook Example

`hooks/codex-stop-hook.example.json` shows how to wire a Codex `Stop` hook to Skill RSI context capture.

Keep `SKILL_RSI_PROJECT` explicit. The hook records sanitized context into the project's hook queue. It does not run an RSI loop directly and does not spend model budget.

See `../../docs/CODEX_HOOKS.md` for the full hook model.

## Expansion Plan

The source-of-truth plan for the Codex Plugin, MCP tools, MCP-UI cockpit, and later automation work is:

```text
../../docs/CODEX_PLUGIN_SURFACE_PLAN.md
```
