const STRONG_SIGNAL_DELTA = 2;

export function applyPromptBankUpdates({
  bank = {},
  evalRun = null,
  candidateDuel = null,
  challenge = null,
  recommendation = {},
  runId,
  stablePromptCount = null,
}) {
  const currentBank = normalizeBank(bank);
  const stableLimit = Number.isInteger(stablePromptCount)
    ? stablePromptCount
    : (Number.isInteger(currentBank.stablePromptCount) ? currentBank.stablePromptCount : 6);
  const duelRun = candidateDuel || evalRun;
  const challengeRun = challenge;
  const evaluatedRuns = [
    duelRun ? { evalRun: duelRun, comparisonType: 'candidate_duel' } : null,
    challengeRun ? { evalRun: challengeRun, comparisonType: 'challenge' } : null,
  ].filter(Boolean);

  const promptById = collectPromptById(currentBank, evaluatedRuns.map(item => item.evalRun));
  const diagnosticsByType = Object.fromEntries(evaluatedRuns.map(item => [
    item.comparisonType,
    diagnoseEvalPrompts(item.evalRun, { comparisonType: item.comparisonType }),
  ]));
  const combinedDiagnostics = combineDiagnostics(Object.values(diagnosticsByType));
  const analystRecommendations = recommendation.promptBankRecommendations || {};

  const promptEvidence = { ...currentBank.promptEvidence };
  for (const [promptId, prompt] of promptById.entries()) {
    promptEvidence[promptId] = ensureEvidenceRecord({
      existing: promptEvidence[promptId],
      prompt,
      status: inferPromptStatus(currentBank, prompt),
    });
  }
  for (const diagnostics of Object.values(diagnosticsByType)) {
    for (const evidence of diagnostics.evidenceRecords || Object.values(diagnostics.evidenceByPromptId || {})) {
      const promptId = evidence.promptId;
      const existing = ensureEvidenceRecord({
        existing: promptEvidence[promptId],
        prompt: promptById.get(promptId) || evidence.prompt,
        status: inferPromptStatus(currentBank, promptById.get(promptId) || evidence.prompt),
      });
      promptEvidence[promptId] = {
        ...existing,
        evidence: uniqueEvidence([...existing.evidence, evidence]),
        lastEvidenceAtRunId: runId,
      };
    }
  }

  const championConfirmedIds = new Set(diagnosticsByType.challenge?.promotePromptIds || []);
  const provisionallyUsefulIds = new Set([
    ...(diagnosticsByType.candidate_duel?.provisionalPromptIds || []),
    ...(diagnosticsByType.challenge?.provisionalPromptIds || []),
  ]);
  for (const promptId of analystRecommendations.promotePromptIds || []) {
    if (!promptById.has(promptId)) continue;
    if (hasStrongEvidence(promptEvidence[promptId], 'challenge')) {
      championConfirmedIds.add(promptId);
    } else if (hasStrongEvidence(promptEvidence[promptId], 'candidate_duel')) {
      provisionallyUsefulIds.add(promptId);
    }
  }

  const retireIds = new Set(combinedDiagnostics.retirePromptIds);
  for (const promptId of analystRecommendations.retirePromptIds || []) {
    if (!promptById.has(promptId)) continue;
    if (inferPromptStatus(currentBank, promptById.get(promptId)) !== 'stable') {
      retireIds.add(promptId);
    }
  }
  for (const promptId of championConfirmedIds) retireIds.delete(promptId);
  for (const promptId of provisionallyUsefulIds) retireIds.delete(promptId);

  const retired = mergeRetired({
    existing: currentBank.retired,
    retireIds: [...retireIds],
    diagnostics: combinedDiagnostics,
    runId,
  });
  const retiredIds = new Set(retired.map(item => item.promptId));

  const stableById = new Map(currentBank.stablePrompts.map(prompt => [prompt.id, {
    ...prompt,
    bucket: 'stable',
    status: 'stable',
    stableReason: prompt.stableReason || prompt.origin || 'ontology_seed',
  }]));
  for (const promptId of championConfirmedIds) {
    if (retiredIds.has(promptId)) continue;
    const prompt = promptById.get(promptId);
    if (!prompt) continue;
    stableById.set(promptId, {
      ...prompt,
      bucket: 'stable',
      status: 'stable',
      stableReason: 'challenge_confirmed',
      promotedFrom: inferPromptStatus(currentBank, prompt),
      promotedAtRunId: runId,
    });
    promptEvidence[promptId] = {
      ...promptEvidence[promptId],
      status: 'stable',
      stableReason: 'challenge_confirmed',
    };
  }

  const stablePrompts = rankStablePrompts([...stableById.values()], promptEvidence)
    .filter(prompt => !retiredIds.has(prompt.id))
    .slice(0, stableLimit);
  const stableIds = new Set(stablePrompts.map(prompt => prompt.id));

  const provisionalById = new Map(currentBank.provisionalPrompts.map(prompt => [prompt.id, {
    ...prompt,
    bucket: 'provisional',
    status: 'provisional',
  }]));
  for (const promptId of provisionallyUsefulIds) {
    if (retiredIds.has(promptId) || stableIds.has(promptId)) continue;
    const prompt = promptById.get(promptId);
    if (!prompt) continue;
    provisionalById.set(promptId, {
      ...prompt,
      bucket: 'provisional',
      status: 'provisional',
      provisionalAtRunId: runId,
      needsChallengeConfirmation: true,
    });
    promptEvidence[promptId] = {
      ...promptEvidence[promptId],
      status: 'provisional',
    };
  }
  const provisionalPrompts = [...provisionalById.values()]
    .filter(prompt => !retiredIds.has(prompt.id) && !stableIds.has(prompt.id));
  const provisionalIds = new Set(provisionalPrompts.map(prompt => prompt.id));

  const activeExploration = uniquePrompts([
    ...currentBank.explorationPrompts,
    ...getRunPrompts(duelRun).filter(prompt => prompt.bucket === 'exploration'),
  ]).filter(prompt => (
    !retiredIds.has(prompt.id) &&
    !stableIds.has(prompt.id) &&
    !provisionalIds.has(prompt.id)
  ));

  for (const promptId of retiredIds) {
    if (promptEvidence[promptId]) {
      promptEvidence[promptId] = {
        ...promptEvidence[promptId],
        status: 'retired',
      };
    }
  }
  for (const prompt of stablePrompts) {
    promptEvidence[prompt.id] = ensureEvidenceRecord({
      existing: promptEvidence[prompt.id],
      prompt,
      status: 'stable',
    });
  }
  const activeExplorationIds = new Set(activeExploration.map(prompt => prompt.id));
  for (const [promptId, record] of Object.entries(promptEvidence)) {
    if (retiredIds.has(promptId)) {
      promptEvidence[promptId] = { ...record, status: 'retired' };
    } else if (stableIds.has(promptId)) {
      promptEvidence[promptId] = { ...record, status: 'stable' };
    } else if (provisionalIds.has(promptId)) {
      promptEvidence[promptId] = { ...record, status: 'provisional' };
    } else if (activeExplorationIds.has(promptId)) {
      promptEvidence[promptId] = { ...record, status: 'exploration' };
    } else {
      promptEvidence[promptId] = { ...record, status: 'inactive' };
    }
  }

  const promptBankNotes = unique([
    ...currentBank.promptBankNotes,
    ...(analystRecommendations.promptBankNotes || []),
    ...combinedDiagnostics.promptBankNotes,
  ]);
  const nextBank = {
    ...currentBank,
    version: 3,
    updatedAt: new Date().toISOString(),
    currentRunId: runId,
    stablePromptIds: stablePrompts.map(prompt => prompt.id),
    provisionalPromptIds: provisionalPrompts.map(prompt => prompt.id),
    explorationPromptIds: activeExploration
      .filter(prompt => getRunPrompts(duelRun).some(runPrompt => runPrompt.id === prompt.id))
      .map(prompt => prompt.id),
    stablePrompts,
    provisionalPrompts,
    explorationPrompts: activeExploration,
    retired,
    promptEvidence,
    promptBankNotes,
  };

  return {
    bank: nextBank,
    update: {
      runId,
      promotedPromptIds: stablePrompts
        .filter(prompt => championConfirmedIds.has(prompt.id))
        .map(prompt => prompt.id),
      provisionalPromptIds: provisionalPrompts
        .filter(prompt => provisionallyUsefulIds.has(prompt.id))
        .map(prompt => prompt.id),
      retiredPromptIds: [...retireIds],
      evidenceAdded: combinedDiagnostics.evidenceRecords.length,
      diagnostics: combinedDiagnostics,
      stablePromptIds: nextBank.stablePromptIds,
      provisionalPromptIdsAfterUpdate: nextBank.provisionalPromptIds,
      explorationPromptIds: nextBank.explorationPromptIds,
    },
  };
}

