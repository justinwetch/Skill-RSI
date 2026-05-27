import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProject } from '../src/lib/run-loop.js';

test('stub mode completes a three-loop vertical slice', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-test-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design',
    goal: 'Help agents design better UX.',
    loops: 3,
    mode: 'stub',
  });

  assert.equal(result.projectId, 'ux-design');
  assert.equal(result.completedRuns.length, 3);
  assert.equal(result.state.runCount, 3);
  assert.equal(result.history.trajectory.length, 3);
  assert.ok(result.state.currentChampion.skillHash);

  const summary = await fs.readFile(result.paths.historySummary, 'utf8');
  assert.match(summary, /Current champion:/);

  const championSkill = await fs.readFile(path.join(result.paths.championSkillDir, 'SKILL.md'), 'utf8');
  // Champion is a clean, valid Agent Skill — no Skill RSI run metadata leaking into the package.
  assert.match(championSkill, /^---\nname:/);
  assert.match(championSkill, /## Workflow/);
  assert.doesNotMatch(championSkill, /Run Context|Changed parameters|Candidate:/);
});

test('mock mode completes a first run through headless evaluator artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-mock-run-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design Mock',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });

  assert.equal(result.projectId, 'ux-design-mock');
  assert.equal(result.completedRuns.length, 1);
  assert.equal(result.state.runCount, 1);
  assert.ok(result.completedRuns[0].evaluatorRunId.endsWith('-candidate-duel'));

  const runId = result.completedRuns[0].runId;
  const duel = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'eval',
    'candidate-duel.json',
  ), 'utf8'));

  assert.equal(duel.mode, 'mock');
  assert.equal(duel.stats.totalEvals, 10);
  assert.ok(['skillA', 'skillB', 'tie'].includes(duel.stats.winner));
});

test('mock mode later loops run a champion gate', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-mock-later-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design Later',
    goal: 'Help agents design better UX.',
    loops: 3,
    mode: 'mock',
  });

  assert.equal(result.state.runCount, 3);
  assert.equal(result.history.trajectory.length, 3);

  const gatedRun = result.completedRuns.find(run => run.championGateRunId);
  assert.ok(gatedRun);

  const gate = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    gatedRun.runId,
    'eval',
    'champion-gate.json',
  ), 'utf8'));

  assert.equal(gate.mode, 'mock');
  assert.equal(gate.stats.totalEvals, 10);
});

test('history tracks multi-run parameter provenance and detailed artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-history-provenance-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design History',
    goal: 'Help agents design better UX.',
    loops: 3,
    mode: 'mock',
  });

  const history = JSON.parse(await fs.readFile(result.paths.historyIndex, 'utf8'));
  const summary = await fs.readFile(result.paths.historySummary, 'utf8');
  const latestRunId = result.completedRuns.at(-1).runId;
  const detail = await fs.readFile(path.join(result.paths.historyDetailedDir, `${latestRunId}.md`), 'utf8');
  const parameter = history.parameterLog.find(item => item.parameterId === 'p01-activation_metadata');

  assert.ok(parameter);
  assert.equal(parameter.testedInRuns.length, 3);
  assert.ok(parameter.currentEvidence);
  assert.ok(parameter.staleEvidence.length >= 2);
  assert.ok(parameter.outcomeCounts);
  assert.match(summary, /Known weaknesses:/);
  assert.match(summary, /Do not repeat:/);
  assert.match(summary, /Recent parameter evidence:/);
  assert.match(summary, /Failed or recovered strategies:/);
  assert.match(detail, /## Evaluation Summary/);
  assert.match(detail, /## Prompt Bank Changes/);
  assert.match(detail, /## Candidate Reviews/);
  assert.match(detail, /## Artifact Paths/);
});

test('mock mode updates prompt bank across loops', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-prompt-bank-loop-'));

  const first = await runProject({
    cwd,
    projectName: 'UX Design Prompt Bank',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });
  const firstBank = JSON.parse(await fs.readFile(first.paths.promptBankIndex, 'utf8'));

  const second = await runProject({
    cwd,
    projectName: 'UX Design Prompt Bank',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });
  const secondBank = JSON.parse(await fs.readFile(second.paths.promptBankIndex, 'utf8'));

  assert.equal(secondBank.stablePromptIds.length, 6);
  assert.notEqual(secondBank.currentRunId, firstBank.currentRunId);
  assert.ok(secondBank.explorationPrompts.length >= firstBank.explorationPrompts.length + 4);
  assert.ok(secondBank.criteriaVersions.length >= firstBank.criteriaVersions.length);

  const update = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    second.completedRuns[0].runId,
    'eval',
    'prompt-bank-update.json',
  ), 'utf8'));
  assert.equal(update.stablePromptIds.length, 6);
  assert.equal(update.runId, second.completedRuns[0].runId);
  assert.ok(update.diagnostics);
});

