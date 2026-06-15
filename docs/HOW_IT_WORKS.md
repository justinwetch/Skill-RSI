# How Skill RSI works

Skill RSI improves Agent Skill packages by treating each skill as an experiment, not as a one-off prompt-writing exercise. You give it a goal, optionally give it an existing skill, choose the kind of output the skill should produce, and let it run improvement loops. Each loop creates evidence: what was tried, what changed, how it scored, what failed, and what the next loop should test.

The central idea is controlled recursive improvement. Skill RSI should not wander through random rewrites. Once there is a champion skill, the champion is the control and the next challenger is the treatment. That one distinction shapes the whole system.

## The core loop

Skill RSI has two loop shapes.

```text
Scratch project:
goal -> research and ontology -> initial parameterization -> cold-start A/B -> first champion

Later loop or baseline project:
champion -> deconstruction -> experiment plan -> challenger -> eval vs champion -> promote or keep
```

A scratch project has no champion yet, so the first run generates Candidate A and Candidate B. They are independently planned first attempts at the skill. The winner becomes the first champion only if the evidence is usable enough to support that decision.

After that, Skill RSI stops generating two new skills. It generates one challenger and evaluates that challenger directly against the current champion. This keeps the loop interpretable. If the challenger wins, you know what changed. If it loses, you know what not to repeat.

Baseline-upload projects skip the cold-start phase. The uploaded skill becomes champion v0, and the first improvement loop starts by deconstructing that actual artifact.

## Project inputs

A project starts with a small set of decisions:

| Input | What it controls |
| --- | --- |
| Skill goal | The target behavior the loop optimizes toward. |
| Output artifact | Whether eval prompts expect text, code, or code + visuals. |
| Baseline skill | Optional existing Agent Skill package to use as champion v0. |
| Model | The OpenAI model used for agents, generation, and judging. |
| Target iterations | How many loops the user wants to run in a batch. |
| API key path | `.env`, CLI flag, or browser-local UI entry. Keys are not stored in project config. |

The output artifact matters more than it may seem. A text skill should be tested on written artifacts. A code skill should be tested on runnable code tasks. A code + visuals skill should produce complete browser-renderable code, then Skill RSI renders screenshots and judges the visible result. Separate rendered-media artifacts are outside the product surface because there is not yet a coherent Agent Skill artifact contract for them.

## Research and ontology

Ontology is the broad domain map. It answers questions like:

- Who uses this skill?
- What tasks should activate it?
- What outputs should it produce?
- What does excellent work look like in this domain?
- What failure modes should eval prompts catch?
- Which authorities, institutions, or strong opinions should shape the skill's priors?

Before the ontology is generated, Skill RSI builds a research packet when model-native research is available. The research packet captures sources, evidence claims, authority claims, practitioner vocabulary, intertextual context, open questions, and gaps. Claims are labeled as sourced, inferred, or speculative so later agents do not treat model memory as evidence.

Sourced research is intentionally controlled-depth, not exhaustive. The default target is roughly `12-15` strong sources, `6-10` evidence claims, `4-8` authority entries, and `20-50` practitioner lexicon entries. Normalization caps stored packets at `15` sources, `50` lexicon entries, `10` evidence claims, `8` authority entries, and `8` search-trace entries. Stored or reused research packets are normalized again before use, including canonicalizing source IDs and source refs, so old artifacts do not launder stale citation shapes into new runs.

The practitioner lexicon is the expert-register layer. It should include terms, methods, artifacts, metrics, failure modes, schools, debates, boundary terms, and near-synonym distinctions that a strong practitioner would notice and a novice would flatten. A useful lexicon entry explains the expert meaning, novice misuse, relevance to the skill, eval implication, evidence basis, and source refs when sourced.

The intertextual map captures relationships in the field. It should name canonical texts, standards and institutions, schools of thought, recurring debates, concept lineages, adjacent-domain borrowings, and common misreadings. It is not just a bibliography: it should explain what draws from what, what concepts contrast, where ideas were borrowed, and what those relationships imply for skill behavior.

