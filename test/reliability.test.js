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

  assert.match(timeline, /run.started/);
  assert.match(timeline, /run.failed/);
  assert.match(timeline, /Injected model failure/);
});
