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

test('ontology prompt includes research packet and source-labeling instructions', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ontology-research-prompt-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'ontology',
    runId: 'ontology-research-prompt',
    mode: 'mock',
    researchPacket: {
      researchMode: 'sourced',
      authorityMap: [{ name: 'Steve Jobs', strongOpinions: ['Start with the customer experience.'] }],
    },
    qualityFeedback: { issues: [{ code: 'missing_authority_map' }] },
  });

  assert.match(result.prompt, /Research packet:/);
  assert.match(result.prompt, /sourced, inferred, or speculative/);
  assert.match(result.prompt, /Previous quality report:/);
});

test('deconstructor prompt includes full champion package and Agent Skills standard', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-deconstructor-package-prompt-'));
  const init = await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });
  await fs.mkdir(init.paths.championSkillDir, { recursive: true });
  await fs.writeFile(path.join(init.paths.championSkillDir, 'SKILL.md'), `---
name: ux-design
description: Use for UX design.
---

# UX Design

Load [heuristics](references/heuristics.md).
`);
  await fs.mkdir(path.join(init.paths.championSkillDir, 'references'), { recursive: true });
  await fs.writeFile(path.join(init.paths.championSkillDir, 'references', 'heuristics.md'), '# Heuristics\n\nPrefer clarity.');
  const state = JSON.parse(await fs.readFile(init.paths.stateJson, 'utf8'));
  await fs.writeFile(init.paths.stateJson, JSON.stringify({
    ...state,
    currentChampion: { runId: 'run-001', candidateId: 'candidate-a', skillHash: 'hash' },
  }, null, 2));

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'deconstructor',
    runId: 'deconstructor-package-prompt',
    mode: 'mock',
  });

  assert.match(result.prompt, /Full champion package summary:/);
  assert.match(result.prompt, /references\/heuristics\.md/);
  assert.match(result.prompt, /Agent Skills standard:/);
  assert.match(result.prompt, /artifactEvidence/);
  assert.match(result.prompt, /couplingNotes/);
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

test('creator prompt includes Agent Skills standard and Skill Creator guidance', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-creator-guidance-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'creator',
    runId: 'creator-guidance',
    mode: 'mock',
    experimentArm: 'candidateA',
  });

  assert.match(result.prompt, /=== AGENT SKILLS STANDARD ===/);
  assert.match(result.prompt, /=== SKILL CREATOR GUIDANCE ===/);
  assert.match(result.prompt, /Keep `SKILL\.md` concise/);
  assert.match(result.prompt, /Progressive disclosure/);
  assert.match(result.prompt, /Do not create auxiliary documentation/);
});

test('creator prompt includes the project output contract', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-creator-output-contract-'));
  await initProject({
    cwd,
    projectName: 'Frontend Design',
    goal: 'Help agents design and implement better front-end UX.',
    evalOutputType: 'code_visual',
  });

  const result = await runAgentContract({
    cwd,
    projectName: 'frontend-design',
    agentName: 'creator',
    runId: 'creator-output-contract',
    mode: 'mock',
    experimentArm: 'candidateA',
  });

  assert.match(result.prompt, /Expected user-output contract:/);
  assert.match(result.prompt, /production-ready code for visual\/interface artifacts/);
  assert.match(result.prompt, /Conceptual visual direction alone is incomplete/);
});