The authority map is not a celebrity quote machine. It is a way to sharpen the domain prior. For a product skill, Steve Jobs or Dieter Rams might matter because their opinions imply concrete pressure on simplicity, taste, restraint, or user experience. For an accessibility-heavy frontend skill, W3C and WCAG matter because they define enforceable expectations. Authority informs the skill, but authority is not proof by itself.

The ontology is most important at the beginning. It gives the first creators a shared map of the domain and gives the evaluator a vocabulary for judging output. It carries forward practitioner lexicon entries, terminology discriminators, and intertextual relationships so later agents can catch shallow jargon, missing expert distinctions, wrong concept lineage, ignored debates, and weak terminology discrimination. Later, it becomes a guardrail. It should constrain drift and fill missing categories, but it should not overwrite what the system has learned from the actual champion.

Thin expert-register coverage is advisory. Missing or generic practitioner vocabulary and weak or missing intertextual relationships create quality warnings that remain inspectable in run artifacts, but those warnings do not force the revise loop by themselves. Unsupported sourced claims are different: if an ontology claims sourced expert-register evidence without refs or labels, the quality gate treats that as a revision issue.

## Deconstruction

Deconstruction is different from ontology.

Ontology maps the domain. Deconstruction maps the current champion artifact.

The deconstructor reads the goal, history, ontology, Agent Skills standard, and full champion package. Its job is to break the current skill into improvement surfaces. A good parameter is specific enough to test. "Make the skill better" is useless. "Increase the density of concrete implementation examples in the output contract section while preserving activation boundaries" is a real surface.

Each parameter should carry:

- Artifact evidence: where the current skill shows this behavior.
- History evidence: what prior runs have already tried or learned.
- Mutation hypothesis: what changing this parameter should improve.
- Regression risk: what might get worse.
- Measurement plan: how eval prompts can observe the change.
- Coupling notes: which other parameters may move with it.
- Confidence: how strongly the system believes this is worth testing.

This is the step that keeps later runs from becoming wholesale reinventions. The challenger should be an ablation-style variation of the champion, not a new skill that happens to share the same goal.

## Planning the experiment

The manager turns the parameter map into a round-level experiment. It does not write skills and it does not score eval outputs. Its job is to choose what should be tested next.

Most runs use a champion challenge: mutate one focused parameter family, preserve unrelated behavior, and compare the challenger to the champion. If recent runs show local-maxima behavior, the manager can choose a high-divergence reset, but even that is still one challenger against the champion.

The experiment plan should make the premise legible:

- What parameter family is being tested?
- What should the challenger change?
- What should it preserve?
- What would count as evidence that the hypothesis worked?
- What would count as regression?

That premise is what the UI calls the next loop plan. It is also what later agents read before deciding what to do next.

## Skill creation

The creator receives the goal, Agent Skills standard, skill-creator guidance, ontology, deconstruction, experiment plan, and champion package when one exists.

On a scratch run, there are two creators, Candidate A and Candidate B. They explore different first-pass strategies because there is no control yet.

Once a champion exists, there is one creator and one challenger. The creator should preserve the champion's validated package structure unless the experiment plan specifically asks to change it. If the champion has useful reference files, those files should stay unless the plan says otherwise. If the skill is rich, the challenger should not compress it into a tiny generic prompt just because short output is easier to write.

The intended creator flow is:

1. Draft a structured outline.
2. Critique the outline adversarially.
3. Revise the plan.
4. Produce the skill package.

The final package must still be a valid Agent Skill. Skill RSI is improving skills, not free-floating instructions.

## Preflight review

Before evaluation, the reviewer attacks the candidate or challenger. It checks the Agent Skills package, the experiment plan, and common failure modes:

- Missing or invalid `SKILL.md`.
- Broken frontmatter.
- Referenced files that were dropped.
- Unsafe scripts or package behavior.
- Eval prompt leakage.
- Strategy drift away from the assigned experiment arm.
- Severe compression or wholesale rewrite when the plan called for a localized challenge.

The reviewer can request one bounded revision. If the package is still structurally broken, the run stops cleanly and records why. A bad package should not enter eval just because a loop is in progress.

## Evaluation

