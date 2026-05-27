import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRun, createPolicyRecommendation } from '../src/lib/analyst.js';

test('policy analyst promotes only when score and win deltas clear threshold', () => {
  const recommendation = createPolicyRecommendation({
    runId: 'run-001',
    state: { currentChampion: null },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    experimentPlan: { focusParameterIds: ['p01'] },
    candidateDuel: fakeEval({ winner: 'skillA', scoreDelta: 6, skillAWins: 7, skillBWins: 3 }),
  });

  assert.equal(recommendation.decision, 'promote');
  assert.equal(recommendation.recommendedChampionCandidateId, 'candidate-a');
  assert.equal(recommendation.confidence, 'high');
});

test('real analyst recommendation cannot bypass deterministic policy block', async () => {
  const recommendation = await analyzeRun({
    mode: 'real',
    runId: 'run-002',
    goal: 'Help agents design better UX.',
    state: { currentChampion: { skillHash: 'abc' } },
    history: { trajectory: [], parameterLog: [] },
    ontology: null,
    parameterization: { summary: 'Test activation.' },
    experimentPlan: { focusParameterIds: ['p01'] },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    candidateDuel: fakeEval({ winner: 'skillA', scoreDelta: 1, skillAWins: 5, skillBWins: 5 }),
    championGate: fakeEval({ winner: 'skillA', scoreDelta: 1, skillAWins: 5, skillBWins: 5 }),
    model: 'fake-analyst',
    modelClient: async () => JSON.stringify({
      decision: 'promote',
      recommendedChampionCandidateId: 'candidate-a',
      confidence: 'high',
      reasoning: 'Looks good.',
      observations: ['Analyst wants promotion.'],
      nextRoundGuidance: {
        vary: 'x',
        preserve: 'y',
        investigate: 'z',
      },
    }),
  });

  assert.equal(recommendation.decision, 'keep_current');
  assert.equal(recommendation.recommendedChampionCandidateId, null);
  assert.match(recommendation.reasoning, /champion stays|clear enough margin/i);
});

function fakeEval({ winner, scoreDelta, skillAWins, skillBWins }) {
  const totalEvals = skillAWins + skillBWins;
  return {
    runId: 'eval-001',
    mode: 'mock',
    stats: {
      winner,
      scoreDelta,
      skillAWins,
      skillBWins,
      ties: 0,
      totalEvals,
      totalScoreA: 30 + scoreDelta,
      totalScoreB: 30,
    },
    evaluations: Array.from({ length: totalEvals }, (_, index) => ({
      prompt: {
        id: `p${index + 1}`,
        bucket: index < 6 ? 'stable' : 'exploration',
        parameterIds: ['p01'],
      },
      judge: {
        winner: index < skillAWins ? 'skillA' : 'skillB',
        scoreA: 4,
        scoreB: 3,
        reasoning: 'Injected judge reasoning.',
      },
    })),
  };
}
