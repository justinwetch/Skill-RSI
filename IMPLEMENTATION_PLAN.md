# Skill RSI Implementation Plan

Recursive Self-Improvement for Agent Skills

This document is the conceptual source of truth for architecture and product intent.

## 1. Goal

Skill RSI is a system that repeatedly improves Agent Skill packages by generating independent candidate skill versions, evaluating them with a headless SkillEval-style A/B harness, interpreting the results, and promoting the best version into the next iteration.

SkillEval answers "which of these two skills performed better?" Skill RSI answers the missing upstream question: "what should the next challenger skill be, and why?" The human remains a supervisor and budget owner instead of the person manually inventing every variant.

The product should support three operating modes:

1. Manual: run one improvement loop on demand.
2. Scheduled: run a loop on a cron-like cadence.
3. Hook-triggered: run a loop after an external event, such as a skill edit, a failed eval, a merged PR, or a new batch of human feedback.

The core output of every loop is one of:

1. Keep current champion: no candidate has enough evidence to replace it.
2. Promote candidate: a candidate becomes the new champion skill.
3. Edit champion: make a small targeted edit instead of replacing the whole skill.
4. Request new experiment: evaluation was inconclusive or exposed a missing test dimension.

The system must preserve a long-running experiment history without forcing every future agent invocation to read every prior artifact.

## 2. Grounding From SkillEval And Agent Skills

SkillEval already provides the evaluation substrate:

- It compares two skill packages, A and B, over a list of prompts.
- It supports single-file `.md`/`.txt` skills and zipped Agent Skill packages with `SKILL.md`, references, scripts, assets, and supporting files.
- It generates criteria, prompts, and output type using `generateFromSkills`.
- It runs both skills through the same prompt set with `runAllEvals`.
- It judges paired outputs with `judgeAllEvals`.
- It stores browser run state in localStorage and is currently optimized for a GUI workflow.
- It uses a screenshot server for visual outputs and can score text, visual, or mixed outputs.

Agent Skills impose the target shape:

- A skill is a directory with a root `SKILL.md`.
- `SKILL.md` must include YAML frontmatter with at least `name` and `description`.
- Supporting files can live in `scripts/`, `references/`, `assets/`, or other package paths.
- Progressive disclosure matters: startup reads only metadata, activation reads `SKILL.md`, and resources are loaded only when needed.
- Skill generators should keep `SKILL.md` concise, move detailed reference material out, and avoid overfitting to known eval prompts.

Design implication: Skill RSI should not treat a skill as one prompt blob. It should treat a skill as a versioned package, preserve package structure, and evaluate changes at package level.

## 3. Recommended Product Shape

Build Skill RSI as a separate TypeScript/Node project that extracts or imports the reusable parts of SkillEval instead of automating the SkillEval GUI.

Recommended packages:

```text
skill-rsi/
├── packages/
│   ├── core/                 # Loop state machine, schemas, history, promotion logic
│   ├── skilleval-headless/   # Adapted SkillEval engine for filesystem/CLI use
│   ├── agents/               # Prompt contracts and model orchestration helpers
│   ├── cli/                  # skill-rsi command line interface
│   └── web/                  # Optional later UI
├── examples/
│   └── ux-design-skill/
├── docs/
│   └── architecture.md
└── README.md
```

MVP can be a single package if speed matters, but keep internal module boundaries aligned with the package list above so the project can split cleanly later.

## 4. Core Workflow

### First Run

Input:

- Skill goal.
- Domain context.
- Target platform or portability target.
- Optional seed examples, brand guidance, preferred style, and constraints.

Flow:

1. Manager creates a project workspace and run ID.
2. Ontology subgraph maps the skill's possibility space and creates the initial parameter taxonomy.
3. Experiment planner creates an initial broad A/B brief from the ontology.
4. Candidate creator A creates one complete skill package.
5. Candidate creator B independently creates another complete skill package.
6. Preflight validates both packages against the Agent Skills spec and local project rules.
7. Evaluation designer creates a batch of 10 prompts and 4-6 scoring criteria.
8. Headless SkillEval runs A and B over the prompt batch.
9. Judge scores every paired result.
10. Analyst interprets results, noise, failure modes, and promotion confidence.
11. Manager promotes a champion or marks the run inconclusive.
12. History writer stores full artifacts and appends a compact summary.

Output:

- `champion/` skill package.
- `runs/<run_id>/analysis/recommendation.json`.
- `history/current-summary.md`.
- Full raw eval data for later analysis.

### Later Runs

Input:

- Current champion skill.
- Skill goal and context.
- Experiment history summary.
- Optional detailed prior artifacts selected by the manager.

Flow:

