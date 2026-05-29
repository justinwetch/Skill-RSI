import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createSkillRsiMcpServer,
  createSkillRsiServices,
  createSkillRsiToolHandlers,
  resolveRepoRoot,
} from '../plugins/skill-rsi/mcp/server.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve('.');
const pluginValidator = '/Users/justinwetch/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py';

test('Skill RSI plugin validates and registers expected MCP tools', async () => {
  const validation = await execFileAsync('python3', [pluginValidator, 'plugins/skill-rsi'], { cwd: repoRoot });
  assert.match(validation.stdout, /Plugin validation passed/);

  const { server } = await createSkillRsiMcpServer({
    services: stubServices(),
  });
  assert.deepEqual(Object.keys(server._registeredTools).sort(), [
    'skill_rsi_create_project',
    'skill_rsi_doctor',
    'skill_rsi_export_champion',
    'skill_rsi_get_champion',
    'skill_rsi_get_next_loop_plan',
    'skill_rsi_list_projects',
    'skill_rsi_progress',
    'skill_rsi_record_context',
    'skill_rsi_run_next',
  ].sort());
});

test('MCP handlers create, inspect, run, queue context, and export projects', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-mcp-'));
  const baseline = path.join(cwd, 'baseline.md');
  await fs.writeFile(baseline, baselineSkill('mcp-baseline'));
  const services = await createSkillRsiServices({
    repoRoot,
    env: { OPENAI_API_KEY: 'sk-test-mcp-secret' },
  });
  services.cwd = cwd;
  const handlers = createSkillRsiToolHandlers(services);

  const doctor = await handlers.skill_rsi_doctor();
  assert.equal(doctor.schemaVersion, 1);
  assert.equal(doctor.openai.keyConfigured, true);
  assert.ok(!JSON.stringify(doctor).includes('sk-test-mcp-secret'));

  const created = await handlers.skill_rsi_create_project({
    projectName: 'MCP Project',
    goal: 'Improve a baseline skill through MCP.',
    outputType: 'code',
    model: 'gpt-5.5',
    targetIterations: 4,
    baselinePath: baseline,
  });
  assert.equal(created.action, 'project_created');
  assert.equal(created.project.projectId, 'mcp-project');
  assert.equal(created.project.config.eval.outputType, 'code');
  assert.equal(created.project.config.models.agent, 'gpt-5.5');
  assert.equal(created.project.state.currentChampion.candidateId, 'baseline');

  const projects = await handlers.skill_rsi_list_projects();
  assert.equal(projects.projects.length, 1);
  assert.equal(projects.projects[0].projectId, 'mcp-project');

  const champion = await handlers.skill_rsi_get_champion({ projectName: 'MCP Project' });
  assert.equal(champion.available, true);
  assert.match(champion.skillMd, /# mcp-baseline/);

  const progressBeforeRun = await handlers.skill_rsi_progress({ projectName: 'MCP Project' });
  assert.equal(progressBeforeRun.status, 'none');

  const context = await handlers.skill_rsi_record_context({
    projectName: 'MCP Project',
    eventName: 'CodexStop',
    reason: 'Edited skill notes.',
    changedFiles: ['SKILL.md', 'references/notes.md'],
    focusParameterIds: ['p01-trigger'],
  });
  assert.equal(context.action, 'context_queued');
  assert.equal(context.startsModelBackedWork, false);

  const summaryWithContext = await handlers.skill_rsi_get_next_loop_plan({ projectName: 'MCP Project' });
  assert.equal(summaryWithContext.automation.hooks.inbox.count, 1);
  assert.deepEqual(summaryWithContext.automation.hooks.inbox.latest.changedFiles, ['SKILL.md', 'references/notes.md']);

  const run = await handlers.skill_rsi_run_next({
    projectName: 'MCP Project',
    loops: 1,
    mode: 'mock',
    evalMode: 'mock',
  });
  assert.equal(run.action, 'run_completed');
  assert.equal(run.completedRunCount, 1);
  assert.equal(run.runCount, 1);
  assert.equal(run.startsModelBackedWork, false);

  const progressAfterRun = await handlers.skill_rsi_progress({ projectName: 'MCP Project' });
  assert.equal(progressAfterRun.status, 'completed');
  assert.equal(progressAfterRun.runNumber, 1);

  const exportDir = path.join(cwd, 'exported-champion');
  const exported = await handlers.skill_rsi_export_champion({
    projectName: 'MCP Project',
    outDir: exportDir,
  });
  assert.equal(exported.action, 'champion_exported');
  assert.equal(exported.fileCount, 1);
  assert.match(await fs.readFile(path.join(exportDir, 'SKILL.md'), 'utf8'), /^---/);
});

test('MCP helpers resolve repo root and surface missing project errors clearly', async () => {
  assert.equal(await resolveRepoRoot({ env: { SKILL_RSI_ROOT: repoRoot }, startDir: '/tmp' }), repoRoot);

  const services = await createSkillRsiServices({ repoRoot, env: {} });
  services.cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-mcp-missing-'));
  const handlers = createSkillRsiToolHandlers(services);

  await assert.rejects(
    () => handlers.skill_rsi_get_next_loop_plan({ projectName: 'Missing Project' }),
    /Missing Project|missing-project|not been initialized|no runs/i,
  );
});

function stubServices() {
  return {
    cwd: repoRoot,
    env: {},
    checkVisualRunnerAvailability: async () => ({ available: false, error: 'not checked' }),
    recordHookEvent: async () => '/tmp/hook.json',
    runProject: async () => ({
      projectId: 'stub',
      completedRuns: [],
      state: { runCount: 0, currentChampion: null },
      stopReason: null,
    }),
    uiApi: {
      UI_OPENAI_MODELS: ['gpt-5.4-mini', 'gpt-5.5'],
      readProjectSummaries: async () => [],
      createProjectFromLocalInput: async () => ({ projectId: 'stub' }),
      readRunProgress: async () => ({ status: 'none' }),
      readProjectSummary: async () => ({ projectId: 'stub', history: {}, automation: {}, state: {} }),
      readSkillContent: async () => ({ available: false, files: [] }),
    },
  };
}

function baselineSkill(name) {
  return `---
name: ${name}
description: Use when testing MCP project creation and baseline import.
---

# ${name}
`;
}
