import fs from 'node:fs/promises';
import path from 'node:path';
import { getProjectPaths, getRunPaths } from './paths.js';
import { initProject } from './init.js';
import { loadSkillPackage } from './skill-package.js';
import { appendTimeline, readTimeline } from './timeline.js';
import { ensureDir, pathExists, readJson, writeJson } from './store.js';
import { loadProjectConfig } from './config.js';

export async function createProjectForUi({ cwd, projectName, goal, targetIterations = 3, triggerMode = 'manual' }) {
  if (typeof projectName !== 'string' || projectName.trim() === '') {
    throw badRequest('Project name is required');
  }
  if (typeof goal !== 'string' || goal.trim() === '') {
    throw badRequest('Project goal is required');
  }
  const normalizedTargetIterations = Number.parseInt(targetIterations, 10);
  if (!Number.isInteger(normalizedTargetIterations) || normalizedTargetIterations < 1) {
    throw badRequest('Target iterations must be a positive integer');
  }

  const paths = getProjectPaths(cwd, projectName);
  if (await pathExists(paths.stateJson)) {
    const error = new Error(`Project "${paths.projectId}" already exists`);
    error.statusCode = 409;
    throw error;
  }

  await initProject({
    cwd,
    projectName,
    goal,
    runPolicy: {
      triggerMode,
      targetIterations: normalizedTargetIterations,
    },
  });
  return readProjectSummary({ cwd, projectName });
}

export async function readProjectSummaries({ cwd }) {
  const rootDir = path.join(cwd, '.skill-rsi', 'projects');
  if (!(await pathExists(rootDir))) return [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const summaries = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    summaries.push(await readProjectSummary({ cwd, projectName: entry.name }));
  }

  return summaries.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

export async function readProjectSummary({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  const state = await readRequiredJson(paths.stateJson, `Project "${paths.projectId}" has not been initialized`);
  const history = await readRequiredJson(paths.historyIndex, `Project "${paths.projectId}" has no history index`);
  const promptBank = await readJson(paths.promptBankIndex, null);
  const config = await loadProjectConfig({ cwd, projectName });
  const humanDecisions = await listHumanDecisions(paths);

  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    projectDir: paths.projectDir,
    goal: history.skillGoal,
    state: {
      runCount: state.runCount,
      lastRunId: state.lastRunId || null,
      currentChampion: state.currentChampion || null,
      updatedAt: state.updatedAt || null,
      runPolicy: normalizeRunPolicy(state.runPolicy),
      budgetUsage: state.budgetUsage || { estimatedTokens: 0, estimatedSpendUsd: 0 },
    },
    config: {
      trigger: config.trigger,
      budget: config.budget,
      eval: {
        outputType: config.eval.outputType,
        visualRunner: config.eval.visualRunner,
        stablePromptCount: config.eval.stablePromptCount,
        explorationPromptCount: config.eval.explorationPromptCount,
      },
      portability: config.portability,
    },
    history: {
      trajectoryLength: history.trajectory.length,
      recentTrajectory: history.trajectory.slice(-10),
      parameterLogCount: history.parameterLog.length,
    },
    promptBank: promptBank ? {
      currentRunId: promptBank.currentRunId || null,
      stablePromptCount: promptBank.stablePromptIds?.length || 0,
      explorationPromptCount: promptBank.explorationPrompts?.length || 0,
      retiredPromptCount: promptBank.retired?.length || 0,
      criteriaVersionCount: promptBank.criteriaVersions?.length || 0,
    } : null,
    humanDecisionCount: humanDecisions.length,
    artifacts: {
      historyIndex: paths.historyIndex,
      historySummary: paths.historySummary,
      championSkillDir: paths.championSkillDir,
      promptBankIndex: paths.promptBankIndex,
    },
  };
}

function normalizeRunPolicy(runPolicy) {
  const targetIterations = Number.parseInt(runPolicy?.targetIterations ?? '3', 10);
  return {
    triggerMode: runPolicy?.triggerMode || 'manual',
    targetIterations: Number.isInteger(targetIterations) && targetIterations > 0 ? targetIterations : 3,
  };
}

export async function readRunDetail({ cwd, projectName, runId = null }) {
  const paths = getProjectPaths(cwd, projectName);
  const state = await readRequiredJson(paths.stateJson, `Project "${paths.projectId}" has not been initialized`);
  const resolvedRunId = runId || state.lastRunId;
  if (!resolvedRunId) throw new Error(`Project "${paths.projectId}" has no runs`);

  const runPaths = getRunPaths(paths, resolvedRunId);
  const run = await readRequiredJson(runPaths.runJson, `Run "${resolvedRunId}" was not found`);
  const [
    parameterization,
    manager,
    experimentPlan,
    evalConfig,
    candidateDuel,
    championGate,
    promptBankUpdate,
    recommendation,
    timeline,
    humanDecisions,
  ] = await Promise.all([
    readJson(runPaths.parameterizationJson, null),
    readJson(runPaths.managerJson, null),
    readJson(runPaths.experimentPlanJson, null),
    readJson(runPaths.evalConfigJson, null),
    readJson(runPaths.candidateDuelJson, null),
    readJson(runPaths.championGateJson, null),
    readJson(runPaths.promptBankUpdateJson, null),
    readJson(runPaths.recommendationJson, null),
    pathExists(runPaths.timelineJsonl).then(exists => exists ? readTimeline(runPaths.timelineJsonl) : []),
    listHumanDecisions(paths, resolvedRunId),
  ]);

  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    runId: resolvedRunId,
    run,
    parameterization,
    manager,
    experimentPlan,
    evalConfig,
    candidates: summarizeRunCandidates(run),
    reviews: await readCandidateReviews(runPaths),
    evals: {
      candidateDuel,
      championGate,
      promptBankUpdate,
    },
    recommendation,
    timeline,
    humanDecisions,
    artifacts: {
      runJson: runPaths.runJson,
      timelineJsonl: runPaths.timelineJsonl,
      parameterizationJson: runPaths.parameterizationJson,
      managerJson: runPaths.managerJson,
      experimentPlanJson: runPaths.experimentPlanJson,
      evalConfigJson: runPaths.evalConfigJson,
      candidateDuelJson: runPaths.candidateDuelJson,
      championGateJson: runPaths.championGateJson,
      recommendationJson: runPaths.recommendationJson,
      reportMd: runPaths.reportMd,
    },
  };
}

