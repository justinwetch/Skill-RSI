import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { runProject } from '../src/lib/run-loop.js';
import {
  createProjectForUi,
  readProjectSummaries,
  readProjectSummary,
  readRunComparison,
  readRunDetail,
  readRunProgress,
  recordHumanDecision,
} from '../src/lib/ui-api.js';
import { recordHookEvent } from '../src/lib/hooks.js';

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
  assert.ok(summary.state.budgetUsage.estimatedTokens > 0);
  assert.equal(summary.config.eval.outputType, 'text');
  assert.equal(summary.config.budget.maxConcurrentRuns, 1);
  assert.equal(summary.history.trajectoryLength, 1);
  assert.equal(summary.promptBank.stablePromptCount, 6);
  assert.ok(Number.isInteger(summary.promptBank.provisionalPromptCount));
  assert.ok(summary.promptBank.evidenceRecordCount >= 10);
  assert.ok(summary.artifacts.historyIndex.endsWith('history/index.json'));

  const summaries = await readProjectSummaries({ cwd });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].projectId, 'ui-api-project');

  const detail = await readRunDetail({ cwd, projectName: 'UI API Project', runId });
  assert.equal(detail.schemaVersion, 1);
  assert.equal(detail.runId, runId);
  assert.equal(detail.run.runId, runId);
  assert.ok(detail.parameterization.parameters.length >= 12);
  assert.equal(detail.manager.runId, runId);
  assert.ok(detail.manager.finalAction);
  assert.ok(detail.artifacts.managerJson.endsWith('manager/manager.json'));
  assert.ok(detail.experimentPlan.focusParameterIds.length >= 1);
  assert.ok(detail.candidates.candidateA.skillPath.endsWith('candidate-a/skill'));
  assert.equal(detail.evals.candidateDuel.stats.totalEvals, 10);
  assert.equal(detail.timeline.at(0).event, 'run.started');
});

test('ui api exposes comparison and optional audit annotations', async () => {
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
  assert.equal(typeof comparison.sides.currentChampion.available, 'boolean');
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
  assert.equal(created.config.trigger.targetIterations, 3);
  assert.equal(created.config.budget.estimatedTokensPerLoop, 50000);
  assert.equal(created.config.models.agent, 'gpt-5.4-mini');
  assert.equal(created.config.models.generation, 'gpt-5.4-mini');
  assert.equal(created.config.models.judge, 'gpt-5.4-mini');

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

test('ui api exposes automation summary for manual, queued, locked, ceiling, and failed states', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-automation-'));

  const manual = await createProjectForUi({
    cwd,
    projectName: 'Automation Manual',
    goal: 'Improve a manual project.',
  });
  assert.equal(manual.automation.status, 'manual');
  assert.equal(manual.automation.hooks.inbox.count, 0);
  assert.match(manual.automation.commands.cron, /skill-rsi-cron-runner\.mjs automation-manual/);
  assert.match(manual.automation.commands.cron, /--max-runs 3/);
  assert.match(manual.automation.commands.cron, /--max-new-runs 1/);
  assert.match(manual.automation.commands.cron, /--agentic/);
  assert.match(manual.automation.commands.cron, /--real-eval/);
  assert.doesNotMatch(manual.automation.commands.cron, /--patience|--max-inconclusive/);
  assert.match(manual.automation.commands.codexHook, /SKILL_RSI_PROJECT=automation-manual/);

  await recordHookEvent({
    cwd,
    projectName: 'Automation Manual',
    queued: true,
    event: {
      hook_event_name: 'Stop',
      changedFiles: ['SKILL.md', 'references/notes.md'],
      reason: 'Updated the skill implementation notes.',
      focusParameterIds: ['p01-trigger'],
    },
  });
  const queued = await readProjectSummary({ cwd, projectName: 'Automation Manual' });
  assert.equal(queued.automation.status, 'hooks_waiting');
  assert.equal(queued.automation.hooks.inbox.count, 1);
  assert.deepEqual(queued.automation.hooks.inbox.latest.changedFiles, ['SKILL.md', 'references/notes.md']);
  assert.equal(queued.automation.hooks.inbox.latest.reason, 'Updated the skill implementation notes.');
  assert.deepEqual(queued.automation.hooks.inbox.latest.focusParameterIds, ['p01-trigger']);

  await fs.writeFile(path.join(cwd, '.skill-rsi', 'projects', 'automation-manual', 'run.lock'), '{}');
  const locked = await readProjectSummary({ cwd, projectName: 'Automation Manual' });
  assert.equal(locked.automation.status, 'running');
  assert.equal(locked.automation.locked, true);

  const ceiling = await createProjectForUi({
    cwd,
    projectName: 'Automation Ceiling',
    goal: 'Improve until the run ceiling.',
  });
  const ceilingDir = path.join(cwd, '.skill-rsi', 'projects', ceiling.projectId);
  const ceilingConfig = JSON.parse(await fs.readFile(path.join(ceilingDir, 'config.json'), 'utf8'));
  const ceilingState = JSON.parse(await fs.readFile(path.join(ceilingDir, 'state.json'), 'utf8'));
  await fs.writeFile(path.join(ceilingDir, 'config.json'), JSON.stringify({
    ...ceilingConfig,
    budget: { ...ceilingConfig.budget, maxRuns: 1 },
  }, null, 2));
  await fs.writeFile(path.join(ceilingDir, 'state.json'), JSON.stringify({
    ...ceilingState,
    runCount: 1,
  }, null, 2));
  const atCeiling = await readProjectSummary({ cwd, projectName: 'Automation Ceiling' });
  assert.equal(atCeiling.automation.status, 'max_runs');
  assert.equal(atCeiling.automation.maxRuns, 1);

  const failed = await createProjectForUi({
    cwd,
    projectName: 'Automation Failed',
    goal: 'Expose failed hook events.',
  });
  const failedHooksDir = path.join(cwd, '.skill-rsi', 'projects', failed.projectId, 'hooks', 'failed');
  await fs.mkdir(failedHooksDir, { recursive: true });
  await fs.writeFile(path.join(failedHooksDir, 'failed.json'), JSON.stringify({
    id: 'failed',
    eventName: 'Stop',
    receivedAt: new Date().toISOString(),
    changedFiles: ['SKILL.md'],
    queueError: { name: 'TypeError', message: 'cannot read scores' },
  }, null, 2));
  const failedSummary = await readProjectSummary({ cwd, projectName: 'Automation Failed' });
  assert.equal(failedSummary.automation.status, 'failed');
  assert.equal(failedSummary.automation.hooks.failed.count, 1);
  assert.equal(failedSummary.automation.hooks.failed.latest.error.message, 'cannot read scores');
});

test('ui api stores the selected project model across all model roles', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-model-'));

  const created = await createProjectForUi({
    cwd,
    projectName: 'Model Project',
    goal: 'Store model choice from setup.',
    model: 'gpt-5.5',
  });

  assert.equal(created.config.models.agent, 'gpt-5.5');
  assert.equal(created.config.models.generation, 'gpt-5.5');
  assert.equal(created.config.models.judge, 'gpt-5.5');

  const fallback = await createProjectForUi({
    cwd,
    projectName: 'Fallback Model Project',
    goal: 'Normalize unsupported model names.',
    model: 'gpt-5.4-large',
  });

  assert.equal(fallback.config.models.agent, 'gpt-5.4-mini');
});