test('stop rules pause after consecutive inconclusive runs', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-stop-inconclusive-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design Stop Inconclusive',
    goal: 'Help agents design better UX.',
    loops: 3,
    mode: 'mock',
    evalMode: 'real',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    stopRules: { maxInconclusiveRuns: 1 },
    modelClient: tieModelClient,
  });

  assert.equal(result.completedRuns.length, 1);
  assert.equal(result.state.runCount, 1);
  assert.equal(result.history.trajectory.at(-1).decision, 'request_new_experiment');
  assert.ok(result.history.knownWeaknesses.length > 0);
  assert.ok(result.history.failedStrategyLog.some(item => item.source === 'experiment_signal'));
  assert.match(result.stopReason, /consecutive inconclusive run/);

  const second = await runProject({
    cwd,
    projectName: 'UX Design Stop Inconclusive',
    goal: 'Help agents design better UX.',
    loops: 2,
    mode: 'mock',
    evalMode: 'real',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    stopRules: { maxInconclusiveRuns: 1 },
    modelClient: tieModelClient,
  });

  assert.equal(second.completedRuns.length, 0);
  assert.equal(second.state.runCount, 1);
  assert.match(second.stopReason, /consecutive inconclusive run/);
});

test('stop rules pause after consecutive non-promotion runs', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-stop-patience-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design Stop Patience',
    goal: 'Help agents design better UX.',
    loops: 3,
    mode: 'mock',
    evalMode: 'real',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    stopRules: { maxNoPromotionRuns: 1 },
    modelClient: tieModelClient,
  });

  assert.equal(result.completedRuns.length, 1);
  assert.equal(result.state.runCount, 1);
  assert.notEqual(result.history.trajectory.at(-1).decision, 'promote');
  assert.ok(result.history.knownWeaknesses.length > 0);
  assert.match(result.stopReason, /without promotion/);
});

test('mock agents can use the real evaluator path with injected model client', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-real-eval-loop-'));
  const calls = [];

  const result = await runProject({
    cwd,
    projectName: 'UX Design Real Eval',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
    evalMode: 'real',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    modelClient: async request => {
      calls.push(request);
      if (request.jsonMode) {
        return JSON.stringify({
          winner: 'skillA',
          scoreA: 5,
          scoreB: 4,
          breakdown: {
            skillA: { workflow_clarity: 5, validation_usefulness: 5 },
            skillB: { workflow_clarity: 4, validation_usefulness: 4 },
          },
          reasoning: 'Skill A is clearer in the injected test judge.',
        });
      }
      return 'Injected generated output';
    },
  });

  const runId = result.completedRuns[0].runId;
  const duel = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'eval',
    'candidate-duel.json',
  ), 'utf8'));

  assert.equal(duel.mode, 'real');
  assert.equal(duel.stats.winner, 'skillA');
  assert.ok(calls.length > 0);
});

test('agentic mode runs real agent contracts with an injected model client', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agentic-run-'));
  const calls = [];

  const result = await runProject({
    cwd,
    projectName: 'UX Design Agentic',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    agentModel: 'fake-agent-model',
    modelClient: async request => {
      calls.push(request);
      const prompt = request.messages[0].content;
      if (prompt.includes('Ontology Agent')) return JSON.stringify(fakeOntology());
      if (prompt.includes('Parameterization Agent')) return JSON.stringify(fakeParameterization());
      if (prompt.includes('Experiment Planner')) return JSON.stringify(fakeExperimentPlan());
      if (prompt.includes('Assigned experiment arm: candidateB')) return JSON.stringify(fakeCreator('candidate-b', 'candidateB', 'Embedded boundary policy'));
      if (prompt.includes('Assigned experiment arm: candidateA')) return JSON.stringify(fakeCreator('candidate-a', 'candidateA', 'Description-only tightening'));
      if (prompt.includes('Interpret this Skill RSI run')) return JSON.stringify({
        runId: 'analyst',
        decision: 'promote',
        recommendedChampionCandidateId: 'candidate-a',
        confidence: 'medium',
        reasoning: 'Injected analyst accepts the policy-supported winner.',
        observations: ['Injected analyst observation.'],
        nextRoundGuidance: {
          vary: 'next parameter',
          preserve: 'candidate-a strategy',
          investigate: 'stable prompt signal',
        },
        resultSummary: {},
        signalAssessment: {},
        actionableInsights: ['preserve winner'],
        nextExperimentNotes: ['continue'],
        historySummary: 'Promoted candidate-a.',
      });
      if (prompt.includes('adversarial reviewer')) return JSON.stringify({ blockingIssues: [], recommendedEdits: [], nonIssues: ['stub review'], overfittingRisk: 'low' });
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
    },
  });

  assert.equal(result.completedRuns.length, 1);
  assert.equal(result.completedRuns[0].mode, 'agentic');
  assert.ok(calls.length >= 5);

  const runId = result.completedRuns[0].runId;
  const candidateSkill = await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'candidates',
    'candidate-a',
    'skill',
    'SKILL.md',
  ), 'utf8');
  assert.match(candidateSkill, /Description-only tightening/);

  const plan = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'deconstruction',
    'experiment-plan.json',
  ), 'utf8'));
  assert.equal(plan.arms.candidateB.strategyName, 'Embedded boundary policy');
});

