import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { getProjectPaths, getRunPaths } from './paths.js';
import { initProject } from './init.js';
import { loadSkillPackage, materializeSkillPackage } from './skill-package.js';
import { appendTimeline, readTimeline } from './timeline.js';
import { ensureDir, hashDirectory, pathExists, readJson, writeJson, writeText } from './store.js';
import { loadProjectConfig } from './config.js';
import { normalizeTaskContract, taskContractOutputType } from './task-contracts.js';

const MAX_BASELINE_ZIP_BYTES = 25 * 1024 * 1024;
const UI_OUTPUT_TYPES = ['text', 'code', 'code_visual'];

export async function createProjectForUi({
  cwd,
  projectName,
  goal,
  targetIterations = 3,
  triggerMode = 'manual',
  outputType = 'text',
  baselineFiles = [],
  baselineArchive = null,
}) {
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
  const normalizedTaskContract = normalizeTaskContract(null, outputType);
  const normalizedOutputType = UI_OUTPUT_TYPES.includes(taskContractOutputType(normalizedTaskContract))
    ? taskContractOutputType(normalizedTaskContract)
    : 'text';
  const paths = getProjectPaths(cwd, projectName);
  if (await pathExists(paths.stateJson)) {
    const error = new Error(`Project "${paths.projectId}" already exists`);
    error.statusCode = 409;
    throw error;
  }
  const normalizedBaselineFiles = normalizeBaselineFiles(baselineFiles);
  const normalizedBaselineArchive = normalizeBaselineArchive(baselineArchive);
  if (normalizedBaselineFiles.length && normalizedBaselineArchive) {
    throw badRequest('Choose either a baseline folder or a baseline zip, not both');
  }
  const preflightSource = normalizedBaselineArchive || normalizedBaselineFiles.length
    ? await preflightBaselineSkill({
      cwd,
      files: normalizedBaselineFiles,
      archive: normalizedBaselineArchive,
    })
    : null;

  try {
    await initProject({
      cwd,
      projectName,
      goal,
      runPolicy: {
        triggerMode,
        targetIterations: normalizedTargetIterations,
      },
      evalOutputType: normalizedOutputType,
      taskContract: normalizedTaskContract,
    });
    if (preflightSource) await installBaselineSkill({ paths, sourcePath: preflightSource.sourcePath });
    return readProjectSummary({ cwd, projectName });
  } finally {
    if (preflightSource) await fs.rm(preflightSource.tmpDir, { recursive: true, force: true });
  }
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
        taskContract: config.eval.taskContract,
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
      nextLoopPremise: buildNextLoopPremise(history),
    },
    promptBank: promptBank ? {
      currentRunId: promptBank.currentRunId || null,
      stablePromptCount: promptBank.stablePromptIds?.length || 0,
      provisionalPromptCount: promptBank.provisionalPromptIds?.length || promptBank.provisionalPrompts?.length || 0,
      explorationPromptCount: promptBank.explorationPrompts?.length || promptBank.explorationPromptIds?.length || 0,
      retiredPromptCount: promptBank.retired?.length || 0,
      evidenceRecordCount: Object.keys(promptBank.promptEvidence || {}).length,
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
    challenge,
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
    readJson(runPaths.challengeJson, null),
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
      challenge,
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
      candidateDuelJson: candidateDuel ? runPaths.candidateDuelJson : null,
      challengeJson: challenge ? runPaths.challengeJson : null,
      recommendationJson: runPaths.recommendationJson,
      reportMd: runPaths.reportMd,
    },
  };
}

