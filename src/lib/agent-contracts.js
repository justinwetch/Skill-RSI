import path from 'node:path';
import fs from 'node:fs/promises';
import { getProjectPaths, getRunPaths } from './paths.js';
import { ensureDir, readJson, writeJson, writeText } from './store.js';
import {
  validateCandidate,
  validateExperimentPlan,
  validateOntology,
  validateParameterization,
  validateRecommendation,
} from './schema.js';
import { callModel } from './model-client.js';
import {
  createStubExperimentPlan,
  createStubOntology,
  createStubParameterization,
} from './stub-agents.js';
import { loadSkillPackage } from './skill-package.js';

export const AGENT_NAMES = ['ontology', 'deconstructor', 'experiment-planner', 'creator', 'analyst'];

export function buildAgentPrompt({ agentName, context }) {
  if (agentName === 'ontology') return buildOntologyPrompt(context);
  if (agentName === 'deconstructor') return buildDeconstructorPrompt(context);
  if (agentName === 'experiment-planner') return buildExperimentPlannerPrompt(context);
  if (agentName === 'creator') return buildCreatorPrompt(context);
  if (agentName === 'analyst') return buildAnalystPrompt(context);
  throw new Error(`Unknown agent "${agentName}"`);
}

export async function runAgentContract({
  cwd,
  projectName,
  agentName,
  runId = 'contract-run-001',
  mode = 'mock',
  model = null,
  apiKeys = {},
  modelClient = callModel,
  experimentArm = null,
  revision = null,
  refresh = false,
  managerPlan = null,
  researchPacket = null,
  qualityFeedback = null,
  outputType = null,
  maxTokens = null,
}) {
  if (!AGENT_NAMES.includes(agentName)) {
    throw new Error(`Unknown agent "${agentName}"`);
  }
  if (!['mock', 'real'].includes(mode)) {
    throw new Error('Agent mode must be mock or real');
  }
  if (mode === 'real' && !model) {
    throw new Error('Real agent contract requires a model');
  }

  const paths = getProjectPaths(cwd, projectName);
  const state = await readJson(paths.stateJson, {
    projectId: paths.projectId,
    runCount: 0,
    currentChampion: null,
  });
  const projectConfig = await readJson(paths.configJson, null);
  const runPaths = getRunPaths(paths, runId);
  const context = {
    projectId: paths.projectId,
    goal: await readGoal(paths),
    runId,
    projectConfig,
    outputType: normalizeOutputType(outputType || projectConfig?.eval?.outputType),
    state,
    ontology: await readJson(paths.ontologyCurrent, null),
    parameterization: await readJson(paths.parameterizationCurrent, null),
    experimentPlan: await readJson(paths.experimentPlanCurrent, null),
    managerPlan,
    experimentArm,
    revision,
    refresh,
    qualityFeedback,
    researchPacket,
    championSkill: await readChampionSkill(paths),
    championPackage: await readChampionPackage(paths),
    history: await readJson(paths.historyIndex, null),
    agentSkillsStandard: ['creator', 'ontology', 'deconstructor'].includes(agentName) ? await readAgentSkillsStandard(cwd) : null,
    skillCreatorGuidance: agentName === 'creator' ? await readSkillCreatorGuidance(cwd) : null,
  };
  const prompt = buildAgentPrompt({ agentName, context });
  const realResult = mode === 'mock'
    ? { artifact: await createMockArtifact({ agentName, context, runPaths }), rawModelText: null }
    : await createRealArtifact({ agentName, context, prompt, model, apiKeys, modelClient, maxTokens });

  return {
    agentName,
    mode,
    model: mode === 'real' ? model : null,
    modelParameters: mode === 'real' ? {
      maxTokens: resolveAgentMaxTokens(agentName, maxTokens),
      jsonMode: true,
    } : null,
    createdAt: new Date().toISOString(),
    prompt,
    rawModelText: realResult.rawModelText,
    artifact: realResult.artifact,
  };
}

async function createRealArtifact({ agentName, context, prompt, model, apiKeys, modelClient, maxTokens }) {
  const text = await modelClient({
    model,
    apiKeys,
    systemPrompt: 'You are a Skill RSI subagent. Return only valid JSON matching the requested contract.',
    messages: [{ role: 'user', content: prompt }],
    maxTokens: resolveAgentMaxTokens(agentName, maxTokens),
    jsonMode: true,
  });
  let artifact;
  try {
    artifact = parseJson(text);
  } catch (error) {
    annotateContractError(error, { agentName, context, rawModelText: text });
    throw error;
  }
  try {
    return { artifact: validateAgentArtifact(agentName, artifact, context), rawModelText: text };
  } catch (error) {
    annotateContractError(error, { agentName, context, rawModelText: text, rawArtifact: artifact });
    throw error;
  }
}