1. Manager reads compact history, initial context, and current champion.
2. Deconstruction subagent analyzes the latest champion and parameterizes the current skill: what surfaces exist for improvement, what hypotheses attach to each surface, and what evidence from prior runs matters.
3. Ontology subgraph refreshes only if deconstruction reveals a changed domain assumption or a missing category in the parameter taxonomy.
4. Experiment planner converts the parameter map into a concrete A/B experiment brief.
5. Two creator subagents independently produce challenger candidates from that experiment brief.
6. Candidate duel compares challenger A vs challenger B on an exploration batch.
7. Promotion gate compares the winning challenger against the current champion on the stable batch.
8. Analyst recommends promote, keep, edit, or request a new experiment.
9. History writer records what changed, what was learned, and what should be tried next.

This keeps the "two independent paths" design while preventing a new candidate from replacing a proven champion just because it beat another weak candidate.
It also makes every later loop hypothesis-driven: the system first asks what can be changed, then chooses which change to test.

## 5. Orchestration Graph

Use a deterministic state machine first. A graph framework can be introduced later if the branching gets complex.

```text
init_run
  -> load_project_state
  -> build_initial_ontology_or_deconstruct_current_skill
  -> plan_ab_experiment
  -> generate_candidate_a
  -> generate_candidate_b
  -> adversarial_review_a
  -> adversarial_review_b
  -> revise_candidate_a
  -> revise_candidate_b
  -> validate_packages
  -> design_eval_batch
  -> run_candidate_duel
  -> analyze_duel
  -> run_champion_gate
  -> analyze_promotion
  -> apply_decision
  -> write_history
  -> emit_report
```

Every node should be resumable. If a model call fails or an eval times out, the next process should reload state and continue from the failed node.

## 6. Agent Roles

### 6.1 Manager Agent

Responsibility:

- Own the loop state and final decision.
- Design the round-level A/B experiment after reading the parameterization.
- Decide which prior artifacts are relevant enough to load.
- Prevent overfitting, scope creep, and runaway cost.
- Convert analyst recommendations into an explicit next action.

Inputs:

- Project config.
- Current champion.
- Run state.
- Compact history.
- Budget and stop rules.

Outputs:

- Run plan.
- Candidate strategy assignments.
- Parameter focus and A/B experiment brief.
- Final loop decision.
- Next-run notes.

Boundaries:

- The manager does not write skill packages.
- The manager does not score raw eval outputs; the analyst owns interpretation.
- The manager does not generate the parameter map; the deconstructor owns that.
- The manager is the only role that turns a parameter map into the next experiment brief.

### 6.2 Ontology Agent

Responsibility:

- Map the skill's domain and the Agent Skill design space.
- Create structured scaffolding for candidate creators and eval generation.

Output schema:

```ts
type SkillOntology = {
  skillGoal: string;
  targetUsers: string[];
  targetTasks: TaskClass[];
  invocationBoundaries: {
    shouldTriggerWhen: string[];
    shouldNotTriggerWhen: string[];
  };
  inputSurface: string[];
  outputArtifacts: string[];
  requiredKnowledge: string[];
  referencePoints: string[];
  adjacentDomainsToBorrowFrom: string[];
  optionalResources: {
    references: string[];
    scripts: string[];
    assets: string[];
  };
  platformAssumptions: {
    portableAgentSkills: string[];
    clientSpecificFeatures: string[];
  };
  failureModes: FailureMode[];
  qualityAxes: QualityAxis[];
  evalPromptTaxonomy: PromptClass[];
  candidateStrategySpace: CandidateStrategy[];
  openQuestions: string[];
};
```

Design notes:

- Treat the Agent Skills spec as the outer boundary.
- Label anything platform-specific, such as Claude Code-only frontmatter or dynamic context injection, as non-portable unless the project config explicitly allows it.
- Include both "what this skill should do" and "what this skill must not try to own."
- When network access is configured, allow research-backed reference points and adjacent domains; when offline, require the ontology to label those as model inferences.
- Before real ontology generation, build a research packet that captures sources, evidence claims, an authority map, open questions, and research gaps. Model-native OpenAI web search is the first supported path; unsupported providers fall back to inference-labeled packets.
- Run an ontology quality gate after generation. In the default `warn_and_revise` mode, revise once using the quality report, then continue with explicit confidence warnings if issues remain.
- On the first run, create the initial parameter taxonomy. On later runs, prefer deconstruction of the actual champion skill and use ontology only to fill missing categories or update assumptions.

### 6.3 Deconstruction And Parameterization Agent

Responsibility:

- Given history context, initial context, and the latest champion skill, deconstruct the current skill into granular improvement parameters.
- Identify what surfaces can be changed, what each change might improve, what it might damage, and how an experiment could detect the difference.
- Produce hypotheses without deciding the final A/B plan.

Inputs:

- Initial skill goal and context.
- Current champion skill package, including package files beyond `SKILL.md`.
- Compact experiment history.
- Selected detailed prior artifacts.
- Current ontology or parameter taxonomy.
- Known prompt bank and result summaries.
- Agent Skills standard and the current research packet when available.