test('ontology and deconstructor prompts receive the project output contract', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-output-contract-all-agents-'));
  await initProject({
    cwd,
    projectName: 'Code Assistant',
    goal: 'Help agents write implementation code.',
    evalOutputType: 'code',
  });

  const ontology = await runAgentContract({
    cwd,
    projectName: 'code-assistant',
    agentName: 'ontology',
    runId: 'ontology-output-contract',
    mode: 'mock',
  });
  const deconstructor = await runAgentContract({
    cwd,
    projectName: 'code-assistant',
    agentName: 'deconstructor',
    runId: 'deconstructor-output-contract',
    mode: 'mock',
  });

  assert.match(ontology.prompt, /production-ready code artifacts/);
  assert.match(deconstructor.prompt, /Advice-only responses are incomplete/);
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
  assert.match(result.artifact.files[0].content, /description: Use when the user needs help with embedded boundary policy\./);
  assert.doesNotMatch(result.artifact.files[0].content, /Skill RSI candidate/);
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

test('agent prompts receive compact Phase 1 history memory', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-history-context-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });
  const paths = getProjectPaths(cwd, 'ux-design');
  const history = JSON.parse(await fs.readFile(paths.historyIndex, 'utf8'));
  await fs.writeFile(paths.historyIndex, `${JSON.stringify({
    ...history,
    currentChampion: { runId: 'run-002', candidateId: 'candidate-a', skillHash: 'abc123' },
    trajectory: [{
      runId: 'run-002',
      decision: 'request_new_experiment',
      winner: 'current',
      scoreDelta: 0,
      parameterTested: ['p01'],
      hypothesisHeld: null,
      summary: 'Experiment did not create a clear improvement.',
    }],
    parameterLog: [{
      parameterId: 'p01',
      testedInRuns: ['run-001', 'run-002'],
      currentBelief: 'Activation metadata has been noisy twice.',
      status: 'do_not_retry_without_new_evidence',
      lastTestedRunId: 'run-002',
      lastDecision: 'request_new_experiment',
      outcomeCounts: { promote: 0, keep_current: 0, request_new_experiment: 2 },
      currentEvidence: {
        runId: 'run-002',
        decision: 'request_new_experiment',
        confidence: 'low',
        scoreDelta: 0,
        candidateDuelWinner: 'tie',
        championGateWinner: null,
        reviewBlocked: false,
        summary: 'No useful activation metadata signal.',
        caveats: ['Low score margin'],
      },
      staleEvidence: [{
        runId: 'run-001',
        decision: 'keep_current',
        confidence: 'low',
        scoreDelta: 1,
        candidateDuelWinner: 'skillA',
        championGateWinner: 'skillB',
        reviewBlocked: false,
        summary: 'Older weak activation metadata signal.',
        caveats: ['Current champion held'],
      }],
    }],
    knownWeaknesses: [{ runId: 'run-002', source: 'likely_noise', message: 'Low score margin', status: 'open' }],
    doNotRepeat: ['Do not retry p01 without new evidence'],
    failedStrategyLog: [{ runId: 'run-002', source: 'experiment_signal', message: 'Repeated weak activation test', status: 'inconclusive' }],
    recentNextExperimentNotes: ['Try next: output contract'],
  }, null, 2)}\n`, 'utf8');

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'experiment-planner',
    runId: 'planner-history-context',
    mode: 'mock',
  });

  assert.match(result.prompt, /Do not retry p01 without new evidence/);
  assert.match(result.prompt, /Repeated weak activation test/);
  assert.match(result.prompt, /Activation metadata has been noisy twice/);
  assert.match(result.prompt, /Try next: output contract/);
});

test('experiment planner prompt receives explicit manager guidance', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-manager-prompt-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'experiment-planner',
    runId: 'planner-manager-guidance',
    mode: 'mock',
    managerPlan: {
      strategy: { experimentFamily: 'high_divergence_reset' },
      avoid: { parameterIds: ['p01-activation_metadata'], reasons: ['No signal from p01.'] },
      experimentIntent: {
        plannerInstructions: ['Use reset planning and avoid p01 unless new evidence exists.'],
      },
    },
  });

  assert.match(result.prompt, /Manager guidance for this run/);
  assert.match(result.prompt, /high_divergence_reset/);
  assert.match(result.prompt, /p01-activation_metadata/);
  assert.match(result.prompt, /Do not select avoid\.parameterIds/);
});

test('real analyst contract maps unimplemented edit_current to a new experiment', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-analyst-no-edit-'));
  await initProject({ cwd, projectName: 'UX Design', goal: 'Help agents design better UX.' });

  const result = await runAgentContract({
    cwd,
    projectName: 'ux-design',
    agentName: 'analyst',
    runId: 'analyst-no-edit',
    mode: 'real',
    model: 'fake-agent-model',
    modelClient: async () => JSON.stringify({
      runId: 'analyst-no-edit',
      decision: 'edit_current',
      recommendedChampionCandidateId: 'candidate-a',
      confidence: 'medium',
      reasoning: 'Try a surgical edit.',
      observations: ['The model requested an unimplemented branch.'],
      nextRoundGuidance: {
        vary: 'same parameter',
        preserve: 'current champion',
        investigate: 'edit branch',
      },
    }),
  });

  assert.equal(result.artifact.decision, 'request_new_experiment');
  assert.equal(result.artifact.recommendedChampionCandidateId, null);
});
