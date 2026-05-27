import path from 'node:path';
import fs from 'node:fs/promises';
import { getRunPaths } from './paths.js';
import { readJson, writeJson, writeText } from './store.js';
import { validateHistoryIndex } from './schema.js';

export async function appendHistory({ paths, history, state, runRecord, recommendation, parameterization, scoreDelta }) {
  const runPaths = getRunPaths(paths, runRecord.runId);
  const artifacts = await collectHistoryArtifacts(runPaths);
  const tested = Array.isArray(runRecord.experimentPlan?.focusParameterIds)
    ? runRecord.experimentPlan.focusParameterIds
    : [];
  const parameterLog = updateParameterLog(history.parameterLog || [], tested, recommendation, {
    runRecord,
    parameterization,
    scoreDelta,
    artifacts,
  });
  const failedStrategyLog = updateFailedStrategyLog(history.failedStrategyLog || [], {
    runRecord,
    recommendation,
    artifacts,
  });
  const knownWeaknesses = updateKnownWeaknesses(history.knownWeaknesses || [], {
    runRecord,
    recommendation,
    artifacts,
  });
  const doNotRepeat = updateDoNotRepeat(history.doNotRepeat || [], parameterLog, failedStrategyLog);

  const nextHistory = {
    ...history,
    currentChampion: state.currentChampion,
    trajectory: [
      ...history.trajectory,
      {
        runId: runRecord.runId,
        decision: recommendation.decision,
        winner: recommendation.recommendedChampionCandidateId || 'current',
        scoreDelta,
        parameterTested: tested,
        hypothesisHeld: recommendation.decision === 'promote' ? true : null,
        summary: recommendation.reasoning,
        confidence: recommendation.confidence,
        reviewBlocked: Boolean(runRecord.reviewBlocked),
        evaluatorRunId: runRecord.evaluatorRunId || null,
        championGateRunId: runRecord.championGateRunId || null,
      },
    ],
    parameterLog,
    failedStrategyLog,
    knownWeaknesses,
    doNotRepeat,
    recentNextExperimentNotes: summarizeNextExperimentNotes(recommendation),
  };

  validateHistoryIndex(nextHistory);
  await writeJson(paths.historyIndex, nextHistory);
  await writeText(paths.historySummary, renderSummary({
    history: nextHistory,
    state,
    recommendation,
    parameterization,
  }));
  await writeText(
    path.join(paths.historyDetailedDir, `${runRecord.runId}.md`),
    renderDetailedRun({
      paths,
      runRecord,
      recommendation,
      parameterization,
      artifacts,
      parameterLog,
      scoreDelta,
    })
  );

  return nextHistory;
}

async function collectHistoryArtifacts(runPaths) {
  const [candidateDuel, championGate, promptBankUpdate, reviewA, reviewB] = await Promise.all([
    readJson(runPaths.candidateDuelJson, null),
    readJson(runPaths.championGateJson, null),
    readJson(runPaths.promptBankUpdateJson, null),
    readJson(path.join(runPaths.candidateADir, 'review.json'), null),
    readJson(path.join(runPaths.candidateBDir, 'review.json'), null),
  ]);

  return {
    candidateDuel,
    championGate,
    promptBankUpdate,
    reviews: {
      candidateA: reviewA,
      candidateB: reviewB,
    },
    creatorFailures: [
      ...(await collectCreatorFailures(runPaths.candidateADir, 'candidate-a')),
      ...(await collectCreatorFailures(runPaths.candidateBDir, 'candidate-b')),
    ],
  };
}

async function collectCreatorFailures(candidateDir, candidateId) {
  let entries;
  try {
    entries = await fs.readdir(candidateDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const failures = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/^creator-contract-failure-\d+\.json$/.test(entry.name)) continue;
    const artifact = await readJson(path.join(candidateDir, entry.name), null);
    if (artifact) failures.push({ ...artifact, candidateId, artifactName: entry.name });
  }
  return failures;
}

