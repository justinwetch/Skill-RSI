#!/usr/bin/env node

import { runProject } from './lib/run-loop.js';
import { initProject } from './lib/init.js';
import { readProjectStatus } from './lib/status.js';
import { loadSkillPackage } from './lib/skill-package.js';
import { runHeadlessEval } from './lib/evaluator.js';
import { writeAgentContractArtifact, writeRealAgentContractArtifact } from './lib/agent-contracts.js';
import {
  claimPendingHookEvents,
  hasProjectRunLock,
  markHookEventsFailed,
  markHookEventsProcessed,
  markHookEventsSkipped,
  recordHookEvent,
  requeueHookEvents,
  summarizeHookEvents,
} from './lib/hooks.js';
import { getProjectPaths, getRunPaths } from './lib/paths.js';
import { readJson } from './lib/store.js';
import { loadDotEnv } from './lib/env.js';
import { readTimeline, renderTimeline } from './lib/timeline.js';
import { checkVisualRunnerAvailability } from './lib/visual-runner.js';
import {
  createProjectFromLocalInput,
  deleteProject,
  readProjectSummaries,
  readProjectSummary,
  readRunComparison,
  readRunDetail,
  readRunProgress,
  readSkillContent,
  recordHumanDecision,
  UI_OPENAI_MODELS,
} from './lib/ui-api.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_TEST_MODEL = 'gpt-5.4-mini';

