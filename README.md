# Skill RSI

Want Codex to install it for you? Paste this into a fresh Codex thread:

```text
Set up Skill RSI from https://github.com/justinwetch/Skill-RSI. Clone the repo, read AGENTS.md, install dependencies, build the UI, configure and install the Codex plugin, run the plugin smoke checks, and tell me when to start a fresh Codex thread. Do not start any model-backed Skill RSI run yet.
```

What if a skill could improve itself?

Recursive self-improvement is the phrase AI researchers reach for when they describe systems that get better without us in the loop. Usually it's a thought experiment. This one runs on your laptop.

Give Skill RSI a goal and it writes an Agent Skill to chase it. Hand it a skill you already have and it makes that one better instead. Then the loop starts: study the skill, form a theory about what would help, build a variant, test it, keep the winner. Again and again, on its own, until you stop it.

Before it writes a single line, it studies the domain. It researches the field into sourced claims, then compiles them into an ontology: a working model of who the skill serves, what excellent output looks like, the failure modes worth catching, and the authorities whose strong opinions sharpen what "good" means here. That ontology becomes the shared map every later loop builds on and the guardrail that keeps the work from drifting.

Once there's a champion to beat, Skill RSI deconstructs it into more than a dozen testable surfaces, every one carrying a hypothesis, a regression risk, and a way to measure whether the change actually worked. Each loop the current champion is the control and the next variant is the treatment, both run against the same prompts under the same criteria. One variable moves at a time, so when a challenger wins, you know exactly what won.

Skill RSI improves skills the way a research lab works: every loop is an experiment whose results are kept and built on, including a record of dead ends, so it never wastes time re-testing what doesn't work. Each pass starts better informed than the last, converging on what does.

You set the goal. The research, the experiments, the evaluation, and the record-keeping run themselves.

This is the sequel to SkillEval. SkillEval could tell you which of two skills was better. The question it left open was what to build next, and that part was still on you. Skill RSI closes the loop.

