import path from 'node:path';
import fs from 'node:fs/promises';
import { initProject } from './init.js';
import { createRunId, getProjectPaths, getRunPaths } from './paths.js';
import { appendHistory } from './history.js';
import { runHeadlessEval } from './evaluator.js';
import {
  materializeCreatorArtifact,
  readAgentSkillsStandard,
  readChampionPackage,
  runAgentContract,
} from './agent-contracts.js';
import { analyzeRun } from './analyst.js';
import { designEvalBatch, naturalizeEvalPrompts, generateEvalCriteria } from './eval-design.js';
import { applyPromptBankUpdates } from './prompt-bank.js';
import { reviewCandidatePackage } from './reviewer.js';
import { acquireProjectLock } from './lock.js';
import { loadProjectConfig } from './config.js';
import {
  buildResearchPacket,
  createDeconstructionQualityReport,
  createOntologyQualityReport,
} from './research.js';
import {
  applyManagerGuidanceToPlan,
  createManagerArtifact,
  finalizeManagerArtifact,
} from './manager.js';
import { appendTimeline } from './timeline.js';
import { copyDir, ensureDir, hashDirectory, pathExists, readJson, writeJson, writeText } from './store.js';
import {
  validateCandidate,
  validateEvalResult,
  validateExperimentPlan,
  validateHistoryIndex,
  validateOntology,
  validateParameterization,
  validateQualityReport,
  validateRecommendation,
  validateResearchPacket,
  validateRunState,
} from './schema.js';
import {
  createStubExperimentPlan,
  createStubOntology,
  createStubParameterization,
  writeStubCandidate,
} from './stub-agents.js';

const MAX_CANDIDATE_REVISIONS = 3;
const MAX_CREATOR_CONTRACT_ATTEMPTS = 2;

// Resumability (plan §5): reuse a node's already-written artifact instead of redoing the work.
async function reuseJson(filePath, validate) {
  const existing = await readJson(filePath, null);
  if (!existing) return null;
  try { return validate ? validate(existing) : existing; } catch { return null; }
}

function normalizeRunTrigger(value) {
  return ['manual', 'continuous', 'cron', 'hook'].includes(value) ? value : 'manual';
}

function estimateBudgetForOneLoop(config) {
  return {
    estimatedTokens: config.budget.estimatedTokensPerLoop,
    estimatedSpendUsd: config.budget.estimatedSpendUsdPerLoop,
  };
}

function enforceUnattendedBudget({ config, state, loops, triggerMode }) {
  if (config.budget.maxConcurrentRuns < 1) {
    throw new Error('Budget config invalid: maxConcurrentRuns must be at least 1');
  }
  if (triggerMode === 'manual') return;

  const usage = normalizeBudgetUsage(state.budgetUsage);
  const addedTokens = config.budget.estimatedTokensPerLoop * loops;
  const addedSpend = config.budget.estimatedSpendUsdPerLoop * loops;

  if (config.budget.maxEstimatedTokens !== null && usage.estimatedTokens + addedTokens > config.budget.maxEstimatedTokens) {
    throw new Error(`Token budget exceeded: current ${usage.estimatedTokens} + estimated ${addedTokens} > max ${config.budget.maxEstimatedTokens}`);
  }
  if (config.budget.maxEstimatedSpendUsd !== null && usage.estimatedSpendUsd + addedSpend > config.budget.maxEstimatedSpendUsd) {
    throw new Error(`Spend budget exceeded: current ${usage.estimatedSpendUsd} + estimated ${addedSpend} > max ${config.budget.maxEstimatedSpendUsd}`);
  }
}

function normalizeBudgetUsage(value) {
  return {
    estimatedTokens: Number.isFinite(value?.estimatedTokens) ? value.estimatedTokens : 0,
    estimatedSpendUsd: Number.isFinite(value?.estimatedSpendUsd) ? value.estimatedSpendUsd : 0,
  };
}

function applyBudgetUsage(state, budgetEstimate) {
  const usage = normalizeBudgetUsage(state.budgetUsage);
  return {
    ...state,
    budgetUsage: {
      estimatedTokens: usage.estimatedTokens + (budgetEstimate?.estimatedTokens || 0),
      estimatedSpendUsd: Number((usage.estimatedSpendUsd + (budgetEstimate?.estimatedSpendUsd || 0)).toFixed(6)),
    },
  };
}

function createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters = {} }) {
  return {
    agent: agentModel || null,
    generation: generationModel || null,
    judge: judgeModel || null,
    parameters: {
      agentMaxTokens: modelParameters.agentMaxTokens || null,
      creatorMaxTokens: modelParameters.creatorMaxTokens || null,
      generationMaxTokens: modelParameters.generationMaxTokens || null,
      judgeMaxTokens: modelParameters.judgeMaxTokens || null,
    },
  };
}

function summarizeTriggerContext(triggerContext = {}) {
  return {
    mode: normalizeRunTrigger(triggerContext.mode),
    hook: triggerContext.hook ? {
      id: triggerContext.hook.id || null,
      path: triggerContext.hook.path || null,
      source: triggerContext.hook.payload?.source || triggerContext.hook.source || null,
    } : null,
  };
}

async function prepareManager({
  runPaths,
  projectId,
  runId,
  runNumber,
  mode,
  state,
  history,
  parameterization,
  triggerContext = { mode: 'manual', hook: null },
}) {
  const existing = await readJson(runPaths.managerJson, null);
  if (existing) return existing;
  const managerArtifact = createManagerArtifact({
    projectId,
    runId,
    runNumber,
    mode,
    state,
    history,
    parameterization,
    triggerContext,
  });
  await writeJson(runPaths.managerJson, managerArtifact);
  await appendTimeline(runPaths.timelineJsonl, 'manager_plan.written', {
    path: runPaths.managerJson,
    posture: managerArtifact.strategy.posture,
    experimentFamily: managerArtifact.strategy.experimentFamily,
  });
  return managerArtifact;
}

async function finishManager({ runPaths, managerArtifact, recommendation, nextState }) {
  if (!managerArtifact) return null;
  const completed = finalizeManagerArtifact(managerArtifact, { recommendation, nextState });
  await writeJson(runPaths.managerJson, completed);
  await appendTimeline(runPaths.timelineJsonl, 'manager_plan.finalized', {
    decision: completed.finalAction.decision,
    nextAction: completed.finalAction.nextAction,
  });
  return completed;
}

async function prepareResearchPacket({
  paths,
  runPaths,
  runId,
  goal,
  agentModel,
  apiKeys,
  agentClient,
  maxTokens,
  researchConfig,
}) {
  const existing = await readJson(runPaths.researchPacketJson, null);
  if (existing) return validateResearchPacket(existing);
  const packet = await buildResearchPacket({
    runId: `${runId}-research`,
    goal,
    model: agentModel,
    apiKeys,
    modelClient: agentClient,
    config: researchConfig,
    maxTokens,
  });
  await persistResearchPacket({
    paths,
    runPaths,
    runId,
    packet,
    updateCurrent: true,
    eventName: 'research_packet.written',
  });
  return packet;
}

async function persistResearchPacket({
  paths,
  runPaths,
  runId,
  packet,
  updateCurrent = false,
  eventName = 'research_packet.written',
}) {
  const validated = validateResearchPacket(packet);
  await writeJson(runPaths.researchPacketJson, validated);
  if (updateCurrent) await writeJson(paths.researchCurrent, validated);
  await writeJson(runPaths.researchRawJson, {
    runId,
    provider: validated.provider,
    researchMode: validated.researchMode,
    diagnostics: validated.researchDiagnostics || null,
    rawModelText: validated.rawModelText || null,
  });
  await appendTimeline(runPaths.timelineJsonl, eventName, {
    path: runPaths.researchPacketJson,
    mode: validated.researchMode,
    sources: validated.sources.length,
  });
  return validated;
}

async function applyOntologyQualityGate({
  paths,
  runPaths,
  projectId,
  runId,
  goal,
  ontology,
  researchPacket,
  qualityGateConfig,
  researchConfig,
  agentModel,
  apiKeys,
  agentClient,
  maxTokens,
  taskContract = null,
  refresh = false,
}) {
  const firstReport = createOntologyQualityReport({ ontology, researchPacket, config: researchConfig });
  let finalOntology = markQualityConfidence(ontology, firstReport);
  let finalReport = firstReport;
  if (shouldReviseQuality(firstReport, qualityGateConfig)) {
    await appendTimeline(runPaths.timelineJsonl, 'ontology_quality.revision_requested', {
      issues: firstReport.issues.length,
      warnings: firstReport.warnings.length,
    });
    const revised = await runAgentContract({
      cwd: path.dirname(paths.rootDir),
      projectName: projectId,
      agentName: 'ontology',
      runId: `${runId}-ontology-revision`,
      mode: 'real',
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      researchPacket,
      qualityFeedback: firstReport,
      taskContract,
      refresh,
      maxTokens,
    });
    finalOntology = validateOntology(revised.artifact);
    finalReport = {
      ...createOntologyQualityReport({ ontology: finalOntology, researchPacket, config: researchConfig }),
      revisedFrom: firstReport,
    };
    finalOntology = markQualityConfidence(finalOntology, finalReport);
  }
  finalReport = validateQualityReport(finalReport);
  await writeJson(runPaths.ontologyQualityReportJson, finalReport);
  await appendTimeline(runPaths.timelineJsonl, 'ontology_quality.completed', {
    status: finalReport.status,
    issues: finalReport.issues.length,
    warnings: finalReport.warnings.length,
    revised: Boolean(finalReport.revisedFrom),
  });
  if (qualityGateConfig?.mode === 'strict' && finalReport.issues.length) {
    throw new Error(`Ontology quality gate failed: ${finalReport.issues.map(item => item.code).join(', ')}`);
  }
  return finalOntology;
}