Evaluation is a headless SkillEval-style comparison. Both sides run against the same prompts and are judged against the same criteria.

The prompt bank has memory. Stable prompts protect against regression. Exploration prompts probe the parameter being tested in the current round. Prompt evidence can be promoted, retired, or kept provisional depending on how useful it was.

Ontology signals can shape eval design. Stable and exploration prompts may test correct expert vocabulary use, near-synonym distinctions, and intertext-aware judgment when the research packet or ontology provides usable evidence. This is meant to make evaluation sharper, not to overfit the system to its own internal jargon; sourced claims need real source refs, while inferred loop artifacts stay labeled as internal evidence.

The output contract keeps eval honest:

- Text projects produce complete written artifacts.
- Code projects produce complete runnable code, not advice asking for hidden repo files.
- Code + visuals projects produce complete browser-renderable code. Skill RSI renders the output locally, captures screenshots, records render diagnostics, and judges both implementation and visible result.

Prompts must be valid for the active artifact type. If a prompt expects source material, the prompt must include that source material. If a prompt expects standalone code, it cannot imply hidden files. A malformed prompt is a system bug, not a fair test.

## Promotion

Skill RSI does not promote the numerical winner automatically. Promotion has a policy gate.

The challenger must clear score and win-margin thresholds, avoid critical stable-prompt regressions, and complete enough evals to make the decision meaningful. A challenger that wins one flashy exploration prompt but breaks stable behavior should stay a failed experiment, not become the champion.

The analyst interprets the raw eval data in context. It looks at judge reasoning, prompt-level patterns, confidence, noise, and regression risk. The final recommendation becomes one of the loop outcomes:

- Promote the challenger.
- Keep the current champion.
- Record an inconclusive run.
- Request a different experiment direction.

The current champion remains the skill of record unless the challenger earns replacement.

## History and the next loop plan

Every run writes two kinds of memory.

Detailed artifacts preserve the raw material: research packets, ontology, deconstruction, experiment plan, candidate packages, eval output, screenshots, judge reasoning, recommendations, and reports.

Compact history keeps the next loop practical. It records the current state, recent trajectory, known weaknesses, failed strategies, do-not-repeat notes, and next experiment guidance. Agents should not need to reread every prior artifact on every run.

The next loop plan is the bridge between runs. If the analyst says "preserve the champion's package structure, investigate prompt coverage, try a narrower activation-boundary mutation," the manager should see that premise before planning the next challenger.

## UI, CLI, and Codex plugin surfaces

The UI, CLI, and Codex plugin run the same underlying loop.

The UI is optimized for watching the process: project setup, live run progress, next loop plan, history, detailed eval data, rendered screenshots, and skill inspection.

The CLI is optimized for reproducible local control: project creation, baseline import, run commands, progress checks, skill export, standalone evaluation, scheduling, and hook-informed automation.

The Codex plugin is the Codex-native operator surface. It installs an operator skill plus MCP tools, then opens the local Skill RSI web app in Codex by default. That is the reliable guided surface for creating projects, watching runs, inspecting evidence, and exporting champions. The plugin also exposes explicit tools for state inspection, setup drafts, bounded run actions, hook-context consumption, and champion export.

The plugin has one strict rule: it must operate Skill RSI, not manually rewrite target skills in chat. If a user asks to improve a skill, Codex should create or open a Skill RSI project, import the skill as a baseline when relevant, inspect state, and run a bounded loop only after explicit intent. Manual edits to the referenced `SKILL.md` are not the product.

MCP-UI is available as an optional cockpit where the host renders MCP Apps/UI resources reliably. It is not the default Codex desktop path. All MCP tools should still return readable text or JSON fallback content.

The UI Automation panel reports observed run state, pending Codex hook context, and copyable cron/LaunchAgent and Codex hook commands. It does not install or manage operating-system scheduler jobs. Codex hooks only queue context; a later manual or scheduled run consumes that context and decides whether to spend model budget.

All surfaces should tell the same story. Skill RSI researches the domain, maps the current artifact, plans one focused experiment, creates a challenger, evaluates it against the champion, and records what the next loop should know.
