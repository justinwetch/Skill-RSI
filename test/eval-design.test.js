import test from 'node:test';
import assert from 'node:assert/strict';
import { designEvalBatch, naturalizeEvalPrompts } from '../src/lib/eval-design.js';

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
  assert.equal(design.bank.criteriaAuthoring.source, 'deterministic_template');
  assert.ok(design.criteria.length >= 4);
  assert.ok(design.criteria.length <= 6);
  assert.deepEqual(design.prompts[0].parameterIds, ['p01-trigger-boundaries']);
  assert.match(design.prompts[0].text, /Help agents design better UX/);
});

test('evaluation designer records model-generated criteria provenance', () => {
  const design = designEvalBatch({
    runId: 'run-model-criteria',
    goal: 'Help agents write useful prose.',
    ontology: { qualityAxes: ['clarity'], targetTasks: ['draft a memo'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'artifact shape' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    coreCriteria: [{
      id: 'domain_specificity',
      name: 'Domain Specificity',
      description: 'Rewards domain-specific output.',
      rubric: { 5: 'great', 3: 'ok', 1: 'bad' },
    }],
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.equal(design.bank.criteriaAuthoring.source, 'model_generated_plus_contract');
  assert.equal(design.bank.criteriaAuthoring.modelGeneratedCount, 1);
  assert.ok(design.criteria.some(criterion => criterion.id === 'domain_specificity'));
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
  assert.equal(second.bank.promptAuthoring.source, 'mixed');
  assert.ok(second.bank.criteriaVersion > first.bank.criteriaVersion);
  assert.ok(second.bank.criteriaVersions.length >= 2);
});

test('evaluation designer reuses provisional prompts for challenge confirmation', () => {
  const previousBank = {
    outputType: 'text',
    taskContractId: 'text_standalone',
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

test('evaluation designer enforces UI-code output contract', () => {
  const design = designEvalBatch({
    runId: 'run-code-visual',
    goal: 'Help agents design better front-end UX.',
    ontology: {
      qualityAxes: ['visual hierarchy', 'accessibility', 'production readiness'],
      targetTasks: ['implement a landing page', 'revise an application screen'],
    },
    parameterization: {
      parameters: [{
        id: 'p01-output-contract',
        surface: 'implementation output contract',
        possibleMutations: ['require code-first answers'],
        measurementPlan: 'Check whether outputs include usable code instead of visual recommendations.',
      }],
    },
    experimentPlan: { focusParameterIds: ['p01-output-contract'] },
    outputType: 'code_visual',
  });

  assert.equal(design.bank.outputType, 'code');
  assert.equal(design.bank.taskContractId, 'code_standalone');
  assert.ok(design.prompts.every(prompt => prompt.outputType === 'code'));
  assert.match(design.prompts[0].text, /There is no existing repository context/);
  assert.ok(design.criteria.some(criterion => criterion.id === 'contract_validity'));
});

test('evaluation designer resets stale prompt bank when output type changes', () => {
  const textDesign = designEvalBatch({
    runId: 'run-text',
    goal: 'Help agents design better front-end UX.',
    ontology: {
      qualityAxes: ['visual direction'],
      targetTasks: ['recommend a landing page direction'],
    },
    parameterization: {
      parameters: [{ id: 'p01-output-contract', surface: 'output contract' }],
    },
    experimentPlan: { focusParameterIds: ['p01-output-contract'] },
    outputType: 'text',
  });

  const codeDesign = designEvalBatch({
    runId: 'run-code',
    goal: 'Help agents design better front-end UX.',
    ontology: {
      qualityAxes: ['implementation readiness'],
      targetTasks: ['implement a landing page'],
    },
    parameterization: {
      parameters: [{ id: 'p01-output-contract', surface: 'output contract' }],
    },
    experimentPlan: { focusParameterIds: ['p01-output-contract'] },
    previousBank: textDesign.bank,
    outputType: 'code',
  });

  assert.equal(codeDesign.bank.outputType, 'code');
  assert.equal(codeDesign.bank.taskContractId, 'code_standalone');
  assert.notDeepEqual(codeDesign.bank.stablePromptIds, textDesign.bank.stablePromptIds);
  assert.equal(codeDesign.prompts.filter(prompt => prompt.reusedFromBank).length, 0);
  assert.ok(codeDesign.prompts.every(prompt => prompt.outputType === 'code'));
  assert.match(codeDesign.prompts[0].text, /do not ask me to provide files/);
  assert.ok(codeDesign.criteria.some(criterion => criterion.id === 'artifact_completeness'));
});

test('naturalized prompts receive output contract instructions', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-code',
    goal: 'Help agents implement interface components.',
    ontology: { qualityAxes: ['implementation readiness'], targetTasks: ['build a settings panel'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'code output' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code',
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });
  const calls = [];

  await naturalizeEvalPrompts({
    design,
    goal: 'Help agents implement interface components.',
    model: 'fake-judge-model',
    outputType: 'code',
    modelClient: async request => {
      calls.push(request);
      return JSON.stringify({ prompts: ['Build a production-ready settings panel component with complete code.'] });
    },
  });

  assert.match(calls[0].messages[0].content, /code_standalone/);
  assert.match(calls[0].messages[0].content, /Invalid prompt rules/);
  assert.match(design.prompts[0].text, /complete code/);
  assert.equal(design.bank.promptAuthoring.source, 'model_naturalized');
  assert.equal(design.bank.promptAuthoring.modelAttemptCount, 1);
  assert.equal(design.bank.promptAuthoring.fallbackPromptCount, 0);
});

test('invalid naturalized prompts get one repair attempt before fallback', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-repair',
    goal: 'Help agents implement code artifacts.',
    ontology: { qualityAxes: ['artifact completeness'], targetTasks: ['build a utility'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'missing-context behavior' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code',
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });
  const calls = [];

  await naturalizeEvalPrompts({
    design,
    goal: 'Help agents implement code artifacts.',
    model: 'fake-judge-model',
    outputType: 'code',
    modelClient: async request => {
      calls.push(request);
      if (calls.length === 1) {
        return JSON.stringify({ prompts: ['Update the existing app to add search.'] });
      }
      return JSON.stringify({ prompts: ['Build a complete standalone search utility with runnable JavaScript code.'] });
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[0].content, /Rejected prompt numbers: 1/);
  assert.match(design.prompts[0].text, /standalone search utility/);
  assert.equal(design.bank.promptAuthoring.source, 'model_naturalized');
  assert.equal(design.bank.promptAuthoring.modelAttemptCount, 2);
  assert.deepEqual(design.bank.promptAuthoring.initialInvalidPromptIds, ['run-naturalized-repair-stable-01']);
  assert.deepEqual(design.bank.promptAuthoring.repairedPromptIds, ['run-naturalized-repair-stable-01']);
  assert.equal(design.bank.promptAuthoring.fallbackPromptCount, 0);
});

test('invalid prompt repair records deterministic fallback provenance when repair fails', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-fallback',
    goal: 'Help agents implement code artifacts.',
    ontology: { qualityAxes: ['artifact completeness'], targetTasks: ['build a utility'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'missing-context behavior' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code',
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  await naturalizeEvalPrompts({
    design,
    goal: 'Help agents implement code artifacts.',
    model: 'fake-judge-model',
    outputType: 'code',
    modelClient: async () => JSON.stringify({ prompts: ['Update the existing app to add search.'] }),
  });

  assert.equal(design.bank.promptAuthoring.source, 'deterministic_fallback');
  assert.equal(design.bank.promptAuthoring.modelAttemptCount, 2);
  assert.deepEqual(design.bank.promptAuthoring.fallbackPromptIds, ['run-naturalized-fallback-stable-01']);
  assert.match(design.prompts[0].text, /do not ask me to provide files/);
  assert.equal(design.prompts[0].promptAuthoring.source, 'deterministic_fallback');
});

test('strict prompt naturalization fails instead of using deterministic fallback', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-strict',
    goal: 'Help agents implement code artifacts.',
    ontology: { qualityAxes: ['artifact completeness'], targetTasks: ['build a utility'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'missing-context behavior' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code',
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  await assert.rejects(
    naturalizeEvalPrompts({
      design,
      goal: 'Help agents implement code artifacts.',
      model: 'fake-judge-model',
      outputType: 'code',
      strict: true,
      modelClient: async () => JSON.stringify({ prompts: ['Update the existing app to add search.'] }),
    }),
    error => {
      assert.equal(error.name, 'PromptAuthoringError');
      assert.equal(error.provenance.fallbackPromptCount, 1);
      return true;
    },
  );
});

test('evaluation designer creates contract-valid codebase edit prompts', () => {
  const design = designEvalBatch({
    runId: 'run-codebase-edit',
    goal: 'Help agents improve frontend code.',
    ontology: { qualityAxes: ['context fidelity'], targetTasks: ['revise provided files'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'patch fidelity' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code',
    taskContract: { id: 'codebase_edit' },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.equal(design.bank.taskContractId, 'codebase_edit');
  assert.match(design.prompts[0].text, /File tree:/);
  assert.match(design.prompts[0].text, /src\/summary\.js/);
  assert.match(design.prompts[0].text, /```js/);
  assert.ok(design.criteria.some(criterion => criterion.id === 'context_fidelity'));
});

test('evaluation designer resets prompt bank when task contract changes', () => {
  const standalone = designEvalBatch({
    runId: 'run-code-standalone',
    goal: 'Help agents write code.',
    ontology: { qualityAxes: ['artifact completeness'], targetTasks: ['build code'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'artifact shape' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code',
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  const codebase = designEvalBatch({
    runId: 'run-codebase-after-standalone',
    goal: 'Help agents write code.',
    ontology: { qualityAxes: ['context fidelity'], targetTasks: ['patch code'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'patch fidelity' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    previousBank: standalone.bank,
    outputType: 'code',
    taskContract: { id: 'codebase_edit' },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.equal(codebase.bank.taskContractId, 'codebase_edit');
  assert.equal(codebase.prompts.filter(prompt => prompt.reusedFromBank).length, 0);
  assert.match(codebase.prompts[0].text, /File tree:/);
});

test('evaluation designer creates source-grounded text prompts', () => {
  const design = designEvalBatch({
    runId: 'run-source-grounded',
    goal: 'Help agents write grounded summaries.',
    ontology: { qualityAxes: ['source fidelity'], targetTasks: ['summarize source material'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'source fidelity' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'text',
    taskContract: { id: 'text_source_grounded' },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.equal(design.bank.taskContractId, 'text_source_grounded');
  assert.match(design.prompts[0].text, /Source material:/);
  assert.match(design.prompts[0].text, /Use only the source material/);
});

test('evaluation designer drops stale output-contract criteria when output type changes', () => {
  const design = designEvalBatch({
    runId: 'run-output-type-change',
    goal: 'Help agents write useful prose.',
    ontology: { qualityAxes: ['clarity'], targetTasks: ['draft a memo'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'artifact shape' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    previousBank: {
      criteria: [{
        id: 'implemented_visual_output',
        name: 'Implemented Visual Output',
        description: 'Old visual criterion.',
        rubric: { 5: 'great', 3: 'ok', 1: 'bad' },
      }],
      criteriaVersions: [],
    },
    outputType: 'text',
  });

  assert.ok(!design.criteria.some(criterion => criterion.id === 'implemented_visual_output'));
});