test('ui api derives task contracts from UI output type defaults', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-derived-contract-'));

  const textProject = await createProjectForUi({
    cwd,
    projectName: 'Text Skill',
    goal: 'Improve a writing skill.',
    outputType: 'text',
  });
  assert.equal(textProject.config.eval.outputType, 'text');
  assert.equal(textProject.config.eval.taskContract.id, 'text_standalone');

  const codeProject = await createProjectForUi({
    cwd,
    projectName: 'Code Skill',
    goal: 'Improve an implementation skill.',
    outputType: 'code',
  });
  assert.equal(codeProject.config.eval.outputType, 'code');
  assert.equal(codeProject.config.eval.taskContract.id, 'code_standalone');

  const visualCodeProject = await createProjectForUi({
    cwd,
    projectName: 'Visual Code Skill',
    goal: 'Improve a frontend implementation skill.',
    outputType: 'code_visual',
  });
  assert.equal(visualCodeProject.config.eval.outputType, 'code_visual');
  assert.equal(visualCodeProject.config.eval.taskContract.id, 'code_visual_standalone');

  const summary = await readProjectSummary({ cwd, projectName: 'Code Skill' });
  assert.equal(summary.config.eval.outputType, 'code');
  assert.equal(summary.config.eval.taskContract.id, 'code_standalone');
});

test('ui api ignores explicit task contracts and derives from output type', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-output-type-'));

  const created = await createProjectForUi({
    cwd,
    projectName: 'Frontend Codebase Edit',
    goal: 'Improve a front-end design skill.',
    outputType: 'code',
    taskContract: { id: 'codebase_edit' },
  });

  assert.equal(created.config.eval.outputType, 'code');
  assert.equal(created.config.eval.taskContract.id, 'code_standalone');

  const summary = await readProjectSummary({ cwd, projectName: 'Frontend Codebase Edit' });
  assert.equal(summary.config.eval.outputType, 'code');
  assert.equal(summary.config.eval.taskContract.id, 'code_standalone');
});