The deconstruction prompt should require at least a dozen parameter surfaces and encourage finer granularity. Required surfaces to consider:

- Activation metadata: skill name and description specificity.
- Trigger boundaries: when the skill should and should not activate.
- Workflow sequence: order of steps the agent follows after activation.
- Decision heuristics: how the skill tells the agent to choose between valid approaches.
- Context loading strategy: what stays in `SKILL.md` vs references.
- Reference architecture: reference file split, names, and loading cues.
- Script and automation strategy: whether deterministic helpers should exist.
- Output contract: expected final artifact shape, level of detail, and formatting.
- Validation strategy: checks, tests, screenshots, linting, or review steps.
- Failure mode handling: known ways the skill fails and how it recovers.
- Edge-case coverage: unusual requests, missing context, contradictory requirements.
- Progressive disclosure budget: line count, token load, repetition, and bloat.
- Portability: standard Agent Skills behavior vs client-specific features.
- Tool policy: tool assumptions, permissions, and whether scripts are executable.
- Safety and security: unsafe commands, untrusted inputs, dependency risk.
- Examples and counterexamples: whether examples clarify or overfit behavior.
- Tone and collaboration style: how the skill shapes agent communication.
- Package structure: files, directories, assets, and dependency placement.

Output schema:

```ts
type SkillParameterization = {
  runId: string;
  championSkillHash: string;
  summary: string;
  parameters: SkillParameter[];
  crossParameterInteractions: Array<{
    parameterIds: string[];
    interaction: string;
    risk: string;
  }>;
  highestLeverageHypotheses: string[];
  doNotTouchYet: Array<{
    parameterId: string;
    reason: string;
  }>;
  suggestedExperimentFamilies: ExperimentFamily[];
};

type SkillParameter = {
  id: string;
  surface: string;
  currentImplementation: string;
  improvementHypothesis: string;
  expectedBenefit: string;
  regressionRisk: string;
  evidenceFromHistory: string[];
  possibleMutations: string[];
  measurementPlan: string;
  priority: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
  granularity: "micro" | "section" | "package" | "strategy";
};
```

Design notes:

- The deconstruction agent is mandatory after a champion exists.
- It should not rewrite the skill.
- It should not anchor only on the last run; it should distinguish current evidence from stale or inconclusive evidence.
- It should identify parameters that are coupled, because A/B experiments are cleaner when they mutate a small number of related surfaces.
- It should pass the same anti-slop quality gate as ontology: every parameter needs artifact evidence, history evidence, mutation hypothesis, regression risk, measurement plan, confidence, and coupling notes.

### 6.4 Experiment Planner

Responsibility:

- Convert the parameterization into a specific A/B experiment.
- Decide which parameters are worth testing now and which should remain controlled.
- Produce the candidate strategy assignments for creator A and creator B.

Output schema:

```ts
type ABExperimentPlan = {
  runId: string;
  experimentQuestion: string;
  focusParameterIds: string[];
  controlledParameterIds: string[];
  hypothesis: string;
  arms: {
    candidateA: ExperimentArm;
    candidateB: ExperimentArm;
  };
  evalFocus: {
    promptTaxonomyTargets: string[];
    criteriaEmphasis: string[];
    expectedObservableDifferences: string[];
  };
  successMetrics: string[];
  promotionRisks: string[];
  reasonNotTestingOtherHighPriorityParameters: string[];
};

type ExperimentArm = {
  strategyName: string;
  mutationInstructions: string[];
  constraints: string[];
  expectedStrengths: string[];
  expectedWeaknesses: string[];
};
```

Default policy:

- Test one to three related parameters per loop.
- Keep unrelated parameters as controlled constants.
- Prefer experiments that can produce observable differences in a 10-prompt batch.
- If the parameter map suggests many weak hypotheses, plan an exploratory A/B experiment.
- If one hypothesis is strong and localized, plan a narrow edit-vs-restructure experiment.

Useful experiment templates:

- One-parameter bidirectional test: candidate A pushes parameter X higher while candidate B pushes it lower.
- One-parameter challenger test: candidate A mutates parameter X while candidate B preserves the champion's current treatment as a control.
- Two-parameter exploration: candidate A mutates parameter X and candidate B mutates parameter Y, accepting weaker signal in exchange for broader search.
- High-divergence reset: one candidate intentionally explores a substantially different strategy when recent rounds show local-maxima behavior.
- Surgical edit vs restructure: one candidate makes a localized change and the other reorganizes the relevant section or package surface more aggressively.

### 6.5 Candidate Creator Agents

Responsibility:

- Create complete skill package candidates from the same goal, ontology, parameterization, and A/B experiment plan.
- Work independently to reduce correlated failure.
- Produce an outline, pause for adversarial implementation analysis, then implement.

Internal flow:

