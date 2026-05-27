import { getProjectPaths } from './paths.js';
import { ensureDir, pathExists, writeJson, writeText } from './store.js';
import { validateHistoryIndex, validateProjectConfig, validateRunState } from './schema.js';
import { DEFAULT_PROJECT_CONFIG } from './config.js';

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

export async function initProject({ cwd, projectName, goal, runPolicy = null, evalOutputType = 'text' }) {
  const paths = getProjectPaths(cwd, projectName);
  const createdAt = new Date().toISOString();
  const normalizedRunPolicy = normalizeRunPolicy(runPolicy);
  const normalizedEvalOutputType = normalizeEvalOutputType(evalOutputType);

  await ensureDir(paths.projectDir);
  await ensureDir(paths.championSkillDir);
  await ensureDir(paths.historyDetailedDir);
  await ensureDir(paths.runsDir);

  const config = validateProjectConfig({
    name: paths.projectId,
    goal,
    createdAt,
    targetSkillName: paths.projectId,
  });

  const state = validateRunState({
    projectId: paths.projectId,
    runCount: 0,
    currentChampion: null,
    lastRunId: null,
    updatedAt: createdAt,
    runPolicy: normalizedRunPolicy,
    budgetUsage: {
      estimatedTokens: 0,
      estimatedSpendUsd: 0,
    },
  });

  const history = validateHistoryIndex({
    experimentId: paths.projectId,
    createdAt,
    skillGoal: goal,
    currentChampion: null,
    trajectory: [],
    parameterLog: [],
  });

  if (!(await pathExists(paths.configYaml))) {
    await writeText(paths.configYaml, [
      `name: ${yamlScalar(config.name)}`,
      `goal: ${yamlScalar(config.goal)}`,
      `createdAt: ${yamlScalar(config.createdAt)}`,
      `targetSkillName: ${yamlScalar(config.targetSkillName)}`,
      `runPolicy: ${yamlScalar(`${normalizedRunPolicy.triggerMode}:${normalizedRunPolicy.targetIterations}`)}`,
      '',
    ].join('\n'));
  }

  if (!(await pathExists(paths.configJson))) {
    // Machine-readable tunables the loop honors: triggers, budgets, promotion, eval, models, portability.
    await writeJson(paths.configJson, {
      ...DEFAULT_PROJECT_CONFIG,
      trigger: {
        ...DEFAULT_PROJECT_CONFIG.trigger,
        mode: normalizedRunPolicy.triggerMode,
        targetIterations: normalizedRunPolicy.targetIterations,
      },
      eval: {
        ...DEFAULT_PROJECT_CONFIG.eval,
        outputType: normalizedEvalOutputType,
      },
    });
  }

  if (!(await pathExists(paths.stateJson))) {
    await writeJson(paths.stateJson, state);
  }

  if (!(await pathExists(paths.historyIndex))) {
    await writeJson(paths.historyIndex, history);
  }

  if (!(await pathExists(paths.historySummary))) {
    await writeText(paths.historySummary, renderInitialSummary(config));
  }

  return { projectId: paths.projectId, projectDir: paths.projectDir, paths, config, state };
}

function normalizeEvalOutputType(outputType) {
  return ['text', 'code', 'code_visual'].includes(outputType) ? outputType : 'text';
}

function normalizeRunPolicy(runPolicy) {
  const targetIterations = Number.parseInt(runPolicy?.targetIterations ?? '3', 10);
  return {
    triggerMode: runPolicy?.triggerMode || 'manual',
    targetIterations: Number.isInteger(targetIterations) && targetIterations > 0 ? targetIterations : 3,
  };
}

function renderInitialSummary(config) {
  return `# Current Summary

Initial goal: ${config.goal}
Current champion: none
Current strengths: none yet
Known weaknesses: none yet
Highest-leverage parameter hypotheses: none yet
Recent decision: initialized
Do not repeat: none yet
Next experiment notes: run the first loop
Detailed artifacts: none yet
`;
}
