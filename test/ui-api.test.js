import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProject } from '../src/lib/run-loop.js';
import {
  createProjectForUi,
  readProjectSummaries,
  readProjectSummary,
  readRunComparison,
  readRunDetail,
  recordHumanDecision,
} from '../src/lib/ui-api.js';

test('ui api exposes stable project and run detail surfaces', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-'));
  const result = await runProject({
    cwd,
    projectName: 'UI API Project',
    goal: 'Test UI API surfaces.',
    loops: 1,
    mode: 'mock',
  });
  const runId = result.completedRuns[0].runId;

  const summary = await readProjectSummary({ cwd, projectName: 'UI API Project' });
  assert.equal(summary.schemaVersion, 1);
  assert.equal(summary.projectId, 'ui-api-project');
  assert.equal(summary.goal, 'Test UI API surfaces.');
  assert.equal(summary.state.runCount, 1);
  assert.equal(summary.history.trajectoryLength, 1);
  assert.equal(summary.promptBank.stablePromptCount, 6);
  assert.ok(summary.artifacts.historyIndex.endsWith('history/index.json'));

  const summaries = await readProjectSummaries({ cwd });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].projectId, 'ui-api-project');

  const detail = await readRunDetail({ cwd, projectName: 'UI API Project', runId });
  assert.equal(detail.schemaVersion, 1);
  assert.equal(detail.runId, runId);
  assert.equal(detail.run.runId, runId);
  assert.ok(detail.parameterization.parameters.length >= 12);
  assert.ok(detail.experimentPlan.focusParameterIds.length >= 1);
  assert.ok(detail.candidates.candidateA.skillPath.endsWith('candidate-a/skill'));
  assert.equal(detail.evals.candidateDuel.stats.totalEvals, 10);
  assert.equal(detail.timeline.at(0).event, 'run.started');
});

test('ui api exposes comparison and human decision artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-decision-'));
  const result = await runProject({
    cwd,
    projectName: 'UI API Decision Project',
    goal: 'Test UI API decision surfaces.',
    loops: 1,
    mode: 'mock',
  });
  const runId = result.completedRuns[0].runId;

  const comparison = await readRunComparison({ cwd, projectName: 'UI API Decision Project', runId });
  assert.equal(comparison.schemaVersion, 1);
  assert.equal(comparison.sides.candidateA.available, true);
  assert.equal(comparison.sides.candidateB.available, true);
  assert.equal(comparison.sides.currentChampion.available, true);
  assert.ok(comparison.evalSummary.candidateDuel.winner);
  assert.ok(comparison.recommendation.decision);

  const decision = await recordHumanDecision({
    cwd,
    projectName: 'UI API Decision Project',
    runId,
    decision: 'annotate',
    note: 'Reviewed for UI API test.',
  });
  assert.equal(decision.schemaVersion, 1);
  assert.equal(decision.projectId, 'ui-api-decision-project');
  assert.equal(decision.runId, runId);
  assert.equal(decision.decision, 'annotate');
  assert.ok(decision.artifactPath.endsWith('.json'));

  const detail = await readRunDetail({ cwd, projectName: 'UI API Decision Project', runId });
  assert.equal(detail.humanDecisions.length, 1);
  assert.equal(detail.humanDecisions[0].note, 'Reviewed for UI API test.');
  assert.ok(detail.timeline.some(entry => entry.event === 'human_decision.recorded'));
});

test('ui api creates new projects and rejects duplicates', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-create-'));

  const created = await createProjectForUi({
    cwd,
    projectName: 'New UI Project',
    goal: 'Create projects from the UI.',
  });

  assert.equal(created.schemaVersion, 1);
  assert.equal(created.projectId, 'new-ui-project');
  assert.equal(created.goal, 'Create projects from the UI.');
  assert.equal(created.state.runCount, 0);
  assert.equal(created.state.runPolicy.triggerMode, 'manual');
  assert.equal(created.state.runPolicy.targetIterations, 3);

  const summaries = await readProjectSummaries({ cwd });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].projectId, 'new-ui-project');

  await assert.rejects(
    () => createProjectForUi({
      cwd,
      projectName: 'New UI Project',
      goal: 'Create projects from the UI.',
    }),
    /already exists/
  );
});

test('ui api stores requested target iterations', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-policy-'));

  const created = await createProjectForUi({
    cwd,
    projectName: 'Policy Project',
    goal: 'Store run policy from the UI.',
    targetIterations: 7,
  });

  assert.equal(created.state.runPolicy.triggerMode, 'manual');
  assert.equal(created.state.runPolicy.targetIterations, 7);

  await runProject({
    cwd,
    projectName: 'Policy Project',
    goal: 'Store run policy from the UI.',
    loops: 1,
    mode: 'mock',
    maxRuns: 7,
  });

  const afterRun = await readProjectSummary({ cwd, projectName: 'Policy Project' });
  assert.equal(afterRun.state.runPolicy.triggerMode, 'manual');
  assert.equal(afterRun.state.runPolicy.targetIterations, 7);
});
