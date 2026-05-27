import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/lib/init.js';
import {
  AGENT_NAMES,
  materializeCreatorArtifact,
  runAgentContract,
  writeAgentContractArtifact,
  writeRealAgentContractArtifact,
} from '../src/lib/agent-contracts.js';
import { getProjectPaths } from '../src/lib/paths.js';

test('all mock agent contracts produce prompts and artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agent-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  for (const agentName of AGENT_NAMES) {
    const result = await runAgentContract({
      cwd,
      projectName: 'ux-design',
      agentName,
      runId: `contract-${agentName}`,
      mode: 'mock',
    });

    assert.equal(result.agentName, agentName);
    assert.match(result.prompt, /Skill RSI|Skill Creator|Analyst Agent/);
    assert.ok(result.artifact);
  }
});

test('writes an agent contract artifact', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agent-write-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });
  const outputPath = path.join(cwd, 'deconstructor.json');

  await writeAgentContractArtifact({
    cwd,
    projectName: 'ux-design',
    agentName: 'deconstructor',
    runId: 'contract-deconstructor',
    outputPath,
  });

  const written = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(written.agentName, 'deconstructor');
  assert.equal(written.artifact.parameters.length, 12);
});

test('real ontology contract normalizes scalar fields', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ontology-normalize-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'ontology',
    runId: 'ontology-normalize',
    mode: 'real',
    model: 'fake-agent-model',
    modelClient: async () => JSON.stringify({
      skillGoal: 'Help agents design better UX.',
      targetUsers: 'agents',
      targetTasks: 'design UX',
      invocationBoundaries: {
        shouldTriggerWhen: 'UX task',
        shouldNotTriggerWhen: 'unrelated task',
      },
      inputSurface: 'user request',
      outputArtifacts: 'recommendation',
      requiredKnowledge: 'Agent Skills',
      failureModes: 'over-triggering',
      qualityAxes: 'workflow clarity',
      evalPromptTaxonomy: 'direct request',
      candidateStrategySpace: 'lean procedural',
    }),
  });

  assert.equal(result.artifact.runId, 'ontology-normalize');
  assert.deepEqual(result.artifact.inputSurface, ['user request']);
  assert.deepEqual(result.artifact.targetUsers, ['agents']);
});

test('real deconstructor contract validates injected model JSON', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agent-real-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'deconstructor',
    runId: 'real-deconstructor',
    mode: 'real',
    model: 'fake-agent-model',
    modelClient: async () => JSON.stringify({
      runId: 'real-deconstructor',
      summary: 'Injected real-mode parameterization.',
      parameters: Array.from({ length: 12 }, (_, index) => ({
        id: `p${String(index + 1).padStart(2, '0')}`,
        surface: `surface_${index + 1}`,
        currentImplementation: 'current',
        improvementHypothesis: 'hypothesis',
        expectedBenefit: 'benefit',
        regressionRisk: 'risk',
        evidenceFromHistory: [],
        possibleMutations: ['change'],
        ...(index === 0 ? { measurementPlan: ['measure this'] } : { measurementPlan: 'measure' }),
        priority: 'medium',
        confidence: index === 0 ? 'medium-high' : 'low',
        granularity: 'section',
      })),
      crossParameterInteractions: [],
      highestLeverageHypotheses: ['test one thing'],
      doNotTouchYet: [],
      suggestedExperimentFamilies: ['one-parameter challenger test'],
    }),
  });

  assert.equal(result.mode, 'real');
  assert.equal(result.artifact.championSkillHash, 'none');
  assert.match(result.artifact.parameters[0].measurementPlan, /Compare candidate outputs/);
  assert.equal(result.artifact.parameters.length, 12);
});

test('real agent artifact can be saved as current context for the next agent', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agent-current-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });
  const outputPath = path.join(cwd, 'deconstructor.json');

  await writeRealAgentContractArtifact({
    cwd,
    projectName: 'ux-design',
    agentName: 'deconstructor',
    runId: 'real-save-current',
    outputPath,
    model: 'fake-agent-model',
    saveCurrent: true,
    modelClient: async () => JSON.stringify({
      runId: 'real-save-current',
      championSkillHash: 'none',
      summary: 'Saved parameterization.',
      parameters: Array.from({ length: 12 }, (_, index) => ({
        id: `p${String(index + 1).padStart(2, '0')}`,
        surface: `surface_${index + 1}`,
        currentImplementation: 'current',
        improvementHypothesis: 'hypothesis',
        expectedBenefit: 'benefit',
        regressionRisk: 'risk',
        evidenceFromHistory: [],
        possibleMutations: ['change'],
        measurementPlan: 'measure',
        priority: 'medium',
        confidence: 'medium',
        granularity: 'section',
      })),
      crossParameterInteractions: [],
      highestLeverageHypotheses: ['test one thing'],
      doNotTouchYet: [],
      suggestedExperimentFamilies: ['one-parameter challenger test'],
    }),
  });

  const paths = getProjectPaths(cwd, 'ux-design');
  const saved = JSON.parse(await fs.readFile(paths.parameterizationCurrent, 'utf8'));
  assert.equal(saved.runId, 'real-save-current');

  const planner = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'experiment-planner',
    runId: 'planner-after-save',
    mode: 'mock',
  });
  assert.match(planner.prompt, /Saved parameterization/);
});

