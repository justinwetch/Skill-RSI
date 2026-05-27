import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject } from '../src/lib/init.js';
import { runProject } from '../src/lib/run-loop.js';

test('runProject refuses to run when project lock exists', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-lock-'));
  const initialized = await initProject({
    cwd,
    projectName: 'Locked Project',
    goal: 'Test lock behavior.',
  });
  await fs.writeFile(path.join(initialized.projectDir, 'run.lock'), '{}');

  await assert.rejects(() => runProject({
    cwd,
    projectName: 'Locked Project',
    goal: 'Test lock behavior.',
    loops: 1,
    mode: 'mock',
  }), /already locked/);
});

test('runProject enforces max run budget', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-budget-'));

  await assert.rejects(() => runProject({
    cwd,
    projectName: 'Budget Project',
    goal: 'Test budget behavior.',
    loops: 3,
    mode: 'mock',
    maxRuns: 2,
  }), /Run budget exceeded/);
});

test('runProject writes a per-run timeline', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-timeline-'));
  const result = await runProject({
    cwd,
    projectName: 'Timeline Project',
    goal: 'Test timeline behavior.',
    loops: 1,
    mode: 'mock',
  });

  const runId = result.completedRuns[0].runId;
  const timeline = await fs.readFile(path.join(result.paths.runsDir, runId, 'timeline.jsonl'), 'utf8');

  assert.match(timeline, /run.started/);
  assert.match(timeline, /candidate_duel.completed/);
  assert.match(timeline, /run.completed/);
});

test('runProject records failed runs in the timeline before rethrowing', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-timeline-failure-'));

  await assert.rejects(() => runProject({
    cwd,
    projectName: 'Timeline Failure Project',
    goal: 'Test timeline failure behavior.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    agentModel: 'fake-agent-model',
    modelClient: async () => {
      throw new Error('Injected model failure');
    },
  }), /Injected model failure/);

  const runsDir = path.join(cwd, '.skill-rsi', 'projects', 'timeline-failure-project', 'runs');
  const [runId] = await fs.readdir(runsDir);
  const timeline = await fs.readFile(path.join(runsDir, runId, 'timeline.jsonl'), 'utf8');
  const run = JSON.parse(await fs.readFile(path.join(runsDir, runId, 'run.json'), 'utf8'));

  assert.match(timeline, /run.started/);
  assert.match(timeline, /run.failed/);
  assert.match(timeline, /Injected model failure/);
  assert.equal(run.status, 'failed');
  assert.equal(run.error.message, 'Injected model failure');
});

test('runProject retries malformed creator artifacts with candidate-specific diagnostics', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-creator-retry-'));
  let creatorBCalls = 0;

  const result = await runProject({
    cwd,
    projectName: 'Creator Retry Project',
    goal: 'Help agents write better Reddit posts.',
    loops: 1,
    mode: 'agentic',
    evalMode: 'mock',
    generationModel: 'fake-agent-model',
    judgeModel: 'fake-agent-model',
    agentModel: 'fake-agent-model',
    modelClient: async ({ systemPrompt, messages }) => {
      const prompt = messages?.[0]?.content || '';
      if (systemPrompt.includes('Skill RSI subagent')) {
        if (prompt.includes('Ontology Agent')) return JSON.stringify(fakeOntology());
        if (prompt.includes('Parameterization Agent')) return JSON.stringify(fakeParameterization());
        if (prompt.includes('Experiment Planner')) return JSON.stringify(fakeExperimentPlan());
        if (prompt.includes('Assigned experiment arm: candidateB')) {
          creatorBCalls += 1;
          return JSON.stringify(creatorBCalls === 1 ? fakeCreatorArtifact('candidate-b', 'candidateB', []) : fakeCreatorArtifact('candidate-b', 'candidateB'));
        }
        if (prompt.includes('Assigned experiment arm: candidateA')) {
          return JSON.stringify(fakeCreatorArtifact('candidate-a', 'candidateA'));
        }
      }
      if (systemPrompt.includes('configuration generator')) return JSON.stringify(fakeCriteria());
      if (systemPrompt.includes('evaluation prompts')) {
        const count = Number(prompt.match(/Write (\d+) realistic/)?.[1] || 10);
        return JSON.stringify({ prompts: Array.from({ length: count }, (_, index) => `Please help write Reddit post ${index + 1}.`) });
      }
      if (systemPrompt.includes('adversarial reviewer')) {
        return JSON.stringify({ blockingIssues: [], recommendedEdits: [], nonIssues: ['Looks valid.'], overfittingRisk: 'low' });
      }
      if (systemPrompt.includes('Skill RSI analyst')) {
        return JSON.stringify({
          runId: 'ignored',
          decision: 'promote',
          recommendedChampionCandidateId: 'candidate-b',
          confidence: 'medium',
          reasoning: 'Candidate B recovered and performed well.',
          observations: ['Candidate B was usable after repair.'],
          nextRoundGuidance: { vary: 'examples', preserve: 'workflow', investigate: 'edge cases' },
        });
      }
      return JSON.stringify({});
    },
  });

  const runId = result.completedRuns[0].runId;
  const projectDir = path.join(cwd, '.skill-rsi', 'projects', 'creator-retry-project');
  const runDir = path.join(projectDir, 'runs', runId);
  const timeline = await fs.readFile(path.join(runDir, 'timeline.jsonl'), 'utf8');
  const failure = JSON.parse(await fs.readFile(path.join(runDir, 'candidates', 'candidate-b', 'creator-contract-failure-001.json'), 'utf8'));
  const run = JSON.parse(await fs.readFile(path.join(runDir, 'run.json'), 'utf8'));

  assert.equal(creatorBCalls, 2);
  assert.equal(run.status, 'completed');
  assert.match(timeline, /creator_contract.failed/);
  assert.match(timeline, /creator_contract.retrying/);
  assert.match(timeline, /creator_contract.recovered/);
  assert.match(failure.message, /SKILL\.md/);
  assert.ok(result.history.failedStrategyLog.some(item => (
    item.source === 'creator_contract'
    && item.candidateId === 'candidate-b'
    && item.status === 'recovered_or_contained'
  )));
  assert.match(
    await fs.readFile(path.join(projectDir, 'history', 'current-summary.md'), 'utf8'),
    /Failed or recovered strategies:/,
  );
});

