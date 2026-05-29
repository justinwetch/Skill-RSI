import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  buildEvidenceState,
  buildCockpitState,
  createSkillRsiMcpServer,
  createSkillRsiServices,
  createSkillRsiToolHandlers,
  resolveRepoRoot,
} from '../plugins/skill-rsi/mcp/server.mjs';
import { renderCockpitHtml } from '../plugins/skill-rsi/mcp/ui/cockpit.html.js';

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
    'skill_rsi_get_evidence',
    'skill_rsi_get_next_loop_plan',
    'skill_rsi_get_run_comparison',
    'skill_rsi_get_run_detail',
    'skill_rsi_get_skill_content',
    'skill_rsi_list_projects',
    'skill_rsi_open',
    'skill_rsi_progress',
    'skill_rsi_record_context',
    'skill_rsi_run_next',
    'skill_rsi_run_with_context',
  ].sort());
});

test('skill_rsi_open returns fallback content and an MCP-UI cockpit resource', async () => {
  const { server } = await createSkillRsiMcpServer({
    services: stubServices(),
  });
  const result = await server._registeredTools.skill_rsi_open.handler({});
  assert.equal(result.structuredContent.kind, 'skill-rsi-cockpit');
  assert.equal(result.structuredContent.status, 'empty');
  assert.match(result.content[0].text, /No Skill RSI projects yet/);
  assert.equal(result.content[1].type, 'resource');
  assert.match(result.content[1].resource.uri, /^ui:\/\/skill-rsi\/cockpit\/home/);
  assert.match(result.content[1].resource.mimeType, /text\/html/);
  assert.match(result.content[1].resource.text, /Create or import/);
  assert.match(result.content[1].resource.text, /skill_rsi_create_project/);
  assert.ok(!result.content[1].resource.text.includes(process.env.OPENAI_API_KEY || 'sk-'));
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

  const cockpit = await handlers.skill_rsi_open({ projectName: 'MCP Project' });
  assert.equal(cockpit.status, 'manual');
  assert.equal(cockpit.selectedProject.projectId, 'mcp-project');
  assert.equal(cockpit.champion.available, true);
  assert.equal(cockpit.runAction.targetLoops, 4);
  assert.equal(cockpit.runAction.params.loops, 4);
  assert.equal(cockpit.actions.runTargetBatch.toolName, 'skill_rsi_run_next');
  assert.equal(cockpit.actions.exportChampion.toolName, 'skill_rsi_export_champion');

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

  const contextRun = await handlers.skill_rsi_run_with_context({
    projectName: 'MCP Project',
    loops: 1,
    mode: 'mock',
    evalMode: 'mock',
  });
  assert.equal(contextRun.action, 'context_run_completed');
  assert.equal(contextRun.consumedHookEvents, 1);
  assert.equal(contextRun.hookContext.eventCount, 1);
  assert.deepEqual(contextRun.hookContext.changedFiles, ['SKILL.md', 'references/notes.md']);
  assert.equal(contextRun.completedRunCount, 1);
  assert.equal(contextRun.startsModelBackedWork, false);

  const summaryAfterContextRun = await handlers.skill_rsi_get_next_loop_plan({ projectName: 'MCP Project' });
  assert.equal(summaryAfterContextRun.automation.hooks.inbox.count, 0);
  assert.equal(summaryAfterContextRun.automation.hooks.processed.count, 1);

  await handlers.skill_rsi_record_context({
    projectName: 'MCP Project',
    eventName: 'CodexStop',
    reason: 'Budget capped context.',
    changedFiles: ['budget.md'],
  });
  const skippedContextRun = await handlers.skill_rsi_run_with_context({
    projectName: 'MCP Project',
    mode: 'mock',
    evalMode: 'mock',
    maxRuns: 0,
  });
  assert.equal(skippedContextRun.action, 'context_skipped');
  assert.equal(skippedContextRun.consumedHookEvents, 1);
  assert.equal(skippedContextRun.completedRunCount, 0);

  const summaryAfterSkip = await handlers.skill_rsi_get_next_loop_plan({ projectName: 'MCP Project' });
  assert.equal(summaryAfterSkip.automation.hooks.skipped.count, 1);

  const run = await handlers.skill_rsi_run_next({
    projectName: 'MCP Project',
    loops: 1,
    mode: 'mock',
    evalMode: 'mock',
  });
  assert.equal(run.action, 'run_completed');
  assert.equal(run.completedRunCount, 1);
  assert.equal(run.runCount, 2);
  assert.equal(run.startsModelBackedWork, false);

  const progressAfterRun = await handlers.skill_rsi_progress({ projectName: 'MCP Project' });
  assert.equal(progressAfterRun.status, 'completed');
  assert.equal(progressAfterRun.runNumber, 2);

  const exportDir = path.join(cwd, 'exported-champion');
  const exported = await handlers.skill_rsi_export_champion({
    projectName: 'MCP Project',
    outDir: exportDir,
  });
  assert.equal(exported.action, 'champion_exported');
  assert.equal(exported.fileCount, 1);
  assert.match(await fs.readFile(path.join(exportDir, 'SKILL.md'), 'utf8'), /^---/);
});

