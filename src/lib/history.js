import path from 'node:path';
import { writeJson, writeText } from './store.js';
import { validateHistoryIndex } from './schema.js';

export async function appendHistory({ paths, history, state, runRecord, recommendation, parameterization, scoreDelta }) {
  const tested = runRecord.experimentPlan.focusParameterIds;
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
      },
    ],
    parameterLog: updateParameterLog(history.parameterLog, tested, recommendation),
  };

  validateHistoryIndex(nextHistory);
  await writeJson(paths.historyIndex, nextHistory);
  await writeText(paths.historySummary, renderSummary({ history: nextHistory, state, recommendation, parameterization }));
  await writeText(
    path.join(paths.historyDetailedDir, `${runRecord.runId}.md`),
    renderDetailedRun({ runRecord, recommendation, parameterization })
  );

  return nextHistory;
}

function updateParameterLog(existing, tested, recommendation) {
  const byId = new Map(existing.map(item => [item.parameterId, { ...item }]));

  for (const parameterId of tested) {
    const current = byId.get(parameterId) || {
      parameterId,
      testedInRuns: [],
      currentBelief: 'untested',
      status: 'inconclusive',
    };

    current.testedInRuns = [...current.testedInRuns, recommendation.runId];
    current.currentBelief = recommendation.reasoning;
    current.status = recommendation.decision === 'promote' ? 'promising' : 'inconclusive';
    byId.set(parameterId, current);
  }

  return [...byId.values()];
}

function renderSummary({ history, state, recommendation, parameterization }) {
  const champion = state.currentChampion
    ? `${state.currentChampion.runId}/${state.currentChampion.candidateId}/${state.currentChampion.skillHash.slice(0, 12)}`
    : 'none';

  return `# Current Summary

Initial goal: ${history.skillGoal}
Current champion: ${champion}
Current strengths: ${formatList(recommendation.observations)}
Known weaknesses: inspect the run report, eval artifacts, and analyst notes for unresolved regressions or low-confidence areas
Highest-leverage parameter hypotheses: ${formatList(parameterization.highestLeverageHypotheses)}
Recent decision: ${recommendation.decision}
Do not repeat: none yet
Next experiment notes: ${recommendation.nextRoundGuidance.investigate}
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

function renderDetailedRun({ runRecord, recommendation, parameterization }) {
  return `# ${runRecord.runId}

Decision: ${recommendation.decision}
Confidence: ${recommendation.confidence}

## Parameters Tested

${runRecord.experimentPlan.focusParameterIds.map(id => `- ${id}`).join('\n')}

## Parameterization Summary

${parameterization.summary}

## Recommendation

${recommendation.reasoning}
`;
}
