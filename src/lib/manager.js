const REPEAT_STATUSES = new Set(['do_not_retry_without_new_evidence']);

export function createManagerArtifact({
  projectId,
  runId,
  runNumber,
  mode,
  state,
  history,
  parameterization,
  triggerContext = null,
  createdAt = new Date().toISOString(),
}) {
  const avoid = collectAvoidance(history);
  const localMaxima = detectLocalMaxima(history);
  const hookFocus = deriveHookFocus({ triggerContext, parameterization });
  const experimentFamily = localMaxima.detected ? 'high_divergence_reset' : 'standard_focused_ab';
  const explorationLevel = localMaxima.detected ? 'high' : avoid.parameterIds.length ? 'guarded' : 'normal';

  return {
    schemaVersion: 1,
    projectId,
    runId,
    runNumber,
    mode,
    createdAt,
    currentChampionAtStart: state.currentChampion || null,
    selectedPriorArtifacts: selectPriorArtifacts(history),
    trigger: summarizeTrigger(triggerContext, hookFocus),
    avoid,
    localMaxima,
    strategy: {
      posture: localMaxima.detected
        ? 'recover_from_local_maximum'
        : avoid.parameterIds.length ? 'avoid_repeat' : 'normal',
      experimentFamily,
      explorationLevel,
    },
    experimentIntent: {
      focusHint: localMaxima.detected
        ? 'Plan a high-divergence or reset experiment instead of another small local mutation.'
        : 'Plan a focused A/B experiment against the highest-leverage current parameter.',
      candidatePool: summarizeParameterPool(parameterization, avoid.parameterIds),
      plannerInstructions: buildPlannerInstructions({ avoid, localMaxima, hookFocus }),
    },
    finalAction: null,
  };
}

export function finalizeManagerArtifact(managerArtifact, { recommendation, nextState, completedAt = new Date().toISOString() }) {
  return {
    ...managerArtifact,
    finalAction: {
      completedAt,
      decision: recommendation.decision,
      recommendedChampionCandidateId: recommendation.recommendedChampionCandidateId || null,
      nextChampion: nextState.currentChampion || null,
      nextAction: inferNextAction(recommendation),
      reason: recommendation.reasoning || null,
    },
  };
}

export function applyManagerGuidanceToPlan(plan, managerArtifact, parameterization) {
  if (!managerArtifact) return plan;

  const avoidIds = new Set(managerArtifact.avoid?.parameterIds || []);
  const preferredIds = (managerArtifact.trigger?.hook?.focusParameterIds || []).filter(id => !avoidIds.has(id));
  const availableIds = getAvailableParameterIds(parameterization, avoidIds);
  const fallbackFocus = availableIds.length ? availableIds.slice(0, 3) : plan.focusParameterIds;
  const focusParameterIds = plan.focusParameterIds.filter(id => !avoidIds.has(id)).slice(0, 3);
  const nextFocus = unique([
    ...preferredIds,
    ...(focusParameterIds.length ? focusParameterIds : fallbackFocus),
  ]).slice(0, 3);
  const controlledParameterIds = unique([
    ...(plan.controlledParameterIds || []).filter(id => !nextFocus.includes(id)),
    ...Array.from(avoidIds),
  ]);

  const guidedPlan = {
    ...plan,
    focusParameterIds: nextFocus,
    controlledParameterIds,
    reasonNotTestingOtherHighPriorityParameters: unique([
      ...normalizeArray(plan.reasonNotTestingOtherHighPriorityParameters),
      ...normalizeArray(managerArtifact.avoid?.reasons),
    ]),
  };

  if (managerArtifact.strategy?.experimentFamily !== 'high_divergence_reset') {
    return guidedPlan;
  }

  return {
    ...guidedPlan,
    experimentQuestion: startsWithLabel(guidedPlan.experimentQuestion, 'High-divergence reset')
      ? guidedPlan.experimentQuestion
      : `High-divergence reset: ${guidedPlan.experimentQuestion}`,
    hypothesis: `A deliberately different structure or reset-to-baseline treatment may escape a local maximum. ${guidedPlan.hypothesis}`,
    arms: {
      candidateA: {
        ...guidedPlan.arms.candidateA,
        strategyName: prefixStrategy(guidedPlan.arms.candidateA.strategyName, 'high-divergence'),
        mutationInstructions: unique([
          'Use a substantially different skill structure, workflow order, or information architecture from the current champion.',
          'Keep the package valid and portable, but do not preserve local wording unless it is essential.',
          ...normalizeArray(guidedPlan.arms.candidateA.mutationInstructions),
        ]),
      },
      candidateB: {
        ...guidedPlan.arms.candidateB,
        strategyName: prefixStrategy(guidedPlan.arms.candidateB.strategyName, 'reset-control'),
        mutationInstructions: unique([
          'Rebuild from the original goal and ontology with minimal assumptions from recent losing experiments.',
          'Preserve only the proven champion constraints and explicitly avoid recently failed parameter treatments.',
          ...normalizeArray(guidedPlan.arms.candidateB.mutationInstructions),
        ]),
      },
    },
    promotionRisks: unique([
      ...normalizeArray(guidedPlan.promotionRisks),
      'High-divergence recovery can improve exploration but may regress stable champion behavior.',
    ]),
  };
}