async function createMockArtifact({ agentName, context }) {
  if (agentName === 'ontology') {
    return validateOntology(createStubOntology({
      projectId: context.projectId,
      goal: context.goal,
      runId: context.runId,
    }));
  }

  if (agentName === 'deconstructor') {
    return validateParameterization(createStubParameterization({
      runId: context.runId,
      championSkillHash: context.state.currentChampion?.skillHash,
    }));
  }

  if (agentName === 'experiment-planner') {
    const parameterization = context.parameterization || createStubParameterization({
      runId: context.runId,
      championSkillHash: context.state.currentChampion?.skillHash,
    });
    return validateExperimentPlan(createStubExperimentPlan({
      runId: context.runId,
      runNumber: context.state.runCount + 1,
      parameterization,
    }));
  }

  if (agentName === 'creator') {
    return {
      candidateId: 'candidate-a',
      experimentArm: 'candidateA',
      strategy: 'contract-mock',
      changedParameterIds: ['p01-activation_metadata'],
      files: [{
        path: 'SKILL.md',
        content: `---\nname: ${context.projectId}-contract\ndescription: Use when testing the creator contract.\n---\n\n# Contract Skill\n`,
      }],
      rationale: 'Mock creator artifact for contract validation.',
      expectedAdvantages: ['schema-stable output'],
      expectedRisks: ['not a real generated skill'],
      selfCritique: ['Requires real model generation in the next implementation pass.'],
    };
  }

  return validateRecommendation({
    runId: context.runId,
    decision: 'request_new_experiment',
    recommendedChampionCandidateId: null,
    confidence: 'low',
    reasoning: 'Mock analyst artifact validates recommendation shape.',
    observations: ['No real eval data was provided.'],
    nextRoundGuidance: {
      vary: 'agent prompt implementation',
      preserve: 'schema contracts',
      investigate: 'real model-backed analyst behavior',
    },
  });
}

export async function writeAgentContractArtifact({ cwd, projectName, agentName, runId, outputPath = null }) {
  const result = await runAgentContract({ cwd, projectName, agentName, runId, mode: 'mock' });
  const targetPath = outputPath || path.join(cwd, '.skill-rsi', 'agent-contracts', `${agentName}.json`);
  await writeJson(targetPath, result);
  return { ...result, outputPath: targetPath };
}

export async function writeRealAgentContractArtifact({
  cwd,
  projectName,
  agentName,
  runId,
  outputPath = null,
  model,
  apiKeys = {},
  saveCurrent = false,
  modelClient = callModel,
  experimentArm = null,
  candidateDir = null,
  revision = null,
}) {
  const result = await runAgentContract({ cwd, projectName, agentName, runId, mode: 'real', model, apiKeys, modelClient, experimentArm, revision });
  const targetPath = outputPath || path.join(cwd, '.skill-rsi', 'agent-contracts', `${agentName}.json`);
  await writeJson(targetPath, result);
  if (saveCurrent) {
    await writeCurrentAgentArtifact({ cwd, projectName, agentName, artifact: result.artifact });
  }
  const materializedCandidate = candidateDir
    ? await materializeCreatorArtifact({ artifact: result.artifact, candidateDir })
    : null;
  return { ...result, outputPath: targetPath, materializedCandidate };
}

function resolveAgentMaxTokens(agentName, maxTokens) {
  if (Number.isInteger(maxTokens) && maxTokens > 0) return maxTokens;
  return agentName === 'creator' ? 12000 : 8192;
}

async function writeCurrentAgentArtifact({ cwd, projectName, agentName, artifact }) {
  const paths = getProjectPaths(cwd, projectName);
  if (agentName === 'ontology') {
    await writeJson(paths.ontologyCurrent, artifact);
  } else if (agentName === 'deconstructor') {
    await writeJson(paths.parameterizationCurrent, artifact);
  } else if (agentName === 'experiment-planner') {
    await writeJson(paths.experimentPlanCurrent, artifact);
  } else {
    throw new Error(`--save-current is not supported for ${agentName}`);
  }
}

export async function materializeCreatorArtifact({ artifact, candidateDir }) {
  validateCreatorArtifact(artifact, { runId: artifact.runId || 'materialized-creator' });
  const packageFiles = artifact.files.map(file => ({
    relativePath: validateRelativePackagePath(file.path),
    content: validateCreatorFileContent(file),
  }));
  const skillDir = path.join(candidateDir, 'skill');
  await ensureDir(skillDir);

  for (const file of packageFiles) {
    await writeText(path.join(skillDir, file.relativePath), file.content);
  }

  const candidate = validateCandidate({
    candidateId: artifact.candidateId,
    experimentArm: artifact.experimentArm,
    strategy: artifact.strategy,
    skillPath: skillDir,
    changedParameterIds: artifact.changedParameterIds,
    rationale: artifact.rationale,
    expectedAdvantages: artifact.expectedAdvantages,
    expectedRisks: artifact.expectedRisks,
    selfCritique: artifact.selfCritique,
  });

  await writeJson(path.join(candidateDir, 'rationale.json'), candidate);
  await writeText(path.join(candidateDir, 'rationale.md'), renderCreatorRationale(candidate));
  return candidate;
}

function validateRelativePackagePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Creator file path must be a non-empty string');
  }
  if (path.isAbsolute(filePath)) {
    throw new Error(`Creator file path must be relative: ${filePath}`);
  }
  const normalized = path.normalize(filePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`Creator file path cannot leave the skill package: ${filePath}`);
  }
  return normalized;
}

function validateCreatorFileContent(file) {
  if (typeof file.content !== 'string') {
    throw new Error(`Creator file content must be a string: ${file.path}`);
  }
  return file.content;
}

