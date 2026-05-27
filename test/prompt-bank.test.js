import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPromptBankUpdates, diagnoseEvalPrompts } from '../src/lib/prompt-bank.js';

test('prompt diagnostics make useful duel prompts provisional and keep stable ties', () => {
  const diagnostics = diagnoseEvalPrompts(fakeEvalRun());

  assert.deepEqual(diagnostics.promotePromptIds, []);
  assert.deepEqual(diagnostics.provisionalPromptIds, ['explore-strong']);
  assert.ok(!diagnostics.retirePromptIds.includes('stable-tie'));
  assert.ok(diagnostics.retirePromptIds.includes('explore-no-parameter'));
});

test('prompt bank update requires challenge evidence before stable promotion', () => {
  const bank = {
    stablePromptCount: 6,
    stablePromptIds: ['s1', 's2', 's3', 's4', 's5', 's6'],
    explorationPromptIds: ['old-e1'],
    stablePrompts: ['s1', 's2', 's3', 's4', 's5', 's6'].map(id => prompt(id, 'stable')),
    explorationPrompts: [prompt('old-e1', 'exploration')],
    retired: [],
  };

  const { bank: next, update } = applyPromptBankUpdates({
    bank,
    candidateDuel: fakeEvalRun(),
    recommendation: {
      promptBankRecommendations: {
        promotePromptIds: ['explore-strong'],
        retirePromptIds: ['stable-tie'],
        promptBankNotes: ['Analyst note.'],
      },
    },
    runId: 'run-002',
  });

  assert.ok(!next.stablePromptIds.includes('explore-strong'));
  assert.ok(next.provisionalPromptIds.includes('explore-strong'));
  assert.equal(next.stablePromptIds.length, 6);
  assert.ok(next.stablePromptIds.includes('s1'));
  assert.ok(!next.retired.some(item => item.promptId === 'stable-tie'));
  assert.ok(update.provisionalPromptIds.includes('explore-strong'));
  assert.ok(!update.promotedPromptIds.includes('explore-strong'));
  assert.ok(update.retiredPromptIds.includes('explore-no-parameter'));
  assert.equal(next.promptEvidence['explore-strong'].status, 'provisional');
});

test('challenge promotes provisional prompts to stable', () => {
  const bank = {
    stablePromptCount: 6,
    stablePromptIds: ['s1', 's2', 's3', 's4', 's5', 's6'],
    provisionalPromptIds: ['explore-strong'],
    explorationPromptIds: [],
    stablePrompts: ['s1', 's2', 's3', 's4', 's5', 's6'].map(id => prompt(id, 'stable')),
    provisionalPrompts: [prompt('explore-strong', 'provisional', ['p02'])],
    explorationPrompts: [],
    retired: [],
  };

  const { bank: next, update } = applyPromptBankUpdates({
    bank,
    candidateDuel: fakeEvalRun(),
    challenge: fakeChampionGate(),
    recommendation: { decision: 'promote', promptBankRecommendations: {} },
    runId: 'run-003',
  });

  assert.ok(next.stablePromptIds.includes('explore-strong'));
  assert.ok(!next.provisionalPromptIds.includes('explore-strong'));
  assert.ok(update.promotedPromptIds.includes('explore-strong'));
  assert.equal(next.promptEvidence['explore-strong'].status, 'stable');
  assert.equal(next.promptEvidence['explore-strong'].stableReason, 'challenge_confirmed');
});

function fakeEvalRun() {
  return {
    runId: 'eval-001',
    prompts: [
      prompt('stable-tie', 'stable'),
      prompt('explore-strong', 'exploration'),
      prompt('explore-no-parameter', 'exploration', []),
    ],
    evaluations: [
      evaluation('stable-tie', 'stable', ['p01'], 'tie', 3, 3, 'Tie.'),
      evaluation('explore-strong', 'exploration', ['p02'], 'skillA', 5, 2, 'Strong signal.'),
      evaluation('explore-no-parameter', 'exploration', [], 'skillB', 4, 2, 'Missing metadata.'),
    ],
  };
}

function fakeChampionGate() {
  return {
    runId: 'eval-002',
    prompts: [
      prompt('explore-strong', 'provisional', ['p02']),
    ],
    evaluations: [
      evaluation('explore-strong', 'provisional', ['p02'], 'skillA', 5, 2, 'Strong challenge signal.'),
    ],
  };
}

function prompt(id, bucket, parameterIds = ['p01']) {
  return {
    id,
    bucket,
    text: `Prompt ${id}`,
    parameterIds,
    difficulty: 'medium',
  };
}

function evaluation(id, bucket, parameterIds, winner, scoreA, scoreB, reasoning) {
  return {
    prompt: prompt(id, bucket, parameterIds),
    judge: {
      winner,
      scoreA,
      scoreB,
      reasoning,
    },
  };
}
