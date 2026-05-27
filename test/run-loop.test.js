import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProject } from '../src/lib/run-loop.js';
import { initProject } from '../src/lib/init.js';
import { getProjectPaths } from '../src/lib/paths.js';
import { createProjectForUi } from '../src/lib/ui-api.js';

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

test('run loop persists configured eval retry and promotion reliability policy', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-eval-policy-'));
  const projectName = 'UX Design Eval Policy';
  await initProject({
    cwd,
    projectName,
    goal: 'Help agents design better UX.',
  });
  const paths = getProjectPaths(cwd, projectName);
  const config = JSON.parse(await fs.readFile(paths.configJson, 'utf8'));
  await fs.writeFile(paths.configJson, JSON.stringify({
    ...config,
    promotion: {
      ...config.promotion,
      maxStablePromptRegression: 3,
      minEvalCompletionRate: 0.9,
    },
    eval: {
      ...config.eval,
      retryPolicy: {
        generationMaxAttempts: 3,
        judgeMaxAttempts: 4,
        backoffMs: 0,
      },
    },
  }, null, 2));

  const result = await runProject({
    cwd,
    projectName,
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });

  const runId = result.completedRuns[0].runId;
  const evalConfig = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'eval',
    'config.json',
  ), 'utf8'));
  const runRecord = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'run.json',
  ), 'utf8'));
  const duel = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'eval',
    'candidate-duel.json',
  ), 'utf8'));

  assert.deepEqual(evalConfig.retryPolicy, {
    generationMaxAttempts: 3,
    judgeMaxAttempts: 4,
    backoffMs: 0,
  });
  assert.equal(duel.modelMetadata.retryPolicy.generationMaxAttempts, 3);
  assert.equal(evalConfig.promotionPolicy.maxStablePromptRegression, 3);
  assert.equal(runRecord.promotionPolicy.minEvalCompletionRate, 0.9);
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

test('runs write and finalize a manager artifact', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-manager-artifact-'));

  const result = await runProject({
    cwd,
    projectName: 'UX Design Manager',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });

  const runId = result.completedRuns[0].runId;
  const manager = JSON.parse(await fs.readFile(path.join(
    result.paths.runsDir,
    runId,
    'manager',
    'manager.json',
  ), 'utf8'));
  const timeline = await fs.readFile(path.join(result.paths.runsDir, runId, 'timeline.jsonl'), 'utf8');

  assert.equal(manager.runId, runId);
  assert.equal(manager.strategy.experimentFamily, 'standard_focused_ab');
  assert.equal(manager.finalAction.decision, result.completedRuns[0].recommendation.decision);
  assert.ok(Array.isArray(manager.experimentIntent.plannerInstructions));
  assert.match(timeline, /manager_plan\.written/);
  assert.match(timeline, /manager_plan\.finalized/);
});

test('manager avoids parameters marked do-not-repeat without new evidence', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-manager-avoid-'));

  const first = await runProject({
    cwd,
    projectName: 'UX Design Avoid',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });
  const history = JSON.parse(await fs.readFile(first.paths.historyIndex, 'utf8'));
  await fs.writeFile(first.paths.historyIndex, `${JSON.stringify({
    ...history,
    parameterLog: [
      {
        parameterId: 'p01-activation_metadata',
        testedInRuns: ['seed-run'],
        currentBelief: 'Activation metadata test was noisy.',
        status: 'do_not_retry_without_new_evidence',
      },
      {
        parameterId: 'p02-trigger_boundaries',
        testedInRuns: ['seed-run'],
        currentBelief: 'Trigger boundary test was inconclusive.',
        status: 'do_not_retry_without_new_evidence',
      },
      {
        parameterId: 'p03-workflow_sequence',
        testedInRuns: ['seed-run'],
        currentBelief: 'Workflow sequence test lost twice.',
        status: 'do_not_retry_without_new_evidence',
      },
    ],
    doNotRepeat: ['Do not retry the first three parameters without new evidence.'],
  }, null, 2)}\n`, 'utf8');

  const second = await runProject({
    cwd,
    projectName: 'UX Design Avoid',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });

  const runId = second.completedRuns[0].runId;
  const plan = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    runId,
    'deconstruction',
    'experiment-plan.json',
  ), 'utf8'));
  const manager = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    runId,
    'manager',
    'manager.json',
  ), 'utf8'));

  assert.deepEqual(manager.avoid.parameterIds, [
    'p01-activation_metadata',
    'p02-trigger_boundaries',
    'p03-workflow_sequence',
  ]);
  assert.ok(manager.selectedPriorArtifacts.some(item => item.kind === 'run_report'));
  assert.ok(plan.focusParameterIds.every(id => !manager.avoid.parameterIds.includes(id)));
  assert.ok(plan.focusParameterIds.includes('p04-decision_heuristics'));
});