async function applyDeconstructionQualityGate({
  paths,
  runPaths,
  projectId,
  runId,
  parameterization,
  researchPacket,
  qualityGateConfig,
  agentModel,
  apiKeys,
  agentClient,
  maxTokens,
  taskContract = null,
}) {
  const championPackage = await readChampionPackage(paths);
  const firstReport = createDeconstructionQualityReport({ parameterization, championPackage });
  let finalParameterization = markQualityConfidence(parameterization, firstReport);
  let finalReport = firstReport;
  if (shouldReviseQuality(firstReport, qualityGateConfig)) {
    await appendTimeline(runPaths.timelineJsonl, 'deconstruction_quality.revision_requested', {
      issues: firstReport.issues.length,
      warnings: firstReport.warnings.length,
    });
    const revised = await runAgentContract({
      cwd: path.dirname(paths.rootDir),
      projectName: projectId,
      agentName: 'deconstructor',
      runId: `${runId}-deconstructor-revision`,
      mode: 'real',
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      researchPacket,
      qualityFeedback: firstReport,
      taskContract,
      maxTokens,
    });
    finalParameterization = validateParameterization(revised.artifact);
    finalReport = {
      ...createDeconstructionQualityReport({ parameterization: finalParameterization, championPackage }),
      revisedFrom: firstReport,
    };
    finalParameterization = markQualityConfidence(finalParameterization, finalReport);
  }
  finalReport = validateQualityReport(finalReport);
  await writeJson(runPaths.deconstructionQualityReportJson, finalReport);
  await appendTimeline(runPaths.timelineJsonl, 'deconstruction_quality.completed', {
    status: finalReport.status,
    issues: finalReport.issues.length,
    warnings: finalReport.warnings.length,
    revised: Boolean(finalReport.revisedFrom),
  });
  if (qualityGateConfig?.mode === 'strict' && finalReport.issues.length) {
    throw new Error(`Deconstruction quality gate failed: ${finalReport.issues.map(item => item.code).join(', ')}`);
  }
  return finalParameterization;
}

function shouldReviseQuality(report, config = {}) {
  return config.mode === 'warn_and_revise' && report.revisionRecommended;
}

function markQualityConfidence(artifact, report) {
  return {
    ...artifact,
    qualityGate: {
      status: report.status,
      confidence: report.confidence,
      issueCount: report.issues.length,
      warningCount: report.warnings.length,
    },
  };
}

async function createFallbackResearchFromOntology({ runId, goal, ontology }) {
  return validateResearchPacket({
    runId: `${runId}-research-reused`,
    skillGoal: goal,
    researchMode: ontology?.researchMode || 'inference',
    provider: 'reused-ontology',
    sources: [],
    searchTrace: [],
    evidenceClaims: (ontology?.evidenceClaims || [{
      claim: 'Reused ontology without a fresh research packet.',
      evidenceBasis: 'inferred',
      sourceRefs: [],
      confidence: 'low',
      implicationsForSkill: ['Treat ontology claims as inherited context.'],
    }]),
    authorityMap: ontology?.authorityMap?.length ? ontology.authorityMap : [{
      name: 'Reused ontology authorities',
      authorityType: 'unknown',
      whyTheyMatter: 'No fresh authority research was run for this iteration.',
      strongOpinions: ['No fresh authority opinions gathered.'],
      implicationsForSkill: ['Avoid promoting authority claims beyond prior ontology evidence.'],
      misuseRisks: ['Current run may inherit stale authority assumptions.'],
      evidenceBasis: 'inferred',
      sourceRefs: [],
    }],
    openQuestions: ontology?.openQuestions || [],
    gaps: ontology?.researchGaps || ['No current-run research packet was created.'],
  });
}

// Find the most recent run that started but never completed, so we can resume it.
async function findIncompleteRun(paths) {
  if (!(await pathExists(paths.runsDir))) return null;
  const entries = await fs.readdir(paths.runsDir, { withFileTypes: true });
  const runIds = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (!runIds.length) return null;
  const latest = runIds[runIds.length - 1];
  const run = await readJson(getRunPaths(paths, latest).runJson, null);
  return run && run.status && run.status !== 'completed' ? latest : null;
}

export async function runProject({
  cwd,
  projectName,
  goal,
  loops,
  mode,
  maxRuns = null,
  evalMode = 'mock',
  generationModel = null,
  judgeModel = null,
  agentModel = null,
  apiKeys = {},
  modelClient = null,
  stopRules = {},
  triggerMode = null,
  hookContext = null,
}) {
  if (!['stub', 'mock', 'agentic'].includes(mode)) {
    throw new Error('Run mode must be stub, mock, or agentic');
  }

  const init = await initProject({ cwd, projectName, goal });
  const paths = getProjectPaths(cwd, projectName);
  const config = await loadProjectConfig({ cwd, projectName });
  // Honor per-project config: explicit caller models win; otherwise fall back to config.
  generationModel = generationModel || config.models.generation;
  judgeModel = judgeModel || config.models.judge;
  agentModel = agentModel || config.models.agent;
  const evalOutputType = config.eval.outputType || 'text';
  const taskContract = config.eval.taskContract;
  const evalRetryPolicy = config.eval.retryPolicy;
  const generationMaxTokens = config.models.generationMaxTokens;
  const judgeMaxTokens = config.models.judgeMaxTokens;
  const agentMaxTokens = config.models.agentMaxTokens;
  const creatorMaxTokens = config.models.creatorMaxTokens;
  const runTrigger = normalizeRunTrigger(triggerMode ?? config.trigger.mode);
  const effectiveMaxRuns = maxRuns ?? config.budget.maxRuns;
  const lock = await acquireProjectLock(paths.projectDir);
  let state = validateRunState(await readJson(paths.stateJson));
  let history = validateHistoryIndex(await readJson(paths.historyIndex));
  const completedRuns = [];
  let stopReason = null;

  try {
    if (effectiveMaxRuns !== null && state.runCount + loops > effectiveMaxRuns) {
      throw new Error(`Run budget exceeded: current ${state.runCount} + requested ${loops} > max ${effectiveMaxRuns}`);
    }
    enforceUnattendedBudget({ config, state, loops, triggerMode: runTrigger });

    // If the previous run started but never finished (e.g. a model call failed mid-run), resume it
    // on the first iteration instead of starting a fresh run and discarding completed work.
    const resumeRunId = mode === 'agentic' ? await findIncompleteRun(paths) : null;

    for (let index = 0; index < loops; index += 1) {
      stopReason = getStopReason({ history, stopRules });
      if (stopReason) break;

      const resuming = index === 0 && Boolean(resumeRunId);
      const existingRun = resuming ? await readJson(getRunPaths(paths, resumeRunId).runJson, null) : null;
      const runNumber = resuming && existingRun ? existingRun.runNumber : state.runCount + 1;
      const runId = resuming ? resumeRunId : createRunId(runNumber, new Date(Date.now() + index));
      const runPaths = getRunPaths(paths, runId);
      const runLoop = mode === 'agentic'
        ? runAgenticLoop
        : mode === 'mock' ? runMockLoop : runStubLoop;
      let completed;
      try {
        completed = await runLoop({
          paths,
          runPaths,
          projectId: paths.projectId,
          goal,
          state,
          history,
          runId,
          runNumber,
          evalMode,
          generationModel,
          judgeModel,
          agentModel: agentModel || generationModel,
          modelParameters: {
            agentMaxTokens,
            creatorMaxTokens,
            generationMaxTokens,
            judgeMaxTokens,
          },
          apiKeys,
          modelClient,
          promotion: config.promotion,
          evalBatch: config.eval,
          evalOutputType,
          taskContract,
          evalRetryPolicy,
          researchConfig: config.research,
          qualityGateConfig: config.qualityGate,
          budgetEstimate: estimateBudgetForOneLoop(config),
          triggerContext: {
            mode: runTrigger,
            hook: hookContext,
            hookFocusFields: config.trigger.hookFocusFields,
          },
          resuming,
        });
      } catch (error) {
        await appendTimeline(runPaths.timelineJsonl, 'run.failed', {
          name: error.name,
          message: error.message,
        });
        await markRunFailed({ runPaths, runId, runNumber, mode, error });
        throw error;
      }

      state = completed.state;
      history = completed.history;
      completedRuns.push(completed.runRecord);
    }

    stopReason = stopReason || getStopReason({ history, stopRules });
  } finally {
    await lock.release();
  }

  return { projectId: paths.projectId, paths, state, history, completedRuns, init, stopReason };
}

