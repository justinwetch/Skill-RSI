# Skill RSI

Recursive Self-Improvement for Agent Skills.

This repository currently has the local Skill RSI scaffold plus a focused headless SkillEval integration. Mock modes remain available for offline development, and `evaluate` can now run text-only real model generation and judging through provider APIs.

## Commands

```bash
npm test
node src/cli.js init ux-design --goal "Help agents design better UX for production applications."
node src/cli.js run ux-design --stub --loops 3
node src/cli.js run ux-design-mock --mock --loops 1 --goal "Help agents design better UX for production applications."
node src/cli.js run ux-design-real-eval --mock --real-eval --loops 1 --goal "Help agents design better UX for production applications."
node src/cli.js run ux-design-agentic --agentic --loops 1 --agent-model gpt-5.4-mini --goal "Help agents design better UX for production applications."
node src/cli.js run ux-design-loop --mock --loops 3 --max-runs 5
node src/cli.js step ux-design-loop --mock
node src/cli.js continuous ux-design-loop --mock --max-runs 5 --patience 3 --max-inconclusive 2
node src/cli.js hook ux-design-loop --mock --event hook.json
node src/cli.js projects
node src/cli.js status ux-design
node src/cli.js summary ux-design-loop
node src/cli.js run-detail ux-design-loop
node src/cli.js compare ux-design-loop
node src/cli.js decide ux-design-loop --decision annotate --note "Reviewed current run."
node src/cli.js report ux-design
node src/cli.js timeline ux-design-loop
node src/cli.js timeline ux-design-loop --json
node src/cli.js inspect-skill .skill-rsi/projects/ux-design/champion/skill
node src/cli.js evaluate eval-demo --a ./skill-a --b ./skill-b --prompts prompts.json --criteria criteria.json --mock --out result.json
node src/cli.js evaluate eval-demo --a ./skill-a --b ./skill-b --prompts prompts.json --criteria criteria.json --gen-model gpt-5.4-mini --judge-model gpt-5.4-mini --out result.json
node src/cli.js agent ux-design --name deconstructor --run-id contract-001 --out deconstructor.json
node src/cli.js agent ux-design --name deconstructor --real --model gpt-5.4-mini --save-current --out deconstructor.json
node src/cli.js agent ux-design --name creator --real --model gpt-5.4-mini --arm candidateA --candidate-dir .skill-rsi/projects/ux-design/scratch/candidate-a --out creator-a.json
```

## UI

Build the UI and start the local Skill RSI server:

```bash
npm run build:ui
npm run server
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

For UI development, run the API server and Vite client in separate terminals:

```bash
npm run server
npm run dev:ui
```

The UI reuses SkillEval's graphite workbench style and reads the same JSON surfaces exposed by the CLI.

## API Keys

Copy `.env.example` to `.env` and add:

```bash
OPENAI_API_KEY=sk-...
```

`.env` is gitignored. If no model is provided for real `evaluate`, the CLI defaults both generation and judging to `gpt-5.4-mini` to keep test runs cheap.

Generated experiment data is written under `.skill-rsi/projects/<project>/`.

For unattended runs, see [`docs/SCHEDULING.md`](docs/SCHEDULING.md).
For current implementation status and the checkoff roadmap, see
[`IMPLEMENTATION_TRACKER.md`](IMPLEMENTATION_TRACKER.md).

## Implemented

- CLI scaffold for `init`, `run --stub`, and `status`
- local project workspace under `.skill-rsi/projects/<name>/`
- run folders with candidates, deconstruction, eval placeholders, analysis, and promoted skill artifacts
- schema validators for config, state, ontology, parameterization, experiment plan, candidates, eval results, recommendations, and history
- deterministic stub loop that can complete three iterations and update champion state
- append-only history index plus compact current summary
- skill package inspection for directories, single `.md`/`.txt` files, and zipped packages
- mock headless evaluator with blind A/B labels and structured JSON output
- real text-only headless evaluator using provider model APIs
- mock agent contracts for ontology, deconstructor, experiment planner, creator, and analyst
- real model-backed agent contract runner for ontology, deconstructor, experiment planner, creator, and analyst
- real creator artifact materialization into a candidate skill package directory
- `run --agentic` orchestration for model-backed deconstruction, planning, and candidate creation with mock or real eval
- parameter-targeted evaluation designer with 6 stable prompts, 4 exploration prompts, and 4-6 criteria
- prompt-bank lifecycle with stable prompt reuse, exploration prompt history, and criteria version metadata
- prompt-bank updates that promote high-signal exploration prompts and retire weak prompts after eval
- analyst-backed recommendation with deterministic promotion policy gate
- adversarial candidate preflight review that blocks invalid packages, unsafe scripts, and eval prompt leakage before evaluation
- review-blocked agentic runs now complete cleanly with `request_new_experiment`, persisted review artifacts, and no eval spend
- one bounded creator revision retry for candidates blocked by adversarial review, with revision artifacts under `revision-001/`
- stop rules for continuous/manual loops: max-run budget, promotion patience, and consecutive inconclusive-run caps
- timeline inspection command with text/JSON output plus failed-run timeline entries
- documented cron and macOS LaunchAgent scheduling around the bounded `continuous` command
- UI-ready JSON surfaces for project lists, project summaries, run details, manager artifacts, candidate comparisons, and optional audit annotations
- SkillEval-inspired React UI for project dashboards, run summaries, candidate comparison, eval results, prompt-bank health, timeline, and skill inspection
- mock first-run flow that uses generated candidate packages plus the headless evaluator artifact shape
- mock later-run flow with challenger-vs-champion gates
- project run lock, max-run budget guard, and per-run `timeline.jsonl` logs
- manual step, continuous, hook-triggered, status, and report command surfaces