test('manager detects local maxima and switches to high-divergence reset planning', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-manager-local-max-'));

  const first = await runProject({
    cwd,
    projectName: 'UX Design Local Max',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });
  const history = JSON.parse(await fs.readFile(first.paths.historyIndex, 'utf8'));
  await fs.writeFile(first.paths.historyIndex, `${JSON.stringify({
    ...history,
    trajectory: [
      { runId: 'old-001', decision: 'keep_current', scoreDelta: 0, parameterTested: ['p01'], summary: 'No signal.' },
      { runId: 'old-002', decision: 'request_new_experiment', scoreDelta: 0, parameterTested: ['p02'], summary: 'Inconclusive.' },
      { runId: 'old-003', decision: 'keep_current', scoreDelta: 1, parameterTested: ['p03'], summary: 'Current champion held.' },
    ],
  }, null, 2)}\n`, 'utf8');

  const second = await runProject({
    cwd,
    projectName: 'UX Design Local Max',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });

  const runId = second.completedRuns[0].runId;
  const manager = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    runId,
    'manager',
    'manager.json',
  ), 'utf8'));
  const plan = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    runId,
    'deconstruction',
    'experiment-plan.json',
  ), 'utf8'));

  assert.equal(manager.localMaxima.detected, true);
  assert.equal(manager.strategy.experimentFamily, 'high_divergence_reset');
  assert.match(plan.experimentQuestion, /High-divergence reset/);
  assert.match(plan.arms.candidateA.strategyName, /^high-divergence-/);
  assert.match(plan.arms.candidateB.strategyName, /^reset-control-/);
});

test('manager respects configured hook focus fields', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-hook-focus-fields-'));
  const first = await runProject({
    cwd,
    projectName: 'UX Design Hook Focus',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
  });
  await fs.writeFile(first.paths.configJson, JSON.stringify({
    trigger: {
      mode: 'hook',
      hookFocusFields: ['reason'],
    },
  }, null, 2));

  const second = await runProject({
    cwd,
    projectName: 'UX Design Hook Focus',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'mock',
    triggerMode: 'hook',
    hookContext: {
      id: 'hook-reason-only',
      payload: {
        source: 'test',
        reason: 'The output contract changed.',
        changedFiles: ['references/domain-notes.md'],
      },
    },
  });

  const runId = second.completedRuns[0].runId;
  const manager = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    runId,
    'manager',
    'manager.json',
  ), 'utf8'));
  const plan = JSON.parse(await fs.readFile(path.join(
    second.paths.runsDir,
    runId,
    'deconstruction',
    'experiment-plan.json',
  ), 'utf8'));

  assert.deepEqual(manager.trigger.hook.focusParameterIds, ['p08-output_contract']);
  assert.ok(plan.focusParameterIds.includes('p08-output_contract'));
  assert.ok(!plan.focusParameterIds.includes('p06-reference_architecture'));
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