async function runStubLoop({
  paths,
  runPaths,
  projectId,
  goal,
  state,
  history,
  runId,
  runNumber,
  generationModel,
  judgeModel,
  agentModel,
  modelParameters = {},
  evalMode,
  evalOutputType = 'text',
  taskContract = null,
  evalRetryPolicy = {},
  promotion = null,
  budgetEstimate = null,
  triggerContext = { mode: 'manual', hook: null },
}) {
  await ensureDir(runPaths.runDir);
  await ensureDir(runPaths.evalRawDir);
  await ensureDir(runPaths.analysisDir);
  await appendTimeline(runPaths.timelineJsonl, 'run.started', { mode: 'stub', runId });

  const startedAt = new Date().toISOString();
  const runRecord = {
    runId,
    runNumber,
    mode: 'stub',
    status: 'running',
    startedAt,
    completedAt: null,
    currentChampionAtStart: state.currentChampion,
    trigger: summarizeTriggerContext(triggerContext),
    eval: {
      mode: evalMode,
      outputType: evalOutputType,
      taskContract,
    },
    promotionPolicy: promotion,
    models: createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters }),
    budgetEstimate,
  };
  await writeJson(runPaths.runJson, runRecord);

  const ontology = validateOntology(createStubOntology({ projectId, goal, runId }));
  await writeJson(paths.ontologyCurrent, ontology);
  await appendTimeline(runPaths.timelineJsonl, 'ontology.written', { path: paths.ontologyCurrent });

  const parameterization = validateParameterization(createStubParameterization({
    runId,
    championSkillHash: state.currentChampion?.skillHash,
  }));
  await writeJson(paths.parameterizationCurrent, parameterization);
  await writeJson(runPaths.parameterizationJson, parameterization);
  await appendTimeline(runPaths.timelineJsonl, 'parameterization.written', { path: runPaths.parameterizationJson });

  const managerArtifact = await prepareManager({
    runPaths,
    projectId,
    runId,
    runNumber,
    mode: 'stub',
    state,
    history,
    parameterization,
    triggerContext,
  });
  const experimentPlan = validateExperimentPlan(applyManagerGuidanceToPlan(
    createStubExperimentPlan({ runId, runNumber, parameterization }),
    managerArtifact,
    parameterization,
  ));
  await writeJson(runPaths.experimentPlanJson, experimentPlan);
  await appendTimeline(runPaths.timelineJsonl, 'experiment_plan.written', { path: runPaths.experimentPlanJson });

  const candidateA = validateCandidate(await writeStubCandidate({
    candidateDir: runPaths.candidateADir,
    candidateId: 'candidate-a',
    arm: experimentPlan.arms.candidateA,
    projectId,
    goal,
    runId,
    changedParameterIds: experimentPlan.focusParameterIds,
  }));
  const candidateB = validateCandidate(await writeStubCandidate({
    candidateDir: runPaths.candidateBDir,
    candidateId: 'candidate-b',
    arm: experimentPlan.arms.candidateB,
    projectId,
    goal,
    runId,
    changedParameterIds: experimentPlan.focusParameterIds,
  }));
  await appendTimeline(runPaths.timelineJsonl, 'candidates.written', {
    candidateA: candidateA.skillPath,
    candidateB: candidateB.skillPath,
  });

  const evalDesign = designEvalBatch({
    runId,
    goal,
    ontology,
    parameterization,
    experimentPlan,
    history,
    previousBank: await readJson(paths.promptBankIndex, null),
    outputType: evalOutputType,
    taskContract,
  });
  await writeJson(paths.promptBankIndex, evalDesign.bank);
  await writeJson(paths.promptBankPrompts, evalDesign.prompts);
  await writeJson(paths.promptBankCriteria, evalDesign.criteria);
  await writeJson(runPaths.evalConfigJson, {
    runId,
    prompts: evalDesign.prompts,
    criteria: evalDesign.criteria,
    bank: evalDesign.bank,
    outputType: evalOutputType,
    taskContract,
    retryPolicy: evalRetryPolicy,
    promotionPolicy: promotion,
    models: createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters }),
    budgetEstimate,
  });
  await appendTimeline(runPaths.timelineJsonl, 'eval_config.written', { path: runPaths.evalConfigJson });
  const prompts = evalDesign.prompts;

  const candidateDuel = validateEvalResult(createStubEvalResult({
    runId,
    phase: 'candidate_duel',
    prompts,
    winner: runNumber % 2 === 0 ? 'candidate-a' : 'candidate-b',
    scoreOffset: runNumber,
  }));
  await writeJson(runPaths.candidateDuelJson, candidateDuel);
  await appendTimeline(runPaths.timelineJsonl, 'candidate_duel.completed', { winner: candidateDuel.winner });

  const promotedCandidateId = runNumber % 2 === 0 ? null : candidateDuel.winner;
  const championGate = validateEvalResult(createStubEvalResult({
    runId,
    phase: 'champion_gate',
    prompts,
    winner: promotedCandidateId || 'current',
    scoreOffset: runNumber + 1,
  }));
  await writeJson(runPaths.championGateJson, championGate);
  await appendTimeline(runPaths.timelineJsonl, 'champion_gate.completed', { winner: championGate.winner });

  const recommendation = validateRecommendation(createStubRecommendation({
    runId,
    promotedCandidateId,
    candidateDuel,
    championGate,
  }));
  await writeJson(runPaths.recommendationJson, recommendation);
  await writeText(runPaths.reportMd, renderReport({ runId, recommendation, candidateDuel, championGate }));
  await appendTimeline(runPaths.timelineJsonl, 'analysis.written', { decision: recommendation.decision });

  const nextState = await applyDecision({
    paths,
    runPaths,
    state,
    runId,
    runNumber,
    candidateA,
    candidateB,
    promotedCandidateId,
    budgetEstimate,
  });

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    candidates: [candidateA, candidateB],
    experimentPlan,
    recommendation,
  };
  await writeJson(runPaths.runJson, completedRunRecord);
  await writeJson(paths.stateJson, nextState);
  await appendTimeline(runPaths.timelineJsonl, 'state.updated', { champion: nextState.currentChampion?.candidateId || null });
  await finishManager({ runPaths, managerArtifact, recommendation, nextState });

  const nextHistory = await appendHistory({
    paths,
    history,
    state: nextState,
    runRecord: completedRunRecord,
    recommendation,
    parameterization,
    scoreDelta: championGate.scores[0]?.delta ?? null,
  });
  await appendTimeline(runPaths.timelineJsonl, 'run.completed', { status: 'completed' });

  return { state: nextState, history: nextHistory, runRecord: completedRunRecord };
}