1. Draft a detailed package outline.
2. Run adversarial self-critique against the outline.
3. Revise the outline using only concrete, useful critique.
4. Write the final package files.

Each creator should receive a different strategy assignment. Examples:

- Creator A: lean procedural skill, minimal bundled resources, strong invocation boundaries.
- Creator B: resource-rich skill with reference files, examples, and scripts where justified.
- Creator A: workflow-first organization.
- Creator B: failure-mode-first organization.

Output:

```ts
type CandidatePackage = {
  candidateId: string;
  experimentArm: "candidateA" | "candidateB";
  strategy: string;
  changedParameterIds: string[];
  files: SkillFile[];
  rationale: string;
  expectedAdvantages: string[];
  expectedRisks: string[];
  selfCritique: string[];
};
```

Hard rules:

- Do not mention or optimize for specific eval prompt IDs.
- Keep `SKILL.md` concise enough to load cheaply.
- Use references when domain detail is needed.
- Use scripts only when deterministic execution beats prose instructions.
- Make the `description` specific enough for activation, not a generic marketing sentence.
- Preserve controlled parameters from the experiment plan unless the plan explicitly authorizes changing them.

### 6.6 Adversarial Reviewer

Responsibility:

- Review each candidate before evaluation.
- Attack the candidate's assumptions and implementation choices.
- Recommend concrete changes, not vague criticism.

Scope:

- Spec compliance.
- Trigger precision.
- Context cost.
- Missing edge cases.
- Overconstraint or underconstraint.
- Resource packaging.
- Security and unsafe script behavior.
- Evaluation leakage.

Output:

```ts
type AdversarialReview = {
  candidateId: string;
  blockingIssues: ReviewIssue[];
  recommendedEdits: ReviewIssue[];
  nonIssues: string[];
  overfittingRisk: "low" | "medium" | "high";
  approveForEval: boolean;
};
```

### 6.7 Evaluation Designer

Responsibility:

- Generate or maintain the eval prompt batch and scoring criteria.
- Use batches of 10 by default for fast iteration.
- Separate stable prompts from exploration prompts.

Prompt bank structure:

```ts
type PromptBank = {
  stable: EvalPrompt[];
  exploration: EvalPrompt[];
  retired: RetiredPrompt[];
};
```

Batch policy:

- Use 6 stable prompts and 4 exploration prompts for normal scheduled runs.
- Use 10 exploration prompts for first-run candidate discovery.
- Promote strong exploration prompts into stable only after they reveal durable signal.
- Retire prompts that are too easy, impossible, ambiguous, or leak implementation details.

### 6.8 SkillEval Runner

Responsibility:

- Run the paired candidate outputs.
- Preserve raw outputs, timing, model metadata, screenshots when relevant, judge responses, and parsed scores.

Required extensions over current SkillEval:

- Filesystem loader for skill packages.
- CLI/API entrypoint.
- JSONL or JSON run output.
- Stable run IDs and content hashes.
- Randomized A/B labeling for judges.
- Optional tie/inconclusive result.
- Retry policy for model/API failures.
- Cost and concurrency limits.

### 6.9 Data Analyst Agent

Responsibility:

- Interpret the SkillEval data in context.
- Separate likely signal from noise.
- Recommend the next state.

Inputs:

- Ontology.
- Parameterization and A/B experiment plan.
- Candidate rationales.
- Current champion, if any.
- Prompt batch metadata.
- Raw eval and judge data.
- Prior experiment history summary.

Output:

```ts
type AnalystRecommendation = {
  decision: "promote" | "keep_current" | "edit_current" | "request_new_experiment";
  recommendedChampionCandidateId?: string;
  confidence: "low" | "medium" | "high";
  resultSummary: {
    wins: Record<string, number>;
    meanScore: Record<string, number>;
    scoreDelta: number;
    criticalRegressions: string[];
  };
  signalAssessment: {
    strongSignals: string[];
    weakSignals: string[];
    likelyNoise: string[];
    inconclusiveAreas: string[];
  };
  actionableInsights: string[];
  nextExperimentNotes: string[];
  historySummary: string;
};
```

The analyst must be allowed to say "inconclusive." With 10 prompts, many runs will not justify promotion unless the margin is clear.

## 7. Data Model And Workspace Layout

Use local filesystem storage for MVP. It is transparent, git-friendly, and easy for agents to inspect. Add SQLite later only if query needs become painful.