function fakeOntology() {
  return {
    skillGoal: 'Help agents write better Reddit posts.',
    targetUsers: ['agents'],
    targetTasks: ['write posts'],
    invocationBoundaries: {
      shouldTriggerWhen: ['Reddit writing request'],
      shouldNotTriggerWhen: ['unrelated request'],
    },
    inputSurface: ['user request'],
    outputArtifacts: ['post draft'],
    requiredKnowledge: ['Reddit norms'],
    failureModes: ['generic copy'],
    qualityAxes: ['workflow clarity', 'audience fit', 'validation usefulness'],
    evalPromptTaxonomy: ['title request', 'draft request'],
    candidateStrategySpace: ['structured', 'fast'],
  };
}

function fakeParameterization() {
  return {
    summary: 'Seed Reddit writing surfaces.',
    parameters: Array.from({ length: 12 }, (_, index) => ({
      id: `p${String(index + 1).padStart(2, '0')}`,
      surface: `surface ${index + 1}`,
      currentImplementation: 'baseline',
      improvementHypothesis: 'A focused change may improve Reddit writing quality.',
      expectedBenefit: 'better posts',
      regressionRisk: 'more verbosity',
      evidenceFromHistory: [],
      possibleMutations: ['change workflow'],
      measurementPlan: 'Compare candidate outputs.',
      priority: index === 0 ? 'high' : 'medium',
      confidence: 'medium',
      granularity: 'section',
    })),
    crossParameterInteractions: [],
    highestLeverageHypotheses: ['Improve workflow sequence.'],
    doNotTouchYet: [],
    suggestedExperimentFamilies: ['workflow comparison'],
  };
}

function fakeExperimentPlan() {
  return {
    experimentQuestion: 'Does a stronger workflow improve Reddit drafts?',
    focusParameterIds: ['p01'],
    controlledParameterIds: ['p02'],
    hypothesis: 'A stronger workflow improves output.',
    arms: {
      candidateA: { strategyName: 'Structured workflow', mutationInstructions: ['Use a clear sequence.'] },
      candidateB: { strategyName: 'Fast workflow', mutationInstructions: ['Use a lighter sequence.'] },
    },
    evalFocus: ['workflow clarity'],
    successMetrics: ['higher mock score'],
    promotionRisks: ['overfitting'],
    reasonNotTestingOtherHighPriorityParameters: ['Keep scope narrow.'],
  };
}

function fakeCreatorArtifact(candidateId, experimentArm, files = null) {
  return {
    candidateId,
    experimentArm,
    strategy: `${candidateId} strategy`,
    changedParameterIds: ['p01'],
    files: files ?? [{
      path: 'SKILL.md',
      content: `---
name: reddit-post-writer
description: Use when helping draft, rewrite, validate, or improve Reddit posts for a specific subreddit or audience.
---

# Reddit Post Writer

Use this skill when the user asks for Reddit titles, posts, rewrites, or subreddit-specific drafting help.

## Workflow

1. Identify the subreddit, audience, goal, and source material.
2. Draft a concise post with a clear hook and readable paragraphs.
3. Validate the draft for subreddit fit, authenticity, clarity, and unsupported claims.

## Output

Return the requested title, post body, rewrite, or variants in a clean format.
`,
    }],
    rationale: 'Creates a valid Reddit writing skill.',
    expectedAdvantages: ['clear workflow'],
    expectedRisks: ['may be conservative'],
    selfCritique: ['Needs live evaluation.'],
  };
}

function fakeCriteria() {
  return {
    criteria: [
      { id: 'clarity', name: 'Clarity', description: 'Clear output.', rubric: { 5: 'great', 4: 'good', 3: 'ok', 2: 'weak', 1: 'bad' } },
      { id: 'fit', name: 'Fit', description: 'Fits Reddit.', rubric: { 5: 'great', 4: 'good', 3: 'ok', 2: 'weak', 1: 'bad' } },
      { id: 'usefulness', name: 'Usefulness', description: 'Useful draft.', rubric: { 5: 'great', 4: 'good', 3: 'ok', 2: 'weak', 1: 'bad' } },
    ],
  };
}