async function runAgenticLoop({
  paths,
  runPaths,
  projectId,
  goal,
  state,
  history,
  runId,
  runNumber,
  evalMode,
  generationModel,
  judgeModel,
  agentModel,
  modelParameters = {},
  apiKeys,
  modelClient,
  promotion = null,
  evalBatch = null,
  evalOutputType = 'text',
  taskContract = null,
  evalRetryPolicy = {},
  researchConfig = {},
  qualityGateConfig = {},
  budgetEstimate = null,
  triggerContext = { mode: 'manual', hook: null },
  resuming = false,
}) {
  await ensureDir(runPaths.runDir);
  await ensureDir(runPaths.researchDir);
  await ensureDir(runPaths.evalRawDir);
  await ensureDir(runPaths.analysisDir);
  await appendTimeline(runPaths.timelineJsonl, resuming ? 'run.resumed' : 'run.started', {
    mode: 'agentic',
    runId,
    evalMode,
    generationModel,
    judgeModel,
    agentModel,
    outputType: evalOutputType,
    taskContract,
  });

  // Preserve the original run record (and its start time) when resuming an incomplete run.
  const existingRecord = resuming ? await readJson(runPaths.runJson, null) : null;
  const runRecord = existingRecord && existingRecord.status !== 'completed' ? existingRecord : {
    runId,
    runNumber,
    mode: 'agentic',
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    currentChampionAtStart: state.currentChampion,
    trigger: summarizeTriggerContext(triggerContext),
    eval: {
      mode: evalMode,
      outputType: evalOutputType,
      taskContract,
    },
    promotionPolicy: promotion,
    models: createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters }),
    researchPolicy: researchConfig,
    qualityGatePolicy: qualityGateConfig,
    budgetEstimate,
  };
  await writeJson(runPaths.runJson, runRecord);

  const agentClient = modelClient || undefined;
  const agentSkillsStandard = await readAgentSkillsStandard(path.dirname(paths.rootDir));
  const ontologyRefreshStatePath = path.join(path.dirname(paths.ontologyCurrent), 'refresh-state.json');
  let ontology = await readJson(paths.ontologyCurrent, null);
  const championHash = state.currentChampion?.skillHash || null;
  const ontologyRefreshState = await readJson(ontologyRefreshStatePath, null);
  let researchPacket = await reuseJson(paths.researchCurrent, validateResearchPacket);

  if (!ontology && !state.currentChampion) {
    // First run: build the initial domain map from scratch.
    researchPacket = await prepareResearchPacket({
      paths,
      runPaths,
      runId,
      goal,
      agentModel,
      apiKeys,
      agentClient,
      maxTokens: modelParameters.agentMaxTokens,
      researchConfig,
    });
    const ontologyResult = await runAgentContract({
      cwd: path.dirname(paths.rootDir),
      projectName: projectId,
      agentName: 'ontology',
      runId: `${runId}-ontology`,
      mode: 'real',
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      researchPacket,
      taskContract,
      maxTokens: modelParameters.agentMaxTokens,
    });
    ontology = validateOntology(ontologyResult.artifact);
    ontology = await applyOntologyQualityGate({
      paths,
      runPaths,
      projectId,
      runId,
      goal,
      ontology,
      researchPacket,
      qualityGateConfig,
      researchConfig,
      agentModel,
      apiKeys,
      agentClient,
      maxTokens: modelParameters.agentMaxTokens,
      taskContract,
    });
    await writeJson(paths.ontologyCurrent, ontology);
    await writeJson(path.join(runPaths.deconstructionDir, 'ontology.json'), ontology);
    await writeJson(ontologyRefreshStatePath, { championHash });
    await appendTimeline(runPaths.timelineJsonl, 'ontology.written', {
      mode: 'real',
      agent: 'ontology',
      model: agentModel,
      path: paths.ontologyCurrent,
    });
  } else if (ontology && championHash && championHash !== ontologyRefreshState?.championHash) {
    // The champion changed since the map was last built (§6.2/§6.6): refresh it conservatively.
    researchPacket = await prepareResearchPacket({
      paths,
      runPaths,
      runId,
      goal,
      agentModel,
      apiKeys,
      agentClient,
      maxTokens: modelParameters.agentMaxTokens,
      researchConfig,
    });
    const refreshed = await runAgentContract({
      cwd: path.dirname(paths.rootDir),
      projectName: projectId,
      agentName: 'ontology',
      runId: `${runId}-ontology-refresh`,
      mode: 'real',
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      refresh: true,
      researchPacket,
      taskContract,
      maxTokens: modelParameters.agentMaxTokens,
    });
    ontology = validateOntology(refreshed.artifact);
    ontology = await applyOntologyQualityGate({
      paths,
      runPaths,
      projectId,
      runId,
      goal,
      ontology,
      researchPacket,
      qualityGateConfig,
      researchConfig,
      agentModel,
      apiKeys,
      agentClient,
      maxTokens: modelParameters.agentMaxTokens,
      taskContract,
      refresh: true,
    });
    await writeJson(paths.ontologyCurrent, ontology);
    await writeJson(path.join(runPaths.deconstructionDir, 'ontology.json'), ontology);
    await writeJson(ontologyRefreshStatePath, { championHash });
    await appendTimeline(runPaths.timelineJsonl, 'ontology.refreshed', {
      mode: 'real',
      agent: 'ontology',
      model: agentModel,
      from: ontologyRefreshState?.championHash || null,
      to: championHash,
      path: paths.ontologyCurrent,
    });
  } else if (!ontology && state.currentChampion) {
    await appendTimeline(runPaths.timelineJsonl, 'ontology.skipped_for_baseline', {
      reason: 'uploaded baseline champion supplied; deconstructing existing skill before any ontology refresh',
      champion: state.currentChampion.skillHash,
    });
  } else {
    await appendTimeline(runPaths.timelineJsonl, 'ontology.reused', { path: paths.ontologyCurrent });
  }
  if (!researchPacket) {
    researchPacket = await createFallbackResearchFromOntology({ runId, goal, ontology });
    await persistResearchPacket({
      paths,
      runPaths,
      runId,
      packet: researchPacket,
      updateCurrent: false,
      eventName: 'research_packet.fallback_written',
    });
  } else if (!(await pathExists(runPaths.researchPacketJson))) {
    await persistResearchPacket({
      paths,
      runPaths,
      runId,
      packet: researchPacket,
      updateCurrent: false,
      eventName: 'research_packet.reused',
    });
  }

  let parameterization = await reuseJson(runPaths.parameterizationJson, validateParameterization);
  if (!parameterization) {
    const deconstructorResult = await runAgentContract({
      cwd: path.dirname(paths.rootDir),
      projectName: projectId,
      agentName: 'deconstructor',
      runId: `${runId}-deconstructor`,
      mode: 'real',
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      researchPacket,
      taskContract,
      maxTokens: modelParameters.agentMaxTokens,
    });
    parameterization = validateParameterization(deconstructorResult.artifact);
    parameterization = await applyDeconstructionQualityGate({
      paths,
      runPaths,
      projectId,
      runId,
      goal,
      parameterization,
      researchPacket,
      qualityGateConfig,
      agentModel,
      apiKeys,
      agentClient,
      maxTokens: modelParameters.agentMaxTokens,
      taskContract,
    });
    await writeJson(paths.parameterizationCurrent, parameterization);
    await writeJson(runPaths.parameterizationJson, parameterization);
    const seededFromOntology = !state.currentChampion;
    await appendTimeline(runPaths.timelineJsonl, seededFromOntology ? 'parameterization.seeded' : 'parameterization.written', {
      mode: 'real',
      agent: 'deconstructor',
      model: agentModel,
      firstRun: seededFromOntology,
      path: runPaths.parameterizationJson,
    });
  }

  const managerArtifact = await prepareManager({
    runPaths,
    projectId,
    runId,
    runNumber,
    mode: 'agentic',
    state,
    history,
    parameterization,
    triggerContext,
  });

  let experimentPlan = await reuseJson(runPaths.experimentPlanJson, validateExperimentPlan);
  if (!experimentPlan) {
    const plannerResult = await runAgentContract({
      cwd: path.dirname(paths.rootDir),
      projectName: projectId,
      agentName: 'experiment-planner',
      runId: `${runId}-planner`,
      mode: 'real',
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      managerPlan: managerArtifact,
      taskContract,
      maxTokens: modelParameters.agentMaxTokens,
    });
    experimentPlan = validateExperimentPlan(applyManagerGuidanceToPlan(
      plannerResult.artifact,
      managerArtifact,
      parameterization,
    ));
    await writeJson(paths.experimentPlanCurrent, experimentPlan);
    await writeJson(runPaths.experimentPlanJson, experimentPlan);
    await appendTimeline(runPaths.timelineJsonl, 'experiment_plan.written', {
      mode: 'real',
      agent: 'experiment-planner',
      model: agentModel,
      path: runPaths.experimentPlanJson,
    });
  }

  const candidateAResult = await createAndMaterializeCandidate({
    paths,
    runPaths,
    projectId,
    runId,
    candidateDir: runPaths.candidateADir,
    candidateId: 'candidate-a',
    experimentArm: 'candidateA',
    agentModel,
    modelParameters,
    apiKeys,
    agentClient,
    outputType: evalOutputType,
    taskContract,
  });
  let creatorAArtifact = candidateAResult.artifact;
  let candidateA = candidateAResult.candidate;

  const candidateBResult = await createAndMaterializeCandidate({
    paths,
    runPaths,
    projectId,
    runId,
    candidateDir: runPaths.candidateBDir,
    candidateId: 'candidate-b',
    experimentArm: 'candidateB',
    agentModel,
    modelParameters,
    apiKeys,
    agentClient,
    outputType: evalOutputType,
    taskContract,
  });
  let creatorBArtifact = candidateBResult.artifact;
  let candidateB = candidateBResult.candidate;
  await appendTimeline(runPaths.timelineJsonl, 'candidates.written', {
    mode: 'real',
    model: agentModel,
    candidateA: candidateA.skillPath,
    candidateB: candidateB.skillPath,
  });

  // Reuse the persisted eval config on resume (skips the criteria + prompt generation calls).
  let evalDesign = await reuseJson(runPaths.evalConfigJson, cfg => ({ prompts: cfg.prompts, criteria: cfg.criteria, bank: cfg.bank }));
  if (!evalDesign) {
    const previousBank = await readJson(paths.promptBankIndex, null);
    // SkillEval-style: generate the core eval criteria from the goal + both candidates on the first
    // run (when nothing is locked yet), then reuse the locked criteria on later runs for stability.
    const lockedCore = Array.isArray(previousBank?.criteria)
      ? previousBank.criteria.filter(criterion => !criterion.parameterIds?.length)
      : [];
    let coreCriteria = null;
    if (!lockedCore.length) {
      coreCriteria = await generateEvalCriteria({
        goal,
        candidateA,
        candidateB,
        model: judgeModel || agentModel,
        apiKeys,
        modelClient: agentClient,
        outputType: evalOutputType,
        taskContract,
      });
      if (coreCriteria) {
        await appendTimeline(runPaths.timelineJsonl, 'criteria.generated', {
          mode: 'real', model: judgeModel || agentModel, count: coreCriteria.length,
        });
      } else {
        await appendTimeline(runPaths.timelineJsonl, 'criteria.fallback', {
          mode: 'deterministic',
          reason: 'model_criteria_generation_failed_or_unavailable',
        });
      }
    } else {
      await appendTimeline(runPaths.timelineJsonl, 'criteria.reused', {
        source: previousBank?.criteriaAuthoring?.source || 'prompt_bank',
        count: lockedCore.length,
      });
    }
    evalDesign = designEvalBatch({
      runId,
      goal,
      ontology,
      parameterization,
      experimentPlan,
      history,
      previousBank,
      stablePromptCount: evalBatch?.stablePromptCount,
      explorationPromptCount: evalBatch?.explorationPromptCount,
      coreCriteria,
      outputType: evalOutputType,
      taskContract,
    });
    // SkillEval-style: have the model write realistic eval prompts (falls back to templates on failure)
    const promptAuthoring = await naturalizeEvalPrompts({
      design: evalDesign,
      goal,
      model: judgeModel || agentModel,
      apiKeys,
      modelClient: agentClient,
      outputType: evalOutputType,
      taskContract,
    });
    await appendTimeline(runPaths.timelineJsonl, 'eval_prompts.generated', {
      mode: 'real',
      model: judgeModel || agentModel,
      count: evalDesign.prompts.length,
      source: promptAuthoring?.source || evalDesign.bank?.promptAuthoring?.source || 'unknown',
      fallbackPromptCount: promptAuthoring?.fallbackPromptCount || 0,
      repairedPromptCount: promptAuthoring?.repairedPromptIds?.length || 0,
      modelAttemptCount: promptAuthoring?.modelAttemptCount || 0,
    });
    await writeJson(paths.promptBankIndex, evalDesign.bank);
    await writeJson(paths.promptBankPrompts, evalDesign.prompts);
    await writeJson(paths.promptBankCriteria, evalDesign.criteria);
    await writeJson(runPaths.evalConfigJson, {
      runId,
      prompts: evalDesign.prompts,
      criteria: evalDesign.criteria,
      bank: evalDesign.bank,
      outputType: evalOutputType,
      taskContract,
      retryPolicy: evalRetryPolicy,
      promotionPolicy: promotion,
      models: createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters }),
      budgetEstimate,
    });
    await appendTimeline(runPaths.timelineJsonl, 'eval_config.written', { path: runPaths.evalConfigJson });
  }

  let reviewA = await reuseJson(path.join(runPaths.candidateADir, 'review.json'));
  let reviewB = await reuseJson(path.join(runPaths.candidateBDir, 'review.json'));
  const championPackageForReview = state.currentChampion ? await readChampionPackage(paths) : null;
  if (!reviewA || !reviewB) {
    [reviewA, reviewB] = await Promise.all([
      reviewA || reviewCandidatePackage({ candidate: candidateA, experimentPlan, evalDesign, goal, model: agentModel, apiKeys, modelClient: agentClient, agentSkillsStandard, championPackage: championPackageForReview }),
      reviewB || reviewCandidatePackage({ candidate: candidateB, experimentPlan, evalDesign, goal, model: agentModel, apiKeys, modelClient: agentClient, agentSkillsStandard, championPackage: championPackageForReview }),
    ]);
    await writeJson(path.join(runPaths.candidateADir, 'review.json'), reviewA);
    await writeJson(path.join(runPaths.candidateBDir, 'review.json'), reviewB);
    await appendTimeline(runPaths.timelineJsonl, 'candidate_reviews.completed', {
      candidateA: reviewA.approveForEval,
      candidateB: reviewB.approveForEval,
    });
  }
  // Autonomous repair: keep fixing a candidate that fails the deterministic safety/spec gate,
  // up to MAX_CANDIDATE_REVISIONS attempts, rather than giving up after one.
  for (let attempt = 1; attempt <= MAX_CANDIDATE_REVISIONS && !reviewA.approveForEval; attempt += 1) {
    ({ artifact: creatorAArtifact, candidate: candidateA, review: reviewA } = await reviseBlockedCandidate({
      paths,
      runPaths,
      projectId,
      runId,
      goal,
      attempt,
      candidateDir: runPaths.candidateADir,
      candidate: candidateA,
      originalArtifact: creatorAArtifact,
      review: reviewA,
      experimentArm: 'candidateA',
      experimentPlan,
      evalDesign,
      agentModel,
      modelParameters,
      apiKeys,
      agentClient,
      agentSkillsStandard,
      outputType: evalOutputType,
      taskContract,
      championPackage: championPackageForReview,
    }));
  }
  for (let attempt = 1; attempt <= MAX_CANDIDATE_REVISIONS && !reviewB.approveForEval; attempt += 1) {
    ({ artifact: creatorBArtifact, candidate: candidateB, review: reviewB } = await reviseBlockedCandidate({
      paths,
      runPaths,
      projectId,
      runId,
      goal,
      attempt,
      candidateDir: runPaths.candidateBDir,
      candidate: candidateB,
      originalArtifact: creatorBArtifact,
      review: reviewB,
      experimentArm: 'candidateB',
      experimentPlan,
      evalDesign,
      agentModel,
      modelParameters,
      apiKeys,
      agentClient,
      agentSkillsStandard,
      outputType: evalOutputType,
      taskContract,
      championPackage: championPackageForReview,
    }));
  }
  if (!reviewA.approveForEval || !reviewB.approveForEval) {
    return completeReviewBlockedRun({
      paths,
      runPaths,
      state,
      history,
      runRecord,
      runId,
      runNumber,
      candidateA,
      candidateB,
      experimentPlan,
      parameterization,
      reviewA,
      reviewB,
      managerArtifact,
      budgetEstimate,
    });
  }

  let candidateDuel = await reuseJson(runPaths.candidateDuelJson);
  if (!candidateDuel) {
    candidateDuel = await runHeadlessEval({
      skillAPath: candidateA.skillPath,
      skillBPath: candidateB.skillPath,
      promptsPath: paths.promptBankPrompts,
      criteriaPath: paths.promptBankCriteria,
      outputPath: runPaths.candidateDuelJson,
      mode: evalMode,
      runId: `${runId}-candidate-duel`,
      generationModel,
      judgeModel,
      outputType: evalOutputType,
      taskContract,
      maxTokens: modelParameters.generationMaxTokens,
      judgeMaxTokens: modelParameters.judgeMaxTokens,
      retryPolicy: evalRetryPolicy,
      apiKeys,
      modelClient: agentClient,
    });
    await appendTimeline(runPaths.timelineJsonl, 'candidate_duel.completed', { winner: candidateDuel.stats.winner });
  }

  const promotedCandidateId = candidateDuel.stats.winner === 'skillA'
    ? 'candidate-a'
    : candidateDuel.stats.winner === 'skillB' ? 'candidate-b' : null;
  const duelWinnerCandidate = promotedCandidateId === 'candidate-a'
    ? candidateA
    : promotedCandidateId === 'candidate-b' ? candidateB : null;

  let championGate = await reuseJson(runPaths.championGateJson);
  if (!championGate) {
    if (state.currentChampion && duelWinnerCandidate) {
      championGate = await runHeadlessEval({
        skillAPath: duelWinnerCandidate.skillPath,
        skillBPath: paths.championSkillDir,
        promptsPath: paths.promptBankPrompts,
        criteriaPath: paths.promptBankCriteria,
        outputPath: runPaths.championGateJson,
        mode: evalMode,
        runId: `${runId}-champion-gate`,
        generationModel,
        judgeModel,
        outputType: evalOutputType,
        taskContract,
        maxTokens: modelParameters.generationMaxTokens,
        judgeMaxTokens: modelParameters.judgeMaxTokens,
        retryPolicy: evalRetryPolicy,
        apiKeys,
        modelClient: agentClient,
      });
      await appendTimeline(runPaths.timelineJsonl, 'champion_gate.completed', { winner: championGate.stats.winner });
    } else {
      await appendTimeline(runPaths.timelineJsonl, 'champion_gate.skipped', { reason: 'no current champion or no duel winner' });
    }
  }

  let recommendation = await reuseJson(runPaths.recommendationJson, validateRecommendation);
  if (!recommendation) {
    recommendation = await analyzeRun({
      mode: agentModel ? 'real' : 'policy',
      runId,
      goal,
      state,
      history,
      ontology,
      parameterization,
      experimentPlan,
      candidateA,
      candidateB,
      candidateDuel,
      championGate,
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      promotion,
    });
    const promptBankUpdate = applyPromptBankUpdates({
      bank: evalDesign.bank,
      candidateDuel,
      championGate,
      recommendation,
      runId,
    });
    await writeJson(paths.promptBankIndex, promptBankUpdate.bank);
    await writeJson(runPaths.promptBankUpdateJson, promptBankUpdate.update);
    await appendTimeline(runPaths.timelineJsonl, 'prompt_bank.updated', {
      promoted: promptBankUpdate.update.promotedPromptIds.length,
      provisional: promptBankUpdate.update.provisionalPromptIds.length,
      retired: promptBankUpdate.update.retiredPromptIds.length,
    });
    await writeJson(runPaths.recommendationJson, recommendation);
    await writeText(runPaths.reportMd, renderMockReport({ runId, recommendation, candidateDuel, championGate }));
    await appendTimeline(runPaths.timelineJsonl, 'analysis.written', { decision: recommendation.decision });
  }

  const nextState = await applyDecision({
    paths,
    runPaths,
    state,
    runId,
    runNumber,
    candidateA,
    candidateB,
    promotedCandidateId: recommendation.recommendedChampionCandidateId,
    budgetEstimate,
  });

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    candidates: [candidateA, candidateB],
    experimentPlan,
    recommendation,
    evaluatorRunId: candidateDuel.runId,
    championGateRunId: championGate?.runId || null,
  };
  await writeJson(runPaths.runJson, completedRunRecord);
  await writeJson(paths.stateJson, nextState);
  await appendTimeline(runPaths.timelineJsonl, 'state.updated', { champion: nextState.currentChampion?.candidateId || null });
  await finishManager({ runPaths, managerArtifact, recommendation, nextState });

  // Guard against double-appending if a resume re-enters after history was already written.
  const alreadyInHistory = Array.isArray(history.trajectory) && history.trajectory.some(entry => entry.runId === runId);
  const nextHistory = alreadyInHistory ? history : await appendHistory({
    paths,
    history,
    state: nextState,
    runRecord: completedRunRecord,
    recommendation,
    parameterization,
    scoreDelta: championGate?.stats.scoreDelta ?? candidateDuel.stats.scoreDelta,
  });
  await appendTimeline(runPaths.timelineJsonl, 'run.completed', { status: 'completed' });

  return { state: nextState, history: nextHistory, runRecord: completedRunRecord };
}