function updateParameterLog(existing, tested, recommendation, { runRecord, parameterization, scoreDelta, artifacts }) {
  const byId = new Map((existing || []).map(item => [item.parameterId, { ...item }]));
  const parameterLookup = new Map((parameterization?.parameters || []).map(parameter => [parameter.id, parameter]));

  for (const parameterId of tested) {
    const current = byId.get(parameterId) || {
      parameterId,
      testedInRuns: [],
      currentBelief: 'untested',
      status: 'inconclusive',
      outcomeCounts: { promote: 0, keep_current: 0, request_new_experiment: 0 },
      staleEvidence: [],
    };
    const priorCurrentEvidence = current.currentEvidence || null;
    const testedInRuns = unique([...(current.testedInRuns || []), recommendation.runId]);
    const outcomeCounts = {
      promote: current.outcomeCounts?.promote || 0,
      keep_current: current.outcomeCounts?.keep_current || 0,
      request_new_experiment: current.outcomeCounts?.request_new_experiment || 0,
    };
    outcomeCounts[recommendation.decision] = (outcomeCounts[recommendation.decision] || 0) + 1;
    const currentEvidence = createParameterEvidence({
      parameterId,
      parameter: parameterLookup.get(parameterId),
      runRecord,
      recommendation,
      scoreDelta,
      artifacts,
    });
    const staleEvidence = priorCurrentEvidence
      ? [priorCurrentEvidence, ...(current.staleEvidence || [])].slice(0, 8)
      : (current.staleEvidence || []);
    const nonPromotionTests = testedInRuns.length - outcomeCounts.promote;

    current.testedInRuns = testedInRuns;
    current.currentBelief = currentEvidence.summary;
    current.status = getParameterStatus({ recommendation, testedInRuns, outcomeCounts, nonPromotionTests });
    current.lastTestedRunId = recommendation.runId;
    current.lastDecision = recommendation.decision;
    current.currentEvidence = currentEvidence;
    current.staleEvidence = staleEvidence;
    current.outcomeCounts = outcomeCounts;
    byId.set(parameterId, current);
  }

  return [...byId.values()];
}

function createParameterEvidence({ parameterId, parameter, runRecord, recommendation, scoreDelta, artifacts }) {
  const decisiveEval = artifacts.championGate || artifacts.candidateDuel;
  const reviewBlocked = Boolean(runRecord.reviewBlocked);
  const weakSignals = normalizeList(recommendation.signalAssessment?.weakSignals);
  const likelyNoise = normalizeList(recommendation.signalAssessment?.likelyNoise);
  const inconclusive = normalizeList(recommendation.signalAssessment?.inconclusiveAreas);
  const criticalRegressions = normalizeList(recommendation.resultSummary?.criticalRegressions);
  const caveats = [...weakSignals, ...likelyNoise, ...inconclusive, ...criticalRegressions].slice(0, 8);
  const summary = recommendation.historySummary || recommendation.reasoning || `${recommendation.decision} on ${parameterId}`;

  return {
    runId: recommendation.runId,
    decision: recommendation.decision,
    confidence: recommendation.confidence,
    parameterSurface: parameter?.surface || parameterId,
    scoreDelta,
    evalWinner: decisiveEval?.stats?.winner || null,
    candidateDuelWinner: artifacts.candidateDuel?.stats?.winner || null,
    championGateWinner: artifacts.championGate?.stats?.winner || null,
    reviewBlocked,
    hypothesisHeld: recommendation.decision === 'promote' ? true : recommendation.decision === 'request_new_experiment' ? null : false,
    summary,
    caveats,
  };
}

function getParameterStatus({ recommendation, testedInRuns, outcomeCounts, nonPromotionTests }) {
  if (recommendation.decision === 'promote') return 'promising';
  if (nonPromotionTests >= 2 && outcomeCounts.promote === 0 && testedInRuns.length >= 2) {
    return 'do_not_retry_without_new_evidence';
  }
  if (recommendation.decision === 'keep_current') {
    return 'deprioritized';
  }
  return 'inconclusive';
}

function updateFailedStrategyLog(existing, { runRecord, recommendation, artifacts }) {
  const next = [...(existing || [])];

  for (const failure of artifacts.creatorFailures) {
    next.push({
      runId: runRecord.runId,
      source: 'creator_contract',
      candidateId: failure.candidateId,
      message: failure.message,
      status: runRecord.status === 'completed' ? 'recovered_or_contained' : 'failed',
      artifact: `runs/${runRecord.runId}/candidates/${failure.candidateId}/${failure.artifactName}`,
    });
  }

  for (const [candidateKey, review] of Object.entries(artifacts.reviews || {})) {
    if (!review || review.approveForEval) continue;
    const candidateId = candidateKey === 'candidateA' ? 'candidate-a' : 'candidate-b';
    for (const issue of review.blockingIssues || []) {
      next.push({
        runId: runRecord.runId,
        source: 'candidate_review',
        candidateId,
        message: `${issue.surface}: ${issue.message}`,
        status: 'blocked_eval',
        artifact: `runs/${runRecord.runId}/candidates/${candidateId}/review.json`,
      });
    }
  }

  if (recommendation.decision === 'request_new_experiment' && !runRecord.reviewBlocked && !artifacts.creatorFailures.length) {
    next.push({
      runId: runRecord.runId,
      source: 'experiment_signal',
      candidateId: null,
      message: recommendation.reasoning,
      status: 'inconclusive',
      artifact: `runs/${runRecord.runId}/analysis/recommendation.json`,
    });
  }

  return uniqueBy(next, item => `${item.runId}:${item.source}:${item.candidateId || 'none'}:${item.message}`).slice(-30);
}