For the origin story, see [Open Sourcing SkillEval](https://www.justinwetch.com/blog/skilleval).

![Ask Codex to use Skill RSI](screenshots/readme-latest-project-20260530-2225/09-codex-invoke.png)

From Codex, Skill RSI opens the local app and prepares the project without starting model-backed work in chat.

![Codex Skill RSI setup handoff](screenshots/readme-latest-project-20260530-2225/10-codex-setup-sidebar.png)

The sidebar keeps the result and next-loop controls visible beside the conversation.

![Codex Skill RSI dark result sidebar](screenshots/readme-latest-project-20260530-2225/11-codex-result-sidebar-dark.png)

During a run, the UI tracks the current stage and the evidence being produced.

![Skill RSI run in progress](screenshots/readme-latest-project-20260530-2225/00-running-live.png)

## Evidence-Backed Decisions

Every promotion decision links back to prompt-level evidence: the prompt, judge rationale, criterion scores, and both candidate outputs.

![Prompt-level evaluation evidence](screenshots/readme-latest-project-20260530-2225/06-evidence-prompt-expanded.png)

Skill RSI also keeps the candidate packages inspectable, so every champion change stays traceable.

![Candidate skill diff](screenshots/readme-latest-project-20260530-2225/08-candidate-compare.png)

## UI Walkthrough

The summary view shows the head-to-head result at a glance.

![Evaluation summary](screenshots/readme-latest-project-20260530-2225/03-evidence-summary.png)

The detailed breakdown explains where each candidate won across the criteria.

![Detailed evaluation breakdown](screenshots/readme-latest-project-20260530-2225/04-evidence-detailed-breakdown.png)

The prompt list keeps every judgment inspectable.

![Prompt evidence list](screenshots/readme-latest-project-20260530-2225/05-evidence-prompts.png)

The champion skill can be opened directly from the UI.

![Champion skill viewer](screenshots/readme-latest-project-20260530-2225/07-champion-skill.png)

The history view records the improvement trajectory over time.

![Improvement history](screenshots/readme-latest-project-20260530-2225/02-history.png)

The next loop plan carries forward what the latest evidence says to try, preserve, or avoid.

![Next loop plan](screenshots/readme-latest-project-20260530-2225/12-next-loop-plan.png)

## How It Works

For the canonical explanation of the loop and agent roles, see [docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md).

First scratch run:

```text
load project
  -> build research packet and ontology
  -> seed initial parameterization
  -> plan cold-start duel
  -> generate Candidate A and Candidate B
  -> adversarial preflight review
  -> evaluate Candidate A vs Candidate B
  -> crown first champion when evidence is usable
  -> write history and next-loop plan
```

Later runs, or baseline-upload projects:

```text
load champion and history
  -> deconstruct current champion into improvement parameters
  -> use ontology as domain guardrail, not as a rewrite brief
  -> plan one controlled challenger
  -> generate challenger as a localized ablation of the champion
  -> adversarial preflight review
  -> evaluate challenger vs champion
  -> promote or keep current champion
  -> write history and next-loop plan
```

Baseline uploads skip the initial ontology step and start from deconstructing the uploaded champion. Existing ontologies are reused or conservatively refreshed when the champion changes.

## Diagram Views

The core loop keeps every run framed as a controlled experiment.

![Skill RSI core loop diagram](docs/assets/diagrams/mermaid-png/core-loop.png)

The ontology turns research into a domain guardrail before the first skill is written.

![Skill RSI ontology map diagram](docs/assets/diagrams/mermaid-png/ontology-map.png)

The experiment plan decides what changes, what stays fixed, and what evidence should count.

![Skill RSI experiment plan diagram](docs/assets/diagrams/mermaid-png/experiment-plan.png)

History keeps each loop from forgetting what already worked or failed.

![Skill RSI history memory diagram](docs/assets/diagrams/mermaid-png/history-memory.png)

## Quick Start

```bash
git clone https://github.com/justinwetch/Skill-RSI.git
cd Skill-RSI
npm install
cp .env.example .env
```

Add your OpenAI key to `.env` for CLI/server use:

```bash
OPENAI_API_KEY=sk-...
```

Stub mode runs without API calls:

```bash
node src/cli.js init my-skill \
  --goal "Help agents write clear technical documentation." \
  --output text \
  --model gpt-5.5 \
  --target-iterations 3
node src/cli.js run my-skill --stub --loops 3
```

Start from an existing skill package:

```bash
node src/cli.js init my-skill \
  --goal "Improve this existing skill." \
  --baseline ./path/to/skill-or.zip
```

Real agentic run:

```bash
node src/cli.js run my-skill --agentic --real-eval --loops 1
```

Inspect results:

```bash
node src/cli.js status my-skill
node src/cli.js summary my-skill
node src/cli.js progress my-skill
node src/cli.js timeline my-skill
node src/cli.js report my-skill
node src/cli.js skill my-skill --source champion
```

## Local UI

Build and start the local server, then open [http://127.0.0.1:8765](http://127.0.0.1:8765):

```bash
npm run build:ui
npm run server
```

To use a non-default port:

```bash
SKILL_RSI_SERVER_PORT=8766 npm run server
```

PowerShell:

```powershell
$env:SKILL_RSI_SERVER_PORT=8766; npm run server
```

For hot-reload UI development, run these in separate terminals:

```bash
npm run server
npm run dev:ui
```

The UI supports:

- creating projects from scratch or from an uploaded skill folder, single `SKILL.md`, or zip
- output artifact selection: Text, Code, or Code + visuals
- OpenAI model selection: `gpt-5.5` by default, or `gpt-5.4-mini` for lower-cost iteration
- browser-local OpenAI API key entry, with `.env` as server fallback
- live loop progress, next-loop plan, detailed eval data, champion/challenger skill viewing, and visual screenshots when available
- automation status for manual runs, cron/LaunchAgent setup commands, and queued Codex hook context

Model choice can be changed between runs; each run records the models it used. API keys are not stored in project config; the UI stores pasted keys locally in the browser.

## Codex Plugin

Skill RSI also ships a repo-tracked Codex Plugin at [plugins/skill-rsi](plugins/skill-rsi). The plugin teaches Codex to open the local Skill RSI web app in the Codex sidebar, use the MCP control plane for structured operations, and fall back to CLI commands when needed.

The plugin currently expects a local Skill RSI checkout. Use the copy-paste Codex setup prompt at the top of this README, or see [AGENTS.md](AGENTS.md) for the agent-facing setup guide.

Manual setup:

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

If your Codex version cannot auto-install plugins from the CLI, install from the Codex UI instead: open Plugins in the sidebar, click Built by OpenAI, select Skill RSI, open the Skill RSI plugin page, then click Add to Codex.

After installing or updating the plugin, start a new Codex thread so Codex loads the latest plugin skill and MCP tools. You can start from the Skill RSI plugin page or one of its starter prompts, or mention `@Skill RSI` from chat.

Validate and smoke-check the plugin from the repository root:

```bash
npm run plugin:configure -- --check
npm run plugin:validate
npm run plugin:smoke
```

Skill RSI model-backed runs use the OpenAI API key in `.env` or the browser-local UI key field. A ChatGPT Plus/Pro subscription does not fund local Skill RSI API calls.

The plugin is a Codex-native operator surface. By default, it opens the local web app at `http://127.0.0.1:8765/` because that remains the most reliable guided console in Codex desktop. MCP tools can prepare fresh setup drafts, create or import projects when explicitly requested, return focused launch URLs, inspect existing projects only when explicitly requested, run bounded loops only when explicitly requested, export champions, and explicitly consume queued Codex context. The CLI remains the best surface for reproducible automation.

MCP-UI support is host-dependent and is not the default Codex desktop path. `skill_rsi_open` returns the local app launch URL only; `skill_rsi_cockpit` is the optional embedded console for hosts with robust MCP Apps/UI rendering. Codex hooks only queue context; they do not run RSI loops or spend model budget by themselves.

For install/update details and troubleshooting, see [plugins/skill-rsi/README.md](plugins/skill-rsi/README.md). For the plugin release checklist, see [docs/CODEX_PLUGIN_RELEASE.md](docs/CODEX_PLUGIN_RELEASE.md).

## Operating Modes

Manual:

```bash
node src/cli.js run ux-design --agentic --real-eval --loops 1
```

Scheduled or continuous:

```bash
node scripts/skill-rsi-cron-runner.mjs ux-design --agentic --real-eval --max-runs 20 --max-new-runs 1 --agent-model gpt-5.5
```

Queue hook context:

```bash
node src/cli.js hook-record ux-design --event hook.json
```

Codex hooks only queue context; the next manual or scheduled run consumes it. For cron, PowerShell, or macOS LaunchAgent setup, see [docs/SCHEDULING.md](docs/SCHEDULING.md). For Codex hook setup, see [docs/CODEX_HOOKS.md](docs/CODEX_HOOKS.md).

## What A Run Produces

Cold start:

```text
runs/<run-id>/
├── deconstruction/
│   ├── research-packet.json
│   ├── ontology.json
│   ├── parameterization.json
│   └── experiment-plan.json
├── candidates/
│   ├── candidate-a/
│   └── candidate-b/
├── eval/
│   ├── config.json
│   └── candidate-duel.json
└── analysis/
    ├── recommendation.json
    └── report.md
```

Champion challenge:

```text
runs/<run-id>/
├── deconstruction/
│   ├── parameterization.json
│   └── experiment-plan.json
├── challenger/
├── eval/
│   ├── config.json
│   └── challenge.json
└── analysis/
    ├── recommendation.json
    └── report.md
```

Visual runs also persist rendered HTML, screenshots, render diagnostics, and screenshot references under the run's eval artifacts.

After a promotion, `champion/skill/` is updated and `history/current-summary.md` records what changed, what was learned, what not to repeat, and what the next loop should try.

## CLI Reference

```bash
# Project management
node src/cli.js doctor
node src/cli.js init <name> --goal "..." --output text|code|code_visual --model gpt-5.5 --target-iterations 3
node src/cli.js init <name> --goal "..." --baseline ./path/to/skill-or.zip
node src/cli.js projects
node src/cli.js status <project>
node src/cli.js delete <project>
node src/cli.js diagnose [project]
node src/cli.js support-prompt [project]

# Running loops
node src/cli.js run <project> --stub --loops 3
node src/cli.js run <project> --agentic --real-eval --loops 1
node src/cli.js run <project> --agentic --real-eval --loops 1 --model gpt-5.5
node src/cli.js step <project>
node src/cli.js continuous <project> --agentic --real-eval --max-runs 20 --max-new-runs 1
node src/cli.js continuous <project> --agentic --real-eval --max-runs 20 --max-new-runs 1 --consume-hooks
node src/cli.js hook-record <project> --event hook.json

# Inspection
node src/cli.js summary <project>
node src/cli.js progress <project>
node src/cli.js compare <project>
node src/cli.js timeline <project>
node src/cli.js report <project>
node src/cli.js run-detail <project>
node src/cli.js skill <project> --source champion
node src/cli.js skill <project> --source challenger --run latest --json
node src/cli.js export-skill <project> --source champion --out ./exported-skill
node src/cli.js inspect-skill <path/to/skill>

# Standalone evaluation
node src/cli.js evaluate <project> \
  --a ./skill-a --b ./skill-b \
  --prompts prompts.json --criteria criteria.json \
  --output text \
  --gen-model gpt-5.5 --judge-model gpt-5.5 \
  --out result.json

node src/cli.js evaluate <project> \
  --a ./skill-a --b ./skill-b \
  --prompts prompts.json --criteria criteria.json \
  --output code_visual \
  --visual-artifacts-dir ./visual-artifacts \
  --gen-model gpt-5.5 --judge-model gpt-5.5 \
  --out result.json

# Annotation, not required promotion
node src/cli.js decide <project> --decision annotate --note "Reviewed."
```

`init --output code_visual` checks local screenshot runner availability before creating the project. Run `node src/cli.js doctor` for OpenAI key status, supported model names, and visual runner diagnostics. `node src/cli.js diagnose [project]` optionally creates a support zip under `.skill-rsi-diagnostics/`; it may contain run data, but it should not contain API keys. `node src/cli.js support-prompt [project]` prints copy-paste instructions for Codex, including asking an agent to audit what you are sending. Per-run model flags override project config and should be used intentionally because they make the run history less uniform.

## Project Workspace

All state lives under `.skill-rsi/projects/<name>/` as plain files.

```text
.skill-rsi/
└── projects/
    └── ux-design/
        ├── config.json
        ├── project.yaml
        ├── state.json
        ├── champion/skill/
        ├── ontology/current.json
        ├── parameterization/current.json
        ├── prompt-bank/
        ├── runs/
        └── history/
            ├── current-summary.md
            ├── index.json
            └── detailed/
```

`config.json` is the machine-readable source for triggers, budgets, promotion policy, eval policy, model choices, research policy, and portability. `project.yaml` is a compact human-readable companion.

Current UI-created model config:

```json
{
  "models": {
    "agent": "gpt-5.5",
    "generation": "gpt-5.5",
    "judge": "gpt-5.5"
  }
}
```

## API Keys

CLI and local server runs load `.env` automatically:

```bash
OPENAI_API_KEY=sk-...
```

The UI can also use a pasted key saved locally in the browser. Project files store model names, not API keys.

## Visual Evaluation

`Code + visuals` projects require generated skills to produce complete standalone browser-renderable UI code. Skill RSI renders each output with Playwright/system Chromium, captures desktop/tablet/mobile screenshots, records render diagnostics, and sends the text plus images to the judge.

The product exposes `Code + visuals`, where the artifact is still browser-renderable code. Separate rendered-media generation is not part of the product surface.

## Built On

Skill RSI's evaluation engine is a headless adaptation of [SkillEval](https://github.com/justinwetch/SkillEval). Skill packages follow the [Agent Skills standard](https://agentskills.io/specification). For architecture and roadmap notes, see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Built by [Justin Wetch](https://www.justinwetch.com)
