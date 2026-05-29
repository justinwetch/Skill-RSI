#!/usr/bin/env node

import fs from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderCockpitHtml } from './ui/cockpit.html.js';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const SUPPORTED_OUTPUT_TYPES = ['text', 'code', 'code_visual'];
const SUPPORTED_MODELS = ['gpt-5.4-mini', 'gpt-5.5'];
const COCKPIT_RESOURCE_URI = 'ui://skill-rsi/cockpit.html';
const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
const DEFAULT_APP_URL = 'http://127.0.0.1:8765/';

let mcpRuntimeDepsPromise = null;
let McpServer;
let StdioServerTransport;
let createUIResource;
let registerAppTool;
let registerAppResource;
let z;

function currentDirname(importMetaUrl = import.meta.url) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

export async function resolveRepoRoot({ env = process.env, startDir = currentDirname() } = {}) {
  const candidates = [];
  if (env.SKILL_RSI_ROOT) candidates.push(path.resolve(env.SKILL_RSI_ROOT));
  if (env.PWD) candidates.push(path.resolve(env.PWD));
  candidates.push(process.cwd());
  candidates.push(path.resolve(startDir, '..', '..', '..'));

  for (const candidate of candidates) {
    try {
      const packageJson = JSON.parse(await fs.readFile(path.join(candidate, 'package.json'), 'utf8'));
      if (packageJson.name === 'skill-rsi') return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Could not resolve Skill RSI repo root. Set SKILL_RSI_ROOT to the repository path.');
}

async function importPackageFromRoot(repoRoot, packageSpecifier) {
  const requireFromRoot = createRequire(path.join(repoRoot, 'package.json'));
  return import(pathToFileURL(requireFromRoot.resolve(packageSpecifier)).href);
}

async function loadMcpRuntimeDeps(repoRoot) {
  mcpRuntimeDepsPromise ||= (async () => {
    const [mcp, stdio, ui, apps, zod] = await Promise.all([
      importPackageFromRoot(repoRoot, '@modelcontextprotocol/sdk/server/mcp.js'),
      importPackageFromRoot(repoRoot, '@modelcontextprotocol/sdk/server/stdio.js'),
      importPackageFromRoot(repoRoot, '@mcp-ui/server'),
      importPackageFromRoot(repoRoot, '@modelcontextprotocol/ext-apps/server'),
      importPackageFromRoot(repoRoot, 'zod'),
    ]);
    McpServer = mcp.McpServer;
    StdioServerTransport = stdio.StdioServerTransport;
    createUIResource = ui.createUIResource;
    registerAppTool = apps.registerAppTool;
    registerAppResource = apps.registerAppResource;
    z = zod.z;
  })();
  await mcpRuntimeDepsPromise;
}

async function importLib(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export async function createSkillRsiServices({ repoRoot = null, env = process.env } = {}) {
  const cwd = repoRoot || await resolveRepoRoot({ env });
  const { loadDotEnv } = await importLib(cwd, 'src/lib/env.js');
  await loadDotEnv(cwd);
  const [
    uiApi,
    runLoop,
    visualRunner,
    hooks,
    store,
    paths,
  ] = await Promise.all([
    importLib(cwd, 'src/lib/ui-api.js'),
    importLib(cwd, 'src/lib/run-loop.js'),
    importLib(cwd, 'src/lib/visual-runner.js'),
    importLib(cwd, 'src/lib/hooks.js'),
    importLib(cwd, 'src/lib/store.js'),
    importLib(cwd, 'src/lib/paths.js'),
  ]);

  return {
    cwd,
    env,
    uiApi,
    paths,
    runProject: runLoop.runProject,
    checkVisualRunnerAvailability: visualRunner.checkVisualRunnerAvailability,
    recordHookEvent: hooks.recordHookEvent,
    claimPendingHookEvents: hooks.claimPendingHookEvents,
    hasProjectRunLock: hooks.hasProjectRunLock,
    markHookEventsProcessed: hooks.markHookEventsProcessed,
    markHookEventsSkipped: hooks.markHookEventsSkipped,
    markHookEventsFailed: hooks.markHookEventsFailed,
    requeueHookEvents: hooks.requeueHookEvents,
    summarizeHookEvents: hooks.summarizeHookEvents,
    readJson: store.readJson,
    pathExists: store.pathExists,
    writeJson: store.writeJson,
  };
}

function normalizeModel(model) {
  return SUPPORTED_MODELS.includes(model) ? model : DEFAULT_MODEL;
}

function normalizeOutputType(outputType) {
  return SUPPORTED_OUTPUT_TYPES.includes(outputType) ? outputType : 'text';
}

function normalizeRunMode(mode) {
  return ['stub', 'mock', 'agentic'].includes(mode) ? mode : 'agentic';
}

function normalizeEvalMode(evalMode) {
  return ['mock', 'real'].includes(evalMode) ? evalMode : 'real';
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeIntegerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function makeSummary(title, lines = []) {
  return [title, ...lines.filter(Boolean).map(line => `- ${line}`)].join('\n');
}

function toolResult(data, summary = null) {
  return {
    content: [
      {
        type: 'text',
        text: summary ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function uiToolResult(data, uiResource, summary = null) {
  return {
    content: [
      uiResource,
      {
        type: 'text',
        text: summary ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
    _meta: {
      'ui/resourceUri': COCKPIT_RESOURCE_URI,
      ui: {
        resourceUri: COCKPIT_RESOURCE_URI,
      },
    },
  };
}

function safeExportPath(rootDir, filePath) {
  const destination = path.resolve(rootDir, filePath);
  const root = path.resolve(rootDir);
  const rootWithSep = `${root}${path.sep}`;
  if (destination !== root && !destination.startsWith(rootWithSep)) {
    throw new Error(`Refusing to export unsafe path: ${filePath}`);
  }
  return destination;
}

async function exportSkillFiles(skill, outDir) {
  if (!skill.available) {
    throw new Error(`Skill source "${skill.source}" is not available for ${skill.projectId}`);
  }
  const destinationRoot = path.resolve(outDir);
  let fileCount = 0;
  for (const file of skill.files) {
    if (typeof file.text !== 'string') continue;
    const destination = safeExportPath(destinationRoot, file.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.text, 'utf8');
    fileCount += 1;
  }
  return fileCount;
}

export function createSkillRsiToolHandlers(services) {
  return {
    async skill_rsi_open(args = {}) {
      return buildLaunchState({
        services,
        projectName: args.projectName || null,
        create: Boolean(args.create),
        draftId: args.draftId || null,
      });
    },

    async skill_rsi_cockpit(args = {}) {
      requireExistingProjectIntent(args, 'skill_rsi_cockpit');
      return buildCockpitState({
        services,
        projectName: args.projectName || null,
        view: args.view || 'overview',
        runId: args.runId || null,
        skillSource: args.skillSource || null,
        filePath: args.filePath || null,
      });
    },

    async skill_rsi_doctor() {
      const visualRunner = await services.checkVisualRunnerAvailability();
      return {
        schemaVersion: 1,
        repoRoot: services.cwd,
        pluginPhase: 'mcp-control-plane',
        openai: {
          keyConfigured: Boolean(services.env.OPENAI_API_KEY),
          models: services.uiApi.UI_OPENAI_MODELS || SUPPORTED_MODELS,
          defaultModel: DEFAULT_MODEL,
        },
        visualRunner,
      };
    },

    async skill_rsi_list_projects(args = {}) {
      requireExistingProjectIntent(args, 'skill_rsi_list_projects');
      return {
        schemaVersion: 1,
        repoRoot: services.cwd,
        projects: await services.uiApi.readProjectSummaries({ cwd: services.cwd }),
      };
    },

    async skill_rsi_create_project(args) {
      const resolvedProjectName = await resolveFreshProjectName({
        services,
        requestedProjectName: args.projectName,
      });
      const summary = await services.uiApi.createProjectFromLocalInput({
        cwd: services.cwd,
        projectName: resolvedProjectName.projectName,
        goal: args.goal,
        targetIterations: positiveInteger(args.targetIterations, 3),
        triggerMode: args.triggerMode || 'manual',
        outputType: normalizeOutputType(args.outputType || 'text'),
        model: normalizeModel(args.model || DEFAULT_MODEL),
        baselinePath: args.baselinePath || null,
      });
      return {
        schemaVersion: 1,
        action: 'project_created',
        requestedProjectName: args.projectName,
        collisionResolved: resolvedProjectName.collisionResolved,
        launchUrl: buildLaunchUrl({ projectId: summary.projectId }),
        nextAction: 'open_local_app',
        project: summary,
      };
    },

    async skill_rsi_prepare_project(args) {
      const resolvedProjectName = args.projectName
        ? await resolveFreshProjectName({ services, requestedProjectName: args.projectName })
        : { projectName: '', collisionResolved: false };
      const draft = await services.uiApi.createProjectDraftForUi({
        cwd: services.cwd,
        projectName: resolvedProjectName.projectName,
        goal: args.goal || '',
        targetIterations: positiveInteger(args.targetIterations, 3),
        triggerMode: args.triggerMode || 'manual',
        outputType: args.outputType ? normalizeOutputType(args.outputType) : null,
        model: normalizeModel(args.model || DEFAULT_MODEL),
        baselinePath: args.baselinePath || null,
      });
      const launchUrl = buildLaunchUrl({ create: true, draftId: draft.id });
      const healthUrl = new URL('/api/capabilities', DEFAULT_APP_URL).toString();
      return {
        schemaVersion: 1,
        action: 'project_setup_prepared',
        startsModelBackedWork: false,
        requestedProjectName: args.projectName || null,
        collisionResolved: resolvedProjectName.collisionResolved,
        draft,
        launchUrl,
        server: await checkLocalAppServer(healthUrl),
        nextAction: 'open_local_app',
        browser: {
          required: true,
          surface: 'codex-in-app-browser',
          instruction: `Open ${launchUrl} in the Codex in-app browser/sidebar.`,
        },
      };
    },

    async skill_rsi_run_next(args) {
      requireRunIntent(args, 'skill_rsi_run_next');
      const mode = normalizeRunMode(args.mode || 'agentic');
      const evalMode = normalizeEvalMode(args.evalMode || 'real');
      const model = args.model || null;
      const result = await services.runProject({
        cwd: services.cwd,
        projectName: args.projectName,
        goal: args.goal || `Improve the ${args.projectName} Agent Skill.`,
        loops: positiveInteger(args.loops, 1),
        mode,
        maxRuns: nonNegativeIntegerOrNull(args.maxRuns),
        evalMode,
        generationModel: args.generationModel || model || null,
        judgeModel: args.judgeModel || model || null,
        agentModel: args.agentModel || model || null,
        triggerMode: 'manual',
        apiKeys: {
          anthropic: args.anthropicKey || null,
          openai: args.openaiKey || null,
          gemini: args.geminiKey || null,
        },
      });
      return {
        schemaVersion: 1,
        action: 'run_completed',
        startsModelBackedWork: mode === 'agentic' || evalMode === 'real',
        projectId: result.projectId,
        completedRunCount: result.completedRuns.length,
        completedRuns: result.completedRuns.map(run => ({
          runId: run.runId,
          runNumber: run.runNumber,
          decision: run.recommendation?.decision || null,
        })),
        stopReason: result.stopReason || null,
        runCount: result.state.runCount,
        champion: result.state.currentChampion || null,
      };
    },

    async skill_rsi_run_with_context(args) {
      requireRunIntent(args, 'skill_rsi_run_with_context');
      return runWithQueuedContext({ services, args });
    },

    async skill_rsi_progress(args) {
      requireExistingProjectIntent(args, 'skill_rsi_progress');
      return services.uiApi.readRunProgress({
        cwd: services.cwd,
        projectName: args.projectName,
      });
    },

    async skill_rsi_get_run_detail(args) {
      requireExistingProjectIntent(args, 'skill_rsi_get_run_detail');
      return services.uiApi.readRunDetail({
        cwd: services.cwd,
        projectName: args.projectName,
        runId: args.runId || null,
      });
    },

    async skill_rsi_get_run_comparison(args) {
      requireExistingProjectIntent(args, 'skill_rsi_get_run_comparison');
      return services.uiApi.readRunComparison({
        cwd: services.cwd,
        projectName: args.projectName,
        runId: args.runId || null,
      });
    },

    async skill_rsi_get_skill_content(args) {
      requireExistingProjectIntent(args, 'skill_rsi_get_skill_content');
      return services.uiApi.readSkillContent({
        cwd: services.cwd,
        projectName: args.projectName,
        source: args.source || 'champion',
        runId: args.runId || null,
      });
    },

    async skill_rsi_get_evidence(args) {
      requireExistingProjectIntent(args, 'skill_rsi_get_evidence');
      return buildEvidenceState({
        services,
        projectName: args.projectName,
        runId: args.runId || null,
      });
    },

    async skill_rsi_get_next_loop_plan(args) {
      requireExistingProjectIntent(args, 'skill_rsi_get_next_loop_plan');
      const summary = await services.uiApi.readProjectSummary({
        cwd: services.cwd,
        projectName: args.projectName,
      });
      return {
        schemaVersion: 1,
        projectId: summary.projectId,
        nextLoopPremise: summary.history.nextLoopPremise,
        automation: summary.automation,
        currentChampion: summary.state.currentChampion,
        runPolicy: summary.state.runPolicy,
      };
    },

    async skill_rsi_get_champion(args) {
      requireExistingProjectIntent(args, 'skill_rsi_get_champion');
      const [summary, skill] = await Promise.all([
        services.uiApi.readProjectSummary({ cwd: services.cwd, projectName: args.projectName }),
        services.uiApi.readSkillContent({ cwd: services.cwd, projectName: args.projectName, source: 'champion' }),
      ]);
      const skillMd = skill.files.find(file => file.path === 'SKILL.md')?.text || null;
      return {
        schemaVersion: 1,
        projectId: summary.projectId,
        champion: summary.state.currentChampion,
        available: skill.available,
        packageType: skill.packageType || null,
        hash: skill.hash || null,
        validation: skill.validation || null,
        skillMd,
      };
    },

    async skill_rsi_export_champion(args) {
      requireExistingProjectIntent(args, 'skill_rsi_export_champion');
      const skill = await services.uiApi.readSkillContent({
        cwd: services.cwd,
        projectName: args.projectName,
        source: 'champion',
      });
      const fileCount = await exportSkillFiles(skill, args.outDir);
      return {
        schemaVersion: 1,
        action: 'champion_exported',
        projectId: skill.projectId,
        source: 'champion',
        outDir: path.resolve(args.outDir),
        fileCount,
      };
    },

    async skill_rsi_record_context(args) {
      const event = {
        source: 'skill-rsi-mcp',
        hook_event_name: args.eventName || 'MCPContext',
        changedFiles: Array.isArray(args.changedFiles) ? args.changedFiles : [],
        reason: args.reason || null,
        focusParameterIds: Array.isArray(args.focusParameterIds) ? args.focusParameterIds : [],
        parameterIds: Array.isArray(args.parameterIds) ? args.parameterIds : [],
      };
      const hookPath = await services.recordHookEvent({
        cwd: services.cwd,
        projectName: args.projectName,
        event,
        queued: true,
      });
      return {
        schemaVersion: 1,
        action: 'context_queued',
        projectName: args.projectName,
        hookPath,
        startsModelBackedWork: false,
      };
    },
  };
}

function slugifyProjectName(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

async function buildLaunchState({ services, projectName = null, create = false, draftId = null }) {
  const projectId = slugifyProjectName(projectName);
  const launchUrl = buildLaunchUrl({ projectId, create, draftId });
  const healthUrl = new URL('/api/capabilities', DEFAULT_APP_URL).toString();
  const server = await checkLocalAppServer(healthUrl);
  return {
    schemaVersion: 1,
    action: 'open_local_app',
    startsModelBackedWork: false,
    repoRoot: services.cwd,
    projectId,
    draftId,
    launchUrl,
    server,
    browser: {
      required: true,
      surface: 'codex-in-app-browser',
      instruction: `Open ${launchUrl} in the Codex in-app browser/sidebar.`,
    },
  };
}

function buildLaunchUrl({ projectId = null, create = false, draftId = null } = {}) {
  const url = new URL(DEFAULT_APP_URL);
  if (projectId) url.searchParams.set('project', projectId);
  if (create) url.searchParams.set('create', '1');
  if (draftId) url.searchParams.set('draft', draftId);
  return url.toString();
}

async function checkLocalAppServer(healthUrl) {
  try {
    const status = await httpGetStatus(healthUrl, 700);
    return {
      reachable: status >= 200 && status < 500,
      healthUrl,
      status,
      startCommand: null,
    };
  } catch (error) {
    return {
      reachable: false,
      healthUrl,
      status: null,
      error: error.message,
      startCommand: 'npm run server',
    };
  }
}

function httpGetStatus(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode || 0));
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Timed out checking ${url}`));
    });
    request.on('error', reject);
  });
}

function requireExistingProjectIntent(args, toolName) {
  if (args?.existingProjectIntent === true) return;
  const error = new Error(`${toolName} requires existingProjectIntent: true. For fresh Skill RSI requests, create/import a fresh project and open the local app instead of inspecting existing project state.`);
  error.statusCode = 400;
  throw error;
}

function requireRunIntent(args, toolName) {
  if (args?.runIntent === true) return;
  const error = new Error(`${toolName} requires runIntent: true. Plain Skill RSI create/improve requests must open the UI and let the user start loops there.`);
  error.statusCode = 400;
  throw error;
}

async function resolveFreshProjectName({ services, requestedProjectName }) {
  const baseProjectId = slugifyProjectName(requestedProjectName) || 'skill-rsi-project';
  if (!services.paths?.getProjectPaths || !services.pathExists) {
    return { projectName: baseProjectId, collisionResolved: false };
  }

  for (let index = 0; index < 1000; index += 1) {
    const projectName = index === 0 ? baseProjectId : `${baseProjectId}-${index + 1}`;
    const paths = services.paths.getProjectPaths(services.cwd, projectName);
    const exists = await services.pathExists(paths.projectDir);
    if (!exists) {
      return {
        projectName,
        projectId: paths.projectId,
        collisionResolved: index > 0,
      };
    }
  }

  throw new Error(`Could not find an unused project name for ${baseProjectId}`);
}

export async function buildCockpitState({
  services,
  projectName = null,
  view = 'overview',
  runId = null,
  skillSource = null,
  filePath = null,
}) {
  return buildConsoleState({ services, projectName, view, runId, skillSource, filePath });
}

function normalizeView(view) {
  return ['overview', 'history', 'evidence', 'skill', 'automation'].includes(view) ? view : 'overview';
}

function normalizeSkillSource(source, competitionMode) {
  const allowed = competitionMode === 'cold_start_duel'
    ? ['champion', 'candidate-a', 'candidate-b']
    : ['champion', 'challenger'];
  return allowed.includes(source) ? source : 'champion';
}

export async function buildConsoleState({
  services,
  projectName = null,
  view = 'overview',
  runId = null,
  skillSource = null,
  filePath = null,
}) {
  const projects = await services.uiApi.readProjectSummaries({ cwd: services.cwd });
  const requestedProjectId = slugifyProjectName(projectName);
  const selectedProject = requestedProjectId
    ? projects.find(project => project.projectId === requestedProjectId) || null
    : projects[0] || null;
  const selectedProjectMissing = Boolean(requestedProjectId && !selectedProject);
  const supportedModels = services.uiApi.UI_OPENAI_MODELS || SUPPORTED_MODELS;
  const selectedView = normalizeView(view);

  if (!selectedProject) {
    return {
      schemaVersion: 1,
      kind: 'skill-rsi-cockpit',
      status: selectedProjectMissing ? 'missing' : 'empty',
      view: selectedView,
      repoRoot: services.cwd,
      requestedProjectId,
      selectedProjectMissing,
      projects,
      selectedProject: null,
      progress: null,
      champion: { available: false },
      nextLoopPremise: null,
      latestEvidence: null,
      runDetail: null,
      comparison: null,
      evidence: null,
      skill: null,
      skillCompare: null,
      automation: null,
      runAction: null,
      contextRunAction: null,
      supportedOutputTypes: SUPPORTED_OUTPUT_TYPES,
      supportedModels,
      actions: buildCockpitActions({ project: null, targetLoops: 3 }),
      capabilities: buildCockpitCapabilities(),
    };
  }

  const [summary, progress, champion] = await Promise.all([
    services.uiApi.readProjectSummary({ cwd: services.cwd, projectName: selectedProject.projectId }),
    services.uiApi.readRunProgress({ cwd: services.cwd, projectName: selectedProject.projectId }),
    services.uiApi.readSkillContent({ cwd: services.cwd, projectName: selectedProject.projectId, source: 'champion' }),
  ]);
  const targetLoops = positiveInteger(summary.state?.runPolicy?.targetIterations, 1);
  const queuedHookCount = summary.automation?.hooks?.inbox?.count || 0;
  const contextRunEligible = queuedHookCount > 0
    && !summary.automation?.locked
    && summary.automation?.status !== 'max_runs';
  const status = progress?.status === 'running'
    ? 'running'
    : summary.automation?.status || (progress?.status === 'completed' ? 'completed' : 'manual');
  const latestRunId = runId || summary.state?.lastRunId || progress?.runId || null;
  const [runDetail, comparison] = latestRunId ? await Promise.all([
    services.uiApi.readRunDetail({ cwd: services.cwd, projectName: selectedProject.projectId, runId: latestRunId }).catch(error => ({ error: { message: error.message } })),
    services.uiApi.readRunComparison({ cwd: services.cwd, projectName: selectedProject.projectId, runId: latestRunId }).catch(error => ({ error: { message: error.message } })),
  ]) : [null, null];
  const evidence = latestRunId && !runDetail?.error
    ? await buildEvidenceState({
      services,
      projectName: selectedProject.projectId,
      runId: latestRunId,
      detail: runDetail,
      comparison,
    }).catch(error => ({ error: { message: error.message } }))
    : null;
  const competitionMode = comparison?.competitionMode || runDetail?.experimentPlan?.competitionMode || 'cold_start_duel';
  const selectedSkillSource = normalizeSkillSource(skillSource, competitionMode);
  const skill = selectedView === 'skill'
    ? await services.uiApi.readSkillContent({
      cwd: services.cwd,
      projectName: selectedProject.projectId,
      source: selectedSkillSource,
      runId: latestRunId,
    }).catch(error => ({ error: { message: error.message }, available: false, files: [] }))
    : null;
  const skillCompare = selectedView === 'skill' && latestRunId
    ? await buildSkillCompareState({
      services,
      projectName: selectedProject.projectId,
      runId: latestRunId,
      competitionMode,
    }).catch(error => ({ error: { message: error.message } }))
    : null;

  return {
    schemaVersion: 1,
    kind: 'skill-rsi-cockpit',
    status,
    view: selectedView,
    repoRoot: services.cwd,
    requestedProjectId,
    selectedProjectMissing: false,
    projects,
    selectedProject: summary,
    progress,
    champion: {
      available: champion.available,
      packageType: champion.packageType || null,
      hash: champion.hash || null,
      validation: champion.validation || null,
      fileCount: champion.files?.length || 0,
    },
    nextLoopPremise: summary.history?.nextLoopPremise || null,
    latestEvidence: {
      latestTrajectory: summary.history?.recentTrajectory?.at?.(-1) || null,
      promptBank: summary.promptBank || null,
    },
    selectedRunId: latestRunId,
    selectedSkillSource,
    selectedFilePath: filePath || null,
    runDetail,
    comparison,
    evidence,
    skill,
    skillCompare,
    automation: summary.automation || null,
    runAction: {
      label: `Run target batch (${targetLoops} ${targetLoops === 1 ? 'loop' : 'loops'})`,
      targetLoops,
      startsModelBackedWork: true,
      toolName: 'skill_rsi_run_next',
      params: {
        projectName: summary.projectId,
        loops: targetLoops,
        mode: 'agentic',
        evalMode: 'real',
      },
    },
    contextRunAction: {
      label: 'Run one loop with queued Codex context',
      queuedHookCount,
      enabled: contextRunEligible,
      startsModelBackedWork: queuedHookCount > 0,
      disabledReason: queuedHookCount === 0
        ? 'no queued Codex context'
        : summary.automation?.locked
          ? 'project is already running'
          : summary.automation?.status === 'max_runs'
            ? 'project is at run ceiling'
            : null,
      toolName: 'skill_rsi_run_with_context',
      params: {
        projectName: summary.projectId,
        loops: 1,
        mode: 'agentic',
        evalMode: 'real',
      },
    },
    supportedOutputTypes: SUPPORTED_OUTPUT_TYPES,
    supportedModels,
    actions: buildCockpitActions({ project: summary, targetLoops }),
    capabilities: buildCockpitCapabilities(),
  };
}

async function buildSkillCompareState({ services, projectName, runId, competitionMode }) {
  const sources = competitionMode === 'cold_start_duel'
    ? { aSource: 'candidate-a', bSource: 'candidate-b', aLabel: 'Candidate A', bLabel: 'Candidate B' }
    : { aSource: 'champion', bSource: 'challenger', aLabel: 'Champion', bLabel: 'Challenger' };
  const [a, b] = await Promise.all([
    services.uiApi.readSkillContent({ cwd: services.cwd, projectName, source: sources.aSource, runId }),
    services.uiApi.readSkillContent({ cwd: services.cwd, projectName, source: sources.bSource, runId }),
  ]);
  return {
    schemaVersion: 1,
    runId,
    competitionMode,
    ...sources,
    a,
    b,
  };
}

function buildCockpitCapabilities() {
  return {
    mcpTools: true,
    mcpUi: true,
    uiActions: true,
    detailedEvidencePanels: true,
    visualScreenshotPanels: true,
    hookAutorun: false,
  };
}

function buildCockpitActions({ project, targetLoops }) {
  const projectName = project?.projectId || null;
  return {
    refresh: {
      toolName: 'skill_rsi_cockpit',
      params: projectName ? { projectName, existingProjectIntent: true } : { existingProjectIntent: true },
    },
    createProject: {
      toolName: 'skill_rsi_create_project',
    },
    runTargetBatch: {
      toolName: 'skill_rsi_run_next',
      enabled: Boolean(projectName),
      params: projectName ? {
        projectName,
        runIntent: true,
        loops: targetLoops,
        mode: 'agentic',
        evalMode: 'real',
      } : null,
    },
    runWithContext: {
      toolName: 'skill_rsi_run_with_context',
      enabled: Boolean(projectName),
      params: projectName ? {
        projectName,
        runIntent: true,
        loops: 1,
        mode: 'agentic',
        evalMode: 'real',
      } : null,
    },
    exportChampion: {
      toolName: 'skill_rsi_export_champion',
      enabled: Boolean(project?.state?.currentChampion),
      params: projectName ? { projectName, existingProjectIntent: true } : null,
    },
    recordContext: {
      toolName: 'skill_rsi_record_context',
      enabled: Boolean(projectName),
    },
  };
}

async function runWithQueuedContext({ services, args }) {
  const projectName = args.projectName;
  if (await services.hasProjectRunLock({ cwd: services.cwd, projectName })) {
    const error = new Error(`Project is already running; pending Codex context remains queued for ${projectName}.`);
    error.statusCode = 409;
    throw error;
  }

  const claimedHookEvents = await services.claimPendingHookEvents({ cwd: services.cwd, projectName });
  const hookContext = services.summarizeHookEvents(claimedHookEvents);
  if (!claimedHookEvents.length) {
    return {
      schemaVersion: 1,
      action: 'no_context_queued',
      projectName,
      consumedHookEvents: 0,
      hookContext: null,
      startsModelBackedWork: false,
    };
  }

  if (await services.hasProjectRunLock({ cwd: services.cwd, projectName })) {
    await services.requeueHookEvents({
      cwd: services.cwd,
      projectName,
      events: claimedHookEvents,
      reason: 'Project became locked after hook events were claimed',
    });
    return {
      schemaVersion: 1,
      action: 'context_requeued_lock_race',
      projectName,
      consumedHookEvents: 0,
      requeuedHookEvents: claimedHookEvents.length,
      hookContext,
      startsModelBackedWork: false,
    };
  }

  const maxRuns = nonNegativeIntegerOrNull(args.maxRuns);
  if (maxRuns === 0) {
    await services.markHookEventsSkipped({
      cwd: services.cwd,
      projectName,
      events: claimedHookEvents,
      reason: 'max-runs 0 requested',
    });
    return {
      schemaVersion: 1,
      action: 'context_skipped',
      projectName,
      consumedHookEvents: claimedHookEvents.length,
      hookContext,
      completedRunCount: 0,
      stopReason: 'max-runs 0 requested',
      startsModelBackedWork: false,
    };
  }

  const mode = normalizeRunMode(args.mode || 'agentic');
  const evalMode = normalizeEvalMode(args.evalMode || 'real');
  const model = args.model || null;
  const loops = Math.min(positiveInteger(args.loops, 1), 1);
  let result;
  try {
    result = await services.runProject({
      cwd: services.cwd,
      projectName,
      goal: args.goal || `Improve the ${projectName} Agent Skill.`,
      loops,
      mode,
      maxRuns,
      evalMode,
      generationModel: args.generationModel || model || null,
      judgeModel: args.judgeModel || model || null,
      agentModel: args.agentModel || model || null,
      triggerMode: 'hook',
      hookContext,
      apiKeys: {
        anthropic: args.anthropicKey || null,
        openai: args.openaiKey || null,
        gemini: args.geminiKey || null,
      },
    });
    if (result.completedRuns.length > 0) {
      await services.markHookEventsProcessed({ cwd: services.cwd, projectName, events: claimedHookEvents });
    } else {
      await services.markHookEventsSkipped({
        cwd: services.cwd,
        projectName,
        events: claimedHookEvents,
        reason: result.stopReason || 'no runs completed',
      });
    }
  } catch (error) {
    if (isProjectLockedError(error)) {
      await services.requeueHookEvents({ cwd: services.cwd, projectName, events: claimedHookEvents, reason: error.message });
      return {
        schemaVersion: 1,
        action: 'context_requeued_lock_race',
        projectName,
        consumedHookEvents: 0,
        requeuedHookEvents: claimedHookEvents.length,
        hookContext,
        startsModelBackedWork: false,
      };
    }
    await services.markHookEventsFailed({ cwd: services.cwd, projectName, events: claimedHookEvents, error });
    throw error;
  }

  return {
    schemaVersion: 1,
    action: result.completedRuns.length > 0 ? 'context_run_completed' : 'context_skipped',
    projectName,
    projectId: result.projectId,
    consumedHookEvents: claimedHookEvents.length,
    hookContext,
    startsModelBackedWork: mode === 'agentic' || evalMode === 'real',
    completedRunCount: result.completedRuns.length,
    completedRuns: result.completedRuns.map(run => ({
      runId: run.runId,
      runNumber: run.runNumber,
      decision: run.recommendation?.decision || null,
    })),
    stopReason: result.stopReason || null,
    runCount: result.state.runCount,
    champion: result.state.currentChampion || null,
  };
}

function isProjectLockedError(error) {
  return typeof error?.message === 'string' && error.message.startsWith('Project is already locked:');
}

export async function buildEvidenceState({ services, projectName, runId = null, detail = null, comparison = null }) {
  const resolvedDetail = detail || await services.uiApi.readRunDetail({
    cwd: services.cwd,
    projectName,
    runId,
  });
  const resolvedComparison = comparison || await services.uiApi.readRunComparison({
    cwd: services.cwd,
    projectName,
    runId,
  });
  const competitionMode = resolvedComparison?.competitionMode || resolvedDetail?.experimentPlan?.competitionMode || 'cold_start_duel';
  const evalRun = competitionMode === 'cold_start_duel'
    ? resolvedDetail.evals?.candidateDuel
    : resolvedDetail.evals?.challenge;
  const labels = competitionMode === 'cold_start_duel'
    ? { a: 'Candidate A', b: 'Candidate B', sourceA: 'candidate-a', sourceB: 'candidate-b' }
    : { a: 'Challenger', b: 'Champion', sourceA: 'challenger', sourceB: 'champion' };
  const criteria = (evalRun?.criteria || []).filter(criterion => !String(criterion.id || '').startsWith('parameter_'));
  const evaluations = [];
  for (const evaluation of evalRun?.evaluations || []) {
    evaluations.push(await embedEvaluationVisuals({
      services,
      evaluation,
    }));
  }
  return {
    schemaVersion: 1,
    projectId: resolvedDetail.projectId,
    runId: resolvedDetail.runId,
    competitionMode,
    experimentQuestion: resolvedComparison?.experimentQuestion || resolvedDetail.experimentPlan?.experimentQuestion || null,
    focusParameterIds: resolvedComparison?.focusParameterIds || resolvedDetail.experimentPlan?.focusParameterIds || [],
    labels,
    stats: evalRun?.stats || null,
    criteria,
    evaluations,
    recommendation: resolvedDetail.recommendation || null,
    sides: resolvedComparison?.sides || null,
    available: Boolean(evalRun),
  };
}

async function embedEvaluationVisuals({ services, evaluation }) {
  const copy = JSON.parse(JSON.stringify(evaluation));
  const visualEntries = [
    copy.visual?.skillA,
    copy.visual?.skillB,
    ...Object.values(copy.results || {}).map(result => result?.visual),
  ].filter(Boolean);
  for (const visual of visualEntries) {
    await embedScreenshots({ services, visual });
  }
  return copy;
}

async function embedScreenshots({ services, visual }) {
  for (const screenshot of visual.screenshots || []) {
    screenshot.embeddedImage = await safeImageDataUrl({ services, filePath: screenshot.path });
  }
}

async function safeImageDataUrl({ services, filePath }) {
  if (!filePath) return { available: false, reason: 'missing-path' };
  const allowedExtensions = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
  ]);
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = allowedExtensions.get(extension);
  if (!mimeType) return { available: false, reason: 'unsupported-image-type' };
  try {
    const artifactRoot = path.join(services.cwd, '.skill-rsi');
    const [realArtifactPath, realArtifactRoot] = await Promise.all([
      fs.realpath(path.resolve(filePath)),
      fs.realpath(artifactRoot),
    ]);
    if (!realArtifactPath.startsWith(`${realArtifactRoot}${path.sep}`)) {
      return { available: false, reason: 'outside-artifact-root' };
    }
    const stat = await fs.stat(realArtifactPath);
    if (!stat.isFile()) return { available: false, reason: 'not-a-file' };
    if (stat.size > 5 * 1024 * 1024) return { available: false, reason: 'image-too-large', size: stat.size };
    const bytes = await fs.readFile(realArtifactPath);
    return {
      available: true,
      mimeType,
      size: stat.size,
      dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    };
  } catch (error) {
    return { available: false, reason: error.code === 'ENOENT' ? 'missing-file' : 'read-failed' };
  }
}

function renderCockpitFallback(state) {
  if (!state.selectedProject) {
    return [
      'Skill RSI Cockpit',
      state.selectedProjectMissing
        ? `Requested project not found: ${state.requestedProjectId}`
        : 'No Skill RSI projects yet.',
      'Use the cockpit UI where supported, or call skill_rsi_create_project to create a project.',
    ].join('\n');
  }
  const lines = [
    'Skill RSI Cockpit',
    `Project: ${state.selectedProject.projectId}`,
    `Status: ${state.status}`,
    `Champion: ${state.champion.available ? 'available' : 'none'}`,
    `Run action: ${state.runAction.label}`,
    `Next loop plan: ${state.nextLoopPremise?.notes?.join(' | ') || 'none yet'}`,
    `Queued Codex context: ${state.automation?.hooks?.inbox?.count || 0}`,
    'If this host does not render MCP-UI, call the listed MCP tools directly.',
  ];
  return lines.join('\n');
}

function createCockpitResource(state) {
  return createUIResource({
    uri: COCKPIT_RESOURCE_URI,
    content: {
      type: 'rawHtml',
      htmlString: renderCockpitHtml(state),
    },
    encoding: 'text',
    uiMetadata: {
      'preferred-frame-size': ['100%', '760px'],
      'initial-render-data': {
        projectId: state.selectedProject?.projectId || null,
        status: state.status,
      },
    },
    adapters: {
      mcpApps: {
        enabled: true,
      },
    },
  });
}

function createCockpitShellState() {
  return {
    schemaVersion: 1,
    status: 'loading',
    view: 'overview',
    requestedProjectId: null,
    selectedProjectMissing: false,
    projects: [],
    selectedProject: null,
    selectedRunId: null,
    selectedFilePath: null,
    champion: { available: false },
    runAction: { label: 'Waiting for Skill RSI state', startsModelBackedWork: false },
    automation: { hooks: { inbox: { count: 0 } } },
    nextLoopPremise: null,
    supportedModels: SUPPORTED_MODELS,
    supportedOutputTypes: SUPPORTED_OUTPUT_TYPES,
    capabilities: {
      mcpUi: true,
      visualRunner: false,
    },
  };
}

function registerCockpitResource(server) {
  registerAppResource(server, 'Skill RSI Console', COCKPIT_RESOURCE_URI, {
    title: 'Skill RSI Console',
    description: 'Native embedded console for Skill RSI projects.',
    mimeType: MCP_APP_MIME_TYPE,
    _meta: {
      ui: {
        prefersBorder: true,
        csp: {
          connectDomains: [],
          resourceDomains: [],
        },
      },
    },
  }, async () => {
    const resource = createCockpitResource(createCockpitShellState()).resource;
    return {
      contents: [{
        uri: COCKPIT_RESOURCE_URI,
        mimeType: resource.mimeType || MCP_APP_MIME_TYPE,
        text: resource.text,
      }],
    };
  });
}

function registerTool(server, handlers, name, config, handler) {
  server.registerTool(name, config, async args => {
    const data = await handler(args || {});
    return toolResult(data, makeSummary(config.title || name, [
      data.action ? `Action: ${data.action}` : null,
      data.projectId ? `Project: ${data.projectId}` : null,
      data.startsModelBackedWork ? 'Starts model-backed work: yes' : null,
    ]));
  });
}

export async function createSkillRsiMcpServer({ services = null } = {}) {
  const resolvedServices = services || await createSkillRsiServices();
  await loadMcpRuntimeDeps(resolvedServices.cwd || await resolveRepoRoot());
  const handlers = createSkillRsiToolHandlers(resolvedServices);
  const server = new McpServer({
    name: 'skill-rsi',
    version: '0.1.0',
  });
  registerCockpitResource(server);

  registerTool(server, handlers, 'skill_rsi_open', {
    title: 'Open Skill RSI Local App',
    description: 'Return the local Skill RSI web app URL for Codex Browser/sidebar launch. This does not inspect project state or start loops.',
    inputSchema: {
      projectName: z.string().optional(),
      create: z.boolean().default(false),
      draftId: z.string().optional(),
    },
  }, handlers.skill_rsi_open);

  registerAppTool(server, 'skill_rsi_cockpit', {
    title: 'Open Skill RSI',
    description: 'Open the optional guided Skill RSI MCP-UI cockpit for explicit existing-project inspection where supported. Not the default Codex desktop launch path.',
    inputSchema: {
      projectName: z.string().optional(),
      view: z.enum(['overview', 'history', 'evidence', 'skill', 'automation']).optional(),
      runId: z.string().optional(),
      skillSource: z.enum(['champion', 'challenger', 'candidate-a', 'candidate-b']).optional(),
      filePath: z.string().optional(),
      existingProjectIntent: z.boolean().optional(),
    },
    _meta: {
      ui: {
        resourceUri: COCKPIT_RESOURCE_URI,
      },
      'ui/resourceUri': COCKPIT_RESOURCE_URI,
    },
  }, async args => {
    const data = await handlers.skill_rsi_cockpit(args || {});
    return uiToolResult(data, createCockpitResource(data), renderCockpitFallback(data));
  });

  registerTool(server, handlers, 'skill_rsi_doctor', {
    title: 'Skill RSI Doctor',
    description: 'Report local Skill RSI, OpenAI key, model, visual runner, and plugin readiness without exposing secrets.',
  }, handlers.skill_rsi_doctor);

  registerTool(server, handlers, 'skill_rsi_list_projects', {
    title: 'List Skill RSI Projects',
    description: 'List local Skill RSI projects and concise state summaries. Use only when the user asks for existing projects, history, or project selection; do not use before a fresh "improve this skill" flow.',
    inputSchema: {
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_list_projects);

  registerTool(server, handlers, 'skill_rsi_create_project', {
    title: 'Create Skill RSI Project',
    description: 'Create a fresh scratch or baseline Skill RSI project using the same defaults as the UI and CLI. If the requested name already exists, the tool creates a suffixed fresh project instead of inspecting or reusing the old one.',
    inputSchema: {
      projectName: z.string().min(1),
      goal: z.string().min(1),
      outputType: z.enum(['text', 'code', 'code_visual']).default('text'),
      model: z.enum(['gpt-5.4-mini', 'gpt-5.5']).default(DEFAULT_MODEL),
      targetIterations: z.number().int().positive().default(3),
      triggerMode: z.enum(['manual', 'continuous', 'hook', 'cron']).default('manual'),
      baselinePath: z.string().optional(),
    },
  }, handlers.skill_rsi_create_project);

  registerTool(server, handlers, 'skill_rsi_prepare_project', {
    title: 'Prepare Skill RSI Project Setup',
    description: 'Prepare a fresh Skill RSI setup draft and return a create-flow URL. Use this for plain fresh Codex requests so the user can choose output type and model in the UI before project creation.',
    inputSchema: {
      projectName: z.string().optional(),
      goal: z.string().optional(),
      outputType: z.enum(['text', 'code', 'code_visual']).optional(),
      model: z.enum(['gpt-5.4-mini', 'gpt-5.5']).default(DEFAULT_MODEL),
      targetIterations: z.number().int().positive().default(3),
      triggerMode: z.enum(['manual', 'continuous', 'hook', 'cron']).default('manual'),
      baselinePath: z.string().optional(),
    },
  }, handlers.skill_rsi_prepare_project);

  registerTool(server, handlers, 'skill_rsi_run_next', {
    title: 'Run Skill RSI Loop',
    description: 'Start bounded manual Skill RSI loop execution through the existing run, lock, and budget machinery.',
    inputSchema: {
      projectName: z.string().min(1),
      loops: z.number().int().positive().default(1),
      mode: z.enum(['stub', 'mock', 'agentic']).default('agentic'),
      evalMode: z.enum(['mock', 'real']).default('real'),
      goal: z.string().optional(),
      maxRuns: z.number().int().nonnegative().optional(),
      model: z.string().optional(),
      generationModel: z.string().optional(),
      judgeModel: z.string().optional(),
      agentModel: z.string().optional(),
      openaiKey: z.string().optional(),
      anthropicKey: z.string().optional(),
      geminiKey: z.string().optional(),
      runIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_run_next);

  registerTool(server, handlers, 'skill_rsi_run_with_context', {
    title: 'Run With Queued Codex Context',
    description: 'Claim queued Codex context and start one bounded hook-informed Skill RSI loop through normal lock, budget, and run recording.',
    inputSchema: {
      projectName: z.string().min(1),
      loops: z.number().int().positive().default(1),
      mode: z.enum(['stub', 'mock', 'agentic']).default('agentic'),
      evalMode: z.enum(['mock', 'real']).default('real'),
      goal: z.string().optional(),
      maxRuns: z.number().int().nonnegative().optional(),
      model: z.string().optional(),
      generationModel: z.string().optional(),
      judgeModel: z.string().optional(),
      agentModel: z.string().optional(),
      openaiKey: z.string().optional(),
      anthropicKey: z.string().optional(),
      geminiKey: z.string().optional(),
      runIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_run_with_context);

  registerTool(server, handlers, 'skill_rsi_progress', {
    title: 'Skill RSI Progress',
    description: 'Read latest run progress and stage details for an explicitly named existing project. Do not use this to resolve a name collision during a fresh project/import flow.',
    inputSchema: {
      projectName: z.string().min(1),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_progress);

  registerTool(server, handlers, 'skill_rsi_get_run_detail', {
    title: 'Get Run Detail',
    description: 'Read detailed run artifacts, timeline, recommendation, and eval references for a project run.',
    inputSchema: {
      projectName: z.string().min(1),
      runId: z.string().optional(),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_get_run_detail);

  registerTool(server, handlers, 'skill_rsi_get_run_comparison', {
    title: 'Get Run Comparison',
    description: 'Read champion/challenger or Candidate A/B comparison metadata for a project run.',
    inputSchema: {
      projectName: z.string().min(1),
      runId: z.string().optional(),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_get_run_comparison);

  registerTool(server, handlers, 'skill_rsi_get_skill_content', {
    title: 'Get Skill Content',
    description: 'Read selected champion, challenger, or cold-start candidate package files.',
    inputSchema: {
      projectName: z.string().min(1),
      source: z.enum(['champion', 'challenger', 'candidate-a', 'candidate-b']).default('champion'),
      runId: z.string().optional(),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_get_skill_content);

  registerTool(server, handlers, 'skill_rsi_get_evidence', {
    title: 'Get Run Evidence',
    description: 'Read prompt-level evaluation evidence, judge reasoning, outputs, and visual artifact metadata for a run.',
    inputSchema: {
      projectName: z.string().min(1),
      runId: z.string().optional(),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_get_evidence);

  registerTool(server, handlers, 'skill_rsi_get_next_loop_plan', {
    title: 'Get Next Loop Plan',
    description: 'Read the current next-loop premise, automation state, champion, and run policy.',
    inputSchema: {
      projectName: z.string().min(1),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_get_next_loop_plan);

  registerTool(server, handlers, 'skill_rsi_get_champion', {
    title: 'Get Champion Skill',
    description: 'Read current champion metadata and SKILL.md text when available.',
    inputSchema: {
      projectName: z.string().min(1),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_get_champion);

  registerTool(server, handlers, 'skill_rsi_export_champion', {
    title: 'Export Champion Skill',
    description: 'Export the current champion skill package to a caller-provided local directory.',
    inputSchema: {
      projectName: z.string().min(1),
      outDir: z.string().min(1),
      existingProjectIntent: z.boolean().optional(),
    },
  }, handlers.skill_rsi_export_champion);

  registerTool(server, handlers, 'skill_rsi_record_context', {
    title: 'Record Skill RSI Context',
    description: 'Queue explicit context into a project hook inbox without running an RSI loop.',
    inputSchema: {
      projectName: z.string().min(1),
      eventName: z.string().optional(),
      reason: z.string().optional(),
      changedFiles: z.array(z.string()).default([]),
      focusParameterIds: z.array(z.string()).default([]),
      parameterIds: z.array(z.string()).default([]),
    },
  }, handlers.skill_rsi_record_context);

  return { server, handlers, services: resolvedServices };
}

export async function startStdioServer() {
  const { server } = await createSkillRsiMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startStdioServer().catch(error => {
    console.error(`[skill-rsi-mcp] ${error.stack || error.message}`);
    process.exit(1);
  });
}
