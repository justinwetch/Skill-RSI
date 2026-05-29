import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { claimPendingHookEvents, summarizeHookEvents } from '../src/lib/hooks.js';

const execFileAsync = promisify(execFile);
const CLI = path.resolve('src/cli.js');
const CODEX_HOOK_SCRIPT = path.resolve('scripts/codex-skill-rsi-hook.mjs');
const CRON_RUNNER = path.resolve('scripts/skill-rsi-cron-runner.mjs');

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

test('init command supports UI-equivalent project configuration', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-init-'));

  const init = await execFileAsync('node', [
    CLI,
    'init',
    'Code Project',
    '--goal',
    'Improve an implementation skill.',
    '--output',
    'code',
    '--model',
    'gpt-5.5',
    '--target-iterations',
    '5',
    '--json',
  ], { cwd });
  const created = JSON.parse(init.stdout);

  assert.equal(created.projectId, 'code-project');
  assert.equal(created.config.eval.outputType, 'code');
  assert.equal(created.config.eval.taskContract.id, 'code_standalone');
  assert.equal(created.config.models.agent, 'gpt-5.5');
  assert.equal(created.config.models.generation, 'gpt-5.5');
  assert.equal(created.config.models.judge, 'gpt-5.5');
  assert.equal(created.state.runPolicy.targetIterations, 5);
});

test('init command imports baseline directory, single markdown, and zip packages', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-baselines-'));

  const dirBaseline = path.join(cwd, 'dir-baseline');
  await fs.mkdir(path.join(dirBaseline, 'references'), { recursive: true });
  await fs.writeFile(path.join(dirBaseline, 'SKILL.md'), baselineSkill('dir-baseline'));
  await fs.writeFile(path.join(dirBaseline, 'references', 'notes.md'), '# Notes\n');
  const dirInit = await execFileAsync('node', [
    CLI,
    'init',
    'Directory Baseline',
    '--goal',
    'Improve a directory skill.',
    '--baseline',
    dirBaseline,
    '--json',
  ], { cwd });
  assert.equal(JSON.parse(dirInit.stdout).state.currentChampion.candidateId, 'baseline');

  const mdBaseline = path.join(cwd, 'single-skill.md');
  await fs.writeFile(mdBaseline, baselineSkill('single-baseline'));
  const mdInit = await execFileAsync('node', [
    CLI,
    'init',
    'Markdown Baseline',
    '--goal',
    'Improve a markdown skill.',
    '--baseline',
    mdBaseline,
    '--json',
  ], { cwd });
  assert.equal(JSON.parse(mdInit.stdout).state.currentChampion.candidateId, 'baseline');

  const zipBaseline = path.join(cwd, 'baseline.zip');
  await fs.writeFile(zipBaseline, createStoredZip({
    'zipped/SKILL.md': baselineSkill('zip-baseline'),
    'zipped/references/notes.md': '# Notes\n',
  }));
  const zipInit = await execFileAsync('node', [
    CLI,
    'init',
    'Zip Baseline',
    '--goal',
    'Improve a zip skill.',
    '--baseline',
    zipBaseline,
    '--json',
  ], { cwd });
  assert.equal(JSON.parse(zipInit.stdout).state.currentChampion.candidateId, 'baseline');
});