export async function readRunComparison({ cwd, projectName, runId = null }) {
  const detail = await readRunDetail({ cwd, projectName, runId });
  const paths = getProjectPaths(cwd, projectName);
  const candidateDuel = detail.evals.candidateDuel;
  const championGate = detail.evals.championGate;

  return {
    schemaVersion: 1,
    projectId: detail.projectId,
    runId: detail.runId,
    experimentQuestion: detail.experimentPlan?.experimentQuestion || null,
    focusParameterIds: detail.experimentPlan?.focusParameterIds || [],
    sides: {
      candidateA: await summarizeComparableSkill({
        label: 'candidateA',
        candidate: detail.candidates.candidateA,
        skillPath: detail.candidates.candidateA?.skillPath,
      }),
      candidateB: await summarizeComparableSkill({
        label: 'candidateB',
        candidate: detail.candidates.candidateB,
        skillPath: detail.candidates.candidateB?.skillPath,
      }),
      currentChampion: await summarizeComparableSkill({
        label: 'currentChampion',
        candidate: null,
        skillPath: await pathExists(path.join(paths.championSkillDir, 'SKILL.md')) ? paths.championSkillDir : null,
      }),
    },
    evalSummary: {
      candidateDuel: candidateDuel ? {
        winner: candidateDuel.stats.winner,
        scoreDelta: candidateDuel.stats.scoreDelta,
        wins: {
          skillA: candidateDuel.stats.skillAWins,
          skillB: candidateDuel.stats.skillBWins,
          ties: candidateDuel.stats.ties,
        },
      } : null,
      championGate: championGate ? {
        winner: championGate.stats.winner,
        scoreDelta: championGate.stats.scoreDelta,
        wins: {
          skillA: championGate.stats.skillAWins,
          skillB: championGate.stats.skillBWins,
          ties: championGate.stats.ties,
        },
      } : null,
    },
    recommendation: detail.recommendation ? {
      decision: detail.recommendation.decision,
      recommendedChampionCandidateId: detail.recommendation.recommendedChampionCandidateId || null,
      confidence: detail.recommendation.confidence,
      reasoning: detail.recommendation.reasoning,
    } : null,
  };
}