export async function readRunComparison({ cwd, projectName, runId = null }) {
  const detail = await readRunDetail({ cwd, projectName, runId });
  const paths = getProjectPaths(cwd, projectName);
  const runPaths = getRunPaths(paths, detail.runId);
  const candidateDuel = detail.evals.candidateDuel;
  const challenge = detail.evals.challenge;
  const competitionMode = detail.experimentPlan?.competitionMode || detail.run?.competitionMode || 'cold_start_duel';

  return {
    schemaVersion: 1,
    projectId: detail.projectId,
    runId: detail.runId,
    competitionMode,
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
      champion: await summarizeComparableSkill({
        label: 'champion',
        candidate: null,
        skillPath: await pathExists(path.join(runPaths.championDir, 'SKILL.md')) ? runPaths.championDir
          : await pathExists(path.join(paths.championSkillDir, 'SKILL.md')) ? paths.championSkillDir : null,
      }),
      challenger: await summarizeComparableSkill({
        label: 'challenger',
        candidate: detail.candidates.challenger,
        skillPath: detail.candidates.challenger?.skillPath,
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
      challenge: challenge ? {
        winner: challenge.stats.winner,
        scoreDelta: challenge.stats.scoreDelta,
        wins: {
          skillA: challenge.stats.skillAWins,
          skillB: challenge.stats.skillBWins,
          ties: challenge.stats.ties,
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
    ? (await readTimeline(runPaths.timelineJsonl)).map(entry => ({ timestamp: entry.timestamp, event: entry.event, details: entry.details || {} }))
    : [];
  const completed = run?.status === 'completed' || events.some(entry => entry.event === 'run.completed');
  return {
    schemaVersion: 1,
    projectId: paths.projectId,
    runId,
    runNumber: run?.runNumber ?? null,
    competitionMode: run?.competitionMode || run?.experimentPlan?.competitionMode || null,
    status: completed ? 'completed' : (run?.status || 'running'),
    startedAt: run?.startedAt || null,
    completedAt: run?.completedAt || null,
    events,
    stageDetails: await summarizeProgressArtifacts(runPaths),
  };
}

function normalizeBaselineFiles(files) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const normalized = files.map(file => {
    const relativePath = normalizeBaselinePath(file?.path || file?.name || '');
    const content = file?.content;
    if (typeof content !== 'string') throw badRequest(`Baseline file "${relativePath}" must be text`);
    return { path: relativePath, content };
  });
  return stripUploadedFolderRoot(normalized);
}

function normalizeBaselineArchive(archive) {
  if (!archive) return null;
  const name = typeof archive.name === 'string' && archive.name.trim() ? archive.name.trim() : 'baseline.zip';
  if (!name.toLowerCase().endsWith('.zip')) throw badRequest('Baseline archive must be a .zip file');
  if (typeof archive.contentBase64 !== 'string' || !archive.contentBase64.trim()) {
    throw badRequest('Baseline archive content is required');
  }
  const compact = archive.contentBase64.replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    throw badRequest('Baseline archive content must be valid base64');
  }
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.length === 0) throw badRequest('Baseline archive is empty');
  if (bytes.length > MAX_BASELINE_ZIP_BYTES) {
    throw badRequest(`Baseline archive is too large. Maximum supported size is ${Math.round(MAX_BASELINE_ZIP_BYTES / 1024 / 1024)} MB.`);
  }
  return {
    name: path.basename(name),
    bytes,
  };
}

function normalizeBaselinePath(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw badRequest('Baseline file path is required');
  }
  const normalized = path.normalize(filePath.trim().replaceAll('\\', '/')).replaceAll(path.sep, '/');
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || /^[a-z]:/i.test(normalized)) {
    throw badRequest(`Baseline file path cannot leave the skill package: ${filePath}`);
  }
  return normalized;
}

function stripUploadedFolderRoot(files) {
  if (files.some(file => file.path === 'SKILL.md')) return files;
  const skillEntrypoints = files.filter(file => /(^|\/)SKILL\.md$/i.test(file.path));
  if (skillEntrypoints.length !== 1) return files;
  const skillDir = path.posix.dirname(skillEntrypoints[0].path);
  if (!skillDir || skillDir === '.') return files;
  const prefix = `${skillDir}/`;
  if (!files.every(file => file.path === skillDir || file.path.startsWith(prefix))) return files;
  return files.map(file => ({ ...file, path: file.path.slice(prefix.length) }));
}

async function preflightBaselineSkill({ cwd, files = [], archive = null }) {
  const tmpRoot = path.join(cwd, '.skill-rsi', 'tmp');
  await ensureDir(tmpRoot);
  const tmpDir = await fs.mkdtemp(path.join(tmpRoot, 'baseline-'));
  try {
    const sourcePath = archive
      ? await writeBaselineArchive(tmpDir, archive)
      : await writeBaselineFiles(tmpDir, files);
    const skillPackage = await loadSkillPackage(sourcePath);
    if (!skillPackage.validation.valid) {
      throw badRequest(`Baseline skill is invalid: ${skillPackage.validation.errors.join('; ')}`);
    }
    return { tmpDir, sourcePath };
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (error.statusCode) throw error;
    throw badRequest(`Baseline skill could not be loaded: ${error.message}`);
  }
}