test('doctor, progress, skill, export-skill, and delete commands work from CLI', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-parity-'));
  const baseline = path.join(cwd, 'baseline.md');
  await fs.writeFile(baseline, baselineSkill('parity-baseline'));

  const doctor = await execFileAsync('node', [CLI, 'doctor', '--json'], { cwd });
  const doctorJson = JSON.parse(doctor.stdout);
  assert.equal(doctorJson.schemaVersion, 1);
  assert.equal(typeof doctorJson.openai.keyConfigured, 'boolean');
  assert.ok(!doctor.stdout.includes(process.env.OPENAI_API_KEY || 'sk-'));

  await execFileAsync('node', [
    CLI,
    'init',
    'Parity Project',
    '--goal',
    'Improve a baseline skill.',
    '--baseline',
    baseline,
  ], { cwd });

  const skill = await execFileAsync('node', [CLI, 'skill', 'Parity Project', '--source', 'champion'], { cwd });
  assert.match(skill.stdout, /# parity-baseline/);

  const skillJson = await execFileAsync('node', [CLI, 'skill', 'Parity Project', '--source', 'champion', '--json'], { cwd });
  assert.equal(JSON.parse(skillJson.stdout).available, true);

  const exportDir = path.join(cwd, 'exported');
  const exported = await execFileAsync('node', [
    CLI,
    'export-skill',
    'Parity Project',
    '--source',
    'champion',
    '--out',
    exportDir,
  ], { cwd });
  assert.match(exported.stdout, /Exported champion skill/);
  assert.match(await fs.readFile(path.join(exportDir, 'SKILL.md'), 'utf8'), /parity-baseline/);

  const progress = await execFileAsync('node', [CLI, 'progress', 'Parity Project', '--json'], { cwd });
  assert.equal(JSON.parse(progress.stdout).status, 'none');

  await execFileAsync('node', [CLI, 'step', 'Parity Project', '--mock'], { cwd });
  const progressAfterRun = await execFileAsync('node', [CLI, 'progress', 'Parity Project'], { cwd });
  assert.match(progressAfterRun.stdout, /Status: completed/);
  assert.match(progressAfterRun.stdout, /Competition:/);

  const deleted = await execFileAsync('node', [CLI, 'delete', 'Parity Project', '--json'], { cwd });
  const deletedJson = JSON.parse(deleted.stdout);
  assert.equal(deletedJson.deleted, 'parity-project');
  assert.ok(deletedJson.trashedTo.includes('.trash'));
});

test('evaluate command accepts output contracts and guards visual real eval artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-evaluate-'));
  const skillA = path.join(cwd, 'skill-a');
  const skillB = path.join(cwd, 'skill-b');
  await fs.mkdir(skillA, { recursive: true });
  await fs.mkdir(skillB, { recursive: true });
  await fs.writeFile(path.join(skillA, 'SKILL.md'), baselineSkill('eval-skill-a'));
  await fs.writeFile(path.join(skillB, 'SKILL.md'), baselineSkill('eval-skill-b'));
  const prompts = path.join(cwd, 'prompts.json');
  const criteria = path.join(cwd, 'criteria.json');
  await fs.writeFile(prompts, JSON.stringify([{ id: 'p1', prompt: 'Write a short answer.' }]));
  await fs.writeFile(criteria, JSON.stringify([{ id: 'c1', name: 'Quality', description: 'Quality.' }]));

  const mockEval = await execFileAsync('node', [
    CLI,
    'evaluate',
    'Eval Project',
    '--a',
    skillA,
    '--b',
    skillB,
    '--prompts',
    prompts,
    '--criteria',
    criteria,
    '--output',
    'code_visual',
    '--mock',
  ], { cwd });
  assert.equal(JSON.parse(mockEval.stdout).mode, 'mock');

  await assert.rejects(
    () => execFileAsync('node', [
      CLI,
      'evaluate',
      'Eval Project',
      '--a',
      skillA,
      '--b',
      skillB,
      '--prompts',
      prompts,
      '--criteria',
      criteria,
      '--output',
      'code_visual',
    ], { cwd }),
    /Real code_visual evaluation requires --visual-artifacts-dir/
  );
});

test('continuous command runs only remaining budget', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-continuous-'));

  const first = await execFileAsync('node', [CLI, 'continuous', 'Continuous Project', '--mock', '--max-runs', '2'], { cwd });
  assert.match(first.stdout, /completed 2 loop/);

  const second = await execFileAsync('node', [CLI, 'continuous', 'Continuous Project', '--mock', '--max-runs', '2'], { cwd });
  assert.match(second.stdout, /already at max-runs 2/);
});

test('continuous command supports max-new-runs per invocation cap', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-max-new-runs-'));

  const first = await execFileAsync('node', [
    CLI,
    'continuous',
    'Capped Project',
    '--mock',
    '--max-runs',
    '3',
    '--max-new-runs',
    '1',
  ], { cwd });
  assert.match(first.stdout, /completed 1 loop/);
  assert.match(first.stdout, /total runs 1/);

  const second = await execFileAsync('node', [
    CLI,
    'continuous',
    'Capped Project',
    '--mock',
    '--max-runs',
    '3',
    '--max-new-runs',
    '1',
  ], { cwd });
  assert.match(second.stdout, /completed 1 loop/);
  assert.match(second.stdout, /total runs 2/);

  await assert.rejects(
    () => execFileAsync('node', [
      CLI,
      'continuous',
      'Capped Project',
      '--mock',
      '--max-runs',
      '3',
      '--max-new-runs',
      '0',
    ], { cwd }),
    /--max-new-runs must be a positive integer/
  );
});