function renderCreatorRationale(candidate) {
  return `# ${candidate.candidateId} Rationale

Arm: ${candidate.experimentArm}
Strategy: ${candidate.strategy}

Changed parameters: ${candidate.changedParameterIds.join(', ')}

## Rationale

${candidate.rationale}
`;
}

const ONTOLOGY_FIELDS = 'runId, skillGoal, targetUsers, targetTasks, invocationBoundaries {shouldTriggerWhen, shouldNotTriggerWhen}, inputSurface, outputArtifacts, requiredKnowledge, referencePoints, adjacentDomainsToBorrowFrom, optionalResources {references, scripts, assets}, platformAssumptions {portableAgentSkills, clientSpecificFeatures}, failureModes, qualityAxes, evalPromptTaxonomy, candidateStrategySpace, openQuestions.';

function buildOntologyPrompt(context) {
  const outputContract = getAgentOutputContract(context.outputType);
  if (context.refresh && context.ontology) {
    // Later-run refresh (§6.2/§6.6): update the existing map conservatively rather than rebuild.
    return `You are the Ontology Agent for Skill RSI, REFRESHING an existing domain map after a new champion was promoted.

Goal: ${context.goal}
Run ID: ${context.runId}

Existing ontology:
${formatContextBlock(context.ontology)}

Expected user-output contract:
${formatContextBlock(outputContract)}

Research packet:
${formatContextBlock(context.researchPacket)}

Current champion SKILL.md:
${context.championSkill || 'No current champion skill exists yet.'}

Experiment history summary:
${formatContextBlock(compactHistory(context.history))}

Update the ontology conservatively. Keep the existing structure and stable categories; only fill in genuinely missing categories or correct assumptions that the current champion, research packet, or history now contradicts (e.g. new task classes, failure modes, or quality axes the champion revealed). Do NOT rewrite it wholesale or rename stable entries.
${qualityFeedbackBlock(context)}
${ontologyStandardBlock(context)}
Return the COMPLETE SkillOntology JSON with these fields:
${ONTOLOGY_FIELDS}`;
  }
  return `You are the Ontology Agent for Skill RSI.

Goal: ${context.goal}
Run ID: ${context.runId}

Research packet:
${formatContextBlock(context.researchPacket)}

Expected user-output contract:
${formatContextBlock(outputContract)}

Map the domain and Agent Skill design space.
Build an evidence-backed ontology. Include authorityMap, evidenceClaims, sourceRefs, inferenceLabels, unsupportedClaims, and researchGaps as companion fields. Classify major claims as sourced, inferred, or speculative. Translate authority opinions into concrete implications for this skill and include misuse risks.
${qualityFeedbackBlock(context)}
${ontologyStandardBlock(context)}
Return JSON matching SkillOntology with these fields:
${ONTOLOGY_FIELDS}`;
}

function ontologyStandardBlock(context) {
  if (!context.agentSkillsStandard) return '';
  return `\nTreat the Agent Skills standard below as the OUTER BOUNDARY of the design space: everything you map must be expressible within it. In platformAssumptions, list only standard, portable Agent Skills behavior under portableAgentSkills, and flag anything product-specific (Claude Code-only frontmatter, dynamic context injection, non-standard fields, etc.) under clientSpecificFeatures.
=== AGENT SKILLS STANDARD ===
${context.agentSkillsStandard}
=== END STANDARD ===\n`;
}

function qualityFeedbackBlock(context) {
  if (!context.qualityFeedback) return '';
  return `\nPrevious quality report:
${formatContextBlock(context.qualityFeedback)}

Revise the artifact to address every issue in the quality report. Keep valid existing structure, but replace generic claims with concrete, evidence-labeled content.\n`;
}