export function diagnoseEvalPrompts(evalRun, { comparisonType = 'candidate_duel' } = {}) {
  const promotePromptIds = [];
  const provisionalPromptIds = [];
  const retirePromptIds = [];
  const promptBankNotes = [];
  const evidenceByPromptId = {};
  const evidenceRecords = [];

  for (const evaluation of evalRun?.evaluations || []) {
    const evidence = createEvidenceRecord(evalRun, evaluation, comparisonType);
    const prompt = evidence.prompt || {};
    if (!prompt.id) continue;
    evidenceByPromptId[prompt.id] = evidence;
    evidenceRecords.push(evidence);

    if (evidence.strongSignal) {
      if (comparisonType === 'challenge' && prompt.bucket !== 'stable') {
        promotePromptIds.push(prompt.id);
        promptBankNotes.push(`${prompt.id}: champion challenge confirmed a stable measurement signal with score delta ${evidence.absScoreDelta}.`);
      } else if (prompt.bucket !== 'stable') {
        provisionalPromptIds.push(prompt.id);
        promptBankNotes.push(`${prompt.id}: cold-start duel produced provisional signal with score delta ${evidence.absScoreDelta}; needs champion-challenge confirmation before becoming stable.`);
      }
      continue;
    }

    if (shouldRetirePromptEvidence(evidence)) {
      retirePromptIds.push(prompt.id);
      promptBankNotes.push(`${prompt.id}: retired because the prompt had weak signal, missing metadata, failed judging, or empty reasoning.`);
    } else if (prompt.bucket === 'stable' && (evidence.winner === 'tie' || evidence.absScoreDelta === 0)) {
      promptBankNotes.push(`${prompt.id}: stable prompt tied; kept as a neutral anchor rather than retired.`);
    } else if (prompt.bucket === 'provisional' && comparisonType === 'challenge') {
      retirePromptIds.push(prompt.id);
      promptBankNotes.push(`${prompt.id}: provisional prompt failed champion-challenge confirmation.`);
    }
  }

  return {
    promotePromptIds: unique(promotePromptIds),
    provisionalPromptIds: unique(provisionalPromptIds),
    retirePromptIds: unique(retirePromptIds.filter(id => !promotePromptIds.includes(id) && !provisionalPromptIds.includes(id))),
    promptBankNotes,
    evidenceByPromptId,
    evidenceRecords,
  };
}

