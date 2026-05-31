# Codex Plugin Release Checklist

This checklist is for repo-local Skill RSI Codex Plugin releases. It does not publish to a public marketplace, mutate personal marketplace files, or split the plugin out of this repository.

## Release Target

The plugin lives at `plugins/skill-rsi` and provides:

- the Skill RSI operator skill
- a local MCP server
- a default local web-app launch path for Codex desktop
- optional MCP-UI resources with text fallback
- static plugin assets
- a Codex Stop hook example that queues context only

The local app remains the full evidence console and the default Codex desktop UI surface. The CLI remains the automation and scripting surface. MCP tools are the Codex-native control plane.

## Preflight

From the repository root:

```bash
npm run plugin:configure -- --check
npm run plugin:validate
npm run plugin:smoke
npm test
npm run build:ui
git diff --check
```

Or run the combined check:

```bash
npm run plugin:check
```

Expected results:

- generated MCP config is present and points at this checkout
- plugin validation passes
- MCP smoke reports the expected tool count
- repo tests pass
- UI build passes
- no whitespace errors are reported

## Local Install Smoke

Install from the repository root:

```bash
npm run plugin:configure
codex plugin marketplace add .
codex plugin add skill-rsi@skill-rsi
```

Then verify in Codex:

- the Skill RSI operator skill is discoverable after starting a new Codex thread
- asking "Open Skill RSI" opens the local web app in the Codex in-app browser/sidebar
- `http://127.0.0.1:8765/api/capabilities` reports local readiness when the server is running
- `skill_rsi_open` returns a focused local app launch URL without reading project state
- hosts with robust MCP Apps/UI support can render the optional `skill_rsi_cockpit` console

If the installed plugin cannot resolve the repository, rerun `npm run plugin:configure` from the repository root and reinstall the plugin.

If validation cannot find the Codex plugin validator, set:

```bash
SKILL_RSI_PLUGIN_VALIDATOR="/absolute/path/to/validate_plugin.py"
```

## Hook Example Smoke

Review `plugins/skill-rsi/hooks/codex-stop-hook.example.json` before sharing it.

Confirm that:

- `SKILL_RSI_PROJECT` is explicit
- the command points at `scripts/codex-skill-rsi-hook.mjs`
- the hook queues context only
- docs do not imply hooks run RSI loops or spend model budget

Queued context can be consumed by scheduled/CLI runs or by the explicit `skill_rsi_run_with_context` MCP action.

## Documentation Checks

Before release, scan for stale claims:

```bash
rg -n "\\[TODO:|automatic hook-triggered|human approval|Visual only|two challengers" README.md docs plugins/skill-rsi
```

Acceptable references should be historical, explicitly future-scoped, or absent. Current docs should say:

- no public marketplace publishing is included
- no personal marketplace mutation is performed
- `AGENTS.md` matches the README setup prompt and does not imply setup starts a model-backed run
- MCP-UI host support varies and text fallback is always available
- Codex desktop defaults to the local web app rather than MCP-UI
- hooks queue context only
- model-backed runs are explicit and bounded

## Asset Checks

Static assets live under `plugins/skill-rsi/assets/`.

Keep them:

- repo-tracked
- free of secrets and local paths
- useful for plugin docs or future marketplace presentation
- validator-compatible with the manifest asset fields that reference them

## Not In This Release Path

- public marketplace publication
- personal marketplace file edits
- automatic hook-triggered RSI loops
- a separate plugin repository
- a maintainer-only plugin skill