function buildDeconstructorPrompt(context) {
  const hasChampion = Boolean(context.state?.currentChampion && context.championSkill);
  const outputContract = getAgentOutputContract(context.outputType);

  if (!hasChampion) {
    // First run: there is no champion yet. Per the implementation plan (§4, §6.2), the
    // initial parameter taxonomy is seeded from the ontology rather than by deconstructing
    // a (nonexistent) champion.
    return `You are the Parameterization Agent for Skill RSI, seeding the FIRST iteration of this skill.

Goal: ${context.goal}
Run ID: ${context.runId}
There is no champion skill yet — this is the first pass, so do NOT assume any existing implementation.

Ontology (domain and design-space map):
${formatContextBlock(context.ontology)}

Research packet:
${formatContextBlock(context.researchPacket)}

Expected user-output contract:
${formatContextBlock(outputContract)}

Agent Skills standard:
${formatContextBlock(context.agentSkillsStandard)}

Using the ontology's domain map, define the INITIAL parameter taxonomy for this skill: the surfaces a strong first version must get right — activation/triggering, workflow sequence, decision heuristics, context vs. reference split, output contract, validation, failure handling, examples, and packaging. Return JSON matching SkillParameterization:
runId, championSkillHash (use "none"), summary, parameters, crossParameterInteractions, highestLeverageHypotheses, doNotTouchYet, suggestedExperimentFamilies.
Provide at least 12 parameters. For each, currentImplementation should describe the intended baseline (since none exists yet). Each parameter must include id, surface, currentImplementation, improvementHypothesis, expectedBenefit, regressionRisk, artifactEvidence, evidenceFromHistory, possibleMutations, measurementPlan, couplingNotes, priority, confidence, and granularity.
${qualityFeedbackBlock(context)}`;
  }

  return `You are the Deconstruction and Parameterization Agent for Skill RSI.

Goal: ${context.goal}
Run ID: ${context.runId}
Current champion: ${context.state.currentChampion?.skillHash || 'none'}
Ontology context:
${formatContextBlock(context.ontology)}

Research packet:
${formatContextBlock(context.researchPacket)}

Expected user-output contract:
${formatContextBlock(outputContract)}

Experiment history summary:
${formatContextBlock(compactHistory(context.history))}

Current champion SKILL.md:
${context.championSkill}

Full champion package summary:
${formatContextBlock(context.championPackage)}

Agent Skills standard:
${formatContextBlock(context.agentSkillsStandard)}

Deconstruct the current champion into at least 12 granular improvement parameters. Return JSON matching SkillParameterization:
runId, championSkillHash, summary, parameters, crossParameterInteractions, highestLeverageHypotheses, doNotTouchYet, suggestedExperimentFamilies.
Each parameter must include id, surface, currentImplementation, improvementHypothesis, expectedBenefit, regressionRisk, artifactEvidence, evidenceFromHistory, possibleMutations, measurementPlan, couplingNotes, priority, confidence, and granularity.
${qualityFeedbackBlock(context)}`;
}

function buildExperimentPlannerPrompt(context) {
  return `You are the Experiment Planner for Skill RSI.

Goal: ${context.goal}
Run ID: ${context.runId}

Parameterization to plan from:
${formatContextBlock(context.parameterization)}

Experiment history summary:
${formatContextBlock(compactHistory(context.history))}

Manager guidance for this run:
${formatContextBlock(context.managerPlan)}

Turn the parameterization into a focused A/B experiment. Return JSON matching ABExperimentPlan:
runId, experimentQuestion, focusParameterIds, controlledParameterIds, hypothesis, arms {candidateA, candidateB}, evalFocus, successMetrics, promotionRisks, reasonNotTestingOtherHighPriorityParameters.
Select one to three related parameters and hold unrelated parameters constant.
Honor manager guidance. Do not select avoid.parameterIds unless you explicitly cite new evidence in reasonNotTestingOtherHighPriorityParameters. If strategy.experimentFamily is "high_divergence_reset", plan a high-divergence/reset experiment instead of another small local mutation.

Use this exact arm shape:
"arms": {
  "candidateA": { "strategyName": "...", "mutationInstructions": ["..."] },
  "candidateB": { "strategyName": "...", "mutationInstructions": ["..."] }
}`;
}

function buildCreatorPrompt(context) {
  const outputContract = getAgentOutputContract(context.outputType);
  return `You are a Skill Creator subagent for Skill RSI.

Goal: ${context.goal}
Run ID: ${context.runId}
Assigned experiment arm: ${context.experimentArm || 'candidateA'}

Ontology context:
${formatContextBlock(context.ontology)}

Active experiment plan:
${formatContextBlock(context.experimentPlan)}

Expected user-output contract:
${formatContextBlock(outputContract)}

Current champion SKILL.md:
${context.championSkill || 'No current champion skill exists yet.'}

${context.revision ? `Revision attempt: ${context.revision.attempt}

You are revising a candidate that failed adversarial preflight. Produce a full replacement candidate package, not a patch. Preserve the assigned experiment arm and the experiment intent, but fix every blocking issue.

Original creator artifact:
${formatContextBlock(context.revision.originalArtifact)}

Preflight review to address:
${formatContextBlock(context.revision.review)}
` : ''}

Create one Agent Skill package candidate from the assigned experiment arm. Follow this internal flow: draft outline, adversarial self-critique, revise outline, then write package files.

You are writing a REAL, portable Agent Skill for end users — NOT a Skill RSI artifact. The package MUST conform to the Agent Skills standard below.

=== AGENT SKILLS STANDARD ===
${context.agentSkillsStandard || '(standard unavailable)'}
=== END STANDARD ===

Use the Skill Creator guidance below to make quality and packaging decisions. It is guidance, not permission to violate the Agent Skills standard or assigned experiment arm.

=== SKILL CREATOR GUIDANCE ===
${context.skillCreatorGuidance || '(skill creator guidance unavailable)'}
=== END SKILL CREATOR GUIDANCE ===

Authoring rules for this package, on top of that standard:
- Frontmatter: include the required name and description; add an optional key (license, compatibility, metadata, allowed-tools) only if it genuinely applies, and put extras like author/version INSIDE metadata. Never invent non-spec top-level keys such as id, status, audience, summary, or a top-level version.
- name: a lowercase-hyphen slug reflecting the skill's purpose (e.g. "reddit-content-writer"), NEVER the Skill RSI candidate id.
- description: specific and end-user facing (what it does + when to use it); it must NOT mention Skill RSI, evaluation, validation, test runs, or "vertical slice".
- The package must contain NOTHING about Skill RSI's machinery anywhere in any file: no run ids, candidate ids, parameter ids, experiment/A-B/duel/eval/judge/scoring language, "Run Context" sections, or changed-parameter lists. It should read as if a skilled author wrote it for production use.

If assigned candidateA, use candidateId "candidate-a" and experimentArm "candidateA". If assigned candidateB, use candidateId "candidate-b" and experimentArm "candidateB".
Return JSON with candidateId, experimentArm, strategy, changedParameterIds, files [{path, content}], rationale, expectedAdvantages, expectedRisks, and selfCritique. candidateId/experimentArm/strategy/changedParameterIds are Skill RSI metadata returned in the JSON ONLY — they must NOT appear inside any package file.`;
}

