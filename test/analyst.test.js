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

test('policy analyst crowns a provisional cold-start champion from prompt-win evidence', () => {
  const recommendation = createPolicyRecommendation({
    runId: 'run-bootstrap',
    state: { currentChampion: null },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    experimentPlan: { focusParameterIds: ['p01'], competitionMode: 'cold_start_duel' },
    candidateDuel: fakeEval({ winner: 'tie', scoreDelta: 0, skillAWins: 8, skillBWins: 2 }),
  });

  assert.equal(recommendation.decision, 'promote');
  assert.equal(recommendation.recommendedChampionCandidateId, 'candidate-a');
  assert.equal(recommendation.confidence, 'low');
  assert.equal(recommendation.resultSummary.provisionalBootstrap, true);
  assert.match(recommendation.reasoning, /provisional first champion/i);
});

test('policy analyst still leaves cold start without champion when there is no usable signal', () => {
  const recommendation = createPolicyRecommendation({
    runId: 'run-no-signal',
    state: { currentChampion: null },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    experimentPlan: { focusParameterIds: ['p01'], competitionMode: 'cold_start_duel' },
    candidateDuel: fakeEval({ winner: 'tie', scoreDelta: 0, skillAWins: 0, skillBWins: 0, ties: 6 }),
  });

  assert.equal(recommendation.decision, 'request_new_experiment');
  assert.equal(recommendation.recommendedChampionCandidateId, null);
});

test('real analyst cannot veto a deterministic provisional cold-start champion', async () => {
  const recommendation = await analyzeRun({
    mode: 'real',
    runId: 'run-real-bootstrap',
    goal: 'Help agents design better UX.',
    state: { currentChampion: null },
    history: { trajectory: [], parameterLog: [] },
    ontology: null,
    parameterization: { summary: 'Test activation.' },
    experimentPlan: { focusParameterIds: ['p01'], competitionMode: 'cold_start_duel' },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    candidateDuel: fakeEval({ winner: 'tie', scoreDelta: 0, skillAWins: 8, skillBWins: 2 }),
    model: 'fake-analyst',
    modelClient: async () => JSON.stringify({
      decision: 'request_new_experiment',
      recommendedChampionCandidateId: null,
      confidence: 'low',
      reasoning: 'Close aggregate result.',
      observations: ['Analyst is cautious.'],
      nextRoundGuidance: {
        vary: 'x',
        preserve: 'y',
        investigate: 'z',
      },
    }),
  });

  assert.equal(recommendation.decision, 'promote');
  assert.equal(recommendation.recommendedChampionCandidateId, 'candidate-a');
  assert.equal(recommendation.resultSummary.provisionalBootstrap, true);
  assert.ok(recommendation.observations.some(item => item.includes('provisional champion')));
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
    challenge: fakeEval({ winner: 'skillA', scoreDelta: 1, skillAWins: 5, skillBWins: 5 }),
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

test('policy analyst does not promote when current champion wins challenge', () => {
  const recommendation = createPolicyRecommendation({
    runId: 'run-003',
    state: { currentChampion: { skillHash: 'abc' } },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    experimentPlan: { focusParameterIds: ['p01'] },
    candidateDuel: fakeEval({ winner: 'skillA', scoreDelta: 10, skillAWins: 8, skillBWins: 2 }),
    challenge: fakeEval({ winner: 'skillB', scoreDelta: -10, skillAWins: 2, skillBWins: 8 }),
    promotion: { minScoreDelta: 4, minWinDelta: 2, maxStablePromptRegression: 2 },
  });

  assert.equal(recommendation.decision, 'keep_current');
  assert.equal(recommendation.recommendedChampionCandidateId, null);
  assert.match(recommendation.reasoning, /current champion stays/i);
});

test('policy analyst blocks promotion when stable prompts show critical regression', () => {
  const challenge = fakeEval({ winner: 'skillA', scoreDelta: 10, skillAWins: 8, skillBWins: 2 });
  challenge.evaluations[0] = {
    ...challenge.evaluations[0],
    prompt: {
      ...challenge.evaluations[0].prompt,
      bucket: 'stable',
      id: 'stable-critical',
    },
    judge: {
      winner: 'skillB',
      scoreA: 1,
      scoreB: 5,
      reasoning: 'Candidate missed a critical stable behavior.',
    },
  };

  const recommendation = createPolicyRecommendation({
    runId: 'run-004',
    state: { currentChampion: { skillHash: 'abc' } },
    candidateA: { candidateId: 'candidate-a', strategy: 'A' },
    candidateB: { candidateId: 'candidate-b', strategy: 'B' },
    experimentPlan: { focusParameterIds: ['p01'] },
    candidateDuel: fakeEval({ winner: 'skillA', scoreDelta: 10, skillAWins: 8, skillBWins: 2 }),
    challenge,
    promotion: { minScoreDelta: 4, minWinDelta: 2, maxStablePromptRegression: 2 },
  });

  assert.equal(recommendation.decision, 'keep_current');
  assert.equal(recommendation.recommendedChampionCandidateId, null);
  assert.equal(recommendation.resultSummary.criticalRegressions.length, 1);
  assert.equal(recommendation.resultSummary.criticalRegressions[0].promptId, 'stable-critical');
  assert.ok(recommendation.observations.some(item => item.includes('Stable-prompt regression blocked promotion')));
});

function fakeEval({ winner, scoreDelta, skillAWins, skillBWins, ties = 0 }) {
  const totalEvals = skillAWins + skillBWins + ties;
  return {
    runId: 'eval-001',
    mode: 'mock',
    stats: {
      winner,
      scoreDelta,
      skillAWins,
      skillBWins,
      ties,
      totalEvals,
      totalScoreA: 30 + scoreDelta,
      totalScoreB: 30,
      confidence: {
        completionRate: 1,
      },
    },
    evaluations: Array.from({ length: totalEvals }, (_, index) => ({
      prompt: {
        id: `p${index + 1}`,
        bucket: index < 6 ? 'stable' : 'exploration',
        parameterIds: ['p01'],
      },
      judge: {
        winner: index < skillAWins ? 'skillA' : index < skillAWins + skillBWins ? 'skillB' : 'tie',
        scoreA: 4,
        scoreB: index < skillAWins + skillBWins ? 3 : 4,
        reasoning: 'Injected judge reasoning.',
      },
    })),
  };
}
