import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createRunId } from './paths.js';
import { loadSkillPackage } from './skill-package.js';
import { writeJson } from './store.js';
import { validateHeadlessEvalRun } from './schema.js';
import { callModel } from './model-client.js';

const TEXT_EVALUATED_OUTPUT_TYPES = ['text', 'code', 'code_visual'];

export async function runHeadlessEval({
  skillAPath,
  skillBPath,
  promptsPath,
  criteriaPath,
  outputPath = null,
  mode = 'mock',
  runId = createRunId(1),
  outputType = 'text',
  generationModel = null,
  judgeModel = null,
  apiKeys = {},
  modelClient = callModel,
  maxTokens = 8192,
  judgeMaxTokens = 4096,
  retryPolicy = {},
}) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const normalizedRetryPolicy = normalizeRetryPolicy(retryPolicy);
  if (!['mock', 'real'].includes(mode)) {
    throw new Error('Evaluator mode must be mock or real');
  }
  if (!TEXT_EVALUATED_OUTPUT_TYPES.includes(outputType)) {
    throw new Error(`Unsupported output evaluation type: ${outputType}`);
  }
  if (mode === 'real' && (!generationModel || !judgeModel)) {
    throw new Error('Real evaluation requires generationModel and judgeModel');
  }

  const [skillA, skillB, prompts, criteria] = await Promise.all([
    loadSkillPackage(skillAPath),
    loadSkillPackage(skillBPath),
    readJsonFile(promptsPath),
    readJsonFile(criteriaPath),
  ]);

  assertEvalInputs({ skillA, skillB, prompts, criteria });

  const blindLabels = createBlindLabels(runId);
  const evaluations = mode === 'mock'
    ? prompts.map((prompt, index) => evaluateMockPrompt({
      runId,
      index,
      prompt,
      criteria,
      skillA,
      skillB,
      blindLabels,
    }))
    : await evaluateRealPrompts({
      prompts,
      criteria,
      skillA,
      skillB,
      blindLabels,
      generationModel,
      judgeModel,
      apiKeys,
      modelClient,
      maxTokens,
      judgeMaxTokens,
      retryPolicy: normalizedRetryPolicy,
    });

  const stats = summarizeEvaluations(evaluations);
  const completedAt = new Date().toISOString();
  const result = validateHeadlessEvalRun({
    runId,
    mode,
    createdAt: startedAt,
    completedAt,
    outputType,
    modelMetadata: {
      generationModel: generationModel || null,
      judgeModel: judgeModel || null,
      generationMaxTokens: maxTokens,
      judgeMaxTokens,
      retryPolicy: normalizedRetryPolicy,
    },
    timing: {
      startedAt,
      completedAt,
      elapsedMs: Date.now() - startedMs,
    },
    skills: {
      skillA: summarizeSkill(skillA),
      skillB: summarizeSkill(skillB),
    },
    blindLabels,
    hashes: {
      skillA: skillA.hash,
      skillB: skillB.hash,
      prompts: hashJson(prompts),
      criteria: hashJson(criteria),
    },
    prompts,
    criteria,
    evaluations,
    stats,
  });

  if (outputPath) {
    await writeJson(outputPath, result);
  }

  return result;
}

function evaluateMockPrompt({ runId, index, prompt, criteria, skillA, skillB, blindLabels }) {
  const outputA = createMockOutput({ skill: skillA, prompt, side: 'skillA' });
  const outputB = createMockOutput({ skill: skillB, prompt, side: 'skillB' });
  const scoreA = scoreMockOutput({ skill: skillA, prompt, criteria, runId });
  const scoreB = scoreMockOutput({ skill: skillB, prompt, criteria, runId });
  const winner = scoreA.total === scoreB.total ? 'tie' : scoreA.total > scoreB.total ? 'skillA' : 'skillB';

  return {
    id: index + 1,
    prompt,
    results: {
      [blindLabels.skillA]: {
        sourceSkill: 'skillA',
        content: outputA,
        elapsedMs: 0,
      },
      [blindLabels.skillB]: {
        sourceSkill: 'skillB',
        content: outputB,
        elapsedMs: 0,
      },
    },
    judge: {
      status: 'complete',
      mode: 'mock',
      winner,
      blindWinner: winner === 'tie' ? 'tie' : blindLabels[winner],
      scoreA: scoreA.total,
      scoreB: scoreB.total,
      breakdown: {
        skillA: scoreA.breakdown,
        skillB: scoreB.breakdown,
      },
      reasoning: `Mock judge selected ${winner} for deterministic offline evaluation.`,
    },
  };
}