test('ui api imports an uploaded baseline as champion v0', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-baseline-'));

  const created = await createProjectForUi({
    cwd,
    projectName: 'Baseline Project',
    goal: 'Improve an existing skill.',
    baselineFiles: [{
      path: 'SKILL.md',
      content: `---
name: baseline-skill
description: Use when improving an existing baseline skill.
---

# Baseline Skill
`,
    }],
  });

  assert.equal(created.state.runCount, 0);
  assert.equal(created.state.currentChampion.candidateId, 'baseline');
  assert.equal(created.state.currentChampion.runId, 'baseline-upload');
  assert.equal(created.history.trajectoryLength, 0);
  assert.equal(created.history.nextLoopPremise, null);
  assert.ok(await fs.stat(path.join(cwd, '.skill-rsi', 'projects', 'baseline-project', 'champion', 'skill', 'SKILL.md')));
});

test('ui api normalizes browser folder baseline uploads with references', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-baseline-folder-'));

  const created = await createProjectForUi({
    cwd,
    projectName: 'Browser Folder Baseline',
    goal: 'Improve an uploaded folder skill.',
    baselineFiles: [
      {
        path: 'Uploaded Skill/SKILL.md',
        content: `---
name: browser-folder-baseline
description: Use when improving a browser-uploaded folder skill.
---

# Browser Folder Baseline

Read [the notes](references/notes.md).
`,
      },
      {
        path: 'Uploaded Skill/references/notes.md',
        content: '# Notes\n',
      },
    ],
  });

  assert.equal(created.state.currentChampion.candidateId, 'baseline');
  const skillDir = path.join(cwd, '.skill-rsi', 'projects', 'browser-folder-baseline', 'champion', 'skill');
  assert.match(await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8'), /browser-folder-baseline/);
  assert.match(await fs.readFile(path.join(skillDir, 'references', 'notes.md'), 'utf8'), /Notes/);
});

test('ui api imports an uploaded baseline zip as champion v0', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-baseline-zip-'));
  const zip = createStoredZip({
    'zipped/SKILL.md': `---
name: zipped-baseline
description: Use when improving a zipped baseline skill.
---

# Zipped Baseline
`,
    'zipped/references/notes.md': '# Notes\n',
  });

  const created = await createProjectForUi({
    cwd,
    projectName: 'Baseline Zip Project',
    goal: 'Improve an existing zipped skill.',
    baselineArchive: {
      name: 'baseline.zip',
      contentBase64: zip.toString('base64'),
    },
  });

  assert.equal(created.state.currentChampion.candidateId, 'baseline');
  const skill = await fs.readFile(path.join(cwd, '.skill-rsi', 'projects', 'baseline-zip-project', 'champion', 'skill', 'SKILL.md'), 'utf8');
  const notes = await fs.readFile(path.join(cwd, '.skill-rsi', 'projects', 'baseline-zip-project', 'champion', 'skill', 'references', 'notes.md'), 'utf8');
  assert.match(skill, /name: zipped-baseline/);
  assert.match(notes, /Notes/);
});

test('ui api rejects malformed baseline zip uploads as bad requests', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-bad-zip-'));

  await assert.rejects(
    () => createProjectForUi({
      cwd,
      projectName: 'Bad Zip Project',
      goal: 'Reject bad zip.',
      baselineArchive: {
        name: 'baseline.zip',
        contentBase64: Buffer.from('not really a zip').toString('base64'),
      },
    }),
    error => error.statusCode === 400 && /could not be loaded/i.test(error.message)
  );
});

test('ui api rejects oversized baseline zip uploads before preflight', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-large-zip-'));
  const oversized = Buffer.alloc(25 * 1024 * 1024 + 1).toString('base64');

  await assert.rejects(
    () => createProjectForUi({
      cwd,
      projectName: 'Large Zip Project',
      goal: 'Reject oversized zip.',
      baselineArchive: {
        name: 'baseline.zip',
        contentBase64: oversized,
      },
    }),
    error => error.statusCode === 400 && /too large/i.test(error.message)
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
  assert.equal(created.config.trigger.targetIterations, 7);

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
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

test('ui api exposes next-loop premise and progress stage details', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-ui-api-premise-'));
  const result = await runProject({
    cwd,
    projectName: 'Premise Project',
    goal: 'Expose next premise in UI.',
    loops: 1,
    mode: 'mock',
  });
  const runId = result.completedRuns[0].runId;

  const summary = await readProjectSummary({ cwd, projectName: 'Premise Project' });
  assert.ok(summary.history.nextLoopPremise.notes.length > 0);
  assert.equal(summary.history.nextLoopPremise.sourceRunId, runId);

  const progress = await readRunProgress({ cwd, projectName: 'Premise Project' });
  assert.equal(progress.runId, runId);
  assert.ok(Array.isArray(progress.stageDetails.plan));
  assert.ok(progress.events.some(event => event.details));
  assert.ok(progress.stageDetails.evaluate.some(detail => detail.startsWith('Candidate duel: ')));
  assert.ok(!progress.stageDetails.evaluate.some(detail => /by -\d+/.test(detail)));
});