function normalizeBank(bank) {
  const safeBank = bank && typeof bank === 'object' ? bank : {};
  return {
    ...safeBank,
    stablePrompts: Array.isArray(safeBank.stablePrompts) ? safeBank.stablePrompts : [],
    provisionalPrompts: Array.isArray(safeBank.provisionalPrompts) ? safeBank.provisionalPrompts : [],
    explorationPrompts: Array.isArray(safeBank.explorationPrompts) ? safeBank.explorationPrompts : [],
    retired: Array.isArray(safeBank.retired) ? safeBank.retired.map(normalizeRetiredItem).filter(item => item.promptId) : [],
    promptEvidence: safeBank.promptEvidence && typeof safeBank.promptEvidence === 'object' && !Array.isArray(safeBank.promptEvidence)
      ? safeBank.promptEvidence
      : {},
    promptBankNotes: Array.isArray(safeBank.promptBankNotes) ? safeBank.promptBankNotes : [],
  };
}

function collectPromptById(bank, evalRuns) {
  const prompts = [
    ...bank.stablePrompts,
    ...bank.provisionalPrompts,
    ...bank.explorationPrompts,
    ...evalRuns.flatMap(run => getRunPrompts(run)),
    ...evalRuns.flatMap(run => (run?.evaluations || []).map(evaluation => evaluation.prompt).filter(Boolean)),
  ];
  return new Map(prompts.filter(prompt => prompt?.id).map(prompt => [prompt.id, prompt]));
}