test('real experiment planner normalizes common arm aliases', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agent-planner-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'experiment-planner',
    runId: 'planner-aliases',
    mode: 'real',
    model: 'fake-agent-model',
    modelClient: async () => JSON.stringify({
      runId: 'planner-aliases',
      experimentQuestion: 'Does a tighter validation rubric improve outcomes?',
      focusParameterIds: ['p04-validation-rubric-explicitness'],
      controlledParameterIds: ['p01-activation-phrase-specificity'],
      hypothesis: 'More explicit validation should reduce incomplete outputs.',
      arms: {
        candidateA: {
          strategy: 'Explicit rubric',
          instructions: ['Add a short pass/fail rubric.'],
        },
        candidateB: {
          name: 'Baseline validation',
          changes: 'Keep validation lightweight.',
        },
      },
      evalFocus: ['validation usefulness'],
      successMetrics: ['higher validation criterion score'],
      promotionRisks: ['extra length'],
      reasonNotTestingOtherHighPriorityParameters: ['Keep this run focused.'],
    }),
  });

  assert.equal(result.artifact.arms.candidateA.strategyName, 'Explicit rubric');
  assert.deepEqual(result.artifact.arms.candidateB.mutationInstructions, ['Keep validation lightweight.']);
});

test('creator artifacts can be materialized into candidate skill packages', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-creator-materialize-'));
  const candidateDir = path.join(cwd, 'candidate-a');

  const candidate = await materializeCreatorArtifact({
    candidateDir,
    artifact: {
      runId: 'creator-materialize',
      candidateId: 'candidate-a',
      experimentArm: 'candidateA',
      strategy: 'Explicit rubric',
      changedParameterIds: ['p04-validation-rubric-explicitness'],
      files: [{
        path: 'SKILL.md',
        content: '---\nname: ux-design\n---\n\n# UX Design\n',
      }],
      rationale: 'Adds a validation rubric.',
      expectedAdvantages: ['more reliable validation'],
      expectedRisks: ['slightly longer skill'],
      selfCritique: ['Needs live eval.'],
    },
  });

  assert.equal(candidate.skillPath, path.join(candidateDir, 'skill'));
  assert.equal(
    await fs.readFile(path.join(candidate.skillPath, 'SKILL.md'), 'utf8'),
    '---\nname: ux-design\n---\n\n# UX Design\n',
  );
  await assert.rejects(
    materializeCreatorArtifact({
      candidateDir: path.join(cwd, 'bad-candidate'),
      artifact: {
        runId: 'bad',
        candidateId: 'candidate-b',
        experimentArm: 'candidateB',
        strategy: 'Bad path',
        changedParameterIds: ['p01'],
        files: [
          { path: 'SKILL.md', content: '---\nname: bad\n---\n' },
          { path: '../outside.md', content: 'nope' },
        ],
        rationale: 'Invalid package.',
        expectedAdvantages: [],
        expectedRisks: [],
        selfCritique: [],
      },
    }),
    /cannot leave/,
  );
});

test('real creator contract normalizes omitted optional list fields', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-creator-normalize-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'creator',
    runId: 'creator-normalize',
    mode: 'real',
    model: 'fake-agent-model',
    experimentArm: 'candidateB',
    modelClient: async () => JSON.stringify({
      strategyName: 'Embedded boundary policy',
      changedParameterIds: 'p01',
      files: [{
        path: 'SKILL.md',
        content: '---\nname: ux-design\n---\n\n# UX Design\n',
      }],
      expectedAdvantages: 'clearer triggering',
      expectedRisks: 'slightly longer',
    }),
  });

  assert.equal(result.artifact.candidateId, 'candidate-b');
  assert.equal(result.artifact.experimentArm, 'candidateB');
  assert.equal(result.artifact.strategy, 'Embedded boundary policy');
  assert.match(result.artifact.rationale, /Generated candidate-b/);
  assert.deepEqual(result.artifact.changedParameterIds, ['p01']);
  assert.deepEqual(result.artifact.expectedAdvantages, ['clearer triggering']);
  assert.match(result.artifact.files[0].content, /description: Use when applying the Embedded boundary policy Skill RSI candidate\./);
  assert.equal(result.artifact.selfCritique.length, 1);
});

test('real creator contract normalizes common SKILL.md file aliases', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-creator-file-alias-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'creator',
    runId: 'creator-file-alias',
    mode: 'real',
    model: 'fake-agent-model',
    experimentArm: 'candidateA',
    modelClient: async () => JSON.stringify({
      strategy: 'Alias tolerant package',
      changedParameterIds: [],
      files: [{
        filename: 'skill/SKILL.md',
        markdown: '---\nname: ux-design\n---\n\n# UX Design\n',
      }],
      expectedAdvantages: [],
      expectedRisks: [],
    }),
  });

  assert.equal(result.artifact.files[0].path, 'SKILL.md');
  assert.match(result.artifact.files[0].content, /description:/);
});