async function evaluateRealPrompts({
  prompts,
  criteria,
  skillA,
  skillB,
  blindLabels,
  generationModel,
  judgeModel,
  apiKeys,
  modelClient,
  maxTokens,
  judgeMaxTokens,
  retryPolicy,
}) {
  const evaluations = [];

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    const promptStarted = Date.now();
    const [resultA, resultB] = await Promise.all([
      generateSkillOutput({ skill: skillA, prompt, model: generationModel, apiKeys, modelClient, maxTokens, retryPolicy }),
      generateSkillOutput({ skill: skillB, prompt, model: generationModel, apiKeys, modelClient, maxTokens, retryPolicy }),
    ]);
    const judge = resultA.status === 'complete' && resultB.status === 'complete'
      ? await judgeRealOutputs({
        prompt,
        criteria,
        resultA,
        resultB,
        model: judgeModel,
        apiKeys,
        modelClient,
        maxTokens: judgeMaxTokens,
        blindLabels,
        retryPolicy,
      })
      : createSkippedJudge({
        reason: 'generation_failed',
        failures: [
          ...normalizeArray(resultA.failures).map(failure => ({ ...failure, sourceSkill: 'skillA' })),
          ...normalizeArray(resultB.failures).map(failure => ({ ...failure, sourceSkill: 'skillB' })),
        ],
      });
    const status = resultA.status === 'complete' && resultB.status === 'complete' && judge.status === 'complete'
      ? 'complete'
      : 'failed';

    evaluations.push({
      id: index + 1,
      status,
      prompt,
      promptHash: hashText(getPromptText(prompt)),
      elapsedMs: Date.now() - promptStarted,
      results: {
        [blindLabels.skillA]: {
          sourceSkill: 'skillA',
          status: resultA.status,
          content: resultA.content || '',
          contentHash: resultA.contentHash || null,
          elapsedMs: resultA.elapsedMs,
          attempts: resultA.attempts,
          failures: resultA.failures,
        },
        [blindLabels.skillB]: {
          sourceSkill: 'skillB',
          status: resultB.status,
          content: resultB.content || '',
          contentHash: resultB.contentHash || null,
          elapsedMs: resultB.elapsedMs,
          attempts: resultB.attempts,
          failures: resultB.failures,
        },
      },
      judge,
    });
  }

  return evaluations;
}

async function generateSkillOutput({ skill, prompt, model, apiKeys, modelClient, maxTokens, retryPolicy }) {
  const startedAt = Date.now();
  const response = await withRetry({
    phase: 'generation',
    maxAttempts: retryPolicy.generationMaxAttempts,
    backoffMs: retryPolicy.backoffMs,
    operation: () => modelClient({
      model,
      apiKeys,
      systemPrompt: [
        'You are evaluating an Agent Skill package.',
        'Follow SKILL.md as the package entrypoint.',
        'Treat referenced files as package files and use them when relevant.',
        'If scripts are present, reason from their source unless execution is explicitly available.',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: `${buildSkillPackageText(skill)}\n\n## User Request\n${getPromptText(prompt)}`,
      }],
      maxTokens,
    }),
  });

  if (!response.ok) {
    return {
      status: 'failed',
      content: '',
      contentHash: null,
      elapsedMs: Date.now() - startedAt,
      attempts: response.attempts.length,
      failures: response.attempts,
    };
  }

  return {
    status: 'complete',
    content: response.value,
    contentHash: hashText(response.value),
    elapsedMs: Date.now() - startedAt,
    attempts: response.attempts.length + 1,
    failures: response.attempts,
  };
}

async function judgeRealOutputs({ prompt, criteria, resultA, resultB, model, apiKeys, modelClient, maxTokens, blindLabels, retryPolicy }) {
  const startedAt = Date.now();
  const response = await withRetry({
    phase: 'judging',
    maxAttempts: retryPolicy.judgeMaxAttempts,
    backoffMs: retryPolicy.backoffMs,
    operation: async () => {
      const text = await modelClient({
        model,
        apiKeys,
        systemPrompt: buildJudgeSystemPrompt(criteria),
        messages: [{
          role: 'user',
          content: [
            `Original user prompt:\n${getPromptText(prompt)}`,
            `\n## ${blindLabels.skillA}\n${resultA.content}`,
            `\n## ${blindLabels.skillB}\n${resultB.content}`,
          ].join('\n\n'),
        }],
        maxTokens,
        jsonMode: true,
      });
      try {
        return { text, parsed: parseJudgeJson(text) };
      } catch (error) {
        error.rawResponse = text;
        throw error;
      }
    },
  });

  if (!response.ok) {
    return createFailedJudge({
      mode: 'real',
      elapsedMs: Date.now() - startedAt,
      failures: response.attempts,
    });
  }

  const { text, parsed } = response.value;
  const winner = parsed.winner;
  const blindWinner = winner === 'tie' ? 'tie' : blindLabels[winner];

  return {
    status: 'complete',
    mode: 'real',
    winner,
    blindWinner,
    scoreA: parsed.scoreA,
    scoreB: parsed.scoreB,
    breakdown: parsed.breakdown,
    reasoning: parsed.reasoning,
    rawResponse: text,
    parsedScores: parsed,
    elapsedMs: Date.now() - startedAt,
    attempts: response.attempts.length + 1,
    failures: response.attempts,
  };
}