test('agentic first run persists research packet and quality-gated ontology artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agentic-research-'));
  const calls = [];
  let ontologyCalls = 0;

  const result = await runProject({
    cwd,
    projectName: 'UX Design Research',
    goal: 'Help agents design better UX.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    agentModel: 'gpt-5.4-mini',
    modelClient: async request => {
      calls.push(request);
      const prompt = request.messages[0].content;
      if (request.tools?.some(tool => tool.type === 'web_search')) return JSON.stringify(fakeResearchPacket());
      if (prompt.includes('Ontology Agent')) {
        ontologyCalls += 1;
        return JSON.stringify(ontologyCalls === 1 ? fakeSloppyOntology() : fakeRichOntology());
      }
      if (prompt.includes('Parameterization Agent')) return JSON.stringify(fakeRichParameterization());
      if (prompt.includes('Experiment Planner')) return JSON.stringify(fakeExperimentPlan());
      if (prompt.includes('Assigned experiment arm: candidateB')) return JSON.stringify(fakeCreator('candidate-b', 'candidateB', 'Embedded boundary policy'));
      if (prompt.includes('Assigned experiment arm: candidateA')) return JSON.stringify(fakeCreator('candidate-a', 'candidateA', 'Description-only tightening'));
      if (prompt.includes('Interpret this Skill RSI run')) return JSON.stringify({
        runId: 'analyst',
        decision: 'promote',
        recommendedChampionCandidateId: 'candidate-a',
        confidence: 'medium',
        reasoning: 'Candidate A performed better.',
        observations: ['Candidate A won.'],
        nextRoundGuidance: { vary: 'next parameter', preserve: 'candidate-a', investigate: 'durability' },
      });
      if (prompt.includes('adversarial reviewer')) return JSON.stringify({ blockingIssues: [], recommendedEdits: [], nonIssues: ['stub review'], overfittingRisk: 'low' });
      if (prompt.includes('Generate the evaluation criteria')) return JSON.stringify({
        criteria: [
          { id: 'clarity', name: 'Clarity', description: 'Clear output', rubric: { 5: 'great', 3: 'ok', 1: 'bad' } },
          { id: 'usefulness', name: 'Usefulness', description: 'Useful output', rubric: { 5: 'great', 3: 'ok', 1: 'bad' } },
          { id: 'specificity', name: 'Specificity', description: 'Specific output', rubric: { 5: 'great', 3: 'ok', 1: 'bad' } },
        ],
      });
      if (prompt.includes('Write 10 realistic')) return JSON.stringify({ prompts: Array.from({ length: 10 }, (_, i) => `Research prompt ${i + 1}`) });
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
    },
  });

  const runId = result.completedRuns[0].runId;
  const research = JSON.parse(await fs.readFile(path.join(result.paths.runsDir, runId, 'research', 'research-packet.json'), 'utf8'));
  const ontologyQuality = JSON.parse(await fs.readFile(path.join(result.paths.runsDir, runId, 'deconstruction', 'ontology-quality-report.json'), 'utf8'));
  const deconstructionQuality = JSON.parse(await fs.readFile(path.join(result.paths.runsDir, runId, 'deconstruction', 'deconstruction-quality-report.json'), 'utf8'));

  assert.ok(calls.some(call => call.tools?.some(tool => tool.type === 'web_search')));
  assert.equal(research.researchMode, 'sourced');
  assert.ok(research.authorityMap.some(authority => authority.name === 'Steve Jobs'));
  assert.equal(ontologyCalls, 2);
  assert.ok(ontologyQuality.revisedFrom);
  assert.equal(deconstructionQuality.status, 'pass');
});