async function installBaselineSkill({ paths, sourcePath }) {
  const skillPackage = await loadSkillPackage(sourcePath);
  await materializeSkillPackage(skillPackage, paths.championSkillDir);
  const skillHash = await hashDirectory(paths.championSkillDir);
  const state = await readJson(paths.stateJson);
  const history = await readJson(paths.historyIndex);
  const now = new Date().toISOString();
  const currentChampion = {
    runId: 'baseline-upload',
    candidateId: 'baseline',
    skillHash,
    skillPath: paths.championSkillDir,
    source: 'uploaded-baseline',
  };
  await writeJson(paths.stateJson, {
    ...state,
    currentChampion,
    updatedAt: now,
  });
  await writeJson(paths.historyIndex, {
    ...history,
    currentChampion,
    baseline: {
      source: 'uploaded-baseline',
      importedAt: now,
      skillHash,
    },
  });
  await writeJson(path.join(paths.projectDir, 'baseline.json'), {
    source: 'uploaded-baseline',
    importedAt: now,
    skillHash,
    championSkillDir: paths.championSkillDir,
  });
}

async function writeBaselineFiles(destinationDir, files) {
  for (const file of files) {
    await writeText(path.join(destinationDir, file.path), file.content);
  }
  return destinationDir;
}

async function writeBaselineArchive(destinationDir, archive) {
  const archivePath = path.join(destinationDir, archive.name);
  await fs.writeFile(archivePath, archive.bytes);
  return archivePath;
}

function buildNextLoopPremise(history) {
  const notes = Array.isArray(history.recentNextExperimentNotes) ? history.recentNextExperimentNotes.filter(Boolean) : [];
  if (!notes.length) return null;
  const sourceRun = history.trajectory?.at?.(-1) || null;
  return {
    sourceRunId: sourceRun?.runId || null,
    sourceDecision: sourceRun?.decision || null,
    notes,
  };
}

async function summarizeProgressArtifacts(runPaths) {
  const [
    research,
    ontologyQuality,
    deconstructionQuality,
    parameterization,
    manager,
    experimentPlan,
    reviewA,
    reviewB,
    reviewChallenger,
    candidateDuel,
    challenge,
    recommendation,
  ] = await Promise.all([
    readJson(runPaths.researchPacketJson, null),
    readJson(runPaths.ontologyQualityReportJson, null),
    readJson(runPaths.deconstructionQualityReportJson, null),
    readJson(runPaths.parameterizationJson, null),
    readJson(runPaths.managerJson, null),
    readJson(runPaths.experimentPlanJson, null),
    readJson(path.join(runPaths.candidateADir, 'review.json'), null),
    readJson(path.join(runPaths.candidateBDir, 'review.json'), null),
    readJson(path.join(runPaths.challengerDir, 'review.json'), null),
    readJson(runPaths.candidateDuelJson, null),
    readJson(runPaths.challengeJson, null),
    readJson(runPaths.recommendationJson, null),
  ]);
  const coldStart = experimentPlan?.competitionMode === 'cold_start_duel';

  return {
    deconstruct: [
      research ? `Research: ${research.researchMode}, ${research.sources?.length || 0} source(s), authorities: ${listNames(research.authorityMap)}` : null,
      ontologyQuality ? `Ontology quality: ${ontologyQuality.status} (${ontologyQuality.issues?.length || 0} issue(s), ${ontologyQuality.warnings?.length || 0} warning(s))` : null,
      deconstructionQuality ? `Deconstruction quality: ${deconstructionQuality.status} (${deconstructionQuality.issues?.length || 0} issue(s), ${deconstructionQuality.warnings?.length || 0} warning(s))` : null,
      parameterization ? `Parameters: ${(parameterization.parameters || []).length}; top: ${listParameterSurfaces(parameterization)}` : null,
    ].filter(Boolean),
    plan: [
      manager?.nextLoopPremise?.notes?.length ? `Premise: ${manager.nextLoopPremise.notes.join(' | ')}` : null,
      manager?.strategy ? `Strategy: ${manager.strategy.posture}; ${manager.strategy.experimentFamily}` : null,
      experimentPlan?.competitionMode ? `Competition: ${experimentPlan.competitionMode}` : null,
      experimentPlan ? `Question: ${experimentPlan.experimentQuestion}` : null,
      experimentPlan ? (coldStart
        ? `Arms: ${experimentPlan.arms?.candidateA?.strategyName || 'A'} vs ${experimentPlan.arms?.candidateB?.strategyName || 'B'}`
        : `Challenge: ${experimentPlan.arms?.challenger?.strategyName || 'planned'} vs current champion`) : null,
    ].filter(Boolean),
    generate: [
      experimentPlan ? (coldStart
        ? `Candidate A: ${experimentPlan.arms?.candidateA?.strategyName || 'planned'}`
        : `Challenger: ${experimentPlan.arms?.challenger?.strategyName || 'planned'}`) : null,
      experimentPlan && coldStart ? `Candidate B: ${experimentPlan.arms?.candidateB?.strategyName || 'planned'}` : null,
    ].filter(Boolean),
    review: [
      reviewA ? `Candidate A review: ${reviewA.approveForEval ? 'approved' : 'blocked'}; ${reviewA.blockingIssues?.length || 0} blocking issue(s)` : null,
      reviewB ? `Candidate B review: ${reviewB.approveForEval ? 'approved' : 'blocked'}; ${reviewB.blockingIssues?.length || 0} blocking issue(s)` : null,
      reviewChallenger ? `Challenger review: ${reviewChallenger.approveForEval ? 'approved' : 'blocked'}; ${reviewChallenger.blockingIssues?.length || 0} blocking issue(s)` : null,
    ].filter(Boolean),
    evaluate: [
      candidateDuel ? `Candidate duel: ${formatEvalOutcome(candidateDuel, {
        skillA: 'Candidate A',
        skillB: 'Candidate B',
      })}` : null,
      challenge ? `Champion challenge: ${formatEvalOutcome(challenge, {
        skillA: 'Challenger',
        skillB: 'Current champion',
      })}` : null,
    ].filter(Boolean),
    decide: [
      recommendation ? `Decision: ${recommendation.decision} (${recommendation.confidence} confidence)` : null,
      recommendation?.nextRoundGuidance?.vary ? `Try next: ${recommendation.nextRoundGuidance.vary}` : null,
    ].filter(Boolean),
  };
}