async function createAndMaterializeCandidate({
  paths,
  runPaths,
  projectId,
  runId,
  candidateDir,
  candidateId,
  experimentArm,
  agentModel,
  modelParameters = {},
  apiKeys,
  agentClient,
  outputType = 'text',
  taskContract = null,
}) {
  const artifactPath = path.join(candidateDir, 'creator-artifact.json');
  let artifact = await readJson(artifactPath, null);
  let revision = null;

  for (let attempt = 1; attempt <= MAX_CREATOR_CONTRACT_ATTEMPTS; attempt += 1) {
    try {
      if (!artifact) {
        const creatorResult = await runAgentContract({
          cwd: path.dirname(paths.rootDir),
          projectName: projectId,
          agentName: 'creator',
          runId: creatorContractRunId(runId, candidateId, attempt),
          mode: 'real',
          model: agentModel,
          apiKeys,
          modelClient: agentClient,
          experimentArm,
          revision,
          outputType,
          taskContract,
          maxTokens: modelParameters.creatorMaxTokens,
        });
        artifact = creatorResult.artifact;
        await writeJson(path.join(candidateDir, `creator-contract-${String(attempt).padStart(3, '0')}.json`), creatorResult);
        await writeJson(path.join(candidateDir, 'creator-contract.json'), creatorResult);
        const attemptPath = attempt === 1
          ? artifactPath
          : path.join(candidateDir, `creator-artifact-retry-${String(attempt - 1).padStart(3, '0')}.json`);
        await writeJson(attemptPath, artifact);
        if (attemptPath !== artifactPath) await writeJson(artifactPath, artifact);
      }

      const candidate = validateCandidate(await materializeCreatorArtifact({ artifact, candidateDir }));
      if (attempt > 1) {
        await appendTimeline(runPaths.timelineJsonl, 'creator_contract.recovered', {
          candidateId,
          attempt,
        });
      }
      return { artifact, candidate };
    } catch (error) {
      await persistCreatorContractFailure({
        runPaths,
        candidateDir,
        candidateId,
        experimentArm,
        attempt,
        error,
      });

      if (attempt >= MAX_CREATOR_CONTRACT_ATTEMPTS) {
        throw wrapCreatorContractError({ candidateId, error });
      }

      revision = createCreatorContractRevision({
        candidateId,
        attempt,
        artifact,
        error,
      });
      artifact = null;
      await appendTimeline(runPaths.timelineJsonl, 'creator_contract.retrying', {
        candidateId,
        nextAttempt: attempt + 1,
      });
    }
  }

  throw new Error(`${candidateId} creator artifact invalid: exhausted creator contract attempts`);
}