function getRunPrompts(evalRun) {
  return Array.isArray(evalRun?.prompts) ? evalRun.prompts : [];
}

function createEvidenceRecord(evalRun, evaluation, comparisonType) {
  const prompt = evaluation.prompt || {};
  const judge = evaluation.judge || {};
  const scoreA = Number.isFinite(judge.scoreA) ? judge.scoreA : null;
  const scoreB = Number.isFinite(judge.scoreB) ? judge.scoreB : null;
  const scoreDelta = scoreA !== null && scoreB !== null ? scoreA - scoreB : null;
  const absScoreDelta = Number.isFinite(scoreDelta) ? Math.abs(scoreDelta) : 0;
  const winner = ['skillA', 'skillB', 'tie'].includes(judge.winner) ? judge.winner : 'tie';
  const hasParameterEvidence = Array.isArray(prompt.parameterIds) && prompt.parameterIds.length > 0;
  const hasReasoning = typeof judge.reasoning === 'string' && judge.reasoning.trim().length > 0;
  const judgeStatus = judge.status || evaluation.status || 'complete';
  const completed = !['failed', 'error', 'incomplete'].includes(judgeStatus);
  const strongSignal = completed && hasReasoning && hasParameterEvidence && winner !== 'tie' && absScoreDelta >= STRONG_SIGNAL_DELTA;

  return {
    runId: evalRun?.runId || null,
    comparisonType,
    promptId: prompt.id,
    prompt: snapshotPrompt(prompt),
    bucket: prompt.bucket || null,
    parameterIds: Array.isArray(prompt.parameterIds) ? prompt.parameterIds : [],
    winner,
    scoreA,
    scoreB,
    scoreDelta,
    absScoreDelta,
    judgeStatus,
    completed,
    hasReasoning,
    hasParameterEvidence,
    strongSignal,
    createdAt: new Date().toISOString(),
  };
}

function shouldRetirePromptEvidence(evidence) {
  if (evidence.bucket === 'stable') return false;
  if (!evidence.completed || !evidence.hasReasoning || !evidence.hasParameterEvidence) return true;
  if (evidence.bucket === 'exploration' && (evidence.winner === 'tie' || evidence.absScoreDelta === 0)) return true;
  return false;
}

function ensureEvidenceRecord({ existing, prompt, status }) {
  const normalizedExisting = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  return {
    promptId: normalizedExisting.promptId || prompt?.id || null,
    prompt: normalizedExisting.prompt || snapshotPrompt(prompt),
    status: normalizedExisting.status || status || prompt?.status || prompt?.bucket || 'exploration',
    origin: normalizedExisting.origin || prompt?.origin || defaultOriginForPrompt(prompt),
    createdAtRunId: normalizedExisting.createdAtRunId || prompt?.createdAtRunId || null,
    stableReason: normalizedExisting.stableReason || prompt?.stableReason || null,
    lastEvidenceAtRunId: normalizedExisting.lastEvidenceAtRunId || null,
    evidence: Array.isArray(normalizedExisting.evidence) ? normalizedExisting.evidence : [],
  };
}

