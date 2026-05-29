#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createUIResource } from '@mcp-ui/server';
import { z } from 'zod';
import { renderCockpitHtml } from './ui/cockpit.html.js';

const DEFAULT_MODEL = 'gpt-5.4-mini';
const SUPPORTED_OUTPUT_TYPES = ['text', 'code', 'code_visual'];
const SUPPORTED_MODELS = ['gpt-5.4-mini', 'gpt-5.5'];

function currentDirname(importMetaUrl = import.meta.url) {
  return path.dirname(fileURLToPath(importMetaUrl));
}

export async function resolveRepoRoot({ env = process.env, startDir = currentDirname() } = {}) {
  const candidates = [];
  if (env.SKILL_RSI_ROOT) candidates.push(path.resolve(env.SKILL_RSI_ROOT));
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

async function importLib(repoRoot, relativePath) {
  return import(pathToFileURL(path.join(repoRoot, relativePath)).href);
}

export async function createSkillRsiServices({ repoRoot = null, env = process.env } = {}) {
  const cwd = repoRoot || await resolveRepoRoot({ env });
  const [
    uiApi,
    runLoop,
    visualRunner,
    hooks,
    store,
  ] = await Promise.all([
    importLib(cwd, 'src/lib/ui-api.js'),
    importLib(cwd, 'src/lib/run-loop.js'),
    importLib(cwd, 'src/lib/visual-runner.js'),
    importLib(cwd, 'src/lib/hooks.js'),
    importLib(cwd, 'src/lib/store.js'),
  ]);

  return {
    cwd,
    env,
    uiApi,
    runProject: runLoop.runProject,
    checkVisualRunnerAvailability: visualRunner.checkVisualRunnerAvailability,
    recordHookEvent: hooks.recordHookEvent,
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
      {
        type: 'text',
        text: summary ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : JSON.stringify(data, null, 2),
      },
      uiResource,
    ],
    structuredContent: data,
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
      return buildCockpitState({
        services,
        projectName: args.projectName || null,
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

    async skill_rsi_list_projects() {
      return {
        schemaVersion: 1,
        repoRoot: services.cwd,
        projects: await services.uiApi.readProjectSummaries({ cwd: services.cwd }),
      };
    },

    async skill_rsi_create_project(args) {
      const summary = await services.uiApi.createProjectFromLocalInput({
        cwd: services.cwd,
        projectName: args.projectName,
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
        project: summary,
      };
    },

    async skill_rsi_run_next(args) {
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

    async skill_rsi_progress(args) {
      return services.uiApi.readRunProgress({
        cwd: services.cwd,
        projectName: args.projectName,
      });
    },

    async skill_rsi_get_next_loop_plan(args) {
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

export async function buildCockpitState({ services, projectName = null }) {
  const projects = await services.uiApi.readProjectSummaries({ cwd: services.cwd });
  const requestedProjectId = slugifyProjectName(projectName);
  const selectedProject = requestedProjectId
    ? projects.find(project => project.projectId === requestedProjectId) || null
    : projects[0] || null;
  const selectedProjectMissing = Boolean(requestedProjectId && !selectedProject);
  const supportedModels = services.uiApi.UI_OPENAI_MODELS || SUPPORTED_MODELS;

  if (!selectedProject) {
    return {
      schemaVersion: 1,
      kind: 'skill-rsi-cockpit',
      status: selectedProjectMissing ? 'missing' : 'empty',
      repoRoot: services.cwd,
      requestedProjectId,
      selectedProjectMissing,
      projects,
      selectedProject: null,
      progress: null,
      champion: { available: false },
      nextLoopPremise: null,
      latestEvidence: null,
      automation: null,
      runAction: null,
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
  const status = progress?.status === 'running'
    ? 'running'
    : summary.automation?.status || (progress?.status === 'completed' ? 'completed' : 'manual');

  return {
    schemaVersion: 1,
    kind: 'skill-rsi-cockpit',
    status,
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
    supportedOutputTypes: SUPPORTED_OUTPUT_TYPES,
    supportedModels,
    actions: buildCockpitActions({ project: summary, targetLoops }),
    capabilities: buildCockpitCapabilities(),
  };
}

function buildCockpitCapabilities() {
  return {
    mcpTools: true,
    mcpUi: true,
    uiActions: true,
    detailedEvidencePanels: false,
    visualScreenshotPanels: false,
    hookAutorun: false,
  };
}

function buildCockpitActions({ project, targetLoops }) {
  const projectName = project?.projectId || null;
  return {
    refresh: {
      toolName: 'skill_rsi_open',
      params: projectName ? { projectName } : {},
    },
    createProject: {
      toolName: 'skill_rsi_create_project',
    },
    runTargetBatch: {
      toolName: 'skill_rsi_run_next',
      enabled: Boolean(projectName),
      params: projectName ? {
        projectName,
        loops: targetLoops,
        mode: 'agentic',
        evalMode: 'real',
      } : null,
    },
    exportChampion: {
      toolName: 'skill_rsi_export_champion',
      enabled: Boolean(project?.state?.currentChampion),
    },
    recordContext: {
      toolName: 'skill_rsi_record_context',
      enabled: Boolean(projectName),
    },
  };
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
    uri: `ui://skill-rsi/cockpit/${state.selectedProject?.projectId || state.requestedProjectId || 'home'}`,
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
  const handlers = createSkillRsiToolHandlers(resolvedServices);
  const server = new McpServer({
    name: 'skill-rsi',
    version: '0.1.0',
  });

  server.registerTool('skill_rsi_open', {
    title: 'Open Skill RSI',
    description: 'Open the guided Skill RSI MCP-UI cockpit where supported and return a text fallback everywhere.',
    inputSchema: {
      projectName: z.string().optional(),
    },
  }, async args => {
    const data = await handlers.skill_rsi_open(args || {});
    return uiToolResult(data, createCockpitResource(data), renderCockpitFallback(data));
  });

  registerTool(server, handlers, 'skill_rsi_doctor', {
    title: 'Skill RSI Doctor',
    description: 'Report local Skill RSI, OpenAI key, model, visual runner, and plugin readiness without exposing secrets.',
  }, handlers.skill_rsi_doctor);

  registerTool(server, handlers, 'skill_rsi_list_projects', {
    title: 'List Skill RSI Projects',
    description: 'List local Skill RSI projects and concise state summaries.',
  }, handlers.skill_rsi_list_projects);

  registerTool(server, handlers, 'skill_rsi_create_project', {
    title: 'Create Skill RSI Project',
    description: 'Create a scratch or baseline Skill RSI project using the same defaults as the UI and CLI.',
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
    },
  }, handlers.skill_rsi_run_next);

  registerTool(server, handlers, 'skill_rsi_progress', {
    title: 'Skill RSI Progress',
    description: 'Read latest run progress and stage details for a project.',
    inputSchema: {
      projectName: z.string().min(1),
    },
  }, handlers.skill_rsi_progress);

  registerTool(server, handlers, 'skill_rsi_get_next_loop_plan', {
    title: 'Get Next Loop Plan',
    description: 'Read the current next-loop premise, automation state, champion, and run policy.',
    inputSchema: {
      projectName: z.string().min(1),
    },
  }, handlers.skill_rsi_get_next_loop_plan);

  registerTool(server, handlers, 'skill_rsi_get_champion', {
    title: 'Get Champion Skill',
    description: 'Read current champion metadata and SKILL.md text when available.',
    inputSchema: {
      projectName: z.string().min(1),
    },
  }, handlers.skill_rsi_get_champion);

  registerTool(server, handlers, 'skill_rsi_export_champion', {
    title: 'Export Champion Skill',
    description: 'Export the current champion skill package to a caller-provided local directory.',
    inputSchema: {
      projectName: z.string().min(1),
      outDir: z.string().min(1),
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