test('cockpit state and HTML handle empty, missing, and project states', async () => {
  const empty = await buildCockpitState({ services: stubServices() });
  assert.equal(empty.status, 'empty');
  assert.equal(empty.selectedProject, null);
  assert.equal(empty.actions.createProject.toolName, 'skill_rsi_create_project');
  assert.equal(empty.capabilities.mcpUi, true);
  const emptyHtml = renderCockpitHtml(empty);
  assert.match(emptyHtml, /No Skill RSI projects yet/);
  assert.match(emptyHtml, /Create project/);
  assert.doesNotMatch(emptyHtml, /rawPayloadSha256|OPENAI_API_KEY|sk-test/);

  const missing = await buildCockpitState({
    services: stubServices(),
    projectName: 'Missing Project',
  });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.selectedProjectMissing, true);
  assert.match(renderCockpitHtml(missing), /Project missing/);

  const projectServices = stubServices({
    projects: [stubProjectSummary({ projectId: 'alpha-project', targetIterations: 5 })],
    progress: { schemaVersion: 1, projectId: 'alpha-project', runId: 'run-001', status: 'completed', competitionMode: 'champion_challenge' },
    champion: { available: true, packageType: 'directory', hash: 'abc123', validation: { valid: true }, files: [{ path: 'SKILL.md', text: '# Skill' }] },
  });
  const projectState = await buildCockpitState({ services: projectServices });
  assert.equal(projectState.selectedProject.projectId, 'alpha-project');
  assert.equal(projectState.runAction.targetLoops, 5);
  assert.equal(projectState.runAction.label, 'Run target batch (5 loops)');
  assert.equal(projectState.actions.refresh.toolName, 'skill_rsi_open');
  assert.equal(projectState.actions.runTargetBatch.params.loops, 5);
  assert.equal(projectState.contextRunAction.label, 'Run one loop with queued Codex context');
  assert.equal(projectState.actions.runWithContext.toolName, 'skill_rsi_run_with_context');
  const projectHtml = renderCockpitHtml(projectState);
  assert.match(projectHtml, /Run target batch \(5 loops\)/);
  assert.match(projectHtml, /Latest evidence/);
  assert.match(projectHtml, /Automation and context/);
  assert.match(projectHtml, /skill_rsi_run_with_context/);
  assert.match(projectHtml, /Detailed Data/);
});

test('evidence state embeds only safe Skill RSI screenshot artifacts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-mcp-evidence-'));
  const artifactDir = path.join(cwd, '.skill-rsi', 'projects', 'visual-project', 'runs', 'run-001', 'eval', 'visual');
  const safeShot = path.join(artifactDir, 'shot.png');
  const unsafeShot = path.join(cwd, 'outside.png');
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(safeShot, Buffer.from('safe png bytes'));
  await fs.writeFile(unsafeShot, Buffer.from('unsafe png bytes'));

  const runDetail = stubRunDetailWithVisuals({ projectId: 'visual-project', runId: 'run-001', safeShot, unsafeShot });
  const services = stubServices({
    cwd,
    projects: [stubProjectSummary({ projectId: 'visual-project' })],
    runDetail,
    runComparison: stubRunComparison({ projectId: 'visual-project', runId: 'run-001' }),
  });
  const handlers = createSkillRsiToolHandlers(services);
  const evidence = await handlers.skill_rsi_get_evidence({ projectName: 'visual-project', runId: 'run-001' });
  const visual = evidence.evaluations[0].visual;

  assert.equal(visual.skillA.screenshots[0].embeddedImage.available, true);
  assert.match(visual.skillA.screenshots[0].embeddedImage.dataUrl, /^data:image\/png;base64,/);
  assert.equal(visual.skillB.screenshots[0].embeddedImage.available, false);
  assert.equal(visual.skillB.screenshots[0].embeddedImage.reason, 'outside-artifact-root');

  const html = renderCockpitHtml(await buildCockpitState({
    services,
    projectName: 'visual-project',
    view: 'evidence',
    runId: 'run-001',
  }));
  assert.match(html, /Detailed Data/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /outside-artifact-root/);

  const directEvidence = await buildEvidenceState({ services, projectName: 'visual-project', runId: 'run-001' });
  assert.equal(directEvidence.available, true);
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