function snapshotPrompt(prompt) {
  if (!prompt || typeof prompt !== 'object') return null;
  return {
    id: prompt.id,
    text: prompt.text,
    bucket: prompt.bucket,
    parameterIds: Array.isArray(prompt.parameterIds) ? prompt.parameterIds : [],
    difficulty: prompt.difficulty || null,
    taxonomy: Array.isArray(prompt.taxonomy) ? prompt.taxonomy : [],
  };
}

function inferPromptStatus(bank, prompt) {
  if (!prompt?.id) return prompt?.status || prompt?.bucket || 'exploration';
  if (bank.retired.some(item => item.promptId === prompt.id)) return 'retired';
  if (bank.stablePrompts.some(item => item.id === prompt.id) || prompt.bucket === 'stable') return 'stable';
  if (bank.provisionalPrompts.some(item => item.id === prompt.id) || prompt.bucket === 'provisional') return 'provisional';
  return prompt.status || prompt.bucket || 'exploration';
}

function defaultOriginForPrompt(prompt) {
  if (prompt?.origin) return prompt.origin;
  if (prompt?.bucket === 'stable') return 'ontology_seed';
  if (prompt?.bucket === 'provisional') return 'candidate_duel_signal';
  return 'experiment_probe';
}

function hasStrongEvidence(record, comparisonType) {
  return Array.isArray(record?.evidence) && record.evidence.some(evidence => (
    evidence.comparisonType === comparisonType && evidence.strongSignal
  ));
}

function rankStablePrompts(prompts, promptEvidence) {
  return prompts
    .map((prompt, index) => ({ prompt, index, score: stablePromptScore(prompt, promptEvidence[prompt.id]) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(item => item.prompt);
}

function stablePromptScore(prompt, evidenceRecord) {
  const evidence = Array.isArray(evidenceRecord?.evidence) ? evidenceRecord.evidence : [];
  const championSignals = evidence.filter(item => item.comparisonType === 'challenge' && item.strongSignal).length;
  const duelSignals = evidence.filter(item => item.comparisonType === 'candidate_duel' && item.strongSignal).length;
  const seedBonus = prompt.stableReason === 'ontology_seed' || prompt.origin === 'ontology_seed' ? 1 : 0;
  return championSignals * 100 + duelSignals * 10 + seedBonus;
}

function combineDiagnostics(diagnosticsList) {
  const evidenceRecords = diagnosticsList.flatMap(item => item.evidenceRecords || Object.values(item.evidenceByPromptId || {}));
  return {
    promotePromptIds: unique(diagnosticsList.flatMap(item => item.promotePromptIds || [])),
    provisionalPromptIds: unique(diagnosticsList.flatMap(item => item.provisionalPromptIds || [])),
    retirePromptIds: unique(diagnosticsList.flatMap(item => item.retirePromptIds || [])),
    promptBankNotes: unique(diagnosticsList.flatMap(item => item.promptBankNotes || [])),
    evidenceByPromptId: Object.fromEntries(evidenceRecords.map(evidence => [evidence.promptId, evidence])),
    evidenceRecords,
  };
}

function mergeRetired({ existing, retireIds, diagnostics, runId }) {
  const byId = new Map(existing.map(item => [item.promptId, normalizeRetiredItem(item)]));
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
    promptId: item?.promptId || item?.id,
    retiredAtRunId: item?.retiredAtRunId || item?.runId || null,
    reason: item?.reason || 'Retired in previous bank version.',
  };
}

function uniquePrompts(prompts) {
  return [...new Map(prompts.filter(prompt => prompt?.id).map(prompt => [prompt.id, prompt])).values()];
}

function uniqueEvidence(evidence) {
  return [...new Map(evidence.map(item => [
    `${item.runId}:${item.comparisonType}:${item.promptId}`,
    item,
  ])).values()];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