function baselineSkill(name) {
  return `---
name: ${name}
description: Use when testing CLI project creation and baseline import.
---

# ${name}
`;
}

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [filePath, content] of Object.entries(files)) {
    const name = Buffer.from(filePath);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
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

  const runsDir = path.join(cwd, '.skill-rsi', 'projects', 'hook-project', 'runs');
  const [runId] = await fs.readdir(runsDir);
  const manager = JSON.parse(await fs.readFile(path.join(runsDir, runId, 'manager', 'manager.json'), 'utf8'));
  const plan = JSON.parse(await fs.readFile(path.join(runsDir, runId, 'deconstruction', 'experiment-plan.json'), 'utf8'));
  assert.equal(manager.trigger.mode, 'hook');
  assert.ok(manager.trigger.hook.focusParameterIds.includes('p08-output_contract'));
  assert.ok(plan.focusParameterIds.includes('p08-output_contract'));
});

test('hook-record queues stdin event without triggering a run', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-hook-record-'));

  const recorded = await execFileWithInput('node', [
    CLI,
    'hook-record',
    'Queued Project',
    '--event',
    '-',
  ], JSON.stringify({
    hook_event_name: 'Stop',
    changedFiles: ['SKILL.md'],
    cwd,
    transcript_path: '/tmp/codex-transcript.jsonl',
    last_assistant_message: 'Do not persist this conversational output.',
  }), { cwd });
  assert.match(recorded.stdout, /Queued hook:/);

  const inboxDir = path.join(cwd, '.skill-rsi', 'projects', 'queued-project', 'hooks', 'inbox');
  const [eventFile] = await fs.readdir(inboxDir);
  const event = JSON.parse(await fs.readFile(path.join(inboxDir, eventFile), 'utf8'));
  assert.equal(event.eventName, 'Stop');
  assert.equal(event.transcriptPath, '/tmp/codex-transcript.jsonl');
  assert.equal(event.cwd, undefined);
  assert.equal(event.payload.cwd, undefined);
  assert.deepEqual(event.changedFiles, ['SKILL.md']);
  assert.equal(event.payload.last_assistant_message, undefined);
  assert.equal(event.payload.hookEventName, 'Stop');
  assert.equal(typeof event.rawPayloadSha256, 'string');

  const runsDir = path.join(cwd, '.skill-rsi', 'projects', 'queued-project', 'runs');
  await assert.rejects(() => fs.readdir(runsDir), { code: 'ENOENT' });
});

test('continuous --consume-hooks drains inbox without forcing a run at max-runs zero', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-consume-hooks-'));
  await execFileWithInput('node', [
    CLI,
    'hook-record',
    'Consume Project',
    '--event',
    '-',
  ], JSON.stringify({ hook_event_name: 'Stop', changedFiles: ['README.md'] }), { cwd });

  const consumed = await execFileAsync('node', [
    CLI,
    'continuous',
    'Consume Project',
    '--mock',
    '--max-runs',
    '0',
    '--consume-hooks',
  ], { cwd });
  assert.match(consumed.stdout, /Skipped 1 pending hook event/);
  assert.match(consumed.stdout, /already at max-runs 0/);

  const hooksDir = path.join(cwd, '.skill-rsi', 'projects', 'consume-project', 'hooks');
  const inbox = await safeReadDir(path.join(hooksDir, 'inbox'));
  const processing = await safeReadDir(path.join(hooksDir, 'processing'));
  const skipped = await fs.readdir(path.join(hooksDir, 'skipped'));
  assert.deepEqual(inbox, []);
  assert.deepEqual(processing, []);
  assert.equal(skipped.length, 1);
});