function normalizeOutputType(outputType) {
  return ['text', 'code', 'code_visual'].includes(outputType) ? outputType : 'text';
}

function getAgentOutputContract(outputType) {
  if (outputType === 'code') {
    return {
      outputType: 'code',
      contract: 'The improved skill is evaluated on whether it helps agents produce concrete, production-ready code artifacts when implementation work is requested. Advice-only responses are incomplete unless the user explicitly asks for advice.',
      implications: [
        'Ontology should treat implementation readiness, runnable completeness, API/framework specificity, validation, and edge-case handling as first-class quality axes.',
        'Deconstruction should include parameters for how the skill moves from requirements to concrete files/code and how it prevents vague recommendation-only output.',
        'Creator output should be a portable Agent Skill that trains agents to produce code, not merely implementation plans.',
      ],
    };
  }
  if (outputType === 'code_visual') {
    return {
      outputType: 'code_visual',
      contract: 'The improved skill is evaluated on whether it helps agents produce production-ready code for visual/interface artifacts. Conceptual visual direction alone is incomplete. Screenshot/visual execution is not available yet, so the text evaluator inspects code, styling, accessibility, responsive behavior, and interaction detail.',
      implications: [
        'Ontology should include visual hierarchy, layout implementation, responsive behavior, accessibility, interaction states, and production readiness as first-class quality axes.',
        'Deconstruction should identify where the current skill permits mood-board or recommendation-only answers instead of implemented UI/code.',
        'Creator output should train agents to generate actual interface code and validation checks while avoiding claims that screenshots or browser pixels will be evaluated in this phase.',
      ],
    };
  }
  return {
    outputType: 'text',
    contract: 'The improved skill is evaluated on useful text artifacts appropriate to the skill domain, not merely meta-advice about how to create them.',
    implications: [
      'Ontology should identify the text artifacts the skill must reliably produce.',
      'Deconstruction should include parameters for artifact structure, specificity, validation, and domain fit.',
      'Creator output should train agents to produce the requested text artifact directly.',
    ],
  };
}

function buildAnalystPrompt(context) {
  return `You are the Analyst Agent for Skill RSI.

Goal: ${context.goal}
Run ID: ${context.runId}

Experiment history summary:
${formatContextBlock(compactHistory(context.history))}

Active experiment plan:
${formatContextBlock(context.experimentPlan)}

Interpret SkillEval results in context. Return JSON matching AnalystRecommendation:
runId, decision, recommendedChampionCandidateId, confidence, reasoning, observations, nextRoundGuidance {vary, preserve, investigate}.
Use one of these decisions: promote, keep_current, request_new_experiment.
Do not return edit_current; the surgical edit branch is not implemented yet.`;
}

function formatContextBlock(value, maxChars = 12000) {
  if (!value) return 'None available.';
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}

function compactHistory(history) {
  if (!history) return null;
  return {
    experimentId: history.experimentId,
    skillGoal: history.skillGoal,
    currentChampion: history.currentChampion || null,
    trajectory: Array.isArray(history.trajectory) ? history.trajectory.slice(-12) : [],
    parameterLog: Array.isArray(history.parameterLog)
      ? history.parameterLog.slice(-24).map(compactParameterLogItem)
      : [],
    knownWeaknesses: Array.isArray(history.knownWeaknesses) ? history.knownWeaknesses.slice(-12) : [],
    doNotRepeat: Array.isArray(history.doNotRepeat) ? history.doNotRepeat.slice(-12) : [],
    failedStrategyLog: Array.isArray(history.failedStrategyLog) ? history.failedStrategyLog.slice(-12) : [],
    recentNextExperimentNotes: Array.isArray(history.recentNextExperimentNotes)
      ? history.recentNextExperimentNotes.slice(-12)
      : [],
  };
}

function compactParameterLogItem(item) {
  return {
    parameterId: item.parameterId,
    testedInRuns: Array.isArray(item.testedInRuns) ? item.testedInRuns.slice(-8) : [],
    currentBelief: item.currentBelief,
    status: item.status,
    lastTestedRunId: item.lastTestedRunId || null,
    lastDecision: item.lastDecision || null,
    outcomeCounts: item.outcomeCounts || null,
    currentEvidence: compactEvidence(item.currentEvidence),
    staleEvidence: Array.isArray(item.staleEvidence) ? item.staleEvidence.slice(0, 4).map(compactEvidence) : [],
  };
}

function compactEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence || null;
  return {
    runId: evidence.runId,
    decision: evidence.decision,
    confidence: evidence.confidence,
    scoreDelta: evidence.scoreDelta,
    candidateDuelWinner: evidence.candidateDuelWinner,
    championGateWinner: evidence.championGateWinner,
    reviewBlocked: evidence.reviewBlocked,
    summary: evidence.summary,
    caveats: Array.isArray(evidence.caveats) ? evidence.caveats.slice(0, 4) : [],
  };
}

function parseJson(text) {
  const match = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((match ? match[1] : text).trim());
}

function annotateContractError(error, { agentName, context, rawModelText = null, rawArtifact = null }) {
  error.agentName = agentName;
  error.contractRunId = context.runId;
  error.experimentArm = context.experimentArm || null;
  error.rawModelText = rawModelText;
  error.rawArtifact = rawArtifact;
}

function validateAgentArtifact(agentName, artifact, context) {
  if (agentName === 'ontology') return validateOntology(normalizeOntology(artifact, context));
  if (agentName === 'deconstructor') return validateParameterization(normalizeParameterization(artifact, context));
  if (agentName === 'experiment-planner') return validateExperimentPlan(normalizeExperimentPlan(artifact, context));
  if (agentName === 'analyst') return validateRecommendation(normalizeContractRecommendation(artifact, context));
  return validateCreatorArtifact(normalizeCreatorArtifact(artifact, context), context);
}

function normalizeContractRecommendation(artifact, context = {}) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const decision = artifact.decision === 'edit_current' ? 'request_new_experiment' : artifact.decision;
  return {
    ...artifact,
    runId: artifact.runId || context.runId,
    decision,
    recommendedChampionCandidateId: decision === 'promote' ? artifact.recommendedChampionCandidateId : null,
  };
}

function normalizeOntology(artifact, context = {}) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  return {
    ...artifact,
    runId: normalizeString(artifact.runId, context.runId),
    skillGoal: normalizeString(artifact.skillGoal, context.goal),
    targetUsers: normalizeArray(artifact.targetUsers, ['agents using this skill']),
    targetTasks: normalizeArray(artifact.targetTasks, ['complete the requested skill-domain task']),
    invocationBoundaries: {
      shouldTriggerWhen: normalizeArray(artifact.invocationBoundaries?.shouldTriggerWhen, ['the user request matches the skill goal']),
      shouldNotTriggerWhen: normalizeArray(artifact.invocationBoundaries?.shouldNotTriggerWhen, ['the request is unrelated to the skill goal']),
    },
    inputSurface: normalizeArray(artifact.inputSurface, ['user request', 'available context']),
    outputArtifacts: normalizeArray(artifact.outputArtifacts, ['final answer']),
    requiredKnowledge: normalizeArray(artifact.requiredKnowledge, ['Agent Skill structure']),
    referencePoints: normalizeArray(artifact.referencePoints),
    adjacentDomainsToBorrowFrom: normalizeArray(artifact.adjacentDomainsToBorrowFrom),
    optionalResources: {
      references: normalizeArray(artifact.optionalResources?.references),
      scripts: normalizeArray(artifact.optionalResources?.scripts),
      assets: normalizeArray(artifact.optionalResources?.assets),
    },
    platformAssumptions: {
      portableAgentSkills: normalizeArray(artifact.platformAssumptions?.portableAgentSkills, ['root SKILL.md with frontmatter']),
      clientSpecificFeatures: normalizeArray(artifact.platformAssumptions?.clientSpecificFeatures),
    },
    failureModes: normalizeArray(artifact.failureModes, ['overbroad activation', 'missing validation']),
    qualityAxes: normalizeArray(artifact.qualityAxes, ['task success', 'workflow clarity', 'validation usefulness']),
    evalPromptTaxonomy: normalizeArray(artifact.evalPromptTaxonomy, ['direct request', 'ambiguous request', 'edge case request']),
    candidateStrategySpace: normalizeArray(artifact.candidateStrategySpace, ['lean procedural', 'reference-rich']),
    openQuestions: normalizeArray(artifact.openQuestions),
    researchMode: artifact.researchMode || context.researchPacket?.researchMode || 'inference',
    evidenceBasis: normalizeArray(artifact.evidenceBasis || artifact.evidenceClaims),
    sourceRefs: normalizeArray(artifact.sourceRefs),
    authorityMap: normalizeArray(artifact.authorityMap || context.researchPacket?.authorityMap),
    evidenceClaims: normalizeArray(artifact.evidenceClaims || context.researchPacket?.evidenceClaims),
    inferenceLabels: normalizeArray(artifact.inferenceLabels),
    unsupportedClaims: normalizeArray(artifact.unsupportedClaims),
    researchGaps: normalizeArray(artifact.researchGaps || context.researchPacket?.gaps),
  };
}

function normalizeExperimentPlan(artifact, context = {}) {
  if (!artifact || !artifact.arms) return artifact;
  return {
    ...artifact,
    runId: normalizeString(artifact.runId, context.runId),
    arms: {
      candidateA: normalizeExperimentArm(artifact.arms.candidateA),
      candidateB: normalizeExperimentArm(artifact.arms.candidateB),
    },
  };
}

