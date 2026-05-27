# Skill RSI Implementation Tracker

Practical checklist for closing the gap between the conceptual plan in
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) and the current implementation.

Use this as the day-to-day status document. Keep the implementation plan as the
strategy/source-of-truth document, and update this tracker whenever a chunk lands.

## Current Completed Foundation

- [x] Local workspace/project layout under `.skill-rsi/projects/<project>/`
- [x] Stub, mock, and agentic loop modes
- [x] Skill package IO for directories, single-file `.md`/`.txt`, and zip packages
- [x] Text-only headless evaluator with mock and real model-backed modes
- [x] Ontology, deconstructor, experiment planner, creator, reviewer, and analyst contracts
- [x] Candidate package materialization into run workspaces
- [x] Candidate preflight review for spec issues, unsafe scripts, package bloat, and eval leakage
- [x] Bounded candidate revision after adversarial-review blocking issues
- [x] Creator-contract retry diagnostics for malformed creator artifacts
- [x] Prompt-bank lifecycle with stable prompts, exploration prompts, criteria versions, promotion, and retirement
- [x] Analyst recommendation merged with deterministic promotion policy gate
- [x] Champion copy/promotion flow
- [x] Manual, continuous, and hook-triggered CLI surfaces
- [x] Project lock, max-run guard, stop rules, and per-run `timeline.jsonl`
- [x] UI/API surfaces for projects, run detail, comparisons, progress, skill viewing, timeline, and prompt-bank/eval inspection
- [x] Human decisions available as CLI/API audit annotations, not part of the default RSI promotion flow

## Phase 1: History And Provenance Hardening

- [x] Expand `history/current-summary.md` with durable known weaknesses, do-not-repeat items, next experiment notes, and failed-strategy summaries.
- [x] Add richer detailed run reports with eval summary, parameter outcomes, prompt-bank changes, artifact paths, and failure/recovery notes.
- [x] Track stale vs. current evidence in `parameterLog` so later loops do not over-weight old or inconclusive results.
- [x] Record failed creator/reviewer/eval strategies in history when they reveal reusable information.
- [x] Add tests for history summaries over multi-run sequences, including promotion, no-promotion, inconclusive, and recovered-failure runs.

## Phase 2: Manager Behavior And Experiment Memory

- [x] Add an explicit manager artifact per run that records strategic context, selected prior artifacts, experiment intent, and final next action.
- [x] Detect repeated failed experiments and avoid retrying the same parameter/strategy without new evidence.
- [x] Detect local maxima from repeated non-promotion or low-signal runs.
- [x] Add a high-divergence/reset experiment template for local-maxima recovery.
- [x] Make `edit_current` a real surgical-edit branch, or remove it from advertised outcomes until implemented.

## Phase 3: Budget, Config, And Trigger Hardening

- [x] Expand `config.json` to cover budget, trigger, portability, eval output type, and visual-runner settings.
- [x] Enforce token, spend, and concurrency budgets before unattended runs.
- [x] Persist model IDs and relevant generation/judging parameters consistently across agent calls and eval runs.
- [x] Let hook metadata influence experiment focus, instead of only recording the event before a normal one-loop run.
- [x] Surface run policy, trigger mode, and budget limits clearly in the UI.

## Phase 4: Evaluator Reliability And SkillEval Parity

- [x] Add per-prompt eval failure capture so one failed prompt does not destroy the whole eval run.
- [x] Add retry policy for generation and judging calls, with persisted failure metadata.
- [x] Persist richer raw eval artifacts: model metadata, timing, raw judge response, parsed scores, and content hashes.
- [x] Add stable-prompt critical regression checks to promotion policy.
- [x] Add deterministic eval confidence summaries for close/high-impact promotion decisions.
- [x] Keep visual and mixed-output eval explicitly deferred unless prioritized.

## Phase 5: Optional Visual And UI Expansion

- [ ] Add visual runner and screenshot artifact storage only after the text RSI loop is reliable.
- [ ] Reuse or adapt SkillEval screenshot-server contracts for visual/mixed evaluation.
- [ ] Keep human review as annotation/audit by default, not required promotion.
- [ ] Add UI affordances only for implemented backend behavior, avoiding inert approval controls.

## Deferred / V2 Items

- [ ] TypeScript/package split into core, headless evaluator, agents, CLI, and web packages.
- [ ] SQLite or queryable storage if filesystem history becomes hard to inspect.
- [ ] Cross-experiment learning across multiple skill domains.
- [ ] Automated GitHub PR creation or repo-integrated release flow.
- [ ] Hosted service, distributed queues, or multi-user permissions.

## Documentation Checks

- [x] README implementation claims match actual UI and CLI behavior.
- [x] `IMPLEMENTATION_PLAN.md` stays conceptual and links here for status.
- [x] This tracker reflects current code before each major implementation chunk.