function stubServices({
  cwd = repoRoot,
  projects = [],
  progress = { schemaVersion: 1, status: 'none' },
  champion = { available: false, files: [] },
  runDetail = null,
  runComparison = null,
} = {}) {
  return {
    cwd,
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
      readProjectSummaries: async () => projects,
      createProjectFromLocalInput: async () => ({ projectId: 'stub' }),
      readRunProgress: async () => progress,
      readProjectSummary: async ({ projectName }) => projects.find(project => project.projectId === projectName) || stubProjectSummary({ projectId: projectName }),
      readRunDetail: async ({ projectName, runId = null }) => runDetail || stubRunDetail({ projectId: projectName, runId: runId || 'run-001' }),
      readRunComparison: async ({ projectName, runId = null }) => runComparison || stubRunComparison({ projectId: projectName, runId: runId || 'run-001' }),
      readSkillContent: async () => champion,
    },
  };
}

function stubRunDetail({ projectId = 'stub', runId = 'run-001' } = {}) {
  return {
    schemaVersion: 1,
    projectId,
    runId,
    run: { runId, runNumber: 1, status: 'completed' },
    experimentPlan: { competitionMode: 'champion_challenge', experimentQuestion: 'Does the challenger improve trigger clarity?' },
    evals: {
      candidateDuel: null,
      challenge: {
        stats: { winner: 'skillA', scoreDelta: 2, skillAWins: 1, skillBWins: 0, ties: 0 },
        criteria: [{ id: 'clarity', name: 'Clarity' }],
        evaluations: [{
          id: 'p1',
          prompt: { text: 'Task: Improve a skill trigger.' },
          judge: {
            winner: 'skillA',
            scoreA: 5,
            scoreB: 3,
            reasoning: 'The challenger is clearer.',
            breakdown: { skillA: { clarity: 5 }, skillB: { clarity: 3 } },
          },
          results: {
            a: { sourceSkill: 'skillA', content: 'Challenger output' },
            b: { sourceSkill: 'skillB', content: 'Champion output' },
          },
        }],
      },
    },
    recommendation: { decision: 'promote', confidence: 'high', reasoning: 'Promote challenger.' },
    timeline: [{ timestamp: '2026-05-29T00:00:00.000Z', event: 'run.completed' }],
  };
}

function stubRunComparison({ projectId = 'stub', runId = 'run-001' } = {}) {
  return {
    schemaVersion: 1,
    projectId,
    runId,
    competitionMode: 'champion_challenge',
    experimentQuestion: 'Does the challenger improve trigger clarity?',
    focusParameterIds: ['p01-trigger'],
    sides: {
      champion: { available: true, strategy: 'Current champion', changedParameterIds: [] },
      challenger: { available: true, strategy: 'Tighter trigger', changedParameterIds: ['p01-trigger'] },
    },
    evalSummary: {
      challenge: { winner: 'skillA', scoreDelta: 2, wins: { skillA: 1, skillB: 0, ties: 0 } },
    },
  };
}

function stubRunDetailWithVisuals({ projectId, runId, safeShot, unsafeShot }) {
  const detail = stubRunDetail({ projectId, runId });
  detail.evals.challenge.evaluations[0].visual = {
    skillA: {
      status: 'complete',
      screenshots: [{ viewport: 'desktop', width: 1440, height: 1000, path: safeShot, blank: false }],
      blankScreenDetected: false,
      error: null,
    },
    skillB: {
      status: 'complete',
      screenshots: [{ viewport: 'desktop', width: 1440, height: 1000, path: unsafeShot, blank: false }],
      blankScreenDetected: false,
      error: null,
    },
  };
  detail.evals.challenge.evaluations[0].results.a.visual = detail.evals.challenge.evaluations[0].visual.skillA;
  detail.evals.challenge.evaluations[0].results.b.visual = detail.evals.challenge.evaluations[0].visual.skillB;
  return detail;
}

function stubProjectSummary({ projectId = 'stub', targetIterations = 3 } = {}) {
  return {
    schemaVersion: 1,
    projectId,
    goal: 'Improve a stub skill.',
    state: {
      runCount: 1,
      currentChampion: { candidateId: 'baseline', runId: 'baseline-upload' },
      runPolicy: { triggerMode: 'manual', targetIterations },
    },
    config: {
      eval: { outputType: 'text' },
      models: { agent: 'gpt-5.4-mini', generation: 'gpt-5.4-mini', judge: 'gpt-5.4-mini' },
    },
    history: {
      recentTrajectory: [{ runId: 'run-001', decision: 'promote' }],
      nextLoopPremise: { sourceRunId: 'run-001', notes: ['Try next: tighten trigger boundaries'] },
    },
    promptBank: { stablePromptCount: 6, provisionalPromptCount: 1 },
    automation: {
      status: 'manual',
      hooks: {
        inbox: { count: 0, latest: null },
      },
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