test('agentic mode completes cleanly when candidate review blocks evaluation', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agentic-review-block-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design Review Block',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    agentModel: 'fake-agent-model',
    modelClient: async request => {
      const prompt = request.messages[0].content;
      if (prompt.includes('Ontology Agent')) return JSON.stringify(fakeOntology());
      if (prompt.includes('Parameterization Agent')) return JSON.stringify(fakeParameterization());
      if (prompt.includes('Experiment Planner')) return JSON.stringify(fakeExperimentPlan());
      if (prompt.includes('Revision attempt: 1')) {
        const artifact = fakeCreator('candidate-a', 'candidateA', 'Description-only tightening revised');
        artifact.files.push({ path: 'scripts/danger.sh', content: 'rm -rf "$HOME/tmp"\n' });
        return JSON.stringify(artifact);
      }
      if (prompt.includes('Assigned experiment arm: candidateB')) return JSON.stringify(fakeCreator('candidate-b', 'candidateB', 'Embedded boundary policy'));
      if (prompt.includes('Assigned experiment arm: candidateA')) {
        const artifact = fakeCreator('candidate-a', 'candidateA', 'Description-only tightening');
        artifact.files.push({ path: 'scripts/danger.sh', content: 'rm -rf "$HOME/tmp"\n' });
        return JSON.stringify(artifact);
      }
      if (prompt.includes('adversarial reviewer')) return JSON.stringify({ blockingIssues: [], recommendedEdits: [], nonIssues: ['stub review'], overfittingRisk: 'low' });
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
    },
  });

  assert.equal(result.completedRuns.length, 1);
  assert.equal(result.completedRuns[0].reviewBlocked, true);
  assert.equal(result.completedRuns[0].recommendation.decision, 'request_new_experiment');
  assert.equal(result.completedRuns[0].evaluatorRunId, null);
  assert.equal(result.state.currentChampion, null);

  const runId = result.completedRuns[0].runId;
  const review = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'candidates',
    'candidate-a',
    'review.json',
  ), 'utf8'));

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'script:scripts/danger.sh'));

  const revisionReview = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'candidates',
    'candidate-a',
    'revision-001',
    'review.json',
  ), 'utf8'));
  assert.equal(revisionReview.approveForEval, false);
});