function creatorContractRunId(runId, candidateId, attempt) {
  const suffix = candidateId === 'candidate-b' ? 'b' : 'a';
  const base = `${runId}-creator-${suffix}`;
  return attempt === 1 ? base : `${base}-retry-${String(attempt - 1).padStart(3, '0')}`;
}

async function persistCreatorContractFailure({
  runPaths,
  candidateDir,
  candidateId,
  experimentArm,
  attempt,
  error,
}) {
  const suffix = String(attempt).padStart(3, '0');
  const failurePath = path.join(candidateDir, `creator-contract-failure-${suffix}.json`);
  await writeJson(failurePath, {
    candidateId,
    experimentArm,
    attempt,
    name: error.name,
    message: error.message,
    agentName: error.agentName || 'creator',
    contractRunId: error.contractRunId || null,
    rawArtifact: error.rawArtifact || null,
    rawModelText: truncateText(error.rawModelText, 50000),
  });
  await appendTimeline(runPaths.timelineJsonl, 'creator_contract.failed', {
    candidateId,
    attempt,
    message: error.message,
    path: failurePath,
  });
}

function createCreatorContractRevision({ candidateId, attempt, artifact, error }) {
  return {
    attempt,
    candidateId,
    originalArtifact: artifact || error.rawArtifact || {
      contractFailure: error.message,
      rawModelText: truncateText(error.rawModelText, 6000),
    },
    review: {
      candidateId,
      approveForEval: false,
      blockingIssues: [{
        surface: 'creator artifact contract',
        message: `The previous creator response could not be materialized: ${error.message}`,
      }],
      recommendedEdits: [{
        surface: 'files',
        message: 'Return files as an array with a root entry exactly like { "path": "SKILL.md", "content": "..." }.',
      }],
      nonIssues: [],
      overfittingRisk: 'low',
    },
  };
}

function wrapCreatorContractError({ candidateId, error }) {
  const wrapped = new Error(`${candidateId} creator artifact invalid: ${error.message}`);
  wrapped.name = error.name || 'Error';
  wrapped.cause = error;
  return wrapped;
}

async function runMockLoop({
  paths,
  runPaths,
  projectId,
  goal,
  state,
  history,
  runId,
  runNumber,
  evalMode,
  generationModel,
  judgeModel,
  agentModel,
  modelParameters = {},
  apiKeys,
  modelClient,
  promotion = null,
  evalBatch = null,
  evalOutputType = 'text',
  taskContract = null,
  evalRetryPolicy = {},
  budgetEstimate = null,
  triggerContext = { mode: 'manual', hook: null },
}) {
  await ensureDir(runPaths.runDir);
  await ensureDir(runPaths.evalRawDir);
  await ensureDir(runPaths.analysisDir);
  await appendTimeline(runPaths.timelineJsonl, 'run.started', {
    mode: 'mock',
    runId,
    evalMode,
    generationModel,
    judgeModel,
    agentModel,
    outputType: evalOutputType,
    taskContract,
  });

  const startedAt = new Date().toISOString();
  const runRecord = {
    runId,
    runNumber,
    mode: 'mock',
    status: 'running',
    startedAt,
    completedAt: null,
    currentChampionAtStart: state.currentChampion,
    trigger: summarizeTriggerContext(triggerContext),
    eval: {
      mode: evalMode,
      outputType: evalOutputType,
      taskContract,
    },
    promotionPolicy: promotion,
    models: createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters }),
    budgetEstimate,
  };
  await writeJson(runPaths.runJson, runRecord);

  const ontology = validateOntology(createStubOntology({ projectId, goal, runId }));
  await writeJson(paths.ontologyCurrent, ontology);
  await appendTimeline(runPaths.timelineJsonl, 'ontology.written', { path: paths.ontologyCurrent });

  const parameterization = validateParameterization(createStubParameterization({
    runId,
    championSkillHash: state.currentChampion?.skillHash,
  }));
  await writeJson(paths.parameterizationCurrent, parameterization);
  await writeJson(runPaths.parameterizationJson, parameterization);
  await appendTimeline(runPaths.timelineJsonl, 'parameterization.written', { path: runPaths.parameterizationJson });

  const managerArtifact = await prepareManager({
    runPaths,
    projectId,
    runId,
    runNumber,
    mode: 'mock',
    state,
    history,
    parameterization,
    triggerContext,
  });
  const experimentPlan = validateExperimentPlan(applyManagerGuidanceToPlan(
    createStubExperimentPlan({ runId, runNumber, parameterization }),
    managerArtifact,
    parameterization,
  ));
  await writeJson(runPaths.experimentPlanJson, experimentPlan);
  await appendTimeline(runPaths.timelineJsonl, 'experiment_plan.written', { path: runPaths.experimentPlanJson });

  const candidateA = validateCandidate(await writeStubCandidate({
    candidateDir: runPaths.candidateADir,
    candidateId: 'candidate-a',
    arm: experimentPlan.arms.candidateA,
    projectId,
    goal,
    runId,
    changedParameterIds: experimentPlan.focusParameterIds,
  }));
  const candidateB = validateCandidate(await writeStubCandidate({
    candidateDir: runPaths.candidateBDir,
    candidateId: 'candidate-b',
    arm: experimentPlan.arms.candidateB,
    projectId,
    goal,
    runId,
    changedParameterIds: experimentPlan.focusParameterIds,
  }));
  await appendTimeline(runPaths.timelineJsonl, 'candidates.written', {
    candidateA: candidateA.skillPath,
    candidateB: candidateB.skillPath,
  });

  const evalDesign = designEvalBatch({
    runId,
    goal,
    ontology,
    parameterization,
    experimentPlan,
    history,
    previousBank: await readJson(paths.promptBankIndex, null),
    stablePromptCount: evalBatch?.stablePromptCount,
    explorationPromptCount: evalBatch?.explorationPromptCount,
    outputType: evalOutputType,
    taskContract,
  });
  await writeJson(paths.promptBankIndex, evalDesign.bank);
  await writeJson(paths.promptBankPrompts, evalDesign.prompts);
  await writeJson(paths.promptBankCriteria, evalDesign.criteria);
  await writeJson(runPaths.evalConfigJson, {
    runId,
    prompts: evalDesign.prompts,
    criteria: evalDesign.criteria,
    bank: evalDesign.bank,
    outputType: evalOutputType,
    taskContract,
    retryPolicy: evalRetryPolicy,
    promotionPolicy: promotion,
    models: createRunModelMetadata({ agentModel, generationModel, judgeModel, modelParameters }),
    budgetEstimate,
  });
  await appendTimeline(runPaths.timelineJsonl, 'eval_config.written', { path: runPaths.evalConfigJson });

  const candidateDuel = await runHeadlessEval({
    skillAPath: candidateA.skillPath,
    skillBPath: candidateB.skillPath,
    promptsPath: paths.promptBankPrompts,
    criteriaPath: paths.promptBankCriteria,
    outputPath: runPaths.candidateDuelJson,
    mode: evalMode,
    runId: `${runId}-candidate-duel`,
    generationModel,
    judgeModel,
    outputType: evalOutputType,
    taskContract,
    maxTokens: modelParameters.generationMaxTokens,
    judgeMaxTokens: modelParameters.judgeMaxTokens,
    retryPolicy: evalRetryPolicy,
    apiKeys,
    modelClient: modelClient || undefined,
  });
  await appendTimeline(runPaths.timelineJsonl, 'candidate_duel.completed', { winner: candidateDuel.stats.winner });

  const promotedCandidateId = candidateDuel.stats.winner === 'skillA'
    ? 'candidate-a'
    : candidateDuel.stats.winner === 'skillB' ? 'candidate-b' : null;
  const duelWinnerCandidate = promotedCandidateId === 'candidate-a'
    ? candidateA
    : promotedCandidateId === 'candidate-b' ? candidateB : null;

  let championGate = null;
  let finalPromotedCandidateId = promotedCandidateId;
  let decision = promotedCandidateId ? 'promote' : 'request_new_experiment';

  if (state.currentChampion && duelWinnerCandidate) {
    championGate = await runHeadlessEval({
      skillAPath: duelWinnerCandidate.skillPath,
      skillBPath: paths.championSkillDir,
      promptsPath: paths.promptBankPrompts,
      criteriaPath: paths.promptBankCriteria,
      outputPath: runPaths.championGateJson,
      mode: evalMode,
      runId: `${runId}-champion-gate`,
      generationModel,
      judgeModel,
      outputType: evalOutputType,
      taskContract,
      maxTokens: modelParameters.generationMaxTokens,
      judgeMaxTokens: modelParameters.judgeMaxTokens,
      retryPolicy: evalRetryPolicy,
      apiKeys,
      modelClient: modelClient || undefined,
    });
    await appendTimeline(runPaths.timelineJsonl, 'champion_gate.completed', { winner: championGate.stats.winner });

    if (championGate.stats.winner === 'skillA') {
      finalPromotedCandidateId = promotedCandidateId;
      decision = 'promote';
    } else {
      finalPromotedCandidateId = null;
      decision = 'keep_current';
    }
  } else {
    await appendTimeline(runPaths.timelineJsonl, 'champion_gate.skipped', { reason: 'no current champion or no duel winner' });
  }

  const recommendation = validateRecommendation({
    runId,
    decision,
    recommendedChampionCandidateId: finalPromotedCandidateId,
    confidence: finalPromotedCandidateId ? 'medium' : 'low',
    reasoning: createMockRecommendationReasoning({
      promotedCandidateId: finalPromotedCandidateId,
      duelWinnerCandidateId: promotedCandidateId,
      hasChampion: Boolean(state.currentChampion),
      championGate,
    }),
    observations: [
      `Headless duel winner: ${candidateDuel.stats.winner}`,
      `Score delta skillA-skillB: ${candidateDuel.stats.scoreDelta}`,
      championGate ? `Champion gate winner: ${championGate.stats.winner}` : 'Champion gate skipped: no current champion',
    ],
    nextRoundGuidance: {
      vary: 'replace mock agents with model-backed agents',
      preserve: 'headless evaluator artifact shape',
      investigate: 'real candidate generation quality',
    },
  });
  const promptBankUpdate = applyPromptBankUpdates({
    bank: await readJson(paths.promptBankIndex, null),
    candidateDuel,
    championGate,
    recommendation,
    runId,
  });
  await writeJson(paths.promptBankIndex, promptBankUpdate.bank);
  await writeJson(runPaths.promptBankUpdateJson, promptBankUpdate.update);
  await appendTimeline(runPaths.timelineJsonl, 'prompt_bank.updated', {
    promoted: promptBankUpdate.update.promotedPromptIds.length,
    provisional: promptBankUpdate.update.provisionalPromptIds.length,
    retired: promptBankUpdate.update.retiredPromptIds.length,
  });
  await writeJson(runPaths.recommendationJson, recommendation);
  await writeText(runPaths.reportMd, renderMockReport({ runId, recommendation, candidateDuel, championGate }));
  await appendTimeline(runPaths.timelineJsonl, 'analysis.written', { decision: recommendation.decision });

  const nextState = await applyDecision({
    paths,
    runPaths,
    state,
    runId,
    runNumber,
    candidateA,
    candidateB,
    promotedCandidateId: finalPromotedCandidateId,
    budgetEstimate,
  });

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    candidates: [candidateA, candidateB],
    experimentPlan,
    recommendation,
    evaluatorRunId: candidateDuel.runId,
    championGateRunId: championGate?.runId || null,
  };
  await writeJson(runPaths.runJson, completedRunRecord);
  await writeJson(paths.stateJson, nextState);
  await appendTimeline(runPaths.timelineJsonl, 'state.updated', { champion: nextState.currentChampion?.candidateId || null });
  await finishManager({ runPaths, managerArtifact, recommendation, nextState });

  // Guard against double-appending if a resume re-enters after history was already written.
  const alreadyInHistory = Array.isArray(history.trajectory) && history.trajectory.some(entry => entry.runId === runId);
  const nextHistory = alreadyInHistory ? history : await appendHistory({
    paths,
    history,
    state: nextState,
    runRecord: completedRunRecord,
    recommendation,
    parameterization,
    scoreDelta: championGate?.stats.scoreDelta ?? candidateDuel.stats.scoreDelta,
  });
  await appendTimeline(runPaths.timelineJsonl, 'run.completed', { status: 'completed' });

  return { state: nextState, history: nextHistory, runRecord: completedRunRecord };
}

