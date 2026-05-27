import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CLI = path.resolve('src/cli.js');

test('step and report commands work from CLI', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-step-'));

  const step = await execFileAsync('node', [CLI, 'step', 'CLI Project', '--mock', '--goal', 'Test CLI step.'], { cwd });
  assert.match(step.stdout, /Stepped cli-project to run 1/);

  const timeline = await execFileAsync('node', [CLI, 'timeline', 'CLI Project'], { cwd });
  assert.match(timeline.stdout, /# Timeline:/);
  assert.match(timeline.stdout, /run.started/);
  assert.match(timeline.stdout, /candidate_duel.completed/);

  const timelineJson = await execFileAsync('node', [CLI, 'timeline', 'CLI Project', '--json'], { cwd });
  const parsedTimeline = JSON.parse(timelineJson.stdout);
  assert.equal(parsedTimeline.projectId, 'cli-project');
  assert.ok(parsedTimeline.entries.some(entry => entry.event === 'run.completed'));

  const projects = await execFileAsync('node', [CLI, 'projects'], { cwd });
  assert.equal(JSON.parse(projects.stdout).projects[0].projectId, 'cli-project');

  const summary = await execFileAsync('node', [CLI, 'summary', 'CLI Project'], { cwd });
  assert.equal(JSON.parse(summary.stdout).schemaVersion, 1);

  const detail = await execFileAsync('node', [CLI, 'run-detail', 'CLI Project'], { cwd });
  assert.equal(JSON.parse(detail.stdout).projectId, 'cli-project');

  const comparison = await execFileAsync('node', [CLI, 'compare', 'CLI Project'], { cwd });
  assert.equal(JSON.parse(comparison.stdout).sides.candidateA.available, true);

  const decision = await execFileAsync('node', [
    CLI,
    'decide',
    'CLI Project',
    '--decision',
    'annotate',
    '--note',
    'CLI reviewed',
  ], { cwd });
  assert.equal(JSON.parse(decision.stdout).decision, 'annotate');

  const report = await execFileAsync('node', [CLI, 'report', 'CLI Project'], { cwd });
  assert.match(report.stdout, /Current Summary/);
  assert.match(report.stdout, /Test CLI step/);
});

test('continuous command runs only remaining budget', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-continuous-'));

  const first = await execFileAsync('node', [CLI, 'continuous', 'Continuous Project', '--mock', '--max-runs', '2'], { cwd });
  assert.match(first.stdout, /completed 2 loop/);

  const second = await execFileAsync('node', [CLI, 'continuous', 'Continuous Project', '--mock', '--max-runs', '2'], { cwd });
  assert.match(second.stdout, /already at max-runs 2/);
});

test('hook command records event and triggers one run', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-hook-'));
  const hookPath = path.join(cwd, 'hook.json');
  await fs.writeFile(hookPath, JSON.stringify({ source: 'test', changedFiles: ['SKILL.md'] }));

  const hook = await execFileAsync('node', [CLI, 'hook', 'Hook Project', '--mock', '--event', hookPath], { cwd });
  assert.match(hook.stdout, /Recorded hook:/);
  assert.match(hook.stdout, /Triggered run:/);

  const hooksDir = path.join(cwd, '.skill-rsi', 'projects', 'hook-project', 'hooks');
  const hooks = await fs.readdir(hooksDir);
  assert.equal(hooks.length, 1);
});
