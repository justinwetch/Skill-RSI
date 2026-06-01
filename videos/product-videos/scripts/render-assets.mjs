import { spawnSync } from "node:child_process";

const mode = process.argv[2];
const group = process.argv[3] ?? "all";

if (!["render", "still"].includes(mode) || !["all", "light"].includes(group)) {
  console.error("Usage: node scripts/render-assets.mjs render|still [all|light]");
  process.exit(1);
}

const assets = [
  ["Asset01TrainingLossVsJudgment", "01-training-loss-vs-judgment"],
  ["Asset02RecursiveSkillLoop", "02-recursive-skill-loop"],
  ["Asset03StartFromGoal", "03-start-from-goal"],
  ["Asset04SkillEvalToSkillRSI", "04-skilleval-to-skill-rsi"],
  ["Asset05ResearchBeforeWriting", "05-research-before-writing"],
  ["Asset06OntologyBuilder", "06-ontology-builder"],
  ["Asset07AuthorityMap", "07-authority-map"],
  ["Asset08AdversarialReview", "08-adversarial-review"],
  ["Asset09AblationIteration", "09-ablation-iteration"],
  ["Asset10CodexPluginHandoff", "10-codex-plugin-handoff"],
  ["Asset11EvidenceZoomdown", "11-evidence-zoomdown"],
  ["Asset12PromotionGate", "12-promotion-gate"],
  ["Asset13VibesVsEvidence", "13-vibes-vs-evidence"],
  ["Asset14OntologySubwayMap", "14-ontology-subway-map"],
  ["Asset15RegressionShield", "15-regression-shield"],
  ["Asset16TrustStack", "16-trust-stack"],
  ["Asset17DecisionTrace", "17-decision-trace"],
  ["Asset18AutonomousBounded", "18-autonomous-bounded"],
  ["Asset19LightOntologyCards", "19-light-ontology-cards"],
  ["Asset20LightScoreMatrix", "20-light-score-matrix"],
  ["Asset21LightExperimentNotebook", "21-light-experiment-notebook"],
  ["Asset22LightSourceAudit", "22-light-source-audit"],
  ["Asset23LightEvaluationBracket", "23-light-evaluation-bracket"],
  ["Asset24LightMemoryArchive", "24-light-memory-archive"],
  ["Asset25LightTriggerModes", "25-light-trigger-modes"],
  ["Asset26LightSkillPackageExploded", "26-light-skill-package-exploded"],
  ["Asset27LightJudgePanel", "27-light-judge-panel"],
  ["Asset28LightOpenSourcePath", "28-light-open-source-path"],
  ["Asset29LightPromptMicroscope", "29-light-prompt-microscope"],
  ["Asset30LightBeforeAfterSkill", "30-light-before-after-skill"],
];

const selectedAssets =
  group === "light" ? assets.filter(([, file]) => Number(file.slice(0, 2)) >= 19) : assets;

for (const [composition, file] of selectedAssets) {
  const output =
    mode === "render" ? `out/assets/${file}.mp4` : `out/assets/stills/${file}.png`;
  const args =
    mode === "render"
      ? ["remotion", "render", composition, output]
      : ["remotion", "still", composition, output, "--frame=90"];

  console.log(`\n${mode === "render" ? "Rendering" : "Still"} ${composition}`);
  const result = spawnSync("npx", args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