function normalizeCreatorArtifact(artifact, context = {}) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const experimentArm = artifact.experimentArm || context.experimentArm || 'candidateA';
  const candidateId = artifact.candidateId || (experimentArm === 'candidateB' ? 'candidate-b' : 'candidate-a');
  const strategy = normalizeString(
    artifact.strategy || artifact.strategyName || artifact.name,
    `${experimentArm} generated strategy`,
  );
  return {
    ...artifact,
    candidateId,
    experimentArm,
    strategy,
    rationale: normalizeString(artifact.rationale, `Generated ${candidateId} using ${strategy}.`),
    changedParameterIds: normalizeArray(artifact.changedParameterIds),
    files: normalizeCreatorFiles(extractCreatorFiles(artifact), { candidateId, strategy }),
    expectedAdvantages: normalizeArray(artifact.expectedAdvantages),
    expectedRisks: normalizeArray(artifact.expectedRisks),
    selfCritique: normalizeArray(artifact.selfCritique, ['No self-critique was returned by the creator model.']),
  };
}

function extractCreatorFiles(artifact) {
  if (Array.isArray(artifact.files)) return artifact.files;
  const inlineSkill = artifact.skillMarkdown || artifact.skillMd || artifact.skillContent || artifact.skill;
  if (typeof inlineSkill === 'string' && inlineSkill.trim()) {
    return [{ path: 'SKILL.md', content: inlineSkill }];
  }
  return artifact.files;
}

function normalizeCreatorFiles(files, { candidateId, strategy }) {
  if (!Array.isArray(files)) return files;
  return files.map(file => {
    if (!file || typeof file !== 'object') return file;
    const rawPath = file.path || file.filePath || file.filename || file.name;
    const rawContent = typeof file.content === 'string' ? file.content
      : typeof file.markdown === 'string' ? file.markdown
        : typeof file.text === 'string' ? file.text
          : typeof file.body === 'string' ? file.body
            : file.content;
    const normalizedPath = normalizeCreatorFilePath(rawPath);
    const normalizedFile = {
      ...file,
      path: normalizedPath || file.path,
      content: rawContent,
    };
    if (normalizedFile.path !== 'SKILL.md' || typeof normalizedFile.content !== 'string') return normalizedFile;
    return {
      ...normalizedFile,
      content: ensureSkillFrontmatter(normalizedFile.content, { candidateId, strategy }),
    };
  });
}

function normalizeCreatorFilePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null;
  const normalized = rawPath.trim().replaceAll('\\', '/');
  const lower = normalized.toLowerCase();
  if (lower === 'skill.md' || lower.endsWith('/skill.md')) return 'SKILL.md';
  return normalized;
}