test('continuous --consume-hooks processes claimed events when a run completes', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-cli-process-hooks-'));
  await execFileWithInput('node', [
    CLI,
    'hook-record',
    'Process Project',
    '--event',
    '-',
  ], JSON.stringify({ hook_event_name: 'Stop', changedFiles: ['SKILL.md'] }), { cwd });

  const processedRun = await execFileAsync('node', [
    CLI,
    'continuous',
    'Process Project',
    '--mock',
    '--max-runs',
    '1',
    '--consume-hooks',
  ], { cwd });
  assert.match(processedRun.stdout, /Processed 1 pending hook event/);

  const hooksDir = path.join(cwd, '.skill-rsi', 'projects', 'process-project', 'hooks');
  assert.deepEqual(await safeReadDir(path.join(hooksDir, 'inbox')), []);
  assert.deepEqual(await safeReadDir(path.join(hooksDir, 'processing')), []);
  assert.equal((await fs.readdir(path.join(hooksDir, 'processed'))).length, 1);

  const runsDir = path.join(cwd, '.skill-rsi', 'projects', 'process-project', 'runs');
  const [runId] = await fs.readdir(runsDir);
  const manager = JSON.parse(await fs.readFile(path.join(runsDir, runId, 'manager', 'manager.json'), 'utf8'));
  assert.equal(manager.trigger.mode, 'hook');
  assert.deepEqual(manager.trigger.hook.changedFiles, ['SKILL.md']);
});

test('claimPendingHookEvents reclaims stale processing events', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-stale-processing-'));
  await execFileWithInput('node', [
    CLI,
    'hook-record',
    'Stale Project',
    '--event',
    '-',
  ], JSON.stringify({ hook_event_name: 'Stop', changedFiles: ['SKILL.md'] }), { cwd });

  const firstClaim = await claimPendingHookEvents({ cwd, projectName: 'Stale Project' });
  assert.equal(firstClaim.length, 1);

  const secondClaim = await claimPendingHookEvents({
    cwd,
    projectName: 'Stale Project',
    staleProcessingMs: 1,
    now: new Date(Date.now() + 60_000),
  });
  assert.equal(secondClaim.length, 1);
  assert.equal(secondClaim[0].id, firstClaim[0].id);
  assert.equal(secondClaim[0].queueStatus, 'processing');

  const hooksDir = path.join(cwd, '.skill-rsi', 'projects', 'stale-project', 'hooks');
  assert.deepEqual(await safeReadDir(path.join(hooksDir, 'inbox')), []);
  assert.equal((await fs.readdir(path.join(hooksDir, 'processing'))).length, 1);
});

test('claimPendingHookEvents leaves stale processing events alone while project is locked', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-stale-processing-locked-'));
  await execFileWithInput('node', [
    CLI,
    'hook-record',
    'Locked Stale Project',
    '--event',
    '-',
  ], JSON.stringify({ hook_event_name: 'Stop', changedFiles: ['SKILL.md'] }), { cwd });

  const firstClaim = await claimPendingHookEvents({ cwd, projectName: 'Locked Stale Project' });
  assert.equal(firstClaim.length, 1);

  const projectDir = path.join(cwd, '.skill-rsi', 'projects', 'locked-stale-project');
  await fs.writeFile(path.join(projectDir, 'run.lock'), JSON.stringify({ pid: 123, createdAt: new Date().toISOString() }));

  const secondClaim = await claimPendingHookEvents({
    cwd,
    projectName: 'Locked Stale Project',
    staleProcessingMs: 1,
    now: new Date(Date.now() + 60_000),
  });
  assert.equal(secondClaim.length, 0);

  const hooksDir = path.join(projectDir, 'hooks');
  assert.deepEqual(await safeReadDir(path.join(hooksDir, 'inbox')), []);
  const processing = await fs.readdir(path.join(hooksDir, 'processing'));
  assert.equal(processing.length, 1);
  const event = JSON.parse(await fs.readFile(path.join(hooksDir, 'processing', processing[0]), 'utf8'));
  assert.equal(event.queueStatus, 'processing');
});

test('continuous --consume-hooks leaves queued events untouched when project is locked before claim', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-locked-requeue-'));
  await execFileWithInput('node', [
    CLI,
    'hook-record',
    'Locked Project',
    '--event',
    '-',
  ], JSON.stringify({ hook_event_name: 'Stop', changedFiles: ['SKILL.md'] }), { cwd });

  const projectDir = path.join(cwd, '.skill-rsi', 'projects', 'locked-project');
  await fs.writeFile(path.join(projectDir, 'run.lock'), JSON.stringify({ pid: 123, createdAt: new Date().toISOString() }));

  const locked = await execFileAsync('node', [
    CLI,
    'continuous',
    'Locked Project',
    '--mock',
    '--max-runs',
    '1',
    '--consume-hooks',
  ], { cwd });
  assert.match(locked.stdout, /Project is already locked; pending hook event\(s\) remain queued/);

  const hooksDir = path.join(projectDir, 'hooks');
  const inbox = await fs.readdir(path.join(hooksDir, 'inbox'));
  assert.equal(inbox.length, 1);
  assert.deepEqual(await safeReadDir(path.join(hooksDir, 'processing')), []);
  assert.deepEqual(await safeReadDir(path.join(hooksDir, 'failed')), []);

  const event = JSON.parse(await fs.readFile(path.join(hooksDir, 'inbox', inbox[0]), 'utf8'));
  assert.equal(event.queueStatus, undefined);
  assert.equal(event.queueReason, undefined);
});

