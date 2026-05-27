import { getProjectPaths } from './paths.js';
import { readJson } from './store.js';

// Per-project tunables the loop actually honors. Persisted as machine-readable JSON
// (config.json) so there is a single source of truth without a YAML parser dependency.
// Anything missing falls back to these defaults, so older projects keep working.
export const DEFAULT_PROJECT_CONFIG = {
  trigger: {
    mode: 'manual',
    targetIterations: 3,
    hookFocusFields: ['focusParameterIds', 'parameterIds', 'changedFiles', 'reason'],
  },
  budget: {
    maxRuns: null,
    maxEstimatedTokens: null,
    maxEstimatedSpendUsd: null,
    estimatedTokensPerLoop: 50000,
    estimatedSpendUsdPerLoop: 0.05,
    maxConcurrentRuns: 1,
  },
  promotion: {
    // Margins a challenger must clear over the current champion to be promoted.
    minScoreDelta: 4,
    minWinDelta: 2,
    maxStablePromptRegression: 2,
    minEvalCompletionRate: 0.8,
  },
  eval: {
    stablePromptCount: 6,
    explorationPromptCount: 4,
    outputType: 'text',
    visualRunner: false,
    retryPolicy: {
      generationMaxAttempts: 2,
      judgeMaxAttempts: 2,
      backoffMs: 0,
    },
  },
  models: {
    agent: 'gpt-5.4-mini',       // ontology, deconstructor, planner, creator, reviewer, analyst
    generation: 'gpt-5.4-mini',  // runs candidate skills to produce eval outputs
    judge: 'gpt-5.4-mini',       // scores eval outputs
    agentMaxTokens: 8192,
    creatorMaxTokens: 12000,
    generationMaxTokens: 8192,
    judgeMaxTokens: 4096,
  },
  portability: {
    agentSkillsStandard: 'portable',
    allowClientSpecificFeatures: false,
    packageOutputType: 'directory',
  },
};

function mergeSection(defaults, override) {
  if (!override || typeof override !== 'object') return { ...defaults };
  return { ...defaults, ...override };
}

export function normalizeProjectConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    trigger: normalizeTrigger(r.trigger),
    budget: normalizeBudget(r.budget),
    promotion: normalizePromotion(r.promotion),
    eval: normalizeEval(r.eval),
    models: normalizeModels(r.models),
    portability: mergeSection(DEFAULT_PROJECT_CONFIG.portability, r.portability),
  };
}

export async function loadProjectConfig({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  const raw = await readJson(paths.configJson, null);
  return normalizeProjectConfig(raw);
}

function normalizeTrigger(raw) {
  const trigger = mergeSection(DEFAULT_PROJECT_CONFIG.trigger, raw);
  const targetIterations = normalizePositiveInt(trigger.targetIterations, DEFAULT_PROJECT_CONFIG.trigger.targetIterations);
  return {
    ...trigger,
    mode: ['manual', 'continuous', 'cron', 'hook'].includes(trigger.mode) ? trigger.mode : 'manual',
    targetIterations,
    hookFocusFields: Array.isArray(trigger.hookFocusFields) ? trigger.hookFocusFields : DEFAULT_PROJECT_CONFIG.trigger.hookFocusFields,
  };
}

function normalizeBudget(raw) {
  const budget = mergeSection(DEFAULT_PROJECT_CONFIG.budget, raw);
  return {
    maxRuns: normalizeNullablePositiveInt(budget.maxRuns),
    maxEstimatedTokens: normalizeNullablePositiveInt(budget.maxEstimatedTokens),
    maxEstimatedSpendUsd: normalizeNullablePositiveNumber(budget.maxEstimatedSpendUsd),
    estimatedTokensPerLoop: normalizePositiveInt(budget.estimatedTokensPerLoop, DEFAULT_PROJECT_CONFIG.budget.estimatedTokensPerLoop),
    estimatedSpendUsdPerLoop: normalizeNonNegativeNumber(budget.estimatedSpendUsdPerLoop, DEFAULT_PROJECT_CONFIG.budget.estimatedSpendUsdPerLoop),
    maxConcurrentRuns: normalizePositiveInt(budget.maxConcurrentRuns, DEFAULT_PROJECT_CONFIG.budget.maxConcurrentRuns),
  };
}

function normalizePromotion(raw) {
  const promotion = mergeSection(DEFAULT_PROJECT_CONFIG.promotion, raw);
  return {
    minScoreDelta: normalizePositiveInt(promotion.minScoreDelta, DEFAULT_PROJECT_CONFIG.promotion.minScoreDelta),
    minWinDelta: normalizePositiveInt(promotion.minWinDelta, DEFAULT_PROJECT_CONFIG.promotion.minWinDelta),
    maxStablePromptRegression: normalizePositiveInt(
      promotion.maxStablePromptRegression,
      DEFAULT_PROJECT_CONFIG.promotion.maxStablePromptRegression,
    ),
    minEvalCompletionRate: normalizeUnitNumber(
      promotion.minEvalCompletionRate,
      DEFAULT_PROJECT_CONFIG.promotion.minEvalCompletionRate,
    ),
  };
}

function normalizeEval(raw) {
  const evalConfig = mergeSection(DEFAULT_PROJECT_CONFIG.eval, raw);
  return {
    ...evalConfig,
    stablePromptCount: normalizePositiveInt(evalConfig.stablePromptCount, DEFAULT_PROJECT_CONFIG.eval.stablePromptCount),
    explorationPromptCount: normalizePositiveInt(evalConfig.explorationPromptCount, DEFAULT_PROJECT_CONFIG.eval.explorationPromptCount),
    outputType: evalConfig.outputType === 'text' ? 'text' : 'text',
    visualRunner: Boolean(evalConfig.visualRunner),
    retryPolicy: normalizeRetryPolicy(evalConfig.retryPolicy),
  };
}

function normalizeRetryPolicy(raw) {
  const retryPolicy = mergeSection(DEFAULT_PROJECT_CONFIG.eval.retryPolicy, raw);
  return {
    generationMaxAttempts: normalizePositiveInt(
      retryPolicy.generationMaxAttempts,
      DEFAULT_PROJECT_CONFIG.eval.retryPolicy.generationMaxAttempts,
    ),
    judgeMaxAttempts: normalizePositiveInt(
      retryPolicy.judgeMaxAttempts,
      DEFAULT_PROJECT_CONFIG.eval.retryPolicy.judgeMaxAttempts,
    ),
    backoffMs: normalizeNonNegativeNumber(retryPolicy.backoffMs, DEFAULT_PROJECT_CONFIG.eval.retryPolicy.backoffMs),
  };
}

function normalizeModels(raw) {
  const models = mergeSection(DEFAULT_PROJECT_CONFIG.models, raw);
  return {
    ...models,
    agentMaxTokens: normalizePositiveInt(models.agentMaxTokens, DEFAULT_PROJECT_CONFIG.models.agentMaxTokens),
    creatorMaxTokens: normalizePositiveInt(models.creatorMaxTokens, DEFAULT_PROJECT_CONFIG.models.creatorMaxTokens),
    generationMaxTokens: normalizePositiveInt(models.generationMaxTokens, DEFAULT_PROJECT_CONFIG.models.generationMaxTokens),
    judgeMaxTokens: normalizePositiveInt(models.judgeMaxTokens, DEFAULT_PROJECT_CONFIG.models.judgeMaxTokens),
  };
}

function normalizePositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function normalizeNullablePositiveInt(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeNullablePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeUnitNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : fallback;
}