function createSkippedJudge({ reason, failures }) {
  return {
    status: 'skipped',
    mode: 'real',
    winner: 'tie',
    blindWinner: 'tie',
    scoreA: 0,
    scoreB: 0,
    breakdown: { skillA: {}, skillB: {} },
    reasoning: `Judge skipped because ${reason}.`,
    elapsedMs: 0,
    attempts: 0,
    failures,
  };
}

function createFailedJudge({ mode, elapsedMs, failures }) {
  return {
    status: 'failed',
    mode,
    winner: 'tie',
    blindWinner: 'tie',
    scoreA: 0,
    scoreB: 0,
    breakdown: { skillA: {}, skillB: {} },
    reasoning: 'Judge failed after retry attempts.',
    elapsedMs,
    attempts: failures.length,
    failures,
  };
}

function createMockOutput({ skill, prompt, side }) {
  const entrypoint = skill.files.find(file => file.path === 'SKILL.md');
  const heading = entrypoint?.content.match(/^#\s+(.+)$/m)?.[1] || skill.filename;
  return [
    `Mock output from ${side}: ${heading}`,
    `Prompt: ${prompt.text || prompt}`,
    `Package hash: ${skill.hash.slice(0, 12)}`,
  ].join('\n');
}

function scoreMockOutput({ skill, prompt, criteria, runId }) {
  const breakdown = {};
  let total = 0;

  for (const criterion of criteria) {
    const seed = stableNumber(`${runId}:${skill.hash}:${prompt.id || prompt.text || prompt}:${criterion.id || criterion.name}`);
    const score = (seed % 5) + 1;
    breakdown[criterion.id || criterion.name] = score;
    total += score;
  }

  return { total, breakdown };
}

function summarizeEvaluations(evaluations) {
  const stats = {
    totalEvals: evaluations.length,
    completedEvals: 0,
    failedEvals: 0,
    skillAWins: 0,
    skillBWins: 0,
    ties: 0,
    totalScoreA: 0,
    totalScoreB: 0,
  };

  for (const evaluation of evaluations) {
    if (evaluation.status && evaluation.status !== 'complete') {
      stats.failedEvals += 1;
      continue;
    }
    if (evaluation.judge?.status && evaluation.judge.status !== 'complete') {
      stats.failedEvals += 1;
      continue;
    }
    stats.completedEvals += 1;
    if (evaluation.judge.winner === 'skillA') stats.skillAWins += 1;
    if (evaluation.judge.winner === 'skillB') stats.skillBWins += 1;
    if (evaluation.judge.winner === 'tie') stats.ties += 1;
    stats.totalScoreA += evaluation.judge.scoreA || 0;
    stats.totalScoreB += evaluation.judge.scoreB || 0;
  }

  stats.winner = stats.totalScoreA === stats.totalScoreB
    ? 'tie'
    : stats.totalScoreA > stats.totalScoreB ? 'skillA' : 'skillB';
  stats.scoreDelta = stats.totalScoreA - stats.totalScoreB;
  stats.confidence = summarizeConfidence(stats);
  return stats;
}

function summarizeConfidence(stats) {
  const completed = stats.completedEvals || 0;
  const total = stats.totalEvals || 0;
  const completionRate = total ? completed / total : 0;
  const decisiveWins = Math.max(stats.skillAWins, stats.skillBWins);
  const winRate = completed ? decisiveWins / completed : 0;
  const scoreMarginPerPrompt = completed ? Math.abs(stats.scoreDelta || 0) / completed : 0;
  const level = completionRate < 0.8
    ? 'low'
    : winRate >= 0.7 && scoreMarginPerPrompt >= 2 ? 'high'
      : winRate >= 0.6 || scoreMarginPerPrompt >= 1 ? 'medium' : 'low';
  return {
    method: 'deterministic_prompt_summary',
    completionRate: Number(completionRate.toFixed(3)),
    winRate: Number(winRate.toFixed(3)),
    scoreMarginPerPrompt: Number(scoreMarginPerPrompt.toFixed(3)),
    level,
  };
}

function buildSkillPackageText(skill) {
  const lines = [
    `# Active Skill Package: ${skill.filename}`,
    `Package type: ${skill.packageType}`,
    `Entrypoint: ${skill.entrypoint}`,
    '',
    'Use SKILL.md as the package entrypoint. Treat references, scripts, assets, and supporting files as separate package files at their listed relative paths.',
  ];

  for (const file of skill.files) {
    if (file.kind !== 'text') continue;
    lines.push(
      '',
      `--- FILE: ${file.path}`,
      `role: ${file.role}`,
      `mediaType: ${file.mediaType}`,
      '---',
      file.content,
    );
  }

  if (skill.omittedFiles.length) {
    lines.push('', '--- OMITTED PACKAGE FILES ---');
    for (const file of skill.omittedFiles) {
      lines.push(`- ${file.path} (${file.reason})`);
    }
  }

  return lines.join('\n');
}

function buildJudgeSystemPrompt(criteria) {
  const rubricText = criteria.map((criterion, index) => [
    `${index + 1}. ${criterion.name || criterion.id}`,
    criterion.description || '',
    criterion.rubric ? Object.entries(criterion.rubric).map(([score, text]) => `- ${score}: ${text}`).join('\n') : '',
  ].filter(Boolean).join('\n')).join('\n\n');

  const ids = criteria.map(criterion => criterion.id || criterion.name);
  return `You are an expert evaluator comparing two AI-generated outputs.

Score each output from 1-5 for each criterion.

Criteria:
${rubricText}

Return only JSON with this exact shape:
{
  "winner": "skillA" | "skillB" | "tie",
  "scoreA": number,
  "scoreB": number,
  "breakdown": {
    "skillA": { ${ids.map(id => `"${id}": number`).join(', ')} },
    "skillB": { ${ids.map(id => `"${id}": number`).join(', ')} }
  },
  "reasoning": "brief explanation"
}`;
}

function parseJudgeJson(text) {
  const stripped = stripJsonFence(text);
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    throw new Error(`Judge returned invalid JSON: ${error.message}`);
  }

  if (!['skillA', 'skillB', 'tie'].includes(parsed.winner)) {
    throw new Error('Judge JSON winner must be skillA, skillB, or tie');
  }
  if (!Number.isFinite(parsed.scoreA) || !Number.isFinite(parsed.scoreB)) {
    throw new Error('Judge JSON scoreA and scoreB must be numbers');
  }

  return {
    winner: parsed.winner,
    scoreA: parsed.scoreA,
    scoreB: parsed.scoreB,
    breakdown: parsed.breakdown || { skillA: {}, skillB: {} },
    reasoning: parsed.reasoning || '',
  };
}