function collectAvoidance(history) {
  const parameterIds = [];
  const strategies = [];
  const reasons = [];

  for (const item of history?.parameterLog || []) {
    if (REPEAT_STATUSES.has(item.status)) {
      parameterIds.push(item.parameterId);
      reasons.push(`${item.parameterId}: ${item.currentBelief || 'do not retry without new evidence'}`);
    }
  }

  for (const item of history?.failedStrategyLog || []) {
    if (['blocked_eval', 'inconclusive', 'open'].includes(item.status)) {
      strategies.push(item.message);
      reasons.push(item.message);
    }
  }

  for (const item of history?.doNotRepeat || []) {
    reasons.push(typeof item === 'string' ? item : item.message);
  }

  return {
    parameterIds: unique(parameterIds),
    strategies: unique(strategies.filter(Boolean)),
    reasons: unique(reasons.filter(Boolean)).slice(0, 12),
  };
}

function detectLocalMaxima(history) {
  const trajectory = Array.isArray(history?.trajectory) ? history.trajectory : [];
  const trailingNonPromotions = countTrailing(trajectory, entry => entry.decision !== 'promote');
  const trailingInconclusive = countTrailing(trajectory, entry => entry.decision === 'request_new_experiment');
  const trailingLowSignal = countTrailing(trajectory, entry => {
    const delta = entry.scoreDelta;
    return entry.decision !== 'promote' && (delta === null || delta === undefined || Math.abs(delta) <= 1);
  });
  const detected = trailingNonPromotions >= 3 || trailingInconclusive >= 2 || trailingLowSignal >= 3;

  return {
    detected,
    trailingNonPromotions,
    trailingInconclusive,
    trailingLowSignal,
    reason: detected
      ? 'Recent runs repeatedly failed to promote or produced low-signal outcomes.'
      : null,
  };
}

function selectPriorArtifacts(history) {
  const artifacts = [];
  for (const entry of (history?.trajectory || []).slice(-5)) {
    if (!entry.runId) continue;
    artifacts.push({ kind: 'run_report', runId: entry.runId, path: `history/detailed/${entry.runId}.md` });
    artifacts.push({ kind: 'recommendation', runId: entry.runId, path: `runs/${entry.runId}/analysis/recommendation.json` });
    artifacts.push({ kind: 'experiment_plan', runId: entry.runId, path: `runs/${entry.runId}/deconstruction/experiment-plan.json` });
  }
  for (const item of (history?.failedStrategyLog || []).slice(-5)) {
    const artifactPath = item.artifactPath || item.artifact;
    if (artifactPath) {
      artifacts.push({ kind: item.source || 'failed_strategy', runId: item.runId, path: artifactPath });
    } else if (item.runId) {
      artifacts.push({ kind: item.source || 'failed_strategy', runId: item.runId, path: `runs/${item.runId}/analysis/report.md` });
    }
  }
  return artifacts;
}

function summarizeParameterPool(parameterization, avoidIds) {
  const avoid = new Set(avoidIds || []);
  return (parameterization?.parameters || []).slice(0, 24).map(parameter => ({
    id: parameter.id,
    surface: parameter.surface,
    priority: parameter.priority,
    confidence: parameter.confidence,
    eligible: !avoid.has(parameter.id),
  }));
}

function buildPlannerInstructions({ avoid, localMaxima, hookFocus }) {
  const instructions = [];
  if (hookFocus.focusParameterIds.length) {
    instructions.push(`Prioritize hook-focused parameters when feasible: ${hookFocus.focusParameterIds.join(', ')}.`);
  }
  if (avoid.parameterIds.length) {
    instructions.push(`Do not select these parameters unless you name new evidence: ${avoid.parameterIds.join(', ')}.`);
  }
  if (avoid.strategies.length) {
    instructions.push(`Avoid repeating these failed strategies: ${avoid.strategies.slice(0, 4).join(' | ')}.`);
  }
  if (localMaxima.detected) {
    instructions.push('Use a high-divergence/reset experiment: one arm should break out structurally, and one should rebuild from the original goal plus proven constraints.');
  }
  if (!instructions.length) {
    instructions.push('Choose one to three related high-priority parameters and keep the rest controlled.');
  }
  return instructions;
}

