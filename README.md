# 🔄 Skill RSI

Recursive self-improvement for Agent Skills.

Given a skill and a goal, Skill RSI deconstructs what the current version gets wrong, generates two independent challengers based on a focused hypothesis, evaluates them against the champion, and promotes the winner into the next round. Every loop builds on what the last one learned.

For the full origin story, see [Open Sourcing SkillEval](https://www.justinwetch.com/blog/skilleval).

---

After building [SkillEval](https://github.com/justinwetch/SkillEval), I kept running into the same bottleneck. The eval loop worked fine — scoring skills across batches of prompts was no longer the problem. What to test next was still fully manual. You'd finish a round, see that one skill won on edge cases but regressed on output format, and then sit down to figure out what hypothesis to try next time. SkillEval gave me data. It didn't give me the upstream answer.

That question became Skill RSI. The system deconstructs the current champion into a granular map of improvable surfaces, picks one or two to focus on, designs a concrete A/B experiment, and generates two independent challengers from it. A headless eval harness runs the matchups. An analyst agent interprets the results and recommends whether to promote, keep, or mark the run inconclusive. A compact experiment history accumulates across runs, so the system knows what it's already tried, what regressed, and where the most promising hypotheses are. The next loop reads that history instead of starting blind.

I wanted to put a flag in the ground on recursive self-improvement as something that actually runs, not a research concept. The claim is in the name. Given a goal and enough iterations, the system should be able to improve its way toward it.

---

## How it works

Each loop follows a fixed sequence of agent stages:

```
load state and history
  → deconstruct current champion (parameter map)
  → plan A/B experiment (which surfaces to test, which to hold)
  → generate candidate A
  → generate candidate B
  → adversarial preflight review
  → candidate duel (A vs B on exploration batch)
  → champion gate (winner vs current champion on stable batch)
  → analyst recommendation
  → promote / keep / edit / request new experiment
  → write history
```

The first run starts with an ontology pass to map the skill's domain before generating candidates. Later runs skip that and go straight to deconstruction, using the experiment history to focus on the most promising open hypotheses.

You stay in the loop as supervisor and budget owner. The system invents the variants.

## Quick start

```bash
git clone https://github.com/justinwetch/SkillRSI.git
cd skill-rsi
npm install
cp .env.example .env   # add OPENAI_API_KEY or equivalent
```

Initialize a project and run your first loop in stub mode (no API calls):

```bash
node src/cli.js init my-skill --goal "Help agents write clear technical documentation."
node src/cli.js run my-skill --stub --loops 3
```

Run a real loop with model-backed agents:

```bash
node src/cli.js run my-skill --agentic --loops 1 --agent-model gpt-5.4-mini
```

Check the result:

```bash
node src/cli.js status my-skill
node src/cli.js summary my-skill
```

**UI.** Build and start the local server, then open [http://127.0.0.1:8765](http://127.0.0.1:8765):

```bash
npm run build:ui
npm run server
```

For hot-reload UI development, run `npm run server` and `npm run dev:ui` in separate terminals.

## Operating modes

**Manual.** Run one loop and stop. Good for reviewing each result before continuing.

```bash
node src/cli.js run ux-design --agentic --loops 1
```

**Continuous.** Run until a stop condition fires: budget exhausted, a patience threshold of runs without improvement, or too many inconclusive results in a row.

```bash
node src/cli.js continuous ux-design --max-runs 5 --patience 3 --max-inconclusive 2
```

**Hook-triggered.** Start a run from an external event, like a skill edit, a merged PR, or a failed eval. The hook payload includes source event, changed files, and a suggested evaluation focus.

```bash
node src/cli.js hook ux-design --event hook.json
```

For scheduled (cron or macOS LaunchAgent) setup, see [docs/SCHEDULING.md](docs/SCHEDULING.md).

## What a run produces

```
runs/<run-id>/
├── candidates/
│   ├── candidate-a/skill/      # challenger package + rationale + review
│   └── candidate-b/skill/
├── eval/
│   ├── candidate-duel.json     # A vs B results
│   └── champion-gate.json      # winner vs current champion
└── analysis/
    ├── recommendation.json
    └── report.md
```

After a promotion, `champion/skill/` is updated and `history/current-summary.md` appends a summary of what changed, what was learned, and what to try next.

## CLI reference

```bash
# Project management
node src/cli.js init <name> --goal "..."
node src/cli.js projects
node src/cli.js status <project>

# Running loops
node src/cli.js run <project> --stub --loops 3
node src/cli.js run <project> --agentic --loops 1 --agent-model gpt-5.4-mini
node src/cli.js step <project>
node src/cli.js continuous <project> --max-runs 5 --patience 3
node src/cli.js hook <project> --event hook.json

# Inspection
node src/cli.js summary <project>
node src/cli.js compare <project>
node src/cli.js timeline <project>
node src/cli.js report <project>
node src/cli.js run-detail <project>
node src/cli.js inspect-skill <path/to/skill>

# Standalone evaluation (headless SkillEval)
node src/cli.js evaluate <project> \
  --a ./skill-a --b ./skill-b \
  --prompts prompts.json --criteria criteria.json \
  --gen-model gpt-5.4-mini --judge-model gpt-5.4-mini \
  --out result.json

# Annotation
node src/cli.js decide <project> --decision annotate --note "Reviewed."
```

## Project workspace

All state lives under `.skill-rsi/projects/<name>/` as plain JSON. Git-friendly and easy to inspect or repair manually.

```
.skill-rsi/
└── projects/
    └── ux-design/
        ├── project.yaml             # goal, models, promotion policy, budgets
        ├── state.json
        ├── champion/skill/          # current best skill package
        ├── ontology/current.json
        ├── parameterization/current.json
        ├── prompt-bank/             # stable + exploration prompts and criteria
        ├── runs/
        │   └── <run-id>/
        │       ├── candidates/
        │       ├── eval/
        │       └── analysis/
        └── history/
            ├── current-summary.md
            ├── index.json
            └── detailed/
```

## Configuration

`project.yaml` controls the goal, models, promotion policy, and budgets:

```yaml
name: ux-design
goal: Help agents design better UX for production applications.
models:
  creator: gpt-5.4-mini
  judge: gpt-5.4-mini
  analyst: gpt-5.4-mini
eval:
  default_batch_size: 10
  stable_prompt_count: 6
  exploration_prompt_count: 4
promotion:
  min_win_delta: 2
  min_score_delta: 4
  require_no_critical_regressions: true
budget:
  max_loops_per_run: 1
  max_eval_tokens_per_loop: 300000
triggers:
  mode: manual
```

## API keys

Copy `.env.example` to `.env` and add your provider key:

```bash
OPENAI_API_KEY=sk-...
```

If no model is specified for a real `evaluate` run, both generation and judging default to `gpt-5.4-mini`. `.env` is gitignored.

## Built on

Skill RSI's evaluation engine is a headless adaptation of [SkillEval](https://github.com/justinwetch/SkillEval). Skill packages follow the [Agent Skills standard](https://agentskills.io/specification). For architecture and full product roadmap, see [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

---

Built by [Justin Wetch](https://www.justinwetch.com)