function updateKnownWeaknesses(existing, { runRecord, recommendation, artifacts }) {
  const next = [...(existing || [])];
  const add = (source, message) => {
    if (!message) return;
    next.push({
      runId: runRecord.runId,
      source,
      message,
      status: recommendation.decision === 'promote' ? 'watch' : 'open',
    });
  };

  for (const item of normalizeList(recommendation.signalAssessment?.weakSignals)) add('weak_signal', item);
  for (const item of normalizeList(recommendation.signalAssessment?.likelyNoise)) add('likely_noise', item);
  for (const item of normalizeList(recommendation.signalAssessment?.inconclusiveAreas)) add('inconclusive_area', item);
  for (const item of normalizeList(recommendation.resultSummary?.criticalRegressions)) add('critical_regression', item);
  if (recommendation.decision !== 'promote' && next.length === (existing || []).length) {
    add('non_promotion', recommendation.reasoning);
  }

  for (const review of Object.values(artifacts.reviews || {})) {
    for (const issue of review?.blockingIssues || []) add('candidate_review', `${issue.surface}: ${issue.message}`);
  }

  return uniqueBy(next, item => `${item.source}:${item.message}`).slice(-30);
}

function updateDoNotRepeat(existing, parameterLog, failedStrategyLog) {
  const parameterWarnings = parameterLog
    .filter(item => item.status === 'do_not_retry_without_new_evidence')
    .map(item => `Do not retry ${item.parameterId} without new evidence; latest belief: ${item.currentBelief}`);
  const failedStrategies = failedStrategyLog
    .filter(item => item.status === 'blocked_eval' || item.status === 'inconclusive')
    .map(item => `${item.source}${item.candidateId ? `/${item.candidateId}` : ''}: ${item.message}`);

  return unique([...(existing || []), ...parameterWarnings, ...failedStrategies]).slice(-20);
}

function renderSummary({ history, state, recommendation, parameterization }) {
  const champion = state.currentChampion
    ? `${state.currentChampion.runId}/${state.currentChampion.candidateId}/${state.currentChampion.skillHash.slice(0, 12)}`
    : 'none';
  const recentParameterEvidence = (history.parameterLog || [])
    .slice(-5)
    .map(item => `${item.parameterId}: ${item.currentEvidence?.decision || item.lastDecision || 'unknown'} (${item.status})`);
  const failedStrategies = (history.failedStrategyLog || [])
    .slice(-5)
    .map(item => `${item.source}${item.candidateId ? `/${item.candidateId}` : ''}: ${item.message}`);

  return `# Current Summary

Initial goal: ${history.skillGoal}
Current champion: ${champion}
Recent decision: ${recommendation.decision} (${recommendation.confidence} confidence)
Current strengths: ${formatList([
    ...normalizeList(recommendation.signalAssessment?.strongSignals),
    ...normalizeList(recommendation.observations),
  ])}
Known weaknesses: ${formatList((history.knownWeaknesses || []).slice(-8))}
Highest-leverage parameter hypotheses: ${formatList(parameterization.highestLeverageHypotheses)}
Do not repeat: ${formatList(history.doNotRepeat)}
Next experiment notes: ${formatList(summarizeNextExperimentNotes(recommendation))}
Recent parameter evidence: ${formatList(recentParameterEvidence)}
Failed or recovered strategies: ${formatList(failedStrategies)}
Detailed artifacts: history/detailed/${recommendation.runId}.md
`;
}

function formatList(values) {
  if (!Array.isArray(values) || values.length === 0) return 'none recorded';
  return values.map(formatValue).join('; ');
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.hypothesis || value.summary || value.reason || value.id || JSON.stringify(value);
  }
  return String(value);
}