async function completeReviewBlockedRun({
  paths,
  runPaths,
  state,
  history,
  runRecord,
  runId,
  runNumber,
  candidateA,
  candidateB,
  experimentPlan,
  parameterization,
  reviewA,
  reviewB,
  managerArtifact = null,
  budgetEstimate = null,
}) {
  const recommendation = validateRecommendation({
    runId,
    decision: 'request_new_experiment',
    recommendedChampionCandidateId: null,
    confidence: 'high',
    reasoning: createReviewBlockedReasoning({ reviewA, reviewB }),
    observations: [
      `candidate-a review approved: ${reviewA.approveForEval}`,
      `candidate-b review approved: ${reviewB.approveForEval}`,
      `candidate-a blocking issues: ${reviewA.blockingIssues.length}`,
      `candidate-b blocking issues: ${reviewB.blockingIssues.length}`,
    ],
    nextRoundGuidance: {
      vary: 'candidate generation constraints and preflight repair instructions',
      preserve: 'experiment plan and prompt bank until candidates pass review',
      investigate: 'blocking review issues before spending evaluation calls',
    },
    resultSummary: {
      wins: {},
      meanScore: {},
      scoreDelta: 0,
      criticalRegressions: [
        ...reviewA.blockingIssues.map(issue => `candidate-a: ${issue.surface}: ${issue.message}`),
        ...reviewB.blockingIssues.map(issue => `candidate-b: ${issue.surface}: ${issue.message}`),
      ],
    },
    signalAssessment: {
      strongSignals: ['Preflight found blocking candidate quality issues before evaluation.'],
      weakSignals: [],
      likelyNoise: [],
      inconclusiveAreas: ['No SkillEval run was executed.'],
    },
    actionableInsights: [
      'Regenerate or repair blocked candidates before evaluation.',
      'Keep review artifacts attached to the run for the next creator prompt.',
    ],
    nextExperimentNotes: [
      'Retry the same experiment after correcting blocking package issues.',
    ],
    historySummary: 'Evaluation skipped because candidate preflight review blocked the run.',
  });

  await writeJson(runPaths.recommendationJson, recommendation);
  await writeText(runPaths.reportMd, renderReviewBlockedReport({ runId, recommendation, reviewA, reviewB }));
  await appendTimeline(runPaths.timelineJsonl, 'analysis.written', { decision: recommendation.decision, reason: 'candidate_review_blocked' });

  const nextState = validateRunState(applyBudgetUsage({
    projectId: state.projectId,
    runCount: runNumber,
    currentChampion: state.currentChampion,
    lastRunId: runId,
    updatedAt: new Date().toISOString(),
    runPolicy: state.runPolicy,
    budgetUsage: state.budgetUsage,
  }, budgetEstimate));

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    candidates: [candidateA, candidateB],
    experimentPlan,
    recommendation,
    evaluatorRunId: null,
    championGateRunId: null,
    reviewBlocked: true,
  };
  await writeJson(runPaths.runJson, completedRunRecord);
  await writeJson(paths.stateJson, nextState);
  await appendTimeline(runPaths.timelineJsonl, 'state.updated', { champion: nextState.currentChampion?.candidateId || null });
  await finishManager({ runPaths, managerArtifact, recommendation, nextState });

  const nextHistory = await appendHistory({
    paths,
    history,
    state: nextState,
    runRecord: completedRunRecord,
    recommendation,
    parameterization,
    scoreDelta: null,
  });
  await appendTimeline(runPaths.timelineJsonl, 'run.completed', { status: 'completed', reviewBlocked: true });

  return { state: nextState, history: nextHistory, runRecord: completedRunRecord };
}