test('agentic mode proceeds to eval after successful candidate revision', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agentic-review-revision-'));
  let candidateAAttempts = 0;

  const result = await runProject({
    cwd,
    projectName: 'UX Design Review Revision',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    agentModel: 'fake-agent-model',
    modelClient: async request => {
      const prompt = request.messages[0].content;
      if (prompt.includes('Ontology Agent')) return JSON.stringify(fakeOntology());
      if (prompt.includes('Parameterization Agent')) return JSON.stringify(fakeParameterization());
      if (prompt.includes('Experiment Planner')) return JSON.stringify(fakeExperimentPlan());
      if (prompt.includes('Revision attempt: 1')) return JSON.stringify(fakeCreator('candidate-a', 'candidateA', 'Description-only tightening revised'));
      if (prompt.includes('Assigned experiment arm: candidateB')) return JSON.stringify(fakeCreator('candidate-b', 'candidateB', 'Embedded boundary policy'));
      if (prompt.includes('Assigned experiment arm: candidateA')) {
        candidateAAttempts += 1;
        const artifact = fakeCreator('candidate-a', 'candidateA', 'Description-only tightening');
        artifact.files.push({ path: 'scripts/danger.sh', content: 'rm -rf "$HOME/tmp"\n' });
        return JSON.stringify(artifact);
      }
      if (prompt.includes('Interpret this Skill RSI run')) return JSON.stringify({
        runId: 'analyst',
        decision: 'promote',
        recommendedChampionCandidateId: 'candidate-a',
        confidence: 'medium',
        reasoning: 'Revision passed review and eval.',
        observations: ['Revision accepted.'],
        nextRoundGuidance: {
          vary: 'next parameter',
          preserve: 'revised candidate-a',
          investigate: 'revision durability',
        },
      });
      if (prompt.includes('adversarial reviewer')) return JSON.stringify({ blockingIssues: [], recommendedEdits: [], nonIssues: ['stub review'], overfittingRisk: 'low' });
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 80)}`);
    },
  });

  assert.equal(candidateAAttempts, 1);
  assert.equal(result.completedRuns[0].reviewBlocked, undefined);
  assert.ok(result.completedRuns[0].evaluatorRunId);

  const runId = result.completedRuns[0].runId;
  const revisionReview = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'candidates',
    'candidate-a',
    'revision-001',
    'review.json',
  ), 'utf8'));
  assert.equal(revisionReview.approveForEval, true);

  const duel = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'eval',
    'candidate-duel.json',
  ), 'utf8'));
  assert.equal(duel.mode, 'mock');
});

function fakeOntology() {
  return {
    runId: 'ontology',
    skillGoal: 'Help agents design better UX.',
    targetUsers: ['agents'],
    targetTasks: ['design UX'],
    invocationBoundaries: {
      shouldTriggerWhen: ['UX production application request'],
      shouldNotTriggerWhen: ['unrelated request'],
    },
    inputSurface: ['goal'],
    outputArtifacts: ['SKILL.md'],
    requiredKnowledge: ['Agent Skills'],
    referencePoints: ['good UX critique'],
    adjacentDomainsToBorrowFrom: ['product design'],
    optionalResources: { references: [], scripts: [], assets: [] },
    platformAssumptions: { portableAgentSkills: ['SKILL.md'], clientSpecificFeatures: [] },
    failureModes: ['over-triggering'],
    qualityAxes: ['workflow clarity'],
    evalPromptTaxonomy: ['direct request'],
    candidateStrategySpace: ['tight description', 'embedded boundaries'],
    openQuestions: [],
  };
}

function fakeParameterization() {
  return {
    runId: 'deconstructor',
    championSkillHash: 'none',
    summary: 'Parameterize activation and validation.',
    parameters: Array.from({ length: 12 }, (_, index) => ({
      id: `p${String(index + 1).padStart(2, '0')}`,
      surface: `surface ${index + 1}`,
      currentImplementation: 'baseline',
      improvementHypothesis: 'improve clarity',
      expectedBenefit: 'better eval score',
      regressionRisk: 'more verbosity',
      evidenceFromHistory: [],
      possibleMutations: ['tighten'],
      measurementPlan: 'compare A/B',
      priority: index < 2 ? 'high' : 'medium',
      confidence: 'medium',
      granularity: 'section',
    })),
    crossParameterInteractions: [],
    highestLeverageHypotheses: ['test activation boundary'],
    doNotTouchYet: [],
    suggestedExperimentFamilies: ['one parameter'],
  };
}

function fakeExperimentPlan() {
  return {
    runId: 'planner',
    experimentQuestion: 'Which activation boundary works better?',
    focusParameterIds: ['p01'],
    controlledParameterIds: ['p02'],
    hypothesis: 'Embedded boundaries improve behavior.',
    arms: {
      candidateA: {
        strategyName: 'Description-only tightening',
        mutationInstructions: ['tighten the description'],
      },
      candidateB: {
        strategyName: 'Embedded boundary policy',
        mutationInstructions: ['add when-to-use rules'],
      },
    },
    evalFocus: ['workflow clarity'],
    successMetrics: ['mock score'],
    promotionRisks: ['overfitting'],
    reasonNotTestingOtherHighPriorityParameters: ['keep focused'],
  };
}

function fakeCreator(candidateId, experimentArm, strategy) {
  return {
    candidateId,
    experimentArm,
    strategy,
    changedParameterIds: ['p01'],
    files: [{
      path: 'SKILL.md',
      content: `---\nname: ux-design-${candidateId}\ndescription: Use for UX design.\n---\n\n# UX Design ${candidateId}\n\nStrategy: ${strategy}\n`,
    }],
    rationale: `Uses ${strategy}.`,
    expectedAdvantages: ['clear behavior'],
    expectedRisks: ['limited test coverage'],
    selfCritique: ['Needs real eval.'],
  };
}

async function tieModelClient(request) {
  if (request.jsonMode) {
    return JSON.stringify({
      winner: 'tie',
      scoreA: 3,
      scoreB: 3,
      breakdown: {
        skillA: {},
        skillB: {},
      },
      reasoning: 'Injected tie keeps the run inconclusive.',
    });
  }
  return 'Injected generated output';
}
