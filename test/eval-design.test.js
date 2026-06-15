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

test('evaluation designer can seed expert-register and intertextual prompt checks', () => {
  const design = designEvalBatch({
    runId: 'run-expert-register',
    goal: 'Help agents design product strategy.',
    ontology: {
      qualityAxes: ['strategic precision'],
      targetTasks: ['draft a positioning critique'],
      practitionerLexicon: [{
        term: 'positioning',
        evalImplication: 'Penalize output that treats positioning as copywriting.',
      }],
      terminologyDiscriminators: [{
        term: 'positioning',
        distinguishFrom: 'messaging',
        distinction: 'market frame vs. outward language',
      }],
      intertextualMap: {
        recurringDebates: ['category creation vs. category capture'],
        conceptLineages: [{
          concept: 'positioning',
          drawsFrom: ['market segmentation'],
          contrastsWith: ['messaging'],
        }],
      },
    },
    parameterization: {
      parameters: [{ id: 'p01', surface: 'expert vocabulary', possibleMutations: ['add terminology checks'] }],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.match(design.prompts[0].text, /Expert-register check:/);
  assert.match(design.prompts[0].text, /positioning/);
  assert.ok(design.prompts[0].expectedSignals.some(signal => /practitioner_lexicon/.test(signal)));
});

test('evaluation designer ignores sourced expert-register checks without source refs', () => {
  const design = designEvalBatch({
    runId: 'run-expert-register-unsourced',
    goal: 'Help agents design product strategy.',
    ontology: {
      qualityAxes: ['strategic precision'],
      targetTasks: ['draft a positioning critique'],
      practitionerLexicon: [{
        term: 'positioning',
        evalImplication: 'Penalize output that treats positioning as copywriting.',
        evidenceBasis: 'sourced',
        sourceRefs: [],
      }],
      intertextualMap: {
        recurringDebates: ['category creation vs. category capture'],
        evidenceBasis: 'sourced',
        sourceRefs: [],
      },
    },
    parameterization: {
      parameters: [{ id: 'p01', surface: 'expert vocabulary', possibleMutations: ['add terminology checks'] }],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.doesNotMatch(design.prompts[0].text, /Expert-register check:/);
  assert.ok(!design.prompts[0].expectedSignals.some(signal => /practitioner_lexicon|intertextual/.test(signal)));
});

test('evaluation designer ignores sourced intertextual lineage checks without source refs', () => {
  const design = designEvalBatch({
    runId: 'run-lineage-unsourced',
    goal: 'Help agents design product strategy.',
    ontology: {
      qualityAxes: ['strategic precision'],
      targetTasks: ['draft a positioning critique'],
      intertextualMap: {
        evidenceBasis: 'inferred',
        sourceRefs: [],
        conceptLineages: [{
          concept: 'positioning',
          drawsFrom: ['market segmentation'],
          evidenceBasis: 'sourced',
          sourceRefs: [],
        }],
      },
    },
    parameterization: {
      parameters: [{ id: 'p01', surface: 'expert vocabulary', possibleMutations: ['add terminology checks'] }],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.doesNotMatch(design.prompts[0].text, /Expert-register check:/);
  assert.ok(!design.prompts[0].expectedSignals.some(signal => /intertextual_lineage/.test(signal)));
});

test('evaluation designer ignores sourced expert-register checks without research provenance when supplied', () => {
  const design = designEvalBatch({
    runId: 'run-expert-register-unprovenanced',
    goal: 'Help agents design product strategy.',
    ontology: {
      qualityAxes: ['strategic precision'],
      targetTasks: ['draft a positioning critique'],
      practitionerLexicon: [{
        term: 'positioning',
        evalImplication: 'Penalize output that treats positioning as copywriting.',
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
      }],
      terminologyDiscriminators: [{
        term: 'positioning',
        distinguishFrom: 'messaging',
        distinction: 'market frame vs. outward language',
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
      }, 'category fit'],
      intertextualMap: {
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
        recurringDebates: ['category creation vs. category capture'],
        conceptLineages: [{
          concept: 'positioning',
          drawsFrom: ['market segmentation'],
          evidenceBasis: 'sourced',
          sourceRefs: ['s1'],
        }],
      },
    },
    researchPacket: {
      researchMode: 'sourced',
      practitionerLexicon: [],
      intertextualMap: {
        evidenceBasis: 'inferred',
        sourceRefs: [],
        conceptLineages: [],
      },
    },
    parameterization: {
      parameters: [{ id: 'p01', surface: 'expert vocabulary', possibleMutations: ['add terminology checks'] }],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });

  assert.doesNotMatch(design.prompts[0].text, /Expert-register check:/);
  assert.ok(!design.prompts[0].expectedSignals.some(signal => /practitioner_lexicon|terminology_discriminator|intertextual/.test(signal)));
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

  assert.equal(design.bank.outputType, 'code_visual');
  assert.equal(design.bank.taskContractId, 'code_visual_standalone');
  assert.ok(design.prompts.every(prompt => prompt.outputType === 'code_visual'));
  assert.match(design.prompts[0].text, /complete HTML document/);
  assert.ok(design.criteria.some(criterion => criterion.id === 'renderability'));
  assert.ok(design.criteria.some(criterion => criterion.id === 'visual_hierarchy'));
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

test('prompt naturalization retries unparseable model output', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-retry',
    goal: 'Help agents write support replies.',
    ontology: { qualityAxes: ['specificity'], targetTasks: ['write a reply'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'missing-context behavior' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });
  let calls = 0;

  const provenance = await naturalizeEvalPrompts({
    design,
    goal: 'Help agents write support replies.',
    model: 'fake-judge-model',
    retryPolicy: { authoringMaxAttempts: 2, backoffMs: 0 },
    modelClient: async () => {
      calls += 1;
      return calls === 1
        ? 'not json'
        : JSON.stringify({ prompts: ['Please write a clear support reply for a customer whose delivery is two days late and wants a refund.'] });
    },
  });

  assert.equal(calls, 2);
  assert.equal(provenance.modelAttemptCount, 2);
  assert.equal(provenance.attempts.length, 1);
  assert.equal(provenance.attempts[0].failureKind, 'invalid_json');
  assert.match(design.prompts[0].text, /support reply/);
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

test('naturalized text prompts repair dangling source-material references', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-text-repair',
    goal: 'Help agents analyze screenplay structure.',
    ontology: {
      qualityAxes: ['structural usefulness'],
      targetTasks: ['identify and classify structural beats in a screenplay outline'],
    },
    parameterization: { parameters: [{ id: 'p01', surface: 'beat identification' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });
  const calls = [];

  await naturalizeEvalPrompts({
    design,
    goal: 'Help agents analyze screenplay structure.',
    model: 'fake-judge-model',
    modelClient: async request => {
      calls.push(request);
      if (calls.length === 1) {
        return JSON.stringify({
          prompts: ['Please read the screenplay outline below and label the major story beats. The story is about a paramedic who uncovers a conspiracy.'],
        });
      }
      return JSON.stringify({
        prompts: [`Please label the major story beats in this compact outline:

Outline:
- Opening: A paramedic begins a routine night shift while trying to avoid political conflict.
- Inciting pressure: A patient whispers about a city contract and disappears before giving a statement.
- Act 1 break: The paramedic steals a file and commits to investigating.
- Midpoint: He learns his supervisor is protecting the conspiracy.
- Low point: His brother is threatened because of the investigation.
- Climax: He exposes the contract scheme during a public emergency.`],
      });
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].messages[0].content, /Rejected prompt numbers: 1/);
  assert.match(calls[1].messages[0].content, /Self-containment rule/);
  assert.match(design.prompts[0].text, /Outline:/);
  assert.equal(design.bank.promptAuthoring.source, 'model_naturalized');
  assert.deepEqual(design.bank.promptAuthoring.initialInvalidPromptIds, ['run-naturalized-text-repair-stable-01']);
  assert.deepEqual(design.bank.promptAuthoring.repairedPromptIds, ['run-naturalized-text-repair-stable-01']);
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
      retryPolicy: { authoringMaxAttempts: 1, backoffMs: 0 },
      strict: true,
      modelClient: async () => JSON.stringify({ prompts: ['Update the existing app to add search.'] }),
    }),
    error => {
      assert.equal(error.name, 'PromptAuthoringError');
      assert.match(error.message, /Eval prompt authoring failed after 2 attempts/);
      assert.equal(error.provenance.fallbackPromptCount, 1);
      assert.equal(error.provenance.invalidPromptDetails[0].text, 'Update the existing app to add search.');
      assert.equal(error.provenance.failureReason, 'model_prompt_generation_remained_contract_invalid_after_repair');
      return true;
    },
  );
});

test('visual prompt naturalization rejects recommendation-only prompts', async () => {
  const design = designEvalBatch({
    runId: 'run-naturalized-visual',
    goal: 'Help agents implement polished front-end screens.',
    ontology: { qualityAxes: ['visual hierarchy'], targetTasks: ['build a landing page'] },
    parameterization: { parameters: [{ id: 'p01', surface: 'renderable output' }] },
    experimentPlan: { focusParameterIds: ['p01'] },
    outputType: 'code_visual',
    stablePromptCount: 1,
    explorationPromptCount: 0,
  });
  const calls = [];

  await naturalizeEvalPrompts({
    design,
    goal: 'Help agents implement polished front-end screens.',
    model: 'fake-judge-model',
    outputType: 'code_visual',
    modelClient: async request => {
      calls.push(request);
      if (calls.length === 1) {
        return JSON.stringify({ prompts: ['Recommend a visual direction for a tutoring landing page.'] });
      }
      return JSON.stringify({ prompts: ['Build a self-contained browser-renderable tutoring landing page. Return one complete HTML document with inline CSS and JavaScript.'] });
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0].messages[0].content, /code_visual_standalone/);
  assert.match(calls[0].messages[0].content, /Return one complete standalone HTML document with inline CSS and JavaScript/);
  assert.match(design.prompts[0].text, /complete HTML document/);
  assert.equal(design.bank.promptAuthoring.source, 'model_naturalized');
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