async function reviseBlockedCandidate({
  paths,
  runPaths,
  projectId,
  runId,
  goal,
  attempt = 1,
  candidateDir,
  candidate,
  originalArtifact,
  review,
  experimentArm,
  experimentPlan,
  evalDesign,
  agentModel,
  modelParameters = {},
  apiKeys,
  agentClient,
  agentSkillsStandard,
  outputType = 'text',
  taskContract = null,
  championPackage = null,
}) {
  const suffix = String(attempt).padStart(3, '0');
  await appendTimeline(runPaths.timelineJsonl, 'candidate_revision.started', {
    candidateId: candidate.candidateId,
    attempt,
  });

  const revisionDir = path.join(candidateDir, `revision-${suffix}`);
  const revisionResult = await runAgentContract({
    cwd: path.dirname(paths.rootDir),
    projectName: projectId,
    agentName: 'creator',
    runId: `${runId}-${candidate.candidateId}-revision-${suffix}`,
    mode: 'real',
    model: agentModel,
    apiKeys,
    modelClient: agentClient,
    experimentArm,
    revision: {
      attempt,
      candidateId: candidate.candidateId,
      originalArtifact,
      review,
    },
    outputType,
    taskContract,
    maxTokens: modelParameters.creatorMaxTokens,
  });
  await writeJson(path.join(revisionDir, 'creator-contract.json'), revisionResult);
  await writeJson(path.join(revisionDir, 'creator-artifact.json'), revisionResult.artifact);
  const archivedCandidate = validateCandidate(await materializeCreatorArtifact({
    artifact: revisionResult.artifact,
    candidateDir: revisionDir,
  }));
  const revisedReview = await reviewCandidatePackage({
    candidate: archivedCandidate,
    experimentPlan,
    evalDesign,
    goal,
    model: agentModel,
    apiKeys,
    modelClient: agentClient,
    agentSkillsStandard,
    championPackage,
  });
  await writeJson(path.join(revisionDir, 'review.json'), revisedReview);
  const activeCandidate = validateCandidate(await materializeCreatorArtifact({
    artifact: revisionResult.artifact,
    candidateDir,
  }));
  await writeJson(path.join(candidateDir, 'creator-artifact.json'), revisionResult.artifact);
  await writeJson(path.join(candidateDir, 'review.json'), {
    ...revisedReview,
    activeRevision: {
      attempt,
      revisionDir,
      archivedSkillPath: archivedCandidate.skillPath,
    },
  });
  await appendTimeline(runPaths.timelineJsonl, 'candidate_revision.completed', {
    candidateId: candidate.candidateId,
    attempt,
    approved: revisedReview.approveForEval,
  });

  return {
    artifact: revisionResult.artifact,
    candidate: activeCandidate,
    review: revisedReview,
  };
}

function createStubPrompts(runId, parameterIds) {
  return parameterIds.slice(0, 3).map((parameterId, index) => ({
    id: `${runId}-prompt-${index + 1}`,
    text: `Stub prompt ${index + 1} targeting ${parameterId}.`,
    parameterIds: [parameterId],
    difficulty: index === 0 ? 'easy' : 'medium',
  }));
}

function createStubCriteria() {
  return [
    {
      id: 'workflow_clarity',
      name: 'Workflow Clarity',
      description: 'The output follows a clear sequence.',
      rubric: { 5: 'clear', 4: 'mostly clear', 3: 'adequate', 2: 'weak', 1: 'unclear' },
    },
    {
      id: 'validation_usefulness',
      name: 'Validation Usefulness',
      description: 'The output includes useful checks.',
      rubric: { 5: 'strong', 4: 'good', 3: 'adequate', 2: 'weak', 1: 'absent' },
    },
  ];
}

function createStubEvalResult({ runId, phase, prompts, winner, scoreOffset }) {
  const scores = prompts.map((prompt, index) => {
    const base = 7 + index;
    const winnerBonus = winner === 'candidate-a' ? 2 : winner === 'candidate-b' ? -2 : 0;
    const scoreA = base + scoreOffset + winnerBonus;
    const scoreB = base + scoreOffset - winnerBonus;
    const scoreCurrent = base + scoreOffset + (winner === 'current' ? 3 : -1);
    return {
      promptId: prompt.id,
      scoreA,
      scoreB,
      scoreCurrent,
      delta: winner === 'candidate-a' ? scoreA - scoreCurrent : winner === 'candidate-b' ? scoreB - scoreCurrent : 0,
    };
  });

  return {
    runId,
    phase,
    prompts,
    scores,
    winner,
    judgeReasoning: `Stub ${phase} winner is ${winner}.`,
  };
}

function createStubRecommendation({ runId, promotedCandidateId, candidateDuel, championGate }) {
  const decision = promotedCandidateId ? 'promote' : 'keep_current';
  return {
    runId,
    decision,
    recommendedChampionCandidateId: promotedCandidateId,
    confidence: 'medium',
    reasoning: promotedCandidateId
      ? `${promotedCandidateId} passed the stub champion gate.`
      : 'Current champion remains best in the stub champion gate.',
    observations: [
      `Candidate duel winner: ${candidateDuel.winner}`,
      `Champion gate winner: ${championGate.winner}`,
    ],
    nextRoundGuidance: {
      vary: 'continue testing the focused parameters',
      preserve: 'workspace layout and schema validity',
      investigate: 'replace stub eval with headless SkillEval in Chunk 3',
    },
  };
}

async function applyDecision({ paths, runPaths, state, runId, runNumber, candidateA, candidateB, promotedCandidateId, budgetEstimate = null }) {
  let currentChampion = state.currentChampion;

  if (promotedCandidateId) {
    const candidate = promotedCandidateId === 'candidate-a' ? candidateA : candidateB;
    await copyDir(candidate.skillPath, paths.championSkillDir);
    await copyDir(candidate.skillPath, runPaths.promotedSkillDir);
    const skillHash = await hashDirectory(paths.championSkillDir);
    currentChampion = {
      runId,
      candidateId: promotedCandidateId,
      skillHash,
      skillPath: paths.championSkillDir,
    };
  }

  return validateRunState(applyBudgetUsage({
    projectId: state.projectId,
    runCount: runNumber,
    currentChampion,
    lastRunId: runId,
    updatedAt: new Date().toISOString(),
    runPolicy: state.runPolicy,
    budgetUsage: state.budgetUsage,
  }, budgetEstimate));
}

function renderReport({ runId, recommendation, candidateDuel, championGate }) {
  return `# Stub Run Report

Run: ${runId}
Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Candidate Duel

Winner: ${candidateDuel.winner}

## Champion Gate

Winner: ${championGate.winner}

## Reasoning

${recommendation.reasoning}
`;
}

function renderMockReport({ runId, recommendation, candidateDuel, championGate = null }) {
  return `# Mock-Agent Run Report

Run: ${runId}
Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Headless Candidate Duel

Evaluator run: ${candidateDuel.runId}
Winner: ${candidateDuel.stats.winner}
Score delta: ${candidateDuel.stats.scoreDelta}

## Champion Gate

${championGate ? `Evaluator run: ${championGate.runId}
Winner: ${championGate.stats.winner}
Score delta: ${championGate.stats.scoreDelta}` : 'Skipped because no current champion existed at run start.'}

## Reasoning

${recommendation.reasoning}
`;
}

function renderReviewBlockedReport({ runId, recommendation, reviewA, reviewB }) {
  return `# Review-Blocked Run Report

Run: ${runId}
Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Candidate Reviews

candidate-a approved: ${reviewA.approveForEval}
candidate-b approved: ${reviewB.approveForEval}

## Blocking Issues

${[
    ...reviewA.blockingIssues.map(issue => `- candidate-a / ${issue.surface}: ${issue.message}`),
    ...reviewB.blockingIssues.map(issue => `- candidate-b / ${issue.surface}: ${issue.message}`),
  ].join('\n') || 'None'}

## Recommended Edits

${[
    ...reviewA.recommendedEdits.map(issue => `- candidate-a / ${issue.surface}: ${issue.message}`),
    ...reviewB.recommendedEdits.map(issue => `- candidate-b / ${issue.surface}: ${issue.message}`),
  ].join('\n') || 'None'}

## Reasoning

${recommendation.reasoning}
`;
}

function createReviewBlockedReasoning({ reviewA, reviewB }) {
  const blocked = [
    reviewA.approveForEval ? null : `candidate-a failed preflight with ${reviewA.blockingIssues.length} blocking issue(s)`,
    reviewB.approveForEval ? null : `candidate-b failed preflight with ${reviewB.blockingIssues.length} blocking issue(s)`,
  ].filter(Boolean);
  return `${blocked.join('; ')}. Evaluation was skipped to avoid spending judge calls on invalid or unsafe candidates.`;
}

function createMockRecommendationReasoning({ promotedCandidateId, duelWinnerCandidateId, hasChampion, championGate }) {
  if (!duelWinnerCandidateId) {
    return 'Mock headless candidate duel tied; request a new experiment.';
  }
  if (!hasChampion) {
    return `${duelWinnerCandidateId} won the mock headless candidate duel and becomes the initial champion.`;
  }
  if (promotedCandidateId) {
    return `${promotedCandidateId} won the mock champion gate against the current champion.`;
  }
  return `Current champion beat ${duelWinnerCandidateId} in the mock champion gate.`;
}

function getStopReason({ history, stopRules = {} }) {
  const trajectory = Array.isArray(history?.trajectory) ? history.trajectory : [];
  const maxNoPromotionRuns = parsePositiveInteger(stopRules.maxNoPromotionRuns);
  const maxInconclusiveRuns = parsePositiveInteger(stopRules.maxInconclusiveRuns);

  if (maxNoPromotionRuns && countTrailing(trajectory, item => item.decision !== 'promote') >= maxNoPromotionRuns) {
    return `Stopped after ${maxNoPromotionRuns} consecutive run(s) without promotion.`;
  }

  if (maxInconclusiveRuns && countTrailing(trajectory, item => item.decision === 'request_new_experiment') >= maxInconclusiveRuns) {
    return `Stopped after ${maxInconclusiveRuns} consecutive inconclusive run(s).`;
  }

  return null;
}

function countTrailing(items, predicate) {
  let count = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!predicate(items[index])) break;
    count += 1;
  }
  return count;
}

async function markRunFailed({ runPaths, runId, runNumber, mode, error }) {
  const existing = await readJson(runPaths.runJson, null);
  const failedAt = new Date().toISOString();
  await writeJson(runPaths.runJson, {
    ...(existing || {
      runId,
      runNumber,
      mode,
      startedAt: failedAt,
      currentChampionAtStart: null,
    }),
    status: 'failed',
    completedAt: failedAt,
    error: {
      name: error.name,
      message: error.message,
    },
  });
}

function truncateText(value, maxChars) {
  if (typeof value !== 'string') return null;
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n...[truncated]` : value;
}

function parsePositiveInteger(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