```text
.skill-rsi/
└── projects/
    └── ux-design/
        ├── project.yaml
        ├── state.json
        ├── champion/
        │   └── skill/
        │       ├── SKILL.md
        │       ├── references/
        │       ├── scripts/
        │       └── assets/
        ├── ontology/
        │   ├── current.json
        │   └── runs/
        │       └── 2026-05-25T210000Z.json
        ├── parameterization/
        │   ├── current.json
        │   └── runs/
        │       └── 2026-05-25T210000Z.json
        ├── prompt-bank/
        │   ├── prompts.json
        │   └── criteria.json
        ├── runs/
        │   └── 2026-05-25T210000Z/
        │       ├── run.json
        │       ├── deconstruction/
        │       │   ├── parameterization.json
        │       │   └── experiment-plan.json
        │       ├── candidates/
        │       │   ├── candidate-a/
        │       │   │   ├── skill/
        │       │   │   ├── rationale.md
        │       │   │   └── review.json
        │       │   └── candidate-b/
        │       ├── eval/
        │       │   ├── config.json
        │       │   ├── candidate-duel.json
        │       │   ├── champion-gate.json
        │       │   └── raw/
        │       ├── analysis/
        │       │   ├── recommendation.json
        │       │   └── report.md
        │       └── promoted-skill/
        └── history/
            ├── current-summary.md
            ├── index.json
            └── detailed/
                └── 2026-05-25T210000Z.md
```

`current-summary.md` should remain short enough to load every run. It should include:

- Initial goal.
- Current champion identity and hash.
- Current quality summary.
- Highest-leverage parameter hypotheses.
- Known failure modes.
- Things tried that did not work.
- Next experiment notes.
- Links or paths to detailed run artifacts.

`history/detailed/` can grow without limit because the manager should load it selectively.

## 8. Project Configuration

Example `project.yaml`:

```yaml
name: ux-design
goal: Help agents design better UX for production applications.
target_skill_name: ux-design
portability:
  target: agent-skills-standard
  allow_client_specific_features: false
models:
  creator: configurable-model-id
  judge: configurable-model-id
  analyst: configurable-model-id
deconstruction:
  min_parameters: 12
  max_focus_parameters_per_experiment: 3
  refresh_ontology_when_missing_taxonomy: true
eval:
  default_batch_size: 10
  stable_prompt_count: 6
  exploration_prompt_count: 4
  output_type: auto
  allow_visual_runner: true
promotion:
  min_win_delta: 2
  min_score_delta: 4
  allow_promotion_on_low_confidence: false
  require_no_critical_regressions: true
budget:
  max_loops_per_run: 1
  max_parallel_model_calls: 6
  max_generation_tokens_per_candidate: 24000
  max_eval_tokens_per_loop: 300000
triggers:
  mode: manual
  cron: null
  hooks: []
```

## 9. Headless SkillEval Extraction

SkillEval's useful logic should become a headless library.

### Reuse Directly

- Skill package representation.
- Package hashing.
- Prompt and criteria generation concepts.
- Model provider abstraction.
- `runSingleEval` and `runAllEvals`.
- `judgeSingleEval` and `judgeAllEvals`.
- Screenshot server contract for visual outputs.

### Change For Skill RSI

1. Replace browser `File` upload with filesystem package loading.
2. Replace localStorage with explicit JSON artifacts.
3. Add run IDs, skill hashes, prompt IDs, and model metadata to every result.
4. Add random blind labels so judges do not see candidate names.
5. Add ties or inconclusive judgments.
6. Add deterministic config loading from `project.yaml`.
7. Add structured errors and partial run recovery.
8. Add CLI command surface.

Proposed CLI:

```bash
skill-rsi init --name ux-design --goal "Help agents design better UX"
skill-rsi run ux-design --batch 10
skill-rsi evaluate ux-design --a path/to/skill-a --b path/to/skill-b
skill-rsi promote ux-design --run <run-id> --candidate <candidate-id>
skill-rsi history ux-design
skill-rsi daemon ux-design
```

## 10. Promotion Logic

The manager should not blindly promote the numerical winner. Promotion should require a policy gate.

Default rule:

- Candidate wins at least `min_win_delta` more prompts than champion.
- Candidate has at least `min_score_delta` total score advantage.
- Candidate has no critical regressions on stable prompts.
- Analyst confidence is medium or high.
- Candidate package passes spec validation and local lint checks.

Decision table:

| Condition | Decision |
| --- | --- |
| Candidate clearly beats champion | Promote candidate |
| Candidate improves one area but regresses critical stable prompts | Keep current, record targeted edit notes |
| Candidate and champion are close | Keep current, request larger or different eval batch |
| Both candidates fail on the same class | Keep current, add eval/ontology notes |
| Eval prompts are flawed | Request new experiment, do not promote |
| Candidate is better but bloated or non-portable | Edit current or regenerate with constraints |

## 11. Evaluation Design

### Prompt Quality

Prompts should be realistic user requests. They should vary by:

- Difficulty.
- Ambiguity.
- User expertise.
- Input shape.
- Output artifact.
- Edge cases.
- Domain subtask.
- Time pressure or incomplete context.
- Parameter focus, when a run is intentionally testing a specific surface from the deconstruction map.

Avoid:

- Prompt wording copied from candidate skill instructions.
- Artificial prompts that users would not ask.
- Prompts that can only be passed by hardcoding.
- Prompts that require unsupported tools.
- Prompts where the success criteria are unknowable.

### Criteria Quality

Criteria should be:

- Specific to the skill goal.
- Observable in model outputs.
- Split across correctness, usefulness, workflow quality, edge-case handling, and output polish.
- Stable enough to compare across runs.

Each criterion should include a 1-5 rubric. For mechanical checks, add assertions or scripts rather than relying only on judge opinion.
For parameter-targeted runs, the evaluation designer should add explicit metadata describing which parameters a prompt or criterion is expected to illuminate.

Criteria stability matters more than perfect first-pass criteria. Lock the initial stable criteria after run 0, version them only when the analyst identifies a genuine measurement defect, and preserve old criteria for historical comparison.

### Statistical Reality

A batch of 10 is useful for fast iteration, not proof. Treat it as a screening batch.

Use stronger evidence when:

- Promotion changes a widely used champion.
- Results are close.
- Judge rationales conflict with scores.
- One prompt dominates the total score difference.
- Visual judgments are subjective.

Later versions should support:

- Repeated runs per prompt.
- Bootstrap confidence intervals over paired prompt deltas.
- Multiple judges.
- Human review slots.

## 12. History Strategy

History must support progressive disclosure.

### Always Loaded

`history/current-summary.md`:

```markdown
# Current Summary

Initial goal: ...
Current champion: run-id/candidate-id/hash
Current strengths: ...
Known weaknesses: ...
Highest-leverage parameter hypotheses: ...
Recent decision: ...
Do not repeat: ...
Next experiment notes: ...
Detailed artifacts: history/detailed/<run-id>.md
```

`history/index.json` should be append-only and optimized for quick trajectory reads:

```ts
type HistoryIndex = {
  experimentId: string;
  createdAt: string;
  skillGoal: string;
  currentChampion: {
    runId: string;
    candidateId: string;
    skillHash: string;
  };
  trajectory: Array<{
    runId: string;
    decision: "promote" | "keep_current" | "edit_current" | "request_new_experiment";
    winner: string;
    scoreDelta: number | null;
    parameterTested: string[];
    hypothesisHeld: boolean | null;
    summary: string;
  }>;
  parameterLog: Array<{
    parameterId: string;
    testedInRuns: string[];
    currentBelief: string;
    status: "promising" | "deprioritized" | "inconclusive" | "do_not_retry_without_new_evidence";
  }>;
};
```

### Loaded On Demand

- Raw SkillEval outputs.
- Judge transcripts.
- Full candidate packages.
- Deconstruction and parameterization records.
- A/B experiment plans.
- Detailed analyst reports.
- Prior ontology versions.
- Prompt retirement rationale.

### History Writer Rules

- Record facts, not just vibes.
- Preserve enough detail to reproduce a decision.
- Summarize failures by underlying cause.
- Keep a list of failed strategies to prevent loops.
- Mark uncertain conclusions as uncertain.

## 13. Trigger Modes

### Manual

Run one loop and stop.

```bash
skill-rsi run ux-design
```

### Continuous

Run until a stop condition fires:

- Budget exhausted.
- `patience` runs without meaningful improvement.
- Analyst recommends human review.
- N consecutive inconclusive runs.
- Promotion confidence falls below threshold.
- Manager detects local-maxima behavior and schedules either a high-divergence run or a human checkpoint.

### Cron

Use a scheduler to run at fixed times. The scheduler should call the CLI, not embed loop logic.

Example:

```text
0 2 * * * skill-rsi run ux-design --scheduled
```

### Hook

Hooks should enqueue a run request with metadata:

- Source event.
- Changed files.
- Suggested evaluation focus.
- Priority.

Potential hook sources:

- Skill package file changed.
- New human feedback added.
- New eval prompt added.
- Champion promoted.
- GitHub PR merged.
- External benchmark failed.

## 14. Safety, Security, And Reproducibility

Skill RSI will generate executable-looking artifacts. Treat that seriously.

Rules:

- Do not execute generated `scripts/` during candidate generation.
- During evaluation, execute scripts only inside an explicitly configured sandbox.
- Store every generated package and result with content hashes.
- Do not allow candidates to modify eval prompts or criteria.
- Keep eval artifacts separate from candidate skill packages.
- Redact API keys from logs.
- Record model IDs and parameters for every model call.
- Validate package paths to prevent archive traversal.
- Cap package size, file count, text bytes, and image bytes.

Spec validation should check:

- Root `SKILL.md` exists.
- Frontmatter is valid YAML.
- `name` matches directory naming rules.
- `description` is present, specific, and under spec limits.
- Referenced files exist.
- No obviously unsafe path references.
- `SKILL.md` stays under project-defined line/token limits.

## 15. MVP Scope

Build the smallest useful version first:

