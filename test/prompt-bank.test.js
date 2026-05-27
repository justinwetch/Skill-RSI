import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPromptBankUpdates, diagnoseEvalPrompts } from '../src/lib/prompt-bank.js';

test('prompt diagnostics promote useful exploration prompts and retire weak prompts', () => {
  const diagnostics = diagnoseEvalPrompts(fakeEvalRun());

  assert.deepEqual(diagnostics.promotePromptIds, ['explore-strong']);
  assert.ok(diagnostics.retirePromptIds.includes('stable-tie'));
  assert.ok(diagnostics.retirePromptIds.includes('explore-no-parameter'));
});

test('prompt bank update promotes exploration prompts, retires weak prompts, and caps stable prompts', () => {
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
    evalRun: fakeEvalRun(),
    recommendation: {
      promptBankRecommendations: {
        promotePromptIds: ['explore-strong'],
        retirePromptIds: ['stable-tie'],
        promptBankNotes: ['Analyst note.'],
      },
    },
    runId: 'run-002',
  });

  assert.ok(next.stablePromptIds.includes('explore-strong'));
  assert.equal(next.stablePromptIds.length, 6);
  assert.ok(!next.stablePromptIds.includes('stable-tie'));
  assert.ok(next.retired.some(item => item.promptId === 'stable-tie'));
  assert.ok(update.promotedPromptIds.includes('explore-strong'));
  assert.ok(update.retiredPromptIds.includes('stable-tie'));
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