function parseArgs(argv) {
  const [command, maybeProjectName, ...tail] = argv;
  const projectName = maybeProjectName && !maybeProjectName.startsWith('--') ? maybeProjectName : null;
  const rest = projectName ? tail : [maybeProjectName, ...tail].filter(Boolean);
  const options = {};

  for (let i = 0; i < rest.length; i += 1) {
    const item = rest[i];
    if (!item.startsWith('--')) continue;

    const key = item.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { command, projectName, options };
}

function printHelp() {
  console.log(`Skill RSI

Usage:
  skill-rsi init <project> --goal "Skill goal" [--output text|code|code_visual] [--model ${DEFAULT_TEST_MODEL}] [--target-iterations 3]
  skill-rsi init <project> --goal "Improve this skill" --baseline ./path/to/skill-or.zip
  skill-rsi run <project> --stub --loops 3
  skill-rsi run <project> --mock --real-eval --loops 1
  skill-rsi run <project> --agentic --loops 1 [--model ${DEFAULT_TEST_MODEL}]
  skill-rsi step <project> --mock
  skill-rsi continuous <project> --mock --max-runs 10 [--max-new-runs 1] --patience 3 --max-inconclusive 2
  skill-rsi hook <project> --mock --event hook.json
  skill-rsi hook-record <project> --event hook.json|-
  skill-rsi doctor [--json]
  skill-rsi projects
  skill-rsi status <project>
  skill-rsi summary <project>
  skill-rsi progress <project> [--json]
  skill-rsi run-detail <project> [--run run-id]
  skill-rsi compare <project> [--run run-id]
  skill-rsi decide <project> --decision annotate --note "Reviewed"
  skill-rsi report <project>
  skill-rsi timeline <project> [--run run-id] [--json]
  skill-rsi skill <project> --source champion|challenger|candidate-a|candidate-b [--run latest|run-id] [--file SKILL.md] [--json]
  skill-rsi export-skill <project> --source champion|challenger|candidate-a|candidate-b --out ./exported-skill [--run latest|run-id]
  skill-rsi delete <project> [--json]
  skill-rsi inspect-skill <path>
  skill-rsi evaluate <name> --a ./skill-a --b ./skill-b --prompts prompts.json --criteria criteria.json --output text|code|code_visual --mock --out result.json
  skill-rsi evaluate <name> --a ./skill-a --b ./skill-b --prompts prompts.json --criteria criteria.json --output code_visual --visual-artifacts-dir ./visual-artifacts --gen-model ${DEFAULT_TEST_MODEL} --judge-model ${DEFAULT_TEST_MODEL} --out result.json
  skill-rsi agent <project> --name deconstructor --run-id contract-001 --out artifact.json
  skill-rsi agent <project> --name deconstructor --real --model ${DEFAULT_TEST_MODEL} --save-current --out artifact.json
  skill-rsi agent <project> --name creator --real --model ${DEFAULT_TEST_MODEL} --arm candidateA --candidate-dir .skill-rsi/projects/<project>/scratch/candidate-a

Mock modes support offline loop development; evaluate supports text, code, and code + visual output contracts.`);
}

function resolveRunMode(options) {
  if (options.agentic) return 'agentic';
  if (options.mock) return 'mock';
  if (options.stub) return 'stub';
  return null;
}

function resolveStopRules(options) {
  return {
    maxNoPromotionRuns: options.patience ? Number.parseInt(options.patience, 10) : null,
    maxInconclusiveRuns: options['max-inconclusive'] ? Number.parseInt(options['max-inconclusive'], 10) : null,
  };
}

function resolveModelOverrides(options) {
  const model = options.model || null;
  return {
    generationModel: options['gen-model'] || model || null,
    judgeModel: options['judge-model'] || model || null,
    agentModel: options['agent-model'] || model || null,
  };
}

function parseNonNegativeIntOption(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a non-negative integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative integer`);
  return parsed;
}

function parsePositiveIntOption(value, label) {
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a positive integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function normalizeRunIdOption(value) {
  if (!value || value === 'latest') return null;
  return value;
}

function printJsonOrHuman(value, options, humanRenderer) {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(humanRenderer(value));
  }
}

function safeExportPath(rootDir, filePath) {
  const destination = path.resolve(rootDir, filePath);
  const rootWithSep = `${path.resolve(rootDir)}${path.sep}`;
  if (destination !== path.resolve(rootDir) && !destination.startsWith(rootWithSep)) {
    throw new Error(`Refusing to export unsafe path: ${filePath}`);
  }
  return destination;
}

function renderInitSummary(summary) {
  const lines = [
    `Initialized ${summary.projectId}`,
    `Project: ${summary.projectDir}`,
    `Goal: ${summary.goal}`,
    `Output: ${summary.config.eval.outputType}`,
    `Model: ${summary.config.models.agent}`,
    `Target iterations: ${summary.state.runPolicy.targetIterations}`,
    `Champion: ${summary.state.currentChampion?.candidateId || 'none'}`,
  ];
  return lines.join('\n');
}

function renderDoctor(result) {
  return [
    'Skill RSI doctor',
    `Node: ${result.node}`,
    `Server OpenAI key: ${result.openai.serverKeyConfigured ? 'configured' : 'not configured'}`,
    `Models: ${result.openai.models.join(', ')} (default ${result.openai.defaultModel})`,
    `Visual runner: ${result.visualRunner.available ? `available (${result.visualRunner.browser})` : 'unavailable'}`,
    result.visualRunner.available ? null : `Visual runner error: ${result.visualRunner.error}`,
    result.visualRunner.available ? null : `Install hint: ${result.visualRunner.installHint}`,
  ].filter(Boolean).join('\n');
}

function renderProgress(progress) {
  const lines = [
    `Project: ${progress.projectId}`,
    `Run: ${progress.runId || 'none'}`,
    `Status: ${progress.status}`,
  ];
  if (progress.runNumber !== null && progress.runNumber !== undefined) lines.push(`Iteration: ${progress.runNumber}`);
  if (progress.competitionMode) lines.push(`Competition: ${progress.competitionMode}`);
  if (progress.startedAt) lines.push(`Started: ${progress.startedAt}`);
  if (progress.completedAt) lines.push(`Completed: ${progress.completedAt}`);
  if (progress.events?.length) {
    lines.push('', 'Events:');
    for (const event of progress.events.slice(-12)) {
      lines.push(`- ${event.event}`);
    }
  }
  const detailLines = Object.entries(progress.stageDetails || {})
    .flatMap(([stage, details]) => (details || []).map(detail => `- ${stage}: ${detail}`));
  if (detailLines.length) {
    lines.push('', 'Stage details:', ...detailLines);
  }
  return lines.join('\n');
}

function renderExportSummary(result) {
  return [
    `Exported ${result.source} skill for ${result.projectId}`,
    `Files: ${result.fileCount}`,
    `Output: ${result.outDir}`,
  ].join('\n');
}

async function main() {
  await loadDotEnv(process.cwd());
  const { command, projectName, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'doctor') {
    const visualRunner = await checkVisualRunnerAvailability();
    const result = {
      schemaVersion: 1,
      node: process.version,
      openai: {
        keyConfigured: Boolean(process.env.OPENAI_API_KEY),
        serverKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        uiKeySupported: false,
        models: UI_OPENAI_MODELS,
        defaultModel: DEFAULT_TEST_MODEL,
      },
      visualRunner,
    };
    printJsonOrHuman(result, options, renderDoctor);
    return;
  }

  if (command === 'projects') {
    const summaries = await readProjectSummaries({ cwd: process.cwd() });
    console.log(JSON.stringify({
      schemaVersion: 1,
      projects: summaries,
    }, null, 2));
    return;
  }

  if (!projectName) {
    throw new Error(`Missing project name for command "${command}"`);
  }

  if (command === 'init') {
    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    const outputType = options.output || 'text';
    if (outputType === 'code_visual') {
      const visualRunner = await checkVisualRunnerAvailability();
      if (!visualRunner.available) {
        throw new Error(`Visual runner unavailable: ${visualRunner.error}. ${visualRunner.installHint}`);
      }
    }
    const result = await createProjectFromLocalInput({
      cwd: process.cwd(),
      projectName,
      goal,
      targetIterations: options['target-iterations'] || 3,
      triggerMode: options['trigger-mode'] || 'manual',
      outputType,
      model: options.model || DEFAULT_TEST_MODEL,
      baselinePath: options.baseline ? path.resolve(options.baseline) : null,
    });
    printJsonOrHuman(result, options, renderInitSummary);
    return;
  }

  if (command === 'run') {
    const mode = resolveRunMode(options);
    if (!mode) {
      throw new Error('Run requires --stub, --mock, or --agentic.');
    }

    const loops = Number.parseInt(options.loops || '1', 10);
    if (!Number.isInteger(loops) || loops < 1) {
      throw new Error('--loops must be a positive integer');
    }

    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    const { generationModel, judgeModel, agentModel } = resolveModelOverrides(options);
    const result = await runProject({
      cwd: process.cwd(),
      projectName,
      goal,
      loops,
      mode,
      maxRuns: options['max-runs'] ? Number.parseInt(options['max-runs'], 10) : null,
      evalMode: options['real-eval'] ? 'real' : 'mock',
      generationModel,
      judgeModel,
      agentModel,
      stopRules: resolveStopRules(options),
      triggerMode: 'manual',
      apiKeys: {
        anthropic: options['anthropic-key'],
        openai: options['openai-key'],
        gemini: options['gemini-key'],
      },
    });

    console.log(`Completed ${result.completedRuns.length} ${mode} loop(s) for ${result.projectId}`);
    console.log(`Champion: ${result.state.currentChampion?.candidateId || 'none'}`);
    if (result.stopReason) console.log(`Stop reason: ${result.stopReason}`);
    console.log(`History: ${result.paths.historyIndex}`);
    return;
  }

  if (command === 'step') {
    const mode = resolveRunMode(options) || 'stub';
    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    const { generationModel, judgeModel, agentModel } = resolveModelOverrides(options);
    const result = await runProject({
      cwd: process.cwd(),
      projectName,
      goal,
      loops: 1,
      mode,
      maxRuns: options['max-runs'] ? Number.parseInt(options['max-runs'], 10) : null,
      evalMode: options['real-eval'] ? 'real' : 'mock',
      generationModel,
      judgeModel,
      agentModel,
      stopRules: resolveStopRules(options),
      triggerMode: 'manual',
      apiKeys: {
        anthropic: options['anthropic-key'],
        openai: options['openai-key'],
        gemini: options['gemini-key'],
      },
    });
    console.log(`Stepped ${result.projectId} to run ${result.state.runCount}`);
    if (result.stopReason) console.log(`Stop reason: ${result.stopReason}`);
    return;
  }

  if (command === 'continuous') {
    if (!options['max-runs']) throw new Error('continuous requires --max-runs');
    const maxRuns = parseNonNegativeIntOption(options['max-runs'], '--max-runs');
    const maxNewRuns = options['max-new-runs']
      ? parsePositiveIntOption(options['max-new-runs'], '--max-new-runs')
      : null;
    const paths = getProjectPaths(process.cwd(), projectName);
    const state = await readJson(paths.stateJson, { runCount: 0 });
    const remaining = Math.max(0, maxRuns - state.runCount);
    const loops = maxNewRuns ? Math.min(remaining, maxNewRuns) : remaining;
    if (options['consume-hooks'] && await hasProjectRunLock({ cwd: process.cwd(), projectName })) {
      console.log(`Project is already locked; pending hook event(s) remain queued for ${projectName}.`);
      return;
    }
    const claimedHookEvents = options['consume-hooks']
      ? await claimPendingHookEvents({ cwd: process.cwd(), projectName })
      : [];
    if (claimedHookEvents.length && await hasProjectRunLock({ cwd: process.cwd(), projectName })) {
      await requeueHookEvents({
        cwd: process.cwd(),
        projectName,
        events: claimedHookEvents,
        reason: 'Project became locked after hook events were claimed',
      });
      console.log(`Requeued ${claimedHookEvents.length} pending hook event(s); project is already locked.`);
      return;
    }
    if (remaining === 0) {
      if (claimedHookEvents.length) {
        await markHookEventsSkipped({
          cwd: process.cwd(),
          projectName,
          events: claimedHookEvents,
          reason: `max-runs ${maxRuns} already reached`,
        });
        console.log(`Skipped ${claimedHookEvents.length} pending hook event(s); max-runs ${maxRuns} already reached.`);
      }
      console.log(`No runs needed; ${projectName} is already at max-runs ${maxRuns}.`);
      return;
    }
    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    const mode = resolveRunMode(options) || 'stub';
    const { generationModel, judgeModel, agentModel } = resolveModelOverrides(options);
    let result;
    try {
      result = await runProject({
        cwd: process.cwd(),
        projectName,
        goal,
        loops,
        mode,
        maxRuns,
        evalMode: options['real-eval'] ? 'real' : 'mock',
        generationModel,
        judgeModel,
        agentModel,
        stopRules: resolveStopRules(options),
        triggerMode: claimedHookEvents.length ? 'hook' : 'continuous',
        hookContext: summarizeHookEvents(claimedHookEvents),
        apiKeys: {
          anthropic: options['anthropic-key'],
          openai: options['openai-key'],
          gemini: options['gemini-key'],
        },
      });
      if (claimedHookEvents.length) {
        const completed = result.completedRuns.length > 0;
        if (completed) {
          await markHookEventsProcessed({ cwd: process.cwd(), projectName, events: claimedHookEvents });
        } else {
          await markHookEventsSkipped({
            cwd: process.cwd(),
            projectName,
            events: claimedHookEvents,
            reason: result.stopReason || 'no runs completed',
          });
        }
      }
    } catch (error) {
      if (claimedHookEvents.length) {
        if (isProjectLockedError(error)) {
          await requeueHookEvents({
            cwd: process.cwd(),
            projectName,
            events: claimedHookEvents,
            reason: error.message,
          });
          console.log(`Requeued ${claimedHookEvents.length} pending hook event(s); project is already locked.`);
          return;
        }
        await markHookEventsFailed({ cwd: process.cwd(), projectName, events: claimedHookEvents, error });
      }
      throw error;
    }
    console.log(`Continuous run completed ${result.completedRuns.length} loop(s); total runs ${result.state.runCount}.`);
    if (claimedHookEvents.length) {
      const action = result.completedRuns.length > 0 ? 'Processed' : 'Skipped';
      console.log(`${action} ${claimedHookEvents.length} pending hook event(s).`);
    }
    if (result.stopReason) console.log(`Stop reason: ${result.stopReason}`);
    return;
  }

  if (command === 'hook-record') {
    const hookPath = await recordHookEvent({
      cwd: process.cwd(),
      projectName,
      eventPath: options.event || null,
      queued: true,
    });
    console.log(`Queued hook: ${hookPath}`);
    return;
  }

  if (command === 'hook') {
    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    await initProject({ cwd: process.cwd(), projectName, goal });
    const mode = resolveRunMode(options) || 'stub';
    const { generationModel, judgeModel, agentModel } = resolveModelOverrides(options);
    const hookPath = await recordHookEvent({
      cwd: process.cwd(),
      projectName,
      eventPath: options.event || null,
    });
    const hookContext = {
      ...(await readJson(hookPath, {})),
      path: hookPath,
    };
    const result = await runProject({
      cwd: process.cwd(),
      projectName,
      goal,
      loops: 1,
      mode,
      maxRuns: options['max-runs'] ? Number.parseInt(options['max-runs'], 10) : null,
      evalMode: options['real-eval'] ? 'real' : 'mock',
      generationModel,
      judgeModel,
      agentModel,
      stopRules: resolveStopRules(options),
      triggerMode: 'hook',
      hookContext,
      apiKeys: {
        anthropic: options['anthropic-key'],
        openai: options['openai-key'],
        gemini: options['gemini-key'],
      },
    });
    console.log(`Recorded hook: ${hookPath}`);
    console.log(`Triggered run: ${result.state.lastRunId}`);
    if (result.stopReason) console.log(`Stop reason: ${result.stopReason}`);
    return;
  }

  if (command === 'status') {
    const status = await readProjectStatus({ cwd: process.cwd(), projectName });
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === 'summary') {
    const summary = await readProjectSummary({ cwd: process.cwd(), projectName });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === 'progress') {
    const progress = await readRunProgress({ cwd: process.cwd(), projectName });
    printJsonOrHuman(progress, options, renderProgress);
    return;
  }

  if (command === 'run-detail') {
    const detail = await readRunDetail({
      cwd: process.cwd(),
      projectName,
      runId: normalizeRunIdOption(options.run),
    });
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  if (command === 'compare') {
    const comparison = await readRunComparison({
      cwd: process.cwd(),
      projectName,
      runId: normalizeRunIdOption(options.run),
    });
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  if (command === 'decide') {
    if (!options.decision) throw new Error('decide requires --decision');
    const artifact = await recordHumanDecision({
      cwd: process.cwd(),
      projectName,
      runId: normalizeRunIdOption(options.run),
      decision: options.decision,
      candidateId: options.candidate || null,
      note: options.note || '',
      author: options.author || 'local-cli',
    });
    console.log(JSON.stringify(artifact, null, 2));
    return;
  }

  if (command === 'report') {
    const paths = getProjectPaths(process.cwd(), projectName);
    const summary = await fs.readFile(paths.historySummary, 'utf8');
    console.log(summary);
    return;
  }

  if (command === 'timeline') {
    const paths = getProjectPaths(process.cwd(), projectName);
    const state = await readJson(paths.stateJson, null);
    if (!state) throw new Error(`Project "${paths.projectId}" has not been initialized`);
    const runId = options.run || state.lastRunId;
    if (!runId) throw new Error(`Project "${paths.projectId}" has no completed runs`);
    const timelinePath = getRunPaths(paths, runId).timelineJsonl;
    const entries = await readTimeline(timelinePath);
    if (options.json) {
      console.log(JSON.stringify({ projectId: paths.projectId, runId, entries }, null, 2));
    } else {
      console.log(renderTimeline(entries, { runId }));
    }
    return;
  }

  if (command === 'skill') {
    const skill = await readSkillContent({
      cwd: process.cwd(),
      projectName,
      source: options.source || 'champion',
      runId: normalizeRunIdOption(options.run),
    });
    if (options.json) {
      console.log(JSON.stringify(skill, null, 2));
      return;
    }
    if (!skill.available) {
      throw new Error(`Skill source "${skill.source}" is not available for ${projectName}`);
    }
    const requestedFile = options.file || 'SKILL.md';
    const file = skill.files.find(item => item.path === requestedFile);
    if (!file || typeof file.text !== 'string') {
      throw new Error(`File "${requestedFile}" was not found in ${skill.source}`);
    }
    console.log(file.text);
    return;
  }

  if (command === 'export-skill') {
    if (!options.out) throw new Error('export-skill requires --out');
    const skill = await readSkillContent({
      cwd: process.cwd(),
      projectName,
      source: options.source || 'champion',
      runId: normalizeRunIdOption(options.run),
    });
    if (!skill.available) {
      throw new Error(`Skill source "${skill.source}" is not available for ${projectName}`);
    }
    const outDir = path.resolve(options.out);
    for (const file of skill.files) {
      if (typeof file.text !== 'string') continue;
      const destination = safeExportPath(outDir, file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, file.text, 'utf8');
    }
    const result = {
      schemaVersion: 1,
      projectId: skill.projectId,
      source: skill.source,
      runId: skill.runId,
      outDir,
      fileCount: skill.files.filter(file => typeof file.text === 'string').length,
    };
    printJsonOrHuman(result, options, renderExportSummary);
    return;
  }

  if (command === 'delete') {
    const result = await deleteProject({ cwd: process.cwd(), projectName });
    printJsonOrHuman(result, options, deleted => `Deleted ${deleted.deleted}\nMoved to: ${deleted.trashedTo}`);
    return;
  }

  if (command === 'inspect-skill') {
    const skillPackage = await loadSkillPackage(projectName);
    console.log(JSON.stringify({
      id: skillPackage.id,
      sourcePath: skillPackage.sourcePath,
      packageType: skillPackage.packageType,
      entrypoint: skillPackage.entrypoint,
      fileCount: skillPackage.files.length,
      omittedFileCount: skillPackage.omittedFiles.length,
      diagnostics: skillPackage.diagnostics,
      validation: skillPackage.validation,
      hash: skillPackage.hash,
      files: skillPackage.files.map(file => ({
        path: file.path,
        role: file.role,
        kind: file.kind,
        size: file.size,
        sha256: file.sha256,
      })),
    }, null, 2));
    return;
  }

  if (command === 'evaluate') {
    for (const required of ['a', 'b', 'prompts', 'criteria']) {
      if (!options[required]) throw new Error(`Missing --${required}`);
    }
    const generationModel = options['gen-model'] || DEFAULT_TEST_MODEL;
    const judgeModel = options['judge-model'] || generationModel;
    const outputType = options.output || 'text';
    if (outputType === 'code_visual' && !options.mock && !options['visual-artifacts-dir']) {
      throw new Error('Real code_visual evaluation requires --visual-artifacts-dir');
    }

    const result = await runHeadlessEval({
      skillAPath: options.a,
      skillBPath: options.b,
      promptsPath: options.prompts,
      criteriaPath: options.criteria,
      outputPath: options.out || null,
      mode: options.mock ? 'mock' : 'real',
      outputType,
      generationModel,
      judgeModel,
      visualArtifactsDir: options['visual-artifacts-dir'] ? path.resolve(options['visual-artifacts-dir']) : null,
      apiKeys: {
        anthropic: options['anthropic-key'],
        openai: options['openai-key'],
        gemini: options['gemini-key'],
      },
    });

    console.log(JSON.stringify({
      runId: result.runId,
      mode: result.mode,
      totalEvals: result.stats.totalEvals,
      winner: result.stats.winner,
      scoreDelta: result.stats.scoreDelta,
      output: options.out || null,
    }, null, 2));
    return;
  }

  if (command === 'agent') {
    if (!options.name) throw new Error('Missing --name');
    const agentOptions = {
      cwd: process.cwd(),
      projectName,
      agentName: options.name,
      runId: options['run-id'] || 'contract-run-001',
      outputPath: options.out || null,
    };
    const result = options.real
      ? await writeRealAgentContractArtifact({
        ...agentOptions,
        model: options.model || DEFAULT_TEST_MODEL,
        saveCurrent: Boolean(options['save-current']),
        experimentArm: options.arm || null,
        candidateDir: options['candidate-dir'] || null,
        apiKeys: {
          anthropic: options['anthropic-key'],
          openai: options['openai-key'],
          gemini: options['gemini-key'],
        },
      })
      : await writeAgentContractArtifact(agentOptions);
    console.log(JSON.stringify({
      agentName: result.agentName,
      mode: result.mode,
      outputPath: result.outputPath,
      candidatePath: result.materializedCandidate?.skillPath || null,
    }, null, 2));
    return;
  }

  throw new Error(`Unknown command "${command}"`);
}

function isProjectLockedError(error) {
  return typeof error?.message === 'string' && error.message.startsWith('Project is already locked:');
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