function renderDetailedRun({ paths, runRecord, recommendation, parameterization, artifacts, parameterLog, scoreDelta }) {
  const tested = Array.isArray(runRecord.experimentPlan?.focusParameterIds) ? runRecord.experimentPlan.focusParameterIds : [];
  const testedLog = tested
    .map(id => parameterLog.find(item => item.parameterId === id))
    .filter(Boolean);

  return `# ${runRecord.runId}

Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}
Score delta: ${scoreDelta ?? 'n/a'}

## Experiment

Question: ${runRecord.experimentPlan?.experimentQuestion || 'not recorded'}
Hypothesis: ${runRecord.experimentPlan?.hypothesis || 'not recorded'}

Candidate A: ${runRecord.experimentPlan?.arms?.candidateA?.strategyName || 'not recorded'}
Candidate B: ${runRecord.experimentPlan?.arms?.candidateB?.strategyName || 'not recorded'}

## Parameters Tested

${testedLog.length
    ? testedLog.map(item => `- ${item.parameterId}: ${item.status}; ${item.currentBelief}`).join('\n')
    : tested.map(id => `- ${id}`).join('\n') || 'None recorded'}

## Parameterization Summary

${parameterization.summary}

## Evaluation Summary

Candidate duel: ${formatEvalStats(artifacts.candidateDuel)}
Champion gate: ${formatEvalStats(artifacts.championGate)}

## Prompt Bank Changes

${formatPromptBankUpdate(artifacts.promptBankUpdate)}

## Candidate Reviews

${formatReviewSummary('candidate-a', artifacts.reviews.candidateA)}
${formatReviewSummary('candidate-b', artifacts.reviews.candidateB)}

## Failure And Recovery Notes

${formatFailureNotes(artifacts, runRecord)}

## Recommendation

${recommendation.reasoning}

## Next Notes

${formatList(summarizeNextExperimentNotes(recommendation))}

## Artifact Paths

- Run record: runs/${runRecord.runId}/run.json
- Timeline: runs/${runRecord.runId}/timeline.jsonl
- Experiment plan: runs/${runRecord.runId}/deconstruction/experiment-plan.json
- Parameterization: runs/${runRecord.runId}/deconstruction/parameterization.json
- Candidate duel: runs/${runRecord.runId}/eval/candidate-duel.json
- Champion gate: runs/${runRecord.runId}/eval/champion-gate.json
- Recommendation: runs/${runRecord.runId}/analysis/recommendation.json
- Champion skill: ${statefulChampionPath(paths)}
`;
}

function formatEvalStats(evalRun) {
  if (!evalRun) return 'not run';
  const stats = evalRun.stats || {};
  const total = stats.totalEvals ?? (Array.isArray(evalRun.evaluations) ? evalRun.evaluations.length : 'unknown');
  return `${evalRun.runId || 'eval'} winner=${stats.winner || 'unknown'}, scoreDelta=${stats.scoreDelta ?? 'n/a'}, wins=${stats.skillAWins ?? 0}/${stats.skillBWins ?? 0}, ties=${stats.ties ?? 0}, prompts=${total}`;
}

function formatPromptBankUpdate(update) {
  if (!update) return 'No prompt-bank update was recorded.';
  return [
    `Promoted prompts: ${formatList(update.promotedPromptIds)}`,
    `Retired prompts: ${formatList(update.retiredPromptIds)}`,
    `Stable prompts: ${formatList(update.stablePromptIds)}`,
    `Exploration prompts: ${formatList(update.explorationPromptIds)}`,
    `Diagnostics: ${formatList(update.diagnostics?.promptBankNotes)}`,
  ].join('\n');
}

function formatReviewSummary(candidateId, review) {
  if (!review) return `${candidateId}: no review recorded.`;
  return [
    `${candidateId}: approved=${review.approveForEval}, overfittingRisk=${review.overfittingRisk}`,
    `Blocking issues: ${formatList(review.blockingIssues)}`,
    `Recommended edits: ${formatList(review.recommendedEdits)}`,
  ].join('\n');
}

function formatFailureNotes(artifacts, runRecord) {
  const notes = [];
  for (const failure of artifacts.creatorFailures || []) {
    notes.push(`${failure.candidateId} creator contract attempt ${failure.attempt}: ${failure.message}`);
  }
  for (const [candidateKey, review] of Object.entries(artifacts.reviews || {})) {
    if (!review || review.approveForEval) continue;
    const candidateId = candidateKey === 'candidateA' ? 'candidate-a' : 'candidate-b';
    for (const issue of review.blockingIssues || []) {
      notes.push(`${candidateId} review blocked eval: ${issue.surface}: ${issue.message}`);
    }
  }
  if (runRecord.reviewBlocked) notes.push('Evaluation was skipped because candidate review blocked the run.');
  return formatList(notes);
}

function summarizeNextExperimentNotes(recommendation) {
  return unique([
    ...normalizeList(recommendation.nextExperimentNotes),
    recommendation.nextRoundGuidance?.vary ? `Try next: ${recommendation.nextRoundGuidance.vary}` : null,
    recommendation.nextRoundGuidance?.preserve ? `Preserve: ${recommendation.nextRoundGuidance.preserve}` : null,
    recommendation.nextRoundGuidance?.investigate ? `Investigate: ${recommendation.nextRoundGuidance.investigate}` : null,
    ...normalizeList(recommendation.actionableInsights),
  ]);
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(formatValue);
  return [formatValue(value)];
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function uniqueBy(values, keyFn) {
  const byKey = new Map();
  for (const value of values || []) {
    const key = keyFn(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()];
}

function statefulChampionPath(paths) {
  return path.relative(paths.projectDir, paths.championSkillDir) || paths.championSkillDir;
}
