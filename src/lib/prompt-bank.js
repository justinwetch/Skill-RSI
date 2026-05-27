export function applyPromptBankUpdates({
  bank,
  evalRun,
  recommendation,
  runId,
  stablePromptCount = 6,
}) {
  const promptById = new Map([
    ...(bank.stablePrompts || []),
    ...(bank.explorationPrompts || []),
    ...(evalRun.prompts || []),
  ].map(prompt => [prompt.id, prompt]));
  const diagnostics = diagnoseEvalPrompts(evalRun);
  const analystRecommendations = recommendation.promptBankRecommendations || {};
  const promoteIds = unique([
    ...diagnostics.promotePromptIds,
    ...(analystRecommendations.promotePromptIds || []),
  ]).filter(id => promptById.has(id));
  const retireIds = unique([
    ...diagnostics.retirePromptIds,
    ...(analystRecommendations.retirePromptIds || []),
  ]).filter(id => promptById.has(id) && !promoteIds.includes(id));

  const retired = mergeRetired({
    existing: bank.retired || [],
    retireIds,
    diagnostics,
    runId,
  });
  const retiredIds = new Set(retired.map(item => item.promptId));
  const stableById = new Map((bank.stablePrompts || []).map(prompt => [prompt.id, prompt]));
  for (const promptId of promoteIds) {
    if (retiredIds.has(promptId)) continue;
    const prompt = promptById.get(promptId);
    stableById.set(promptId, {
      ...prompt,
      bucket: 'stable',
      promotedFromExploration: true,
      promotedAtRunId: runId,
    });
  }

  const stablePrompts = [...stableById.values()]
    .filter(prompt => !retiredIds.has(prompt.id))
    .slice(-stablePromptCount);
  const explorationPrompts = uniquePrompts([
    ...(bank.explorationPrompts || []),
    ...(evalRun.prompts || []).filter(prompt => prompt.bucket === 'exploration'),
  ]);

  const nextBank = {
    ...bank,
    updatedAt: new Date().toISOString(),
    currentRunId: runId,
    stablePromptIds: stablePrompts.map(prompt => prompt.id),
    explorationPromptIds: (evalRun.prompts || [])
      .filter(prompt => prompt.bucket === 'exploration' && !retiredIds.has(prompt.id))
      .map(prompt => prompt.id),
    stablePrompts,
    explorationPrompts,
    retired,
    promptBankNotes: [
      ...(bank.promptBankNotes || []),
      ...(recommendation.promptBankRecommendations?.promptBankNotes || []),
      ...diagnostics.promptBankNotes,
    ],
  };

  return {
    bank: nextBank,
    update: {
      runId,
      promotedPromptIds: stablePrompts
        .filter(prompt => promoteIds.includes(prompt.id))
        .map(prompt => prompt.id),
      retiredPromptIds: retireIds,
      diagnostics,
      stablePromptIds: nextBank.stablePromptIds,
      explorationPromptIds: nextBank.explorationPromptIds,
    },
  };
}

export function diagnoseEvalPrompts(evalRun) {
  const promotePromptIds = [];
  const retirePromptIds = [];
  const promptBankNotes = [];

  for (const evaluation of evalRun.evaluations || []) {
    const prompt = evaluation.prompt || {};
    const judge = evaluation.judge || {};
    const scoreA = Number.isFinite(judge.scoreA) ? judge.scoreA : 0;
    const scoreB = Number.isFinite(judge.scoreB) ? judge.scoreB : 0;
    const delta = Math.abs(scoreA - scoreB);
    const hasParameter = Array.isArray(prompt.parameterIds) && prompt.parameterIds.length > 0;
    const hasReasoning = typeof judge.reasoning === 'string' && judge.reasoning.trim().length > 0;

    if (prompt.bucket === 'exploration' && judge.winner !== 'tie' && delta >= 2 && hasParameter && hasReasoning) {
      promotePromptIds.push(prompt.id);
      promptBankNotes.push(`${prompt.id}: exploration prompt produced useful signal with score delta ${delta}.`);
    }
    if (judge.winner === 'tie' || delta === 0 || !hasParameter || !hasReasoning) {
      retirePromptIds.push(prompt.id);
      promptBankNotes.push(`${prompt.id}: weak signal, missing metadata, or empty reasoning.`);
    }
  }

  return {
    promotePromptIds: unique(promotePromptIds),
    retirePromptIds: unique(retirePromptIds.filter(id => !promotePromptIds.includes(id))),
    promptBankNotes,
  };
}

function mergeRetired({ existing, retireIds, diagnostics, runId }) {
  const byId = new Map(existing.map(item => [item.promptId || item.id || item, normalizeRetiredItem(item)]));
  for (const promptId of retireIds) {
    if (byId.has(promptId)) continue;
    byId.set(promptId, {
      promptId,
      retiredAtRunId: runId,
      reason: diagnostics.promptBankNotes.find(note => note.startsWith(`${promptId}:`)) || 'Retired by prompt-bank update.',
    });
  }
  return [...byId.values()];
}

function normalizeRetiredItem(item) {
  if (typeof item === 'string') return { promptId: item, reason: 'Retired in previous bank version.' };
  return {
    promptId: item.promptId || item.id,
    retiredAtRunId: item.retiredAtRunId || item.runId || null,
    reason: item.reason || 'Retired in previous bank version.',
  };
}

function uniquePrompts(prompts) {
  return [...new Map(prompts.map(prompt => [prompt.id, prompt])).values()];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