export async function deleteProject({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  if (!(await pathExists(paths.stateJson))) {
    const error = new Error(`Project "${paths.projectId}" was not found`);
    error.statusCode = 404;
    throw error;
  }
  // Soft delete: move the project into a trash folder so it is recoverable rather than destroyed.
  const trashDir = path.join(paths.rootDir, '.trash');
  await ensureDir(trashDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(trashDir, `${paths.projectId}-${stamp}`);
  await fs.rename(paths.projectDir, destination);
  return { schemaVersion: 1, deleted: paths.projectId, trashedTo: destination };
}

export async function readRunProgress({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  if (!(await pathExists(paths.runsDir))) {
    return { schemaVersion: 1, projectId: paths.projectId, runId: null, status: 'none', events: [] };
  }
  const entries = await fs.readdir(paths.runsDir, { withFileTypes: true });
  const runIds = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (runIds.length === 0) {
    return { schemaVersion: 1, projectId: paths.projectId, runId: null, status: 'none', events: [] };
  }
  const runId = runIds[runIds.length - 1];
  const runPaths = getRunPaths(paths, runId);
  const run = await readJson(runPaths.runJson, null);
  const events = (await pathExists(runPaths.timelineJsonl))
    ? (await readTimeline(runPaths.timelineJsonl)).map(entry => ({ timestamp: entry.timestamp, event: entry.event }))
    : [];
  const completed = run?.status === 'completed' || events.some(entry => entry.event === 'run.completed');
  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    runId,
    runNumber: run?.runNumber ?? null,
    status: completed ? 'completed' : (run?.status || 'running'),
    startedAt: run?.startedAt || null,
    completedAt: run?.completedAt || null,
    events,
  };
}

export async function readSkillContent({ cwd, projectName, source = 'champion', runId = null }) {
  const paths = getProjectPaths(cwd, projectName);
  let skillDir;
  let resolvedRunId = null;

  if (source === 'champion') {
    skillDir = paths.championSkillDir;
  } else if (source === 'candidate-a' || source === 'candidate-b') {
    const state = await readRequiredJson(paths.stateJson, `Project "${paths.projectId}" has not been initialized`);
    resolvedRunId = runId || state.lastRunId;
    if (!resolvedRunId) throw new Error(`Project "${paths.projectId}" has no runs`);
    const runPaths = getRunPaths(paths, resolvedRunId);
    const candidateDir = source === 'candidate-a' ? runPaths.candidateADir : runPaths.candidateBDir;
    skillDir = path.join(candidateDir, 'skill');
  } else {
    throw badRequest('source must be champion, candidate-a, or candidate-b');
  }

  if (!(await pathExists(path.join(skillDir, 'SKILL.md')))) {
    return { schemaVersion: 1, projectId: paths.projectId, source, runId: resolvedRunId, available: false, files: [] };
  }

  const pkg = await loadSkillPackage(skillDir);
  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    source,
    runId: resolvedRunId,
    available: true,
    entrypoint: pkg.entrypoint,
    packageType: pkg.packageType,
    hash: pkg.hash,
    validation: pkg.validation,
    diagnostics: pkg.diagnostics,
    files: pkg.files.map(file => ({
      path: file.path,
      role: file.role,
      mediaType: file.mediaType,
      size: file.size,
      text: file.kind === 'text' ? file.content : null,
    })),
  };
}

export async function recordHumanDecision({
  cwd,
  projectName,
  runId = null,
  decision,
  candidateId = null,
  note = '',
  author = 'local-cli',
}) {
  if (!['approve', 'reject', 'override_promote', 'override_keep', 'annotate'].includes(decision)) {
    throw new Error('Human decision must be approve, reject, override_promote, override_keep, or annotate');
  }

  const paths = getProjectPaths(cwd, projectName);
  const state = await readRequiredJson(paths.stateJson, `Project "${paths.projectId}" has not been initialized`);
  const resolvedRunId = runId || state.lastRunId;
  if (!resolvedRunId) throw new Error(`Project "${paths.projectId}" has no runs`);

  const createdAt = new Date().toISOString();
  const decisionId = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const decisionDir = path.join(paths.projectDir, 'human-decisions');
  const artifactPath = path.join(decisionDir, `${resolvedRunId}-${decisionId}.json`);
  const artifact = {
    schemaVersion: 1,
    id: decisionId,
    projectId: paths.projectId,
    runId: resolvedRunId,
    createdAt,
    author,
    decision,
    candidateId,
    note,
  };

  await ensureDir(decisionDir);
  await writeJson(artifactPath, artifact);
  await appendTimeline(getRunPaths(paths, resolvedRunId).timelineJsonl, 'human_decision.recorded', {
    decision,
    candidateId,
    path: artifactPath,
  });

  return { ...artifact, artifactPath };
}

async function readRequiredJson(filePath, message) {
  const value = await readJson(filePath, null);
  if (!value) throw new Error(message);
  return value;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function summarizeRunCandidates(run) {
  const candidates = Array.isArray(run?.candidates) ? run.candidates : [];
  return {
    candidateA: candidates.find(candidate => candidate.candidateId === 'candidate-a') || null,
    candidateB: candidates.find(candidate => candidate.candidateId === 'candidate-b') || null,
  };
}

async function readCandidateReviews(runPaths) {
  const candidateAReview = await readJson(path.join(runPaths.candidateADir, 'review.json'), null);
  const candidateBReview = await readJson(path.join(runPaths.candidateBDir, 'review.json'), null);
  return {
    candidateA: candidateAReview,
    candidateB: candidateBReview,
  };
}

async function summarizeComparableSkill({ label, candidate, skillPath }) {
  if (!skillPath) {
    return {
      label,
      available: false,
      skillPath: null,
    };
  }

  const skillPackage = await loadSkillPackage(skillPath);
  return {
    label,
    available: true,
    skillPath,
    packageType: skillPackage.packageType,
    entrypoint: skillPackage.entrypoint,
    fileCount: skillPackage.files.length,
    hash: skillPackage.hash,
    diagnostics: skillPackage.diagnostics,
    strategy: candidate?.strategy || null,
    changedParameterIds: candidate?.changedParameterIds || [],
  };
}

async function listHumanDecisions(paths, runId = null) {
  const decisionDir = path.join(paths.projectDir, 'human-decisions');
  if (!(await pathExists(decisionDir))) return [];
  const entries = await fs.readdir(decisionDir, { withFileTypes: true });
  const decisions = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const artifact = await readJson(path.join(decisionDir, entry.name), null);
    if (!artifact) continue;
    if (runId && artifact.runId !== runId) continue;
    decisions.push({
      ...artifact,
      artifactPath: path.join(decisionDir, entry.name),
    });
  }

  return decisions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