function ensureSkillFrontmatter(content, { candidateId, strategy }) {
  const strategyLabel = String(strategy || candidateId || 'generated skill').trim();
  const name = slugifySkillName(strategyLabel) || slugifySkillName(candidateId) || 'generated-skill';
  const description = `Use when the user needs help with ${strategyLabel.toLowerCase()}.`;
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\n${content}`;
  }

  let frontmatter = match[1].trim();
  const body = content.slice(match[0].length);
  if (!/^name:\s*.+$/m.test(frontmatter)) {
    frontmatter = `name: ${name}\n${frontmatter}`;
  }
  if (!/^description:\s*.+$/m.test(frontmatter)) {
    frontmatter = `${frontmatter}\ndescription: ${description}`;
  }
  return `---\n${frontmatter}\n---\n${body}`;
}

function slugifySkillName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
  return fallback;
}

function normalizeString(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

function normalizeExperimentArm(arm) {
  if (!arm || typeof arm !== 'object') return arm;
  const strategyName = arm.strategyName || arm.strategy || arm.name || arm.label || arm.title;
  const mutationInstructions = arm.mutationInstructions || arm.mutations || arm.instructions || arm.changes || [];
  return {
    ...arm,
    strategyName,
    mutationInstructions: Array.isArray(mutationInstructions) ? mutationInstructions : [String(mutationInstructions)],
  };
}

function normalizeParameterization(artifact, context = {}) {
  if (!artifact || !Array.isArray(artifact.parameters)) return artifact;
  return {
    ...artifact,
    runId: artifact.runId || context.runId,
    championSkillHash: artifact.championSkillHash || context.state?.currentChampion?.skillHash || 'none',
    parameters: artifact.parameters.map((parameter, index) => ({
      ...parameter,
      id: normalizeString(parameter.id, `p${String(index + 1).padStart(2, '0')}`),
      surface: normalizeString(parameter.surface, `surface ${index + 1}`),
      currentImplementation: normalizeString(parameter.currentImplementation, 'not specified'),
      improvementHypothesis: normalizeString(parameter.improvementHypothesis || parameter.hypothesis, 'Changing this surface may improve skill quality.'),
      expectedBenefit: normalizeString(parameter.expectedBenefit, 'Potentially improves the target quality axes.'),
      regressionRisk: normalizeString(parameter.regressionRisk, 'Could reduce performance on currently handled cases.'),
      artifactEvidence: normalizeArray(parameter.artifactEvidence, ['No artifact evidence returned; treat this parameter as low-confidence.']),
      evidenceFromHistory: normalizeArray(parameter.evidenceFromHistory),
      possibleMutations: normalizeArray(parameter.possibleMutations, ['test a focused mutation']),
      measurementPlan: normalizeString(parameter.measurementPlan, 'Compare candidate outputs on prompts targeting this parameter and inspect score deltas plus judge reasoning.'),
      couplingNotes: normalizeArray(parameter.couplingNotes, ['No coupling notes returned.']),
      priority: normalizeEnum(parameter.priority, ['low', 'medium', 'high'], 'medium'),
      confidence: normalizeEnum(parameter.confidence, ['low', 'medium', 'high'], 'low'),
      granularity: normalizeEnum(parameter.granularity, ['micro', 'section', 'package', 'strategy'], 'section'),
    })),
  };
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]+/g, '_');
  if (allowed.includes(normalized)) return normalized;
  if (normalized.includes('high')) return allowed.includes('high') ? 'high' : fallback;
  if (normalized.includes('medium')) return allowed.includes('medium') ? 'medium' : fallback;
  if (normalized.includes('low')) return allowed.includes('low') ? 'low' : fallback;
  if (normalized.includes('micro')) return allowed.includes('micro') ? 'micro' : fallback;
  if (normalized.includes('section')) return allowed.includes('section') ? 'section' : fallback;
  if (normalized.includes('package')) return allowed.includes('package') ? 'package' : fallback;
  if (normalized.includes('strategy')) return allowed.includes('strategy') ? 'strategy' : fallback;
  return fallback;
}

function validateCreatorArtifact(artifact, context) {
  if (!artifact || typeof artifact !== 'object') throw new Error('Creator artifact must be an object');
  for (const field of ['candidateId', 'experimentArm', 'strategy', 'rationale']) {
    if (typeof artifact[field] !== 'string' || !artifact[field].trim()) {
      throw new Error(`Creator artifact requires ${field}`);
    }
  }
  for (const field of ['changedParameterIds', 'files', 'expectedAdvantages', 'expectedRisks', 'selfCritique']) {
    if (!Array.isArray(artifact[field])) {
      throw new Error(`Creator artifact requires array ${field}`);
    }
  }
  if (!artifact.files.some(file => file.path === 'SKILL.md' && typeof file.content === 'string')) {
    throw new Error('Creator artifact must include files[].path SKILL.md');
  }
  return {
    ...artifact,
    runId: context.runId,
  };
}

async function readGoal(paths) {
  const history = await readJson(paths.historyIndex, null);
  if (history?.skillGoal) return history.skillGoal;
  return `Improve the ${paths.projectId} Agent Skill.`;
}

async function readChampionSkill(paths) {
  try {
    return await fs.readFile(path.join(paths.championSkillDir, 'SKILL.md'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readChampionPackage(paths) {
  try {
    const skillPackage = await loadSkillPackage(paths.championSkillDir);
    return {
      packageType: skillPackage.packageType,
      hash: skillPackage.hash,
      fileCount: skillPackage.files.length,
      files: skillPackage.files
        .filter(file => file.kind === 'text')
        .slice(0, 12)
        .map(file => ({
          path: file.path,
          role: file.role,
          contentPreview: file.content.length > 2500 ? `${file.content.slice(0, 2500)}\n...[truncated]` : file.content,
        })),
      omittedFiles: skillPackage.omittedFiles,
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

// The real Agent Skills standard, extracted to docs/agent-skills-standard.md and fed to the
// creator so packages conform to the actual spec. Falls back to a compact rule set if missing.
export async function readAgentSkillsStandard(cwd) {
  const candidates = [
    path.join(cwd, 'docs', 'agent-skills-standard.md'),
    new URL('../../docs/agent-skills-standard.md', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // Try the next known location.
    }
  }

  return [
    'Agent Skills standard (fallback): a skill is a directory with a root SKILL.md.',
    'Frontmatter requires only `name` (1-64 chars, lowercase letters/digits/hyphens, no leading/trailing or double hyphen) and `description` (1-1024 chars, says what it does and when to use it).',
    'Optional top-level keys: license, compatibility, metadata (a string→string map — put author/version here), allowed-tools. No other top-level keys (no id, status, audience, summary, top-level version).',
    'Keep SKILL.md under ~500 lines; move detail into references/, scripts/, assets/ and link with relative paths.',
  ].join('\n');
}

export async function readSkillCreatorGuidance(cwd) {
  const candidates = [
    path.join(cwd, 'docs', 'skill-creator-guidance.md'),
    new URL('../../docs/skill-creator-guidance.md', import.meta.url),
    process.env.CODEX_HOME
      ? path.join(process.env.CODEX_HOME, 'skills', '.system', 'skill-creator', 'SKILL.md')
      : null,
    process.env.HOME
      ? path.join(process.env.HOME, '.codex', 'skills', '.system', 'skill-creator', 'SKILL.md')
      : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      // Try the next known location.
    }
  }

  return [
    'Skill Creator guidance (fallback): keep SKILL.md concise and production-facing.',
    'Move detailed domain knowledge, examples, schemas, and variant playbooks into references/ with clear loading cues.',
    'Use scripts/ for fragile deterministic work and assets/ for output resources.',
    'Do not include Skill RSI run IDs, candidate IDs, eval prompts, judge/scoring language, or auxiliary README/changelog/process docs in generated packages.',
  ].join('\n');
}
