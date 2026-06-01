# Skill RSI Product Videos

Remotion compositions for procedural Skill RSI product videos.

## Compositions

- `ProductTourLandscape`: 1920x1080, 16 seconds, README/site format.
- `ProductTourSquare`: 1080x1080, 10 seconds, social format.
- `OpeningTitleBlack`: 1920x1080, 5 seconds, black-background title opener using the Skill RSI plugin-store raster icon.
- `Asset01TrainingLossVsJudgment` through `Asset30LightBeforeAfterSkill`: 1920x1080 standalone mograph clips for manual editing.

## Mograph asset pack

Each asset is a 6 second H.264 motion clip rendered to `out/assets/`.

| Composition | Output | Use |
| --- | --- | --- |
| `Asset01TrainingLossVsJudgment` | `01-training-loss-vs-judgment.mp4` | Training loss versus qualitative skill judgment. |
| `Asset02RecursiveSkillLoop` | `02-recursive-skill-loop.mp4` | Research, variant, review, evaluate, promote, remember loop. |
| `Asset03StartFromGoal` | `03-start-from-goal.mp4` | Goal prompt transforming into a skill package. |
| `Asset04SkillEvalToSkillRSI` | `04-skilleval-to-skill-rsi.mp4` | Head-to-head SkillEval expanding into Skill RSI. |
| `Asset05ResearchBeforeWriting` | `05-research-before-writing.mp4` | Sources and claims becoming a research packet. |
| `Asset06OntologyBuilder` | `06-ontology-builder.mp4` | Ontology map assembly. |
| `Asset07AuthorityMap` | `07-authority-map.mp4` | Authority claims sorted into guidance. |
| `Asset08AdversarialReview` | `08-adversarial-review.mp4` | Candidate review scan and checks. |
| `Asset09AblationIteration` | `09-ablation-iteration.mp4` | Champion to challenger with one changed variable. |
| `Asset10CodexPluginHandoff` | `10-codex-plugin-handoff.mp4` | Codex sidebar handoff into Skill RSI. |
| `Asset11EvidenceZoomdown` | `11-evidence-zoomdown.mp4` | Verdict view zooming into prompt-level evidence. |
| `Asset12PromotionGate` | `12-promotion-gate.mp4` | Promotion threshold checks and champion result. |
| `Asset13VibesVsEvidence` | `13-vibes-vs-evidence.mp4` | Fuzzy vibes resolving into inspectable evidence cards. |
| `Asset14OntologySubwayMap` | `14-ontology-subway-map.mp4` | Ontology shown as a clean connected map. |
| `Asset15RegressionShield` | `15-regression-shield.mp4` | Regression risks blocked before promotion. |
| `Asset16TrustStack` | `16-trust-stack.mp4` | Sources, ontology, review, eval, and history stacking into trust. |
| `Asset17DecisionTrace` | `17-decision-trace.mp4` | Promotion traced back to prompt-level evidence. |
| `Asset18AutonomousBounded` | `18-autonomous-bounded.mp4` | Autonomous loop contained by iterations, schedule, and thresholds. |
| `Asset19LightOntologyCards` | `19-light-ontology-cards.mp4` | Light ontology cards assembling into a rewrite map. |
| `Asset20LightScoreMatrix` | `20-light-score-matrix.mp4` | Evaluation score matrix comparing champion and challenger. |
| `Asset21LightExperimentNotebook` | `21-light-experiment-notebook.mp4` | Hypothesis, change, result, and next loop notebook. |
| `Asset22LightSourceAudit` | `22-light-source-audit.mp4` | Sources, claims, authorities, and examples being verified. |
| `Asset23LightEvaluationBracket` | `23-light-evaluation-bracket.mp4` | Prompt bracket feeding control and treatment evaluation. |
| `Asset24LightMemoryArchive` | `24-light-memory-archive.mp4` | Dead ends moving into history so future loops avoid repeats. |
| `Asset25LightTriggerModes` | `25-light-trigger-modes.mp4` | Manual, scheduled, and hook-triggered run modes. |
| `Asset26LightSkillPackageExploded` | `26-light-skill-package-exploded.mp4` | Skill package layers separating into instructions, examples, constraints, rubric, and tests. |
| `Asset27LightJudgePanel` | `27-light-judge-panel.mp4` | Judge rationale and criteria bars. |
| `Asset28LightOpenSourcePath` | `28-light-open-source-path.mp4` | Clone, install, API key, and plugin path. |
| `Asset29LightPromptMicroscope` | `29-light-prompt-microscope.mp4` | Prompt row zoomed into evidence. |
| `Asset30LightBeforeAfterSkill` | `30-light-before-after-skill.mp4` | Baseline document becoming structured champion skill. |

The product-tour compositions use the current screenshot set copied into `public/product/`.

## Commands

```console
npm install
npm run dev
npm run lint
npm run still:opener
npm run still:landscape
npm run still:square
npm run still:assets
npm run still:assets:light
npm run render:opener
npm run render:landscape
npm run render:square
npm run render:assets
npm run render:assets:light
```

Rendered files are written to `out/`, which is ignored by Git.
