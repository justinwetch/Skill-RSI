import test from 'node:test';
import assert from 'node:assert/strict';
import { designEvalBatch } from '../src/lib/eval-design.js';

test('evaluation designer creates stable and exploration prompts with criteria', () => {
  const design = designEvalBatch({
    runId: 'run-001',
    goal: 'Help agents design better UX.',
    ontology: {
      qualityAxes: ['activation precision', 'workflow clarity', 'validation usefulness'],
      targetTasks: ['critique a product flow', 'produce UX recommendations'],
    },
    parameterization: {
      parameters: [{
        id: 'p01-trigger-boundaries',
        surface: 'trigger boundaries',
        possibleMutations: ['add entry conditions'],
        measurementPlan: 'Check false positives and false negatives.',
      }],
    },
    experimentPlan: {
      focusParameterIds: ['p01-trigger-boundaries'],
    },
    history: { trajectory: [] },
  });

  assert.equal(design.prompts.length, 10);
  assert.equal(design.bank.stablePromptIds.length, 6);
  assert.equal(design.bank.provisionalPromptIds.length, 0);
  assert.equal(design.bank.explorationPromptIds.length, 4);
  assert.equal(design.bank.version, 3);
  assert.ok(design.criteria.length >= 4);
  assert.ok(design.criteria.length <= 6);
  assert.deepEqual(design.prompts[0].parameterIds, ['p01-trigger-boundaries']);
  assert.match(design.prompts[0].text, /Help agents design better UX/);
});

test('evaluation designer reuses stable prompts and appends exploration history', () => {
  const first = designEvalBatch({
    runId: 'run-001',
    goal: 'Help agents design better UX.',
    ontology: {
      qualityAxes: ['activation precision'],
      targetTasks: ['critique a product flow'],
    },
    parameterization: {
      parameters: [{
        id: 'p01-trigger-boundaries',
        surface: 'trigger boundaries',
        possibleMutations: ['add entry conditions'],
        measurementPlan: 'Check false positives and false negatives.',
      }],
    },
    experimentPlan: { focusParameterIds: ['p01-trigger-boundaries'] },
  });
  const second = designEvalBatch({
    runId: 'run-002',
    goal: 'Help agents design better UX.',
    ontology: {
      qualityAxes: ['activation precision'],
      targetTasks: ['critique a product flow'],
    },
    parameterization: {
      parameters: [{
        id: 'p02-validation',
        surface: 'validation strategy',
        possibleMutations: ['add checks'],
        measurementPlan: 'Check validation usefulness.',
      }],
    },
    experimentPlan: { focusParameterIds: ['p02-validation'] },
    previousBank: first.bank,
  });

  assert.deepEqual(second.bank.stablePromptIds, first.bank.stablePromptIds);
  assert.equal(second.prompts.filter(prompt => prompt.bucket === 'stable' && prompt.reusedFromBank).length, 6);
  assert.equal(second.bank.explorationPrompts.length, 8);
  assert.equal(second.bank.explorationPromptIds.length, 4);
  assert.ok(second.bank.criteriaVersion > first.bank.criteriaVersion);
  assert.ok(second.bank.criteriaVersions.length >= 2);
});

test('evaluation designer reuses provisional prompts for champion-gate confirmation', () => {
  const previousBank = {
    stablePrompts: [],
    provisionalPrompts: [{
      id: 'run-001-exploration-07',
      text: 'Prior useful probe.',
      parameterIds: ['p01-trigger-boundaries'],
      difficulty: 'hard',
      bucket: 'provisional',
      status: 'provisional',
    }],
    explorationPrompts: [],
    retired: [],
    criteriaVersions: [],
  };

  const design = designEvalBatch({
    runId: 'run-002',
    goal: 'Help agents design better UX.',
    ontology: {
      qualityAxes: ['activation precision'],
      targetTasks: ['critique a product flow'],
    },
    parameterization: {
      parameters: [{
        id: 'p01-trigger-boundaries',
        surface: 'trigger boundaries',
        possibleMutations: ['add entry conditions'],
        measurementPlan: 'Check false positives and false negatives.',
      }],
    },
    experimentPlan: { focusParameterIds: ['p01-trigger-boundaries'] },
    previousBank,
  });

  assert.equal(design.prompts.length, 10);
  assert.equal(design.prompts.filter(prompt => prompt.bucket === 'provisional').length, 1);
  assert.deepEqual(design.bank.provisionalPromptIds, ['run-001-exploration-07']);
  assert.equal(design.bank.explorationPromptIds.length, 3);
});