test('agentic baseline projects skip ontology and start from deconstruction', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-agentic-baseline-'));
  await createProjectForUi({
    cwd,
    projectName: 'Baseline Agentic',
    goal: 'Improve the uploaded baseline skill.',
    baselineFiles: [{
      path: 'SKILL.md',
      content: `---
name: baseline-agentic
description: Use when improving an uploaded baseline skill.
---

# Baseline Skill

Follow the existing workflow.
`,
    }],
  });

  const result = await runProject({
    cwd,
    projectName: 'Baseline Agentic',
    goal: 'Improve the uploaded baseline skill.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    agentModel: 'fake-agent-model',
    modelClient: async request => {
      const prompt = request.messages[0].content;
      if (prompt.includes('Ontology Agent')) throw new Error('baseline run should not call ontology');
      if (prompt.includes('Deconstruction and Parameterization Agent')) {
        assert.match(prompt, /Baseline Skill/);
        return JSON.stringify(fakeRichParameterization());
      }
      if (prompt.includes('Experiment Planner')) return JSON.stringify(fakeExperimentPlan());
      if (prompt.includes('Assigned experiment arm: candidateB')) return JSON.stringify(fakeCreator('candidate-b', 'candidateB', 'Embedded boundary policy'));
      if (prompt.includes('Assigned experiment arm: candidateA')) return JSON.stringify(fakeCreator('candidate-a', 'candidateA', 'Description-only tightening'));
      if (prompt.includes('Interpret this Skill RSI run')) return JSON.stringify({
        runId: 'analyst',
        decision: 'promote',
        recommendedChampionCandidateId: 'candidate-a',
        confidence: 'medium',
        reasoning: 'Candidate A improved the uploaded baseline.',
        observations: ['Baseline was deconstructed directly.'],
        nextRoundGuidance: { vary: 'next baseline weakness', preserve: 'baseline strengths', investigate: 'durability' },
      });
      if (prompt.includes('adversarial reviewer')) return JSON.stringify({ blockingIssues: [], recommendedEdits: [], nonIssues: ['stub review'], overfittingRisk: 'low' });
      throw new Error(`Unexpected prompt: ${prompt.slice(0, 120)}`);
    },
  });

  const runId = result.completedRuns[0].runId;
  const timeline = await fs.readFile(path.join(result.paths.runsDir, runId, 'timeline.jsonl'), 'utf8');
  assert.match(timeline, /ontology\.skipped_for_baseline/);
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

function fakeResearchPacket() {
  return {
    runId: 'research',
    skillGoal: 'Help agents design better UX.',
    researchMode: 'sourced',
    provider: 'openai',
    sources: [{ id: 's1', title: 'Steve Jobs product philosophy', url: 'https://example.com/jobs' }],
    searchTrace: [{ query: 'Steve Jobs product development philosophy', rationale: 'find authority opinions', resultCount: 1 }],
    evidenceClaims: [{
      claim: 'Strong product work starts from customer experience.',
      evidenceBasis: 'sourced',
      sourceRefs: ['s1'],
      confidence: 'medium',
      implicationsForSkill: ['Require UX recommendations to start from user outcomes.'],
    }],
    authorityMap: [{
      name: 'Steve Jobs',
      authorityType: 'practitioner',
      whyTheyMatter: 'Canonical product leader associated with integrated user experience.',
      strongOpinions: ['Start with the customer experience and work backward.'],
      implicationsForSkill: ['Skill should force user-outcome-first reasoning.'],
      misuseRisks: ['Do not use taste as a substitute for validation.'],
      evidenceBasis: 'sourced',
      sourceRefs: ['s1'],
    }],
    openQuestions: [],
    gaps: [],
  };
}

function fakeSloppyOntology() {
  return {
    ...fakeOntology(),
    authorityMap: [],
    failureModes: ['over-triggering'],
    qualityAxes: ['task success', 'workflow clarity'],
  };
}

function fakeRichOntology() {
  return {
    ...fakeOntology(),
    failureModes: ['over-triggering', 'visual-only critique', 'missing product constraints'],
    qualityAxes: ['user-outcome fit', 'interaction clarity', 'constraint-aware prioritization'],
    authorityMap: fakeResearchPacket().authorityMap,
    evidenceClaims: fakeResearchPacket().evidenceClaims,
    sourceRefs: ['s1'],
    inferenceLabels: ['Some UX domain implications are inferred from sourced product philosophy.'],
    unsupportedClaims: [],
    researchGaps: [],
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

function fakeRichParameterization() {
  const parameterization = fakeParameterization();
  return {
    ...parameterization,
    parameters: parameterization.parameters.map(parameter => ({
      ...parameter,
      improvementHypothesis: `Change ${parameter.surface} to improve user-outcome fit.`,
      artifactEvidence: ['First run has no champion artifact; baseline is ontology-derived.'],
      couplingNotes: ['May couple with activation and workflow sequence.'],
    })),
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
