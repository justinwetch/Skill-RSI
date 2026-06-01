import { getProjectPaths } from './paths.js';
import { readJson } from './store.js';
import { normalizeTaskContract, taskContractOutputType } from './task-contracts.js';

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
    taskContract: {
      id: 'text_standalone',
      artifactType: 'text',
      environment: 'standalone',
    },
    retryPolicy: {
      generationMaxAttempts: 2,
      judgeMaxAttempts: 2,
      authoringMaxAttempts: 3,
      backoffMs: 250,
    },
  },
  research: {
    mode: 'best_effort',
    provider: 'model_native',
    requireSourcesForAuthorityClaims: true,
  },
  qualityGate: {
    mode: 'warn_and_revise',
  },
  models: {
    agent: 'gpt-5.5',       // ontology, deconstructor, planner, creator, reviewer, analyst
    generation: 'gpt-5.5',  // runs candidate skills to produce eval outputs
    judge: 'gpt-5.5',       // scores eval outputs
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

export const TEXT_EVAL_OUTPUT_TYPES = ['text', 'code', 'code_visual'];

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
    research: normalizeResearch(r.research),
    qualityGate: normalizeQualityGate(r.qualityGate),
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
  const taskContract = normalizeTaskContract(raw?.taskContract || null, evalConfig.outputType);
  const outputType = taskContractOutputType(taskContract);
  return {
    ...evalConfig,
    stablePromptCount: normalizePositiveInt(evalConfig.stablePromptCount, DEFAULT_PROJECT_CONFIG.eval.stablePromptCount),
    explorationPromptCount: normalizePositiveInt(evalConfig.explorationPromptCount, DEFAULT_PROJECT_CONFIG.eval.explorationPromptCount),
    taskContract,
    outputType: TEXT_EVAL_OUTPUT_TYPES.includes(outputType) ? outputType : 'text',
    retryPolicy: normalizeRetryPolicy(evalConfig.retryPolicy),
  };
}

function normalizeResearch(raw) {
  const research = mergeSection(DEFAULT_PROJECT_CONFIG.research, raw);
  return {
    mode: ['off', 'best_effort', 'required'].includes(research.mode) ? research.mode : DEFAULT_PROJECT_CONFIG.research.mode,
    provider: ['model_native'].includes(research.provider) ? research.provider : DEFAULT_PROJECT_CONFIG.research.provider,
    requireSourcesForAuthorityClaims: research.requireSourcesForAuthorityClaims !== false,
  };
}

function normalizeQualityGate(raw) {
  const qualityGate = mergeSection(DEFAULT_PROJECT_CONFIG.qualityGate, raw);
  return {
    mode: ['off', 'advisory', 'warn_and_revise', 'strict'].includes(qualityGate.mode)
      ? qualityGate.mode
      : DEFAULT_PROJECT_CONFIG.qualityGate.mode,
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
    authoringMaxAttempts: normalizePositiveInt(
      retryPolicy.authoringMaxAttempts,
      DEFAULT_PROJECT_CONFIG.eval.retryPolicy.authoringMaxAttempts,
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
