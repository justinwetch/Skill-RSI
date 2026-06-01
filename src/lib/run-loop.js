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

function competitionModeForState(state, managerArtifact = null) {
  if (!state.currentChampion) return 'cold_start_duel';
  if (managerArtifact?.strategy?.experimentFamily === 'high_divergence_reset') return 'high_divergence_reset';
  return 'champion_challenge';
}

function isColdStartCompetition(experimentPlan) {
  return experimentPlan?.competitionMode === 'cold_start_duel';
}

function armForPlan(experimentPlan, armName) {
  const arm = experimentPlan?.arms?.[armName];
  if (!arm) throw new Error(`Experiment plan missing ${armName} arm for ${experimentPlan?.competitionMode || 'unknown'} competition`);
  return arm;
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

function createRunDiagnostics(clientDiagnostics) {
  const client = sanitizeClientDiagnostics(clientDiagnostics);
  return client ? { client } : null;
}

function sanitizeClientDiagnostics(value) {
  if (!value || typeof value !== 'object') return null;
  const openai = value.openai && typeof value.openai === 'object' ? value.openai : null;
  if (!openai) return null;
  const keySource = ['ui', 'server', 'none', 'multiple'].includes(openai.keySource)
    ? openai.keySource
    : 'none';
  return {
    openai: {
      serverKeyConfigured: Boolean(openai.serverKeyConfigured),
      uiKeyConfigured: Boolean(openai.uiKeyConfigured),
      effectiveKeyConfigured: Boolean(openai.effectiveKeyConfigured),
      keySource,
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

async function snapshotChampionAtRunStart({ paths, runPaths, state }) {
  if (!state.currentChampion) return null;
  if (await pathExists(path.join(runPaths.championDir, 'SKILL.md'))) return runPaths.championDir;
  if (!(await pathExists(path.join(paths.championSkillDir, 'SKILL.md')))) return null;
  await copyDir(paths.championSkillDir, runPaths.championDir);
  await appendTimeline(runPaths.timelineJsonl, 'champion.snapshot_written', {
    path: runPaths.championDir,
    champion: state.currentChampion.skillHash,
  });
  return runPaths.championDir;
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
  retryPolicy = null,
}) {
  const existing = await readJson(runPaths.researchPacketJson, null);
  if (existing) return validateResearchPacket(existing);
  const packet = await buildResearchPacket({
    runId: `${runId}-research`,
    goal,
    model: agentModel,
    apiKeys,
    modelClient: agentClient,
    config: { ...researchConfig, retryPolicy },
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
  clientDiagnostics = null,
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
          clientDiagnostics: sanitizeClientDiagnostics(clientDiagnostics),
          resuming,
        });
      } catch (error) {
        await appendTimeline(runPaths.timelineJsonl, 'run.failed', {
          name: error.name,
          message: error.message,
          attempts: error.attempts || error.provenance?.attempts || [],
          attemptCount: error.attempts?.length || error.provenance?.modelAttemptCount || 0,
          lastError: error.lastError || error.provenance?.lastError || null,
          failureKind: error.failureKind || error.provenance?.failureReason || error.lastError?.failureKind || null,
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
  clientDiagnostics = null,
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
    diagnostics: createRunDiagnostics(clientDiagnostics),
    budgetEstimate,
  };
  await writeJson(runPaths.runJson, runRecord);
  await snapshotChampionAtRunStart({ paths, runPaths, state });

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
  const competitionMode = competitionModeForState(state, managerArtifact);
  const experimentPlan = validateExperimentPlan(applyManagerGuidanceToPlan(
    createStubExperimentPlan({ runId, runNumber, parameterization, competitionMode }),
    managerArtifact,
    parameterization,
  ));
  await writeJson(runPaths.experimentPlanJson, experimentPlan);
  await appendTimeline(runPaths.timelineJsonl, 'experiment_plan.written', { path: runPaths.experimentPlanJson });

  const coldStart = isColdStartCompetition(experimentPlan);
  let candidateA = null;
  let candidateB = null;
  let challenger = null;

  if (coldStart) {
    candidateA = validateCandidate(await writeStubCandidate({
      candidateDir: runPaths.candidateADir,
      candidateId: 'candidate-a',
      arm: armForPlan(experimentPlan, 'candidateA'),
      projectId,
      goal,
      runId,
      changedParameterIds: experimentPlan.focusParameterIds,
    }));
    candidateB = validateCandidate(await writeStubCandidate({
      candidateDir: runPaths.candidateBDir,
      candidateId: 'candidate-b',
      arm: armForPlan(experimentPlan, 'candidateB'),
      projectId,
      goal,
      runId,
      changedParameterIds: experimentPlan.focusParameterIds,
    }));
    await appendTimeline(runPaths.timelineJsonl, 'candidates.written', {
      competitionMode: experimentPlan.competitionMode,
      candidateA: candidateA.skillPath,
      candidateB: candidateB.skillPath,
    });
  } else {
    challenger = validateCandidate(await writeStubCandidate({
      candidateDir: runPaths.challengerDir,
      candidateId: 'challenger',
      arm: armForPlan(experimentPlan, 'challenger'),
      projectId,
      goal,
      runId,
      changedParameterIds: experimentPlan.focusParameterIds,
    }));
    await appendTimeline(runPaths.timelineJsonl, 'challenger.written', {
      competitionMode: experimentPlan.competitionMode,
      challenger: challenger.skillPath,
      champion: paths.championSkillDir,
    });
  }

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

  const candidateDuel = coldStart ? validateEvalResult(createStubEvalResult({
    runId,
    phase: 'candidate_duel',
    prompts,
    winner: runNumber % 2 === 0 ? 'candidate-a' : 'candidate-b',
    scoreOffset: runNumber,
  })) : null;
  if (candidateDuel) {
    await writeJson(runPaths.candidateDuelJson, candidateDuel);
    await appendTimeline(runPaths.timelineJsonl, 'candidate_duel.completed', { winner: candidateDuel.winner });
  }

  const challenge = !coldStart ? validateEvalResult(createStubEvalResult({
    runId,
    phase: 'challenge',
    prompts,
    winner: runNumber % 2 === 0 ? 'current' : 'challenger',
    scoreOffset: runNumber + 1,
  })) : null;
  if (challenge) {
    await writeJson(runPaths.challengeJson, challenge);
    await appendTimeline(runPaths.timelineJsonl, 'challenge.completed', { winner: challenge.winner });
  }

  const promotedCandidateId = coldStart
    ? (runNumber % 2 === 0 ? null : candidateDuel.winner)
    : (challenge.winner === 'challenger' ? 'challenger' : null);

  const recommendation = validateRecommendation(createStubRecommendation({
    runId,
    promotedCandidateId,
    candidateDuel,
    challenge,
  }));
  await writeJson(runPaths.recommendationJson, recommendation);
  await writeText(runPaths.reportMd, renderReport({ runId, recommendation, candidateDuel, challenge, experimentPlan }));
  await appendTimeline(runPaths.timelineJsonl, 'analysis.written', { decision: recommendation.decision });

  const nextState = await applyDecision({
    paths,
    runPaths,
    state,
    runId,
    runNumber,
    candidateA,
    candidateB,
    challenger,
    promotedCandidateId,
    recommendation,
    budgetEstimate,
  });

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    competitionMode: experimentPlan.competitionMode,
    candidates: coldStart ? [candidateA, candidateB] : [],
    challenger,
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
    scoreDelta: (challenge || candidateDuel)?.scores?.[0]?.delta ?? null,
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
  clientDiagnostics = null,
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
    diagnostics: createRunDiagnostics(clientDiagnostics),
    budgetEstimate,
  };
  await writeJson(runPaths.runJson, runRecord);
  await snapshotChampionAtRunStart({ paths, runPaths, state });

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
      retryPolicy: evalRetryPolicy,
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
      retryPolicy: evalRetryPolicy,
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

  const coldStart = isColdStartCompetition(experimentPlan);
  const championComparable = state.currentChampion ? {
    candidateId: 'current',
    experimentArm: 'champion',
    strategy: 'current champion',
    skillPath: paths.championSkillDir,
    changedParameterIds: [],
  } : null;
  let creatorAArtifact = null;
  let creatorBArtifact = null;
  let creatorChallengerArtifact = null;
  let candidateA = null;
  let candidateB = null;
  let challenger = null;

  if (coldStart) {
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
    creatorAArtifact = candidateAResult.artifact;
    candidateA = candidateAResult.candidate;

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
    creatorBArtifact = candidateBResult.artifact;
    candidateB = candidateBResult.candidate;
    await appendTimeline(runPaths.timelineJsonl, 'candidates.written', {
      mode: 'real',
      competitionMode: experimentPlan.competitionMode,
      model: agentModel,
      candidateA: candidateA.skillPath,
      candidateB: candidateB.skillPath,
    });
  } else {
    if (!state.currentChampion) {
      throw new Error(`${experimentPlan.competitionMode} requires a current champion`);
    }
    const challengerResult = await createAndMaterializeCandidate({
      paths,
      runPaths,
      projectId,
      runId,
      candidateDir: runPaths.challengerDir,
      candidateId: 'challenger',
      experimentArm: 'challenger',
      agentModel,
      modelParameters,
      apiKeys,
      agentClient,
      outputType: evalOutputType,
      taskContract,
    });
    creatorChallengerArtifact = challengerResult.artifact;
    challenger = challengerResult.candidate;
    await appendTimeline(runPaths.timelineJsonl, 'challenger.written', {
      mode: 'real',
      competitionMode: experimentPlan.competitionMode,
      model: agentModel,
      challenger: challenger.skillPath,
      champion: paths.championSkillDir,
    });
  }

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
      const criteriaResult = await generateEvalCriteria({
        goal,
        candidateA: coldStart ? candidateA : challenger,
        candidateB: coldStart ? candidateB : championComparable,
        model: judgeModel || agentModel,
        apiKeys,
        modelClient: agentClient,
        outputType: evalOutputType,
        taskContract,
        retryPolicy: evalRetryPolicy,
        returnDiagnostics: true,
      });
      coreCriteria = criteriaResult.criteria;
      if (coreCriteria) {
        await appendTimeline(runPaths.timelineJsonl, 'criteria.generated', {
          mode: 'real',
          model: judgeModel || agentModel,
          count: coreCriteria.length,
          attemptCount: criteriaResult.diagnostics?.attemptCount || 1,
        });
      } else {
        await appendTimeline(runPaths.timelineJsonl, 'criteria.fallback', {
          mode: evalMode === 'real' ? 'failed' : 'deterministic',
          reason: 'model_criteria_generation_failed_or_unavailable',
          artifactPhase: criteriaResult.diagnostics?.artifactPhase || 'eval_criteria',
          attempts: criteriaResult.diagnostics?.attempts || [],
          attemptCount: criteriaResult.diagnostics?.attemptCount || 0,
          lastError: criteriaResult.diagnostics?.lastError || null,
          failureKind: criteriaResult.diagnostics?.failureKind || null,
        });
        if (evalMode === 'real') {
          throw new Error(formatCriteriaAuthoringFailure(criteriaResult.diagnostics));
        }
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
    // SkillEval-style: have the model write realistic eval prompts. Real eval treats
    // invalid prompt authoring as a run failure; mock/dev modes can keep templates.
    let promptAuthoring;
    try {
      promptAuthoring = await naturalizeEvalPrompts({
        design: evalDesign,
        goal,
        model: judgeModel || agentModel,
        apiKeys,
        modelClient: agentClient,
        outputType: evalOutputType,
        taskContract,
        strict: evalMode === 'real',
        retryPolicy: evalRetryPolicy,
      });
    } catch (error) {
      await appendTimeline(runPaths.timelineJsonl, 'eval_prompts.failed', {
        mode: evalMode,
        model: judgeModel || agentModel,
        reason: error.message,
        provenance: error.provenance || null,
        attempts: error.provenance?.attempts || [],
        attemptCount: error.provenance?.modelAttemptCount || 0,
        lastError: error.provenance?.lastError || null,
        failureKind: error.provenance?.failureReason || error.provenance?.lastError?.failureKind || null,
        artifactPhase: 'eval_prompts',
      });
      throw error;
    }
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

  let reviewA = coldStart ? await reuseJson(path.join(runPaths.candidateADir, 'review.json')) : null;
  let reviewB = coldStart ? await reuseJson(path.join(runPaths.candidateBDir, 'review.json')) : null;
  let reviewChallenger = coldStart ? null : await reuseJson(path.join(runPaths.challengerDir, 'review.json'));
  const championPackageForReview = state.currentChampion ? await readChampionPackage(paths) : null;
  if (coldStart && (!reviewA || !reviewB)) {
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
  if (!coldStart && !reviewChallenger) {
    reviewChallenger = await reviewCandidatePackage({
      candidate: challenger,
      experimentPlan,
      evalDesign,
      goal,
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      agentSkillsStandard,
      championPackage: championPackageForReview,
    });
    await writeJson(path.join(runPaths.challengerDir, 'review.json'), reviewChallenger);
    await appendTimeline(runPaths.timelineJsonl, 'challenger_review.completed', {
      challenger: reviewChallenger.approveForEval,
      blockingIssues: reviewChallenger.blockingIssues?.length || 0,
    });
  }
  // Autonomous repair: keep fixing a candidate that fails the deterministic safety/spec gate,
  // up to MAX_CANDIDATE_REVISIONS attempts, rather than giving up after one.
  for (let attempt = 1; coldStart && attempt <= MAX_CANDIDATE_REVISIONS && !reviewA.approveForEval; attempt += 1) {
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
  for (let attempt = 1; coldStart && attempt <= MAX_CANDIDATE_REVISIONS && !reviewB.approveForEval; attempt += 1) {
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
  for (let attempt = 1; !coldStart && attempt <= MAX_CANDIDATE_REVISIONS && !reviewChallenger.approveForEval; attempt += 1) {
    ({ artifact: creatorChallengerArtifact, candidate: challenger, review: reviewChallenger } = await reviseBlockedCandidate({
      paths,
      runPaths,
      projectId,
      runId,
      goal,
      attempt,
      candidateDir: runPaths.challengerDir,
      candidate: challenger,
      originalArtifact: creatorChallengerArtifact,
      review: reviewChallenger,
      experimentArm: 'challenger',
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
  if ((coldStart && (!reviewA.approveForEval || !reviewB.approveForEval)) || (!coldStart && !reviewChallenger.approveForEval)) {
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
      challenger,
      experimentPlan,
      parameterization,
      reviewA,
      reviewB,
      reviewChallenger,
      managerArtifact,
      budgetEstimate,
    });
  }

  let candidateDuel = coldStart ? await reuseJson(runPaths.candidateDuelJson) : null;
  let challenge = coldStart ? null : await reuseJson(runPaths.challengeJson);
  if (coldStart && !candidateDuel) {
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
      visualArtifactsDir: runPaths.evalVisualDir,
    });
    await appendTimeline(runPaths.timelineJsonl, 'candidate_duel.completed', { winner: candidateDuel.stats.winner });
  }

  if (!coldStart && !challenge) {
    challenge = await runHeadlessEval({
      skillAPath: challenger.skillPath,
      skillBPath: paths.championSkillDir,
      promptsPath: paths.promptBankPrompts,
      criteriaPath: paths.promptBankCriteria,
      outputPath: runPaths.challengeJson,
      mode: evalMode,
      runId: `${runId}-challenge`,
      generationModel,
      judgeModel,
      outputType: evalOutputType,
      taskContract,
      maxTokens: modelParameters.generationMaxTokens,
      judgeMaxTokens: modelParameters.judgeMaxTokens,
      retryPolicy: evalRetryPolicy,
      apiKeys,
      modelClient: agentClient,
      visualArtifactsDir: runPaths.evalVisualDir,
    });
    await appendTimeline(runPaths.timelineJsonl, 'challenge.completed', { winner: challenge.stats.winner });
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
      challenger,
      candidateDuel,
      challenge,
      model: agentModel,
      apiKeys,
      modelClient: agentClient,
      promotion,
    });
    const promptBankUpdate = applyPromptBankUpdates({
      bank: evalDesign.bank,
      candidateDuel,
      challenge,
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
    await writeText(runPaths.reportMd, renderMockReport({ runId, recommendation, candidateDuel, challenge, experimentPlan }));
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
    challenger,
    promotedCandidateId: recommendation.recommendedChampionCandidateId,
    recommendation,
    budgetEstimate,
  });

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    competitionMode: experimentPlan.competitionMode,
    candidates: coldStart ? [candidateA, candidateB] : [],
    challenger,
    experimentPlan,
    recommendation,
    evaluatorRunId: (candidateDuel || challenge)?.runId || null,
    challengeRunId: challenge?.runId || null,
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
    scoreDelta: (challenge || candidateDuel)?.stats.scoreDelta ?? null,
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
  let recoveredWithinModelRetry = false;

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
        if (attempt === 1 && Array.isArray(creatorResult.attempts) && creatorResult.attempts.length) {
          recoveredWithinModelRetry = true;
          await persistRecoveredCreatorAttemptFailures({
            runPaths,
            candidateDir,
            candidateId,
            experimentArm,
            attempts: creatorResult.attempts,
          });
        }
        const attemptPath = attempt === 1
          ? artifactPath
          : path.join(candidateDir, `creator-artifact-retry-${String(attempt - 1).padStart(3, '0')}.json`);
        await writeJson(attemptPath, artifact);
        if (attemptPath !== artifactPath) await writeJson(artifactPath, artifact);
      }

      const candidate = validateCandidate(await materializeCreatorArtifact({ artifact, candidateDir }));
      if (attempt > 1 || recoveredWithinModelRetry) {
        await appendTimeline(runPaths.timelineJsonl, 'creator_contract.recovered', {
          candidateId,
          attempt,
          recoveredWithinModelRetry,
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
  const suffix = candidateId === 'challenger' ? 'challenger' : candidateId === 'candidate-b' ? 'b' : 'a';
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
    attempts: error.attempts || [],
    failureKind: error.failureKind || error.lastError?.failureKind || null,
  });
  await appendTimeline(runPaths.timelineJsonl, 'creator_contract.failed', {
    candidateId,
    attempt,
    message: error.message,
    attempts: error.attempts || [],
    failureKind: error.failureKind || error.lastError?.failureKind || null,
    lastError: error.lastError || null,
    artifactPhase: 'creator_contract',
    path: failurePath,
  });
}

async function persistRecoveredCreatorAttemptFailures({
  runPaths,
  candidateDir,
  candidateId,
  experimentArm,
  attempts,
}) {
  for (const attemptRecord of attempts) {
    const error = new Error(attemptRecord.message || 'Creator artifact attempt failed.');
    error.name = attemptRecord.name || 'Error';
    error.rawModelText = attemptRecord.rawResponse || null;
    error.rawArtifact = attemptRecord.rawArtifact || null;
    error.failureKind = attemptRecord.failureKind || null;
    error.lastError = attemptRecord;
    await persistCreatorContractFailure({
      runPaths,
      candidateDir,
      candidateId,
      experimentArm,
      attempt: attemptRecord.attempt,
      error,
    });
    await appendTimeline(runPaths.timelineJsonl, 'creator_contract.retrying', {
      candidateId,
      nextAttempt: attemptRecord.attempt + 1,
      recoveredWithinModelRetry: true,
    });
  }
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

function formatCriteriaAuthoringFailure(diagnostics = {}) {
  const count = diagnostics?.attemptCount || diagnostics?.attempts?.length || 0;
  const last = diagnostics?.lastError;
  const detail = last?.failureKind === 'invalid_json'
    ? 'model returned invalid JSON'
    : last?.failureKind === 'empty_response'
      ? 'model returned an empty response'
      : last?.message || 'model criteria generation was unavailable';
  return `Eval criteria authoring failed after ${count || 'all'} attempts: ${detail}.`;
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
  clientDiagnostics = null,
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
    diagnostics: createRunDiagnostics(clientDiagnostics),
    budgetEstimate,
  };
  await writeJson(runPaths.runJson, runRecord);
  await snapshotChampionAtRunStart({ paths, runPaths, state });

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
  const competitionMode = competitionModeForState(state, managerArtifact);
  const experimentPlan = validateExperimentPlan(applyManagerGuidanceToPlan(
    createStubExperimentPlan({ runId, runNumber, parameterization, competitionMode }),
    managerArtifact,
    parameterization,
  ));
  await writeJson(runPaths.experimentPlanJson, experimentPlan);
  await appendTimeline(runPaths.timelineJsonl, 'experiment_plan.written', { path: runPaths.experimentPlanJson });

  const coldStart = isColdStartCompetition(experimentPlan);
  let candidateA = null;
  let candidateB = null;
  let challenger = null;
  if (coldStart) {
    candidateA = validateCandidate(await writeStubCandidate({
      candidateDir: runPaths.candidateADir,
      candidateId: 'candidate-a',
      arm: armForPlan(experimentPlan, 'candidateA'),
      projectId,
      goal,
      runId,
      changedParameterIds: experimentPlan.focusParameterIds,
    }));
    candidateB = validateCandidate(await writeStubCandidate({
      candidateDir: runPaths.candidateBDir,
      candidateId: 'candidate-b',
      arm: armForPlan(experimentPlan, 'candidateB'),
      projectId,
      goal,
      runId,
      changedParameterIds: experimentPlan.focusParameterIds,
    }));
    await appendTimeline(runPaths.timelineJsonl, 'candidates.written', {
      competitionMode: experimentPlan.competitionMode,
      candidateA: candidateA.skillPath,
      candidateB: candidateB.skillPath,
    });
  } else {
    challenger = validateCandidate(await writeStubCandidate({
      candidateDir: runPaths.challengerDir,
      candidateId: 'challenger',
      arm: armForPlan(experimentPlan, 'challenger'),
      projectId,
      goal,
      runId,
      changedParameterIds: experimentPlan.focusParameterIds,
    }));
    await appendTimeline(runPaths.timelineJsonl, 'challenger.written', {
      competitionMode: experimentPlan.competitionMode,
      challenger: challenger.skillPath,
      champion: paths.championSkillDir,
    });
  }

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

  const candidateDuel = coldStart ? await runHeadlessEval({
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
  }) : null;
  if (candidateDuel) await appendTimeline(runPaths.timelineJsonl, 'candidate_duel.completed', { winner: candidateDuel.stats.winner });

  const challenge = !coldStart ? await runHeadlessEval({
    skillAPath: challenger.skillPath,
    skillBPath: paths.championSkillDir,
    promptsPath: paths.promptBankPrompts,
    criteriaPath: paths.promptBankCriteria,
    outputPath: runPaths.challengeJson,
    mode: evalMode,
    runId: `${runId}-challenge`,
    generationModel,
    judgeModel,
    outputType: evalOutputType,
    taskContract,
    maxTokens: modelParameters.generationMaxTokens,
    judgeMaxTokens: modelParameters.judgeMaxTokens,
    retryPolicy: evalRetryPolicy,
    apiKeys,
    modelClient: modelClient || undefined,
  }) : null;
  if (challenge) await appendTimeline(runPaths.timelineJsonl, 'challenge.completed', { winner: challenge.stats.winner });

  const recommendation = validateRecommendation(await analyzeRun({
    mode: 'policy',
    runId,
    goal,
    state,
    history,
    ontology,
    parameterization,
    experimentPlan,
    candidateA,
    candidateB,
    challenger,
    candidateDuel,
    challenge,
    promotion,
  }));
  const promptBankUpdate = applyPromptBankUpdates({
    bank: await readJson(paths.promptBankIndex, null),
    candidateDuel,
    challenge,
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
  await writeText(runPaths.reportMd, renderMockReport({ runId, recommendation, candidateDuel, challenge, experimentPlan }));
  await appendTimeline(runPaths.timelineJsonl, 'analysis.written', { decision: recommendation.decision });

  const nextState = await applyDecision({
    paths,
    runPaths,
    state,
    runId,
    runNumber,
    candidateA,
    candidateB,
    challenger,
    promotedCandidateId: recommendation.recommendedChampionCandidateId,
    recommendation,
    budgetEstimate,
  });

  const completedRunRecord = {
    ...runRecord,
    status: 'completed',
    completedAt: new Date().toISOString(),
    competitionMode: experimentPlan.competitionMode,
    candidates: coldStart ? [candidateA, candidateB] : [],
    challenger,
    experimentPlan,
    recommendation,
    evaluatorRunId: (candidateDuel || challenge).runId,
    challengeRunId: challenge?.runId || null,
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
    scoreDelta: (challenge || candidateDuel).stats.scoreDelta,
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
  challenger = null,
  experimentPlan,
  parameterization,
  reviewA = null,
  reviewB = null,
  reviewChallenger = null,
  managerArtifact = null,
  budgetEstimate = null,
}) {
  const coldStart = isColdStartCompetition(experimentPlan);
  const blockingIssues = coldStart
    ? [
      ...reviewA.blockingIssues.map(issue => `candidate-a: ${issue.surface}: ${issue.message}`),
      ...reviewB.blockingIssues.map(issue => `candidate-b: ${issue.surface}: ${issue.message}`),
    ]
    : (reviewChallenger?.blockingIssues || []).map(issue => `challenger: ${issue.surface}: ${issue.message}`);
  const recommendation = validateRecommendation({
    runId,
    decision: 'request_new_experiment',
    recommendedChampionCandidateId: null,
    confidence: 'high',
    reasoning: createReviewBlockedReasoning({ reviewA, reviewB, reviewChallenger, coldStart }),
    observations: coldStart ? [
      `candidate-a review approved: ${reviewA.approveForEval}`,
      `candidate-b review approved: ${reviewB.approveForEval}`,
      `candidate-a blocking issues: ${reviewA.blockingIssues.length}`,
      `candidate-b blocking issues: ${reviewB.blockingIssues.length}`,
    ] : [
      `challenger review approved: ${reviewChallenger.approveForEval}`,
      `challenger blocking issues: ${reviewChallenger.blockingIssues.length}`,
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
        ...blockingIssues,
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
  await writeText(runPaths.reportMd, renderReviewBlockedReport({ runId, recommendation, reviewA, reviewB, reviewChallenger, coldStart }));
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
    competitionMode: experimentPlan.competitionMode,
    candidates: coldStart ? [candidateA, candidateB] : [],
    challenger,
    experimentPlan,
    recommendation,
    evaluatorRunId: null,
    challengeRunId: null,
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
    const winnerBonus = winner === 'candidate-a' || winner === 'challenger' ? 2 : winner === 'candidate-b' ? -2 : 0;
    const scoreA = base + scoreOffset + winnerBonus;
    const scoreB = base + scoreOffset - winnerBonus;
    const scoreCurrent = base + scoreOffset + (winner === 'current' ? 3 : -1);
    return {
      promptId: prompt.id,
      scoreA,
      scoreB,
      scoreCurrent,
      delta: winner === 'candidate-a' || winner === 'challenger' ? scoreA - scoreCurrent : winner === 'candidate-b' ? scoreB - scoreCurrent : 0,
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

function createStubRecommendation({ runId, promotedCandidateId, candidateDuel = null, challenge = null }) {
  const decision = promotedCandidateId ? 'promote' : 'keep_current';
  return {
    runId,
    decision,
    recommendedChampionCandidateId: promotedCandidateId,
    confidence: 'medium',
    reasoning: promotedCandidateId
      ? `${promotedCandidateId} passed the stub competition.`
      : 'Current champion remains best in the stub competition.',
    observations: [
      candidateDuel ? `Candidate duel winner: ${candidateDuel.winner}` : null,
      challenge ? `Challenge winner: ${challenge.winner}` : null,
    ].filter(Boolean),
    nextRoundGuidance: {
      vary: 'continue testing the focused parameters',
      preserve: 'workspace layout and schema validity',
      investigate: 'replace stub eval with headless SkillEval in Chunk 3',
    },
  };
}

async function applyDecision({ paths, runPaths, state, runId, runNumber, candidateA = null, candidateB = null, challenger = null, promotedCandidateId, recommendation = null, budgetEstimate = null }) {
  let currentChampion = state.currentChampion;

  if (promotedCandidateId) {
    const candidate = promotedCandidateId === 'challenger'
      ? challenger
      : promotedCandidateId === 'candidate-a' ? candidateA : candidateB;
    if (!candidate) throw new Error(`Cannot promote missing candidate "${promotedCandidateId}"`);
    await copyDir(candidate.skillPath, paths.championSkillDir);
    await copyDir(candidate.skillPath, runPaths.promotedSkillDir);
    const skillHash = await hashDirectory(paths.championSkillDir);
    currentChampion = {
      runId,
      candidateId: promotedCandidateId,
      skillHash,
      skillPath: paths.championSkillDir,
      provisional: Boolean(recommendation?.resultSummary?.provisionalBootstrap),
      confidence: recommendation?.confidence || null,
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

function renderReport({ runId, recommendation, candidateDuel = null, challenge = null, experimentPlan = null }) {
  return `# Stub Run Report

Run: ${runId}
Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Competition

Mode: ${experimentPlan?.competitionMode || (candidateDuel ? 'cold_start_duel' : 'champion_challenge')}

${candidateDuel ? `Cold-start duel winner: ${candidateDuel.winner}` : ''}
${challenge ? `Challenge winner: ${challenge.winner}` : ''}

## Reasoning

${recommendation.reasoning}
`;
}

function renderMockReport({ runId, recommendation, candidateDuel = null, challenge = null, experimentPlan = null }) {
  const activeChallenge = challenge;
  const coldStart = experimentPlan?.competitionMode === 'cold_start_duel' || Boolean(candidateDuel);
  return `# Mock-Agent Run Report

Run: ${runId}
Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Competition

Mode: ${experimentPlan?.competitionMode || (coldStart ? 'cold_start_duel' : 'champion_challenge')}

${candidateDuel ? `Cold-start duel: ${candidateDuel.runId}, winner=${candidateDuel.stats.winner}, scoreDelta=${candidateDuel.stats.scoreDelta}` : ''}
${activeChallenge ? `Champion challenge: ${activeChallenge.runId}, winner=${activeChallenge.stats.winner}, scoreDelta=${activeChallenge.stats.scoreDelta}` : ''}

## Reasoning

${recommendation.reasoning}
`;
}

function renderReviewBlockedReport({ runId, recommendation, reviewA = null, reviewB = null, reviewChallenger = null, coldStart = true }) {
  const reviews = coldStart
    ? [
      ['candidate-a', reviewA],
      ['candidate-b', reviewB],
    ]
    : [['challenger', reviewChallenger]];
  return `# Review-Blocked Run Report

Run: ${runId}
Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Candidate Reviews

${reviews.map(([id, review]) => `${id} approved: ${review?.approveForEval}`).join('\n')}

## Blocking Issues

${reviews.flatMap(([id, review]) => (review?.blockingIssues || []).map(issue => `- ${id} / ${issue.surface}: ${issue.message}`)).join('\n') || 'None'}

## Recommended Edits

${reviews.flatMap(([id, review]) => (review?.recommendedEdits || []).map(issue => `- ${id} / ${issue.surface}: ${issue.message}`)).join('\n') || 'None'}

## Reasoning

${recommendation.reasoning}
`;
}

function createReviewBlockedReasoning({ reviewA = null, reviewB = null, reviewChallenger = null, coldStart = true }) {
  const blocked = coldStart ? [
    reviewA?.approveForEval ? null : `candidate-a failed preflight with ${reviewA?.blockingIssues?.length || 0} blocking issue(s)`,
    reviewB?.approveForEval ? null : `candidate-b failed preflight with ${reviewB?.blockingIssues?.length || 0} blocking issue(s)`,
  ].filter(Boolean) : [
    reviewChallenger?.approveForEval ? null : `challenger failed preflight with ${reviewChallenger?.blockingIssues?.length || 0} blocking issue(s)`,
  ].filter(Boolean);
  return `${blocked.join('; ')}. Evaluation was skipped to avoid spending judge calls on invalid or unsafe candidates.`;
}

function createMockRecommendationReasoning({ promotedCandidateId, duelWinnerCandidateId, hasChampion, challenge = null }) {
  if (!duelWinnerCandidateId) {
    return hasChampion ? 'Mock headless challenger did not beat the current champion.' : 'Mock headless candidate duel tied; request a new experiment.';
  }
  if (!hasChampion) {
    return `${duelWinnerCandidateId} won the mock headless candidate duel and becomes the initial champion.`;
  }
  if (promotedCandidateId) {
    return `${promotedCandidateId} won the mock champion challenge against the current champion.`;
  }
  return `Current champion beat ${duelWinnerCandidateId} in the mock champion challenge.`;
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
      attempts: error.attempts || error.provenance?.attempts || [],
      attemptCount: error.attempts?.length || error.provenance?.modelAttemptCount || 0,
      lastError: error.lastError || error.provenance?.lastError || null,
      failureKind: error.failureKind || error.provenance?.failureReason || error.lastError?.failureKind || null,
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