test('hook summaries stay compact across multiple queued events', () => {
  const summary = summarizeHookEvents([
    {
      id: 'event-a',
      eventName: 'Stop',
      changedFiles: ['SKILL.md', 'references/a.md'],
      transcriptPath: '/tmp/a.jsonl',
      sourceEventPath: '/tmp/a.json',
      payload: {
        changedFiles: ['SKILL.md', 'references/a.md'],
        focusParameterIds: ['p01'],
        reason: 'Skill file changed',
      },
    },
    {
      id: 'event-b',
      eventName: 'Stop',
      changedFiles: ['SKILL.md', 'scripts/tool.js'],
      transcriptPath: '/tmp/b.jsonl',
      sourceEventPath: '/tmp/b.json',
      payload: {
        changedFiles: ['scripts/tool.js'],
        parameterIds: ['p02'],
        reason: 'Script changed',
      },
    },
  ]);

  assert.equal(summary.eventCount, 2);
  assert.deepEqual(summary.changedFiles, ['SKILL.md', 'references/a.md', 'scripts/tool.js']);
  assert.deepEqual(summary.transcriptPaths, ['/tmp/a.jsonl', '/tmp/b.jsonl']);
  assert.deepEqual(summary.sourceEventPaths, ['/tmp/a.json', '/tmp/b.json']);
  assert.deepEqual(summary.payload.focusParameterIds, ['p01']);
  assert.deepEqual(summary.payload.parameterIds, ['p02']);
  assert.equal(summary.payload.reason, 'Script changed | Skill file changed');
  assert.equal(summary.events, undefined);
  assert.equal(summary.payload.hookEventCount, 2);
});

test('Codex hook script queues events and cron runner consumes them safely', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-codex-cron-'));
  const hook = await execFileWithInput('node', [
    CODEX_HOOK_SCRIPT,
  ], JSON.stringify({
    hook_event_name: 'Stop',
    changedFiles: ['docs/SCHEDULING.md'],
  }), {
    cwd,
    env: {
      ...process.env,
      SKILL_RSI_PROJECT: 'Cron Script Project',
    },
  });
  assert.equal(JSON.parse(hook.stdout).continue, true);
  assert.match(hook.stderr, /Queued Skill RSI hook/);

  const runner = await execFileAsync('node', [
    CRON_RUNNER,
    'Cron Script Project',
    '--mock',
    '--max-runs',
    '0',
  ], { cwd });
  assert.match(runner.stdout, /skill-rsi-cron/);
  assert.match(runner.stdout, /Skipped 1 pending hook event/);

  const skippedDir = path.join(cwd, '.skill-rsi', 'projects', 'cron-script-project', 'hooks', 'skipped');
  assert.equal((await fs.readdir(skippedDir)).length, 1);
});

test('Codex hook script requires explicit Skill RSI project selection', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-codex-missing-project-'));

  let error = null;
  try {
    await execFileWithInput('node', [
      CODEX_HOOK_SCRIPT,
    ], JSON.stringify({
      hook_event_name: 'Stop',
      changedFiles: ['SKILL.md'],
    }), { cwd, env: { ...process.env, SKILL_RSI_PROJECT: '' } });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  assert.match(error.message, /SKILL_RSI_PROJECT is required/);
  assert.equal(JSON.parse(error.stdout).continue, true);
  assert.match(error.stderr, /SKILL_RSI_PROJECT is required/);
});

function execFileWithInput(command, args, input, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} ${args.join(' ')} exited with ${code}\n${stderr}`);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      }
    });
    child.stdin.end(input);
  });
}

async function safeReadDir(dir) {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