1. CLI-only project.
2. Local filesystem storage.
3. Text-only evaluation first.
4. Initial ontology plus recurring deconstruction/parameterization.
5. A/B experiment planner.
6. Two independent candidate creators.
7. Batch size 10.
8. Headless SkillEval A/B runner.
9. Analyst recommendation.
10. Champion promotion.
11. Compact history summary.

Explicitly out of MVP:

- Web UI.
- Distributed queues.
- Multi-judge adjudication.
- Automated GitHub PR creation.
- Rich visual regression workflows.
- Long-term hosted database.
- Cross-agent benchmark runners beyond SkillEval's model-call pattern.

## 16. Implementation Milestones

### Vertical Slice First

Before optimizing prompts or UI, build a thin end-to-end loop with stubbed agent prompts and a small test skill. The proof point is three consecutive manual loops that produce candidates, run evaluation, update champion state, and append history. If this path is not reliable, improving individual agent prompts will hide orchestration problems.

After the vertical slice works, validate agent quality against a small fixed bank of representative skills, such as UX design, SQL query writing, and code review. This keeps deconstructor and analyst prompt tuning grounded in more than one domain.

### Milestone 1: Repo Scaffold And Schemas

Tasks:

- Create TypeScript project.
- Define schemas with Zod or equivalent.
- Implement project workspace creation.
- Implement run state persistence.
- Add JSON artifact writer with atomic writes.
- Add a stub-agent mode for local loop testing.

Acceptance criteria:

- `skill-rsi init` creates a valid workspace.
- `skill-rsi run --dry-run` creates a run record and exits.
- Schemas validate project config, ontology, parameterization, experiment plans, candidate metadata, eval results, and recommendations.
- Stub mode can complete a three-loop run and produce valid history artifacts.

### Milestone 2: Skill Package IO And Validation

Tasks:

- Port SkillEval's skill package loader to filesystem.
- Support directory, zip, and single-file input.
- Implement package hashing.
- Implement Agent Skills validation.
- Implement package copy/snapshot helpers.

Acceptance criteria:

- Valid package loads into the same logical representation as SkillEval.
- Invalid packages fail with actionable errors.
- Package hash changes only when package content changes.

### Milestone 3: Headless SkillEval Runner

Tasks:

- Extract model provider calls.
- Implement `runSingleEval` and `runAllEvals` for CLI.
- Implement `judgeSingleEval` and `judgeAllEvals` for CLI.
- Add blind A/B randomization.
- Add JSON run output.
- Add text-only output path.

Acceptance criteria:

- `skill-rsi evaluate --a skill-a --b skill-b --prompts prompts.json --criteria criteria.json` produces a complete result JSON.
- Failed prompt runs are captured without destroying the whole run.
- Judge output parses into structured score data.

### Milestone 4: Ontology, Deconstruction, And Experiment Planning

Tasks:

- Implement ontology prompt contract.
- Implement deconstruction and parameterization prompt contract.
- Implement parameter schema with at least 12 required improvement surfaces.
- Implement A/B experiment planner prompt contract.
- Implement creator prompt contract.
- Implement adversarial review prompt contract.
- Generate two package candidates from the experiment plan into run workspace.
- Revise candidates after adversarial review.

Acceptance criteria:

- Given a goal and context, the system creates two valid, meaningfully different skill packages.
- Given an existing champion, the system produces a granular parameter map and an explicit A/B experiment plan before generating candidates.
- Candidate rationale identifies strategy, expected advantages, and risks.
- Candidate rationale lists changed parameter IDs and controlled parameter IDs.
- Adversarial review can block evaluation on spec or safety failures.

### Milestone 5: Eval Design And Prompt Bank

Tasks:

- Generate first prompt batch and criteria from goal, ontology, experiment plan, and candidate packages.
- Store stable and exploration prompts separately.
- Add prompt IDs, taxonomy labels, and retirement fields.
- Add parameter IDs to prompts and criteria when they are designed to test a specific improvement surface.
- Add criteria versioning.

Acceptance criteria:

- First run can create 10 prompts and 4-6 criteria.
- Later runs reuse stable prompts and add exploration prompts.
- Parameter-targeted runs produce prompts that can plausibly observe the planned difference between A and B.
- Analyst can recommend prompt promotion or retirement.

### Milestone 6: Analyst And Promotion Gate

Tasks:

- Implement analyst prompt contract.
- Implement deterministic promotion policy.
- Merge analyst recommendation with policy gate.
- Copy promoted candidate to `champion/`.
- Write compact and detailed history.

Acceptance criteria:

- Run ends with promote, keep, edit, or request-new-experiment.
- Promotion cannot occur if policy blocks it.
- `history/current-summary.md` updates after every completed run.

### Milestone 7: Scheduling And Hooks

Tasks:

- Add `skill-rsi daemon` or document cron integration.
- Add hook input format.
- Add lock file to prevent overlapping runs.
- Add budget and stop-rule enforcement.
- Add run timeline logs for observability before any full dashboard work.