function summarizeTrigger(triggerContext, hookFocus) {
  if (!triggerContext) return { mode: 'manual', hook: null };
  return {
    mode: triggerContext.mode || 'manual',
    hook: triggerContext.hook ? {
      id: triggerContext.hook.id || null,
      path: triggerContext.hook.path || null,
      source: triggerContext.hook.payload?.source || triggerContext.hook.source || null,
      reason: triggerContext.hook.payload?.reason || triggerContext.hook.reason || null,
      changedFiles: normalizeArray(triggerContext.hook.payload?.changedFiles || triggerContext.hook.changedFiles),
      focusParameterIds: hookFocus.focusParameterIds,
    } : null,
  };
}

function deriveHookFocus({ triggerContext, parameterization }) {
  const payload = triggerContext?.hook?.payload || triggerContext?.hook || {};
  const fields = Array.isArray(triggerContext?.hookFocusFields)
    ? new Set(triggerContext.hookFocusFields)
    : new Set(['focusParameterIds', 'parameterIds', 'changedFiles', 'reason']);
  const explicit = [
    ...(fields.has('focusParameterIds') ? normalizeArray(payload.focusParameterIds) : []),
    ...(fields.has('parameterIds') ? normalizeArray(payload.parameterIds) : []),
  ]
    .filter(id => parameterization?.parameters?.some(parameter => parameter.id === id));
  const inferred = [
    ...(fields.has('changedFiles') ? inferParametersFromChangedFiles(payload.changedFiles, parameterization) : []),
    ...(fields.has('reason') ? inferParametersFromText(payload.reason, parameterization) : []),
  ];
  return {
    focusParameterIds: unique([...explicit, ...inferred]).slice(0, 3),
  };
}

function inferParametersFromChangedFiles(changedFiles, parameterization) {
  const files = normalizeArray(changedFiles).map(file => String(file).toLowerCase());
  if (!files.length) return [];
  const wants = new Set();
  if (files.some(file => file.includes('script'))) wants.add('script');
  if (files.some(file => file.includes('reference'))) wants.add('reference');
  if (files.some(file => file.endsWith('skill.md') || file.includes('skill.md'))) {
    wants.add('activation');
    wants.add('workflow');
    wants.add('output');
  }
  return (parameterization?.parameters || [])
    .filter(parameter => {
      const haystack = `${parameter.id} ${parameter.surface}`.toLowerCase();
      return Array.from(wants).some(term => haystack.includes(term));
    })
    .map(parameter => parameter.id);
}

function inferParametersFromText(text, parameterization) {
  const value = String(text || '').toLowerCase();
  if (!value) return [];
  const wants = new Set();
  if (value.includes('activation') || value.includes('trigger')) wants.add('activation');
  if (value.includes('workflow') || value.includes('sequence')) wants.add('workflow');
  if (value.includes('output') || value.includes('contract')) wants.add('output');
  if (value.includes('validation')) wants.add('validation');
  if (value.includes('script')) wants.add('script');
  if (value.includes('reference')) wants.add('reference');
  return (parameterization?.parameters || [])
    .filter(parameter => {
      const haystack = `${parameter.id} ${parameter.surface}`.toLowerCase();
      return Array.from(wants).some(term => haystack.includes(term));
    })
    .map(parameter => parameter.id);
}

function inferNextAction(recommendation) {
  if (recommendation.decision === 'promote') return 'deconstruct_promoted_champion';
  if (recommendation.decision === 'keep_current') return 'plan_new_experiment_against_current_champion';
  return 'request_new_experiment';
}

function countTrailing(items, predicate) {
  let count = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!predicate(items[index])) break;
    count += 1;
  }
  return count;
}

function getAvailableParameterIds(parameterization, avoidIds) {
  return (parameterization?.parameters || [])
    .filter(parameter => !avoidIds.has(parameter.id))
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
    .map(parameter => parameter.id);
}

function priorityRank(value) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  return 1;
}

function prefixStrategy(value, prefix) {
  const text = String(value || 'candidate').trim();
  return text.startsWith(prefix) ? text : `${prefix}-${text}`;
}

function startsWithLabel(value, label) {
  return String(value || '').toLowerCase().startsWith(label.toLowerCase());
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter(item => item !== undefined && item !== null);
  return value ? [value] : [];
}

function unique(values) {
  return Array.from(new Set(values.filter(value => value !== undefined && value !== null)));
}
