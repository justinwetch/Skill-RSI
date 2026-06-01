# Skill RSI agent setup guide

This file is for agents helping a user install Skill RSI from a GitHub URL. Follow it exactly enough that the user ends up with a working local checkout and Codex plugin, without starting model-backed improvement work during setup.

## Core rule

Operate Skill RSI through its local app, Codex plugin, MCP tools, or CLI. Do not manually rewrite, patch, copy over, or "improve" a target `SKILL.md` file as a substitute for the Skill RSI loop.

If the user asks to improve a skill, the correct path is to create or open a Skill RSI project, optionally import the skill as a baseline, inspect project state, and run a bounded Skill RSI loop only after explicit user intent.

## Agent-assisted setup

If the user gave you the repository URL, clone it and work from the repository root:

```bash
git clone https://github.com/justinwetch/Skill-RSI.git
cd Skill-RSI
```

If the repo is already checked out, use the existing checkout.

Install dependencies and build the local UI:

```bash
npm install
npm run build:ui
```

Create the local environment file:

```bash
cp .env.example .env
```

Ask the user to add `OPENAI_API_KEY` to `.env` locally, or to paste the key into the Skill RSI browser UI later. Do not ask the user to paste the API key into chat. Explain that ChatGPT Plus or Pro does not fund local Skill RSI runs. Skill RSI uses OpenAI API credits through `OPENAI_API_KEY` or the browser-local UI key field.

Configure and install the Codex plugin:

```bash
npm run plugin:configure
npm run plugin:validate
npm run plugin:smoke
codex plugin marketplace add .
codex plugin add skill-rsi@skill-rsi
```

If the user's Codex version does not support CLI/plugin auto-install, give them the manual UI fallback:

1. Open the Codex sidebar.
2. Open the Plugins section.
3. Click Built by OpenAI.
4. Select Skill RSI.
5. Click Skill RSI, then Add to Codex.

After plugin installation, tell the user to start a fresh Codex thread so Codex loads the latest Skill RSI operator skill and MCP tools. They can start from the Skill RSI plugin page or one of its starter prompts, or mention `@Skill RSI` from chat.

## Opening Skill RSI

For setup verification or app launch, start or reuse the local server:

```bash
npm run server
```

Then open the local app in Codex's browser/sidebar:

```text
http://127.0.0.1:8765/
```

Opening the app is safe. Starting an RSI loop is model-backed work and may spend API credits.

## What not to do during setup

- Do not start `skill-rsi run`, `skill-rsi continuous`, `skill_rsi_run_next`, or `skill_rsi_run_with_context` unless the user explicitly asks to run an improvement loop.
- Do not edit target skill packages directly.
- Do not treat Codex hooks as autorun. Hooks queue context only.
- Do not expose API key values in logs, chat, screenshots, or tool output.

## Expected handoff

End setup by telling the user:

- whether dependencies installed
- whether the UI built
- whether plugin configuration, validation, and smoke checks passed
- whether the plugin was installed as `skill-rsi@skill-rsi`, or whether they need to use the manual Plugins UI fallback
- that they should start a fresh Codex thread and open Skill RSI from the plugin page/starter prompts or by mentioning `@Skill RSI` from chat
- that no model-backed Skill RSI run has started