Acceptance criteria:

- Scheduled run can execute unattended.
- Hook-triggered run records source event metadata.
- Concurrent invocations do not corrupt state.
- A user can inspect a run timeline and see each agent step, artifact path, model used, and failure reason.

### Milestone 8: Visual And UI Expansion

Status: deferred / v2. This should not be treated as part of the default text-first RSI loop until the visual evaluation contract has been discussed and specified. See section 21.

Possible tasks:

- Reuse SkillEval screenshot server for visual outputs.
- Add visual output artifact storage.
- Build optional web UI for run history, candidates, and comparisons.
- Add human review interface.

Possible acceptance criteria:

- Visual skills can be evaluated without using the SkillEval GUI.
- Screenshots are stored alongside judge results.
- Human reviewer can override or annotate analyst recommendations.

## 17. Example End-To-End UX

```bash
skill-rsi init \
  --name ux-design \
  --goal "Help agents design better UX for production applications" \
  --context ./context/ux-design.md

skill-rsi run ux-design --batch 10
```

Expected result:

```text
Run: 2026-05-25T210000Z
Candidate duel: candidate-b beat candidate-a, 7-3
Champion gate: candidate-b beat current champion, 6-3-1
Decision: promote
Confidence: medium
New champion: .skill-rsi/projects/ux-design/champion/skill
Report: .skill-rsi/projects/ux-design/runs/2026-05-25T210000Z/analysis/report.md
```

## 18. Key Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Eval overfitting | Keep stable prompts hidden from candidate creators when possible; use exploration prompts; inspect prompt-specific hacks |
| Skill bloat | Enforce `SKILL.md` length and context budget; require references for detail |
| False promotion from noisy batch | Use champion gate, promotion thresholds, and "inconclusive" decisions |
| Judge bias | Blind labels, randomized order, optional multiple judges |
| Candidate convergence | Assign different strategies and forbid creators from seeing each other's work |
| Parameter sprawl | Require prioritization, limit each A/B experiment to one to three related parameters, and track controlled constants |
| Local maxima | Track recent no-improvement streaks and schedule high-divergence or reset-to-baseline experiments |
| Drift from original goal | Periodically compare champion against the original goal, ontology, and human-provided constraints |
| Cost runaway | Enforce per-project run, token, and spend caps before scheduling any unattended loop |
| Repeating failed experiments | Maintain compact "do not repeat" history |
| Unsafe generated scripts | Validate, sandbox, and avoid execution by default |
| GUI coupling to SkillEval | Extract headless core rather than driving the browser |
| Loss of provenance | Hash all packages and store raw artifacts |

## 19. Open Product Decisions

1. Should Skill RSI optimize only Agent Skills standard packages, or allow client-specific extensions per project?
2. Should candidate creators see stable eval prompts? Default recommendation: no, except prompt taxonomy and quality axes.
3. Should human approval be required before promotion? Default recommendation: optional, enabled for high-impact skills.
4. Should Skill RSI live inside SkillEval or as a separate repo? Default recommendation: separate repo with a shared headless SkillEval package.
5. Should scheduled runs automatically spend money? Default recommendation: require explicit project budgets and hard stop rules.
6. Should later-loop deconstruction replace ontology entirely? Default recommendation: no. Use ontology to define the broad domain map and deconstruction to parameterize the current champion against that map.
7. Should successful patterns transfer across experiments? Default recommendation: design history records with domain tags and parameter IDs now, but leave cross-experiment learning to v2.

## 20. References

- SkillEval repository: https://github.com/justinwetch/SkillEval
- Agent Skills overview: https://agentskills.io/home
- Agent Skills specification: https://agentskills.io/specification
- Agent Skills evaluation guidance: https://agentskills.io/skill-creation/evaluating-skills
- Claude Code skills documentation: https://code.claude.com/docs/en/skills

## 21. Visual And UI Expansion

Initial visual work now targets a narrow `code_visual_standalone` path: generated outputs must be complete browser-renderable HTML artifacts, Skill RSI renders them locally, and screenshots become evaluation evidence. Text eval remains the default path.

Still-deferred visual work:

1. Visual-only artifacts: define an image-only artifact contract before exposing it in the UI.
2. Package-based visual apps: support React/Vite/Next packages only after the single-file HTML path is reliable.
3. Audit annotations: keep human review as annotation/audit by default, not a required promotion step, so the RSI premise remains intact.

Open questions before work starts:

1. Which visual skill is the first real target?
2. What viewports and rendering environments count as canonical?
3. Should visual failures block promotion, lower confidence, or only create analyst warnings?
4. How much of SkillEval's screenshot server should be reused directly versus wrapped behind a smaller Skill RSI contract?
5. Should mixed text-plus-visual eval be one combined judge pass or separate modality-specific passes merged by policy?
