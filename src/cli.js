#!/usr/bin/env node

import { initProject } from './lib/init.js';
import { runProject } from './lib/run-loop.js';
import { readProjectStatus } from './lib/status.js';
import { loadSkillPackage } from './lib/skill-package.js';
import { runHeadlessEval } from './lib/evaluator.js';
import { writeAgentContractArtifact, writeRealAgentContractArtifact } from './lib/agent-contracts.js';
import { recordHookEvent } from './lib/hooks.js';
import { getProjectPaths, getRunPaths } from './lib/paths.js';
import { readJson } from './lib/store.js';
import { loadDotEnv } from './lib/env.js';
import { readTimeline, renderTimeline } from './lib/timeline.js';
import {
  readProjectSummaries,
  readProjectSummary,
  readRunComparison,
  readRunDetail,
  recordHumanDecision,
} from './lib/ui-api.js';
import fs from 'node:fs/promises';

const DEFAULT_TEST_MODEL = 'gpt-5.4-mini';

function parseArgs(argv) {
  const [command, projectName, ...rest] = argv;
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
  skill-rsi init <project> --goal "Skill goal"
  skill-rsi run <project> --stub --loops 3
  skill-rsi run <project> --mock --real-eval --loops 1
  skill-rsi run <project> --agentic --loops 1 --agent-model ${DEFAULT_TEST_MODEL}
  skill-rsi step <project> --mock
  skill-rsi continuous <project> --mock --max-runs 10 --patience 3 --max-inconclusive 2
  skill-rsi hook <project> --mock --event hook.json
  skill-rsi projects
  skill-rsi status <project>
  skill-rsi summary <project>
  skill-rsi run-detail <project> [--run run-id]
  skill-rsi compare <project> [--run run-id]
  skill-rsi decide <project> --decision annotate --note "Reviewed"
  skill-rsi report <project>
  skill-rsi timeline <project> [--run run-id] [--json]
  skill-rsi inspect-skill <path>
  skill-rsi evaluate <name> --a ./skill-a --b ./skill-b --prompts prompts.json --criteria criteria.json --mock --out result.json
  skill-rsi evaluate <name> --a ./skill-a --b ./skill-b --prompts prompts.json --criteria criteria.json --gen-model ${DEFAULT_TEST_MODEL} --judge-model ${DEFAULT_TEST_MODEL} --out result.json
  skill-rsi agent <project> --name deconstructor --run-id contract-001 --out artifact.json
  skill-rsi agent <project> --name deconstructor --real --model ${DEFAULT_TEST_MODEL} --save-current --out artifact.json
  skill-rsi agent <project> --name creator --real --model ${DEFAULT_TEST_MODEL} --arm candidateA --candidate-dir .skill-rsi/projects/<project>/scratch/candidate-a

Mock modes support offline loop development; evaluate also supports real text-only model generation and judging.`);
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

async function main() {
  await loadDotEnv(process.cwd());
  const { command, projectName, options } = parseArgs(process.argv.slice(2));

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
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
    const result = await initProject({ cwd: process.cwd(), projectName, goal });
    console.log(`Initialized ${result.projectId}`);
    console.log(`Project: ${result.projectDir}`);
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
    const generationModel = options['gen-model'] || DEFAULT_TEST_MODEL;
    const judgeModel = options['judge-model'] || generationModel;
    const agentModel = options['agent-model'] || generationModel;
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
    const generationModel = options['gen-model'] || DEFAULT_TEST_MODEL;
    const judgeModel = options['judge-model'] || generationModel;
    const agentModel = options['agent-model'] || generationModel;
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
    const maxRuns = Number.parseInt(options['max-runs'], 10);
    const paths = getProjectPaths(process.cwd(), projectName);
    const state = await readJson(paths.stateJson, { runCount: 0 });
    const remaining = Math.max(0, maxRuns - state.runCount);
    if (remaining === 0) {
      console.log(`No runs needed; ${projectName} is already at max-runs ${maxRuns}.`);
      return;
    }
    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    const mode = resolveRunMode(options) || 'stub';
    const generationModel = options['gen-model'] || DEFAULT_TEST_MODEL;
    const judgeModel = options['judge-model'] || generationModel;
    const agentModel = options['agent-model'] || generationModel;
    const result = await runProject({
      cwd: process.cwd(),
      projectName,
      goal,
      loops: remaining,
      mode,
      maxRuns,
      evalMode: options['real-eval'] ? 'real' : 'mock',
      generationModel,
      judgeModel,
      agentModel,
      stopRules: resolveStopRules(options),
      apiKeys: {
        anthropic: options['anthropic-key'],
        openai: options['openai-key'],
        gemini: options['gemini-key'],
      },
    });
    console.log(`Continuous run completed ${result.completedRuns.length} loop(s); total runs ${result.state.runCount}.`);
    if (result.stopReason) console.log(`Stop reason: ${result.stopReason}`);
    return;
  }

  if (command === 'hook') {
    const goal = options.goal || `Improve the ${projectName} Agent Skill.`;
    await initProject({ cwd: process.cwd(), projectName, goal });
    const mode = resolveRunMode(options) || 'stub';
    const generationModel = options['gen-model'] || DEFAULT_TEST_MODEL;
    const judgeModel = options['judge-model'] || generationModel;
    const agentModel = options['agent-model'] || generationModel;
    const hookPath = await recordHookEvent({
      cwd: process.cwd(),
      projectName,
      eventPath: options.event || null,
    });
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

  if (command === 'run-detail') {
    const detail = await readRunDetail({
      cwd: process.cwd(),
      projectName,
      runId: options.run || null,
    });
    console.log(JSON.stringify(detail, null, 2));
    return;
  }

  if (command === 'compare') {
    const comparison = await readRunComparison({
      cwd: process.cwd(),
      projectName,
      runId: options.run || null,
    });
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  if (command === 'decide') {
    if (!options.decision) throw new Error('decide requires --decision');
    const artifact = await recordHumanDecision({
      cwd: process.cwd(),
      projectName,
      runId: options.run || null,
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

    const result = await runHeadlessEval({
      skillAPath: options.a,
      skillBPath: options.b,
      promptsPath: options.prompts,
      criteriaPath: options.criteria,
      outputPath: options.out || null,
      mode: options.mock ? 'mock' : 'real',
      generationModel,
      judgeModel,
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

main().catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