function stripJsonFence(text) {
  const match = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  return (match ? match[1] : text).trim();
}

function getPromptText(prompt) {
  return typeof prompt === 'string' ? prompt : prompt.text;
}

function createBlindLabels(runId) {
  const swap = stableNumber(runId) % 2 === 1;
  return swap
    ? { skillA: 'Result B', skillB: 'Result A' }
    : { skillA: 'Result A', skillB: 'Result B' };
}

function summarizeSkill(skill) {
  return {
    id: skill.id,
    sourcePath: skill.sourcePath,
    packageType: skill.packageType,
    hash: skill.hash,
    validation: skill.validation,
    fileCount: skill.files.length,
  };
}

function assertEvalInputs({ skillA, skillB, prompts, criteria }) {
  if (!skillA.validation.valid) {
    throw new Error(`Skill A is invalid: ${skillA.validation.errors.join('; ')}`);
  }
  if (!skillB.validation.valid) {
    throw new Error(`Skill B is invalid: ${skillB.validation.errors.join('; ')}`);
  }
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('Prompts file must contain a non-empty array');
  }
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new Error('Criteria file must contain a non-empty array');
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function withRetry({ phase, maxAttempts, backoffMs, operation }) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const value = await operation();
      return { ok: true, value, attempts };
    } catch (error) {
      attempts.push({
        phase,
        attempt,
        name: error.name || 'Error',
        message: error.message,
        rawResponse: truncateText(error.rawResponse, 20000),
        elapsedMs: Date.now() - startedAt,
      });
      if (attempt < maxAttempts && backoffMs > 0) {
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  return { ok: false, attempts };
}

function normalizeRetryPolicy(value = {}) {
  return {
    generationMaxAttempts: normalizeAttemptCount(value.generationMaxAttempts, 2),
    judgeMaxAttempts: normalizeAttemptCount(value.judgeMaxAttempts, 2),
    backoffMs: normalizeNonNegativeInt(value.backoffMs, 0),
  };
}

function normalizeAttemptCount(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function hashJson(value) {
  return hashText(JSON.stringify(value));
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function truncateText(value, maxLength) {
  if (typeof value !== 'string' || value.length <= maxLength) return value || null;
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function stableNumber(value) {
  const hex = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
  return Number.parseInt(hex, 16);
}