function formatEvalOutcome(evalRun, labels = {}) {
  const winner = evalRun?.stats?.winner || 'unknown';
  const delta = evalRun?.stats?.scoreDelta;
  const label = labels[winner] || winner;
  if (winner === 'tie') return 'tie';
  if (!Number.isFinite(delta)) return `${label}, margin n/a`;
  return `${label} by ${Math.abs(delta)}`;
}

function listNames(items = []) {
  const names = items.map(item => item?.name).filter(Boolean).slice(0, 3);
  return names.length ? names.join(', ') : 'none';
}

function listParameterSurfaces(parameterization) {
  const surfaces = (parameterization.parameters || [])
    .slice(0, 3)
    .map(parameter => parameter.surface || parameter.id)
    .filter(Boolean);
  return surfaces.length ? surfaces.join(', ') : 'none';
}

export async function readSkillContent({ cwd, projectName, source = 'champion', runId = null }) {
  const paths = getProjectPaths(cwd, projectName);
  let skillDir;
  let resolvedRunId = null;

  if (source === 'champion') {
    if (runId) {
      resolvedRunId = runId;
      const runPaths = getRunPaths(paths, resolvedRunId);
      skillDir = await pathExists(path.join(runPaths.championDir, 'SKILL.md'))
        ? runPaths.championDir
        : paths.championSkillDir;
    } else {
      skillDir = paths.championSkillDir;
    }
  } else if (source === 'candidate-a' || source === 'candidate-b' || source === 'challenger') {
    const state = await readRequiredJson(paths.stateJson, `Project "${paths.projectId}" has not been initialized`);
    resolvedRunId = runId || state.lastRunId;
    if (!resolvedRunId) throw new Error(`Project "${paths.projectId}" has no runs`);
    const runPaths = getRunPaths(paths, resolvedRunId);
    const candidateDir = source === 'challenger' ? runPaths.challengerDir : source === 'candidate-a' ? runPaths.candidateADir : runPaths.candidateBDir;
    skillDir = path.join(candidateDir, 'skill');
  } else {
    throw badRequest('source must be champion, challenger, candidate-a, or candidate-b');
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
    challenger: run?.challenger || candidates.find(candidate => candidate.candidateId === 'challenger') || null,
  };
}

async function readCandidateReviews(runPaths) {
  const candidateAReview = await readJson(path.join(runPaths.candidateADir, 'review.json'), null);
  const candidateBReview = await readJson(path.join(runPaths.candidateBDir, 'review.json'), null);
  const challengerReview = await readJson(path.join(runPaths.challengerDir, 'review.json'), null);
  return {
    candidateA: candidateAReview,
    candidateB: candidateBReview,
    challenger: challengerReview,
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
