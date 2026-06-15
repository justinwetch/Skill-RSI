function fail(label, message) {
  throw new Error(`${label} is invalid: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireString(label, object, key) {
  if (typeof object[key] !== 'string' || object[key].trim() === '') {
    fail(label, `${key} must be a non-empty string`);
  }
}

function requireArray(label, object, key) {
  if (!Array.isArray(object[key])) {
    fail(label, `${key} must be an array`);
  }
}

function requireStringArray(label, object, key) {
  requireArray(label, object, key);
  if (object[key].some(item => typeof item !== 'string' || item.trim() === '')) {
    fail(label, `${key} must contain only non-empty strings`);
  }
}

export const COMPETITION_MODES = ['cold_start_duel', 'champion_challenge', 'high_divergence_reset'];
const ONTOLOGY_LEXICON_LIMIT = 50;

export function validateProjectConfig(config) {
  const label = 'Project config';
  if (!isObject(config)) fail(label, 'must be an object');
  requireString(label, config, 'name');
  requireString(label, config, 'goal');
  requireString(label, config, 'createdAt');
  return config;
}

export function validateRunState(state) {
  const label = 'Run state';
  if (!isObject(state)) fail(label, 'must be an object');
  requireString(label, state, 'projectId');
  if (!Number.isInteger(state.runCount) || state.runCount < 0) {
    fail(label, 'runCount must be a non-negative integer');
  }
  if (state.currentChampion !== null && state.currentChampion !== undefined) {
    if (!isObject(state.currentChampion)) fail(label, 'currentChampion must be an object or null');
    requireString(label, state.currentChampion, 'runId');
    requireString(label, state.currentChampion, 'candidateId');
    requireString(label, state.currentChampion, 'skillHash');
  }
  if (state.budgetUsage !== null && state.budgetUsage !== undefined) {
    if (!isObject(state.budgetUsage)) fail(label, 'budgetUsage must be an object');
    if (!Number.isFinite(state.budgetUsage.estimatedTokens) || state.budgetUsage.estimatedTokens < 0) {
      fail(label, 'budgetUsage.estimatedTokens must be a non-negative number');
    }
    if (!Number.isFinite(state.budgetUsage.estimatedSpendUsd) || state.budgetUsage.estimatedSpendUsd < 0) {
      fail(label, 'budgetUsage.estimatedSpendUsd must be a non-negative number');
    }
  }
  return state;
}

export function validateCandidate(candidate) {
  const label = 'Candidate';
  if (!isObject(candidate)) fail(label, 'must be an object');
  requireString(label, candidate, 'candidateId');
  requireString(label, candidate, 'experimentArm');
  requireString(label, candidate, 'strategy');
  requireString(label, candidate, 'skillPath');
  requireArray(label, candidate, 'changedParameterIds');
  return candidate;
}

export function validateResearchPacket(packet) {
  const label = 'Research packet';
  if (!isObject(packet)) fail(label, 'must be an object');
  requireString(label, packet, 'runId');
  requireString(label, packet, 'skillGoal');
  requireString(label, packet, 'researchMode');
  requireArray(label, packet, 'sources');
  requireArray(label, packet, 'evidenceClaims');
  requireArray(label, packet, 'authorityMap');
  requireArray(label, packet, 'searchTrace');
  requireArray(label, packet, 'openQuestions');
  requireArray(label, packet, 'gaps');

  for (const claim of packet.evidenceClaims) {
    if (!isObject(claim)) fail(label, 'each evidence claim must be an object');
    requireString(label, claim, 'claim');
    if (!['sourced', 'inferred', 'speculative'].includes(claim.evidenceBasis)) {
      fail(label, 'evidenceClaims[].evidenceBasis must be sourced, inferred, or speculative');
    }
  }

  for (const authority of packet.authorityMap) {
    if (!isObject(authority)) fail(label, 'each authority must be an object');
    requireString(label, authority, 'name');
    requireArray(label, authority, 'strongOpinions');
    requireArray(label, authority, 'implicationsForSkill');
    requireArray(label, authority, 'misuseRisks');
  }

  if (packet.practitionerLexicon !== undefined) {
    requireArray(label, packet, 'practitionerLexicon');
    for (const entry of packet.practitionerLexicon) {
      if (!isObject(entry)) fail(label, 'each practitionerLexicon entry must be an object');
      requireString(label, entry, 'term');
      requireString(label, entry, 'evidenceBasis');
      if (!['sourced', 'inferred', 'speculative'].includes(entry.evidenceBasis)) {
        fail(label, 'practitionerLexicon[].evidenceBasis must be sourced, inferred, or speculative');
      }
      requireArray(label, entry, 'sourceRefs');
      if (entry.evidenceBasis === 'sourced' && !entry.sourceRefs.length) {
        fail(label, 'sourced practitionerLexicon entries must include sourceRefs');
      }
    }
  }

  if (packet.intertextualMap !== undefined) {
    if (!isObject(packet.intertextualMap)) fail(label, 'intertextualMap must be an object');
    requireString(label, packet.intertextualMap, 'evidenceBasis');
    if (!['sourced', 'inferred', 'speculative'].includes(packet.intertextualMap.evidenceBasis)) {
      fail(label, 'intertextualMap.evidenceBasis must be sourced, inferred, or speculative');
    }
    if (packet.intertextualMap.sourceRefs !== undefined) requireArray(label, packet.intertextualMap, 'sourceRefs');
    if (packet.intertextualMap.evidenceBasis === 'sourced' && !packet.intertextualMap.sourceRefs?.length) {
      fail(label, 'sourced intertextualMap must include sourceRefs');
    }
    for (const field of [
      'canonicalTexts',
      'standardsAndInstitutions',
      'schoolsOfThought',
      'recurringDebates',
      'conceptLineages',
      'adjacentDomainBorrowings',
      'commonMisreadings',
    ]) {
      if (packet.intertextualMap[field] !== undefined) requireArray(label, packet.intertextualMap, field);
    }
    for (const lineage of packet.intertextualMap.conceptLineages || []) {
      if (!isObject(lineage)) fail(label, 'each intertextualMap.conceptLineages entry must be an object');
      requireString(label, lineage, 'evidenceBasis');
      if (!['sourced', 'inferred', 'speculative'].includes(lineage.evidenceBasis)) {
        fail(label, 'intertextualMap.conceptLineages[].evidenceBasis must be sourced, inferred, or speculative');
      }
      requireArray(label, lineage, 'sourceRefs');
      if (lineage.evidenceBasis === 'sourced' && !lineage.sourceRefs.length) {
        fail(label, 'sourced intertextualMap.conceptLineages entries must include sourceRefs');
      }
    }
  }

  return packet;
}

export function validateOntology(ontology) {
  const label = 'Ontology';
  if (!isObject(ontology)) fail(label, 'must be an object');
  requireString(label, ontology, 'runId');
  requireString(label, ontology, 'skillGoal');
  requireArray(label, ontology, 'targetUsers');
  requireArray(label, ontology, 'targetTasks');
  requireArray(label, ontology, 'inputSurface');
  requireArray(label, ontology, 'outputArtifacts');
  requireArray(label, ontology, 'requiredKnowledge');
  requireArray(label, ontology, 'failureModes');
  requireArray(label, ontology, 'qualityAxes');
  requireArray(label, ontology, 'evalPromptTaxonomy');
  requireArray(label, ontology, 'candidateStrategySpace');
  if (ontology.authorityMap !== undefined) requireArray(label, ontology, 'authorityMap');
  if (ontology.evidenceClaims !== undefined) requireArray(label, ontology, 'evidenceClaims');
  if (ontology.sourceRefs !== undefined) requireArray(label, ontology, 'sourceRefs');
  if (ontology.inferenceLabels !== undefined) requireArray(label, ontology, 'inferenceLabels');
  if (ontology.unsupportedClaims !== undefined) requireArray(label, ontology, 'unsupportedClaims');
  if (ontology.researchGaps !== undefined) requireArray(label, ontology, 'researchGaps');
  if (ontology.practitionerLexicon !== undefined) {
    requireArray(label, ontology, 'practitionerLexicon');
    if (ontology.practitionerLexicon.length > ONTOLOGY_LEXICON_LIMIT) {
      fail(label, `practitionerLexicon must contain at most ${ONTOLOGY_LEXICON_LIMIT} entries`);
    }
    for (const entry of ontology.practitionerLexicon) {
      if (!isObject(entry)) fail(label, 'each practitionerLexicon entry must be an object');
      requireString(label, entry, 'term');
      requireExpertEvidence(label, entry, 'practitionerLexicon[]');
    }
  }
  if (ontology.terminologyDiscriminators !== undefined) {
    requireArray(label, ontology, 'terminologyDiscriminators');
    for (const discriminator of ontology.terminologyDiscriminators) {
      if (!isObject(discriminator)) fail(label, 'each terminologyDiscriminators entry must be an object');
      requireString(label, discriminator, 'term');
      requireExpertEvidence(label, discriminator, 'terminologyDiscriminators[]');
    }
  }
  if (ontology.intertextualMap !== undefined) {
    if (!isObject(ontology.intertextualMap)) fail(label, 'intertextualMap must be an object');
    requireExpertEvidence(label, ontology.intertextualMap, 'intertextualMap');
    for (const field of [
      'canonicalTexts',
      'standardsAndInstitutions',
      'schoolsOfThought',
      'recurringDebates',
      'conceptLineages',
      'adjacentDomainBorrowings',
      'commonMisreadings',
    ]) {
      if (ontology.intertextualMap[field] !== undefined) requireArray(label, ontology.intertextualMap, field);
    }
    for (const lineage of ontology.intertextualMap.conceptLineages || []) {
      if (!isObject(lineage)) fail(label, 'each intertextualMap.conceptLineages entry must be an object');
      requireString(label, lineage, 'concept');
      requireExpertEvidence(label, lineage, 'intertextualMap.conceptLineages[]');
    }
  }
  if (!isObject(ontology.invocationBoundaries)) {
    fail(label, 'invocationBoundaries must be an object');
  }
  requireArray(label, ontology.invocationBoundaries, 'shouldTriggerWhen');
  requireArray(label, ontology.invocationBoundaries, 'shouldNotTriggerWhen');
  return ontology;
}

function requireExpertEvidence(label, entry, path) {
  requireString(label, entry, 'evidenceBasis');
  if (!['sourced', 'inferred', 'speculative'].includes(entry.evidenceBasis)) {
    fail(label, `${path}.evidenceBasis must be sourced, inferred, or speculative`);
  }
  requireArray(label, entry, 'sourceRefs');
  if (entry.evidenceBasis === 'sourced' && !entry.sourceRefs.length) {
    fail(label, `sourced ${path} entries must include sourceRefs`);
  }
}

export function validateQualityReport(report) {
  const label = 'Quality report';
  if (!isObject(report)) fail(label, 'must be an object');
  requireString(label, report, 'artifactType');
  requireString(label, report, 'status');
  requireArray(label, report, 'issues');
  requireArray(label, report, 'warnings');
  if (typeof report.revisionRecommended !== 'boolean') {
    fail(label, 'revisionRecommended must be a boolean');
  }
  return report;
}

export function validateParameterization(parameterization) {
  const label = 'Parameterization';
  if (!isObject(parameterization)) fail(label, 'must be an object');
  requireString(label, parameterization, 'runId');
  requireString(label, parameterization, 'championSkillHash');
  requireString(label, parameterization, 'summary');
  requireArray(label, parameterization, 'parameters');
  requireArray(label, parameterization, 'highestLeverageHypotheses');
  if (parameterization.parameters.length < 12) {
    fail(label, 'parameters must include at least 12 surfaces');
  }

  for (const parameter of parameterization.parameters) {
    if (!isObject(parameter)) fail(label, 'each parameter must be an object');
    requireString(label, parameter, 'id');
    requireString(label, parameter, 'surface');
    requireString(label, parameter, 'improvementHypothesis');
    requireString(label, parameter, 'measurementPlan');
    if (!['low', 'medium', 'high'].includes(parameter.priority)) {
      fail(label, `parameter ${parameter.id} has invalid priority`);
    }
    if (!['low', 'medium', 'high'].includes(parameter.confidence)) {
      fail(label, `parameter ${parameter.id} has invalid confidence`);
    }
  }

  return parameterization;
}

export function validateExperimentPlan(plan) {
  const label = 'Experiment plan';
  if (!isObject(plan)) fail(label, 'must be an object');
  requireString(label, plan, 'runId');
  if (!COMPETITION_MODES.includes(plan.competitionMode)) {
    fail(label, 'competitionMode must be cold_start_duel, champion_challenge, or high_divergence_reset');
  }
  requireString(label, plan, 'experimentQuestion');
  requireString(label, plan, 'hypothesis');
  requireStringArray(label, plan, 'focusParameterIds');
  requireStringArray(label, plan, 'controlledParameterIds');
  requireArray(label, plan, 'successMetrics');
  if (plan.focusParameterIds.length < 1 || plan.focusParameterIds.length > 3) {
    fail(label, 'focusParameterIds must contain one to three parameters');
  }
  if (!isObject(plan.arms)) fail(label, 'arms must be an object');
  if (plan.competitionMode === 'cold_start_duel') {
    if (!isObject(plan.arms.candidateA) || !isObject(plan.arms.candidateB)) {
      fail(label, 'arms.candidateA and arms.candidateB are required for cold_start_duel');
    }
    requireString(label, plan.arms.candidateA, 'strategyName');
    requireString(label, plan.arms.candidateB, 'strategyName');
    requireArray(label, plan.arms.candidateA, 'mutationInstructions');
    requireArray(label, plan.arms.candidateB, 'mutationInstructions');
  } else {
    if (!isObject(plan.arms.challenger)) {
      fail(label, 'arms.challenger is required for champion-present competition modes');
    }
    requireString(label, plan.arms.challenger, 'strategyName');
    requireArray(label, plan.arms.challenger, 'mutationInstructions');
  }
  return plan;
}

export function validateEvalResult(result) {
  const label = 'Eval result';
  if (!isObject(result)) fail(label, 'must be an object');
  requireString(label, result, 'runId');
  requireString(label, result, 'phase');
  requireArray(label, result, 'prompts');
  requireArray(label, result, 'scores');
  if (!['candidate-a', 'candidate-b', 'challenger', 'current'].includes(result.winner)) {
    fail(label, 'winner must be candidate-a, candidate-b, challenger, or current');
  }
  return result;
}

export function validateHeadlessEvalRun(run) {
  const label = 'Headless eval run';
  if (!isObject(run)) fail(label, 'must be an object');
  requireString(label, run, 'runId');
  requireString(label, run, 'mode');
  requireArray(label, run, 'prompts');
  requireArray(label, run, 'criteria');
  requireArray(label, run, 'evaluations');
  if (!isObject(run.skills)) fail(label, 'skills must be an object');
  if (!isObject(run.blindLabels)) fail(label, 'blindLabels must be an object');
  if (!isObject(run.stats)) fail(label, 'stats must be an object');
  return run;
}

export function validateEvalDesign(design) {
  const label = 'Eval design';
  if (!isObject(design)) fail(label, 'must be an object');
  requireString(label, design, 'runId');
  requireArray(label, design, 'prompts');
  requireArray(label, design, 'criteria');
  if (design.prompts.length < 1) fail(label, 'prompts must not be empty');
  if (design.criteria.length < 1) fail(label, 'criteria must not be empty');

  for (const prompt of design.prompts) {
    if (!isObject(prompt)) fail(label, 'each prompt must be an object');
    requireString(label, prompt, 'id');
    requireString(label, prompt, 'text');
    requireArray(label, prompt, 'parameterIds');
    requireString(label, prompt, 'difficulty');
    requireString(label, prompt, 'bucket');
  }

  for (const criterion of design.criteria) {
    if (!isObject(criterion)) fail(label, 'each criterion must be an object');
    requireString(label, criterion, 'id');
    requireString(label, criterion, 'name');
    requireString(label, criterion, 'description');
    if (!isObject(criterion.rubric)) fail(label, `criterion ${criterion.id} must include rubric`);
  }

  return design;
}

export function validateAdversarialReview(review) {
  const label = 'Adversarial review';
  if (!isObject(review)) fail(label, 'must be an object');
  requireString(label, review, 'candidateId');
  requireArray(label, review, 'blockingIssues');
  requireArray(label, review, 'recommendedEdits');
  requireArray(label, review, 'nonIssues');
  if (!['low', 'medium', 'high'].includes(review.overfittingRisk)) {
    fail(label, 'overfittingRisk must be low, medium, or high');
  }
  if (typeof review.approveForEval !== 'boolean') {
    fail(label, 'approveForEval must be a boolean');
  }
  return review;
}

export function validateRecommendation(recommendation) {
  const label = 'Recommendation';
  if (!isObject(recommendation)) fail(label, 'must be an object');
  requireString(label, recommendation, 'runId');
  if (!['promote', 'keep_current', 'request_new_experiment'].includes(recommendation.decision)) {
    fail(label, 'decision is not recognized');
  }
  if (!['low', 'medium', 'high'].includes(recommendation.confidence)) {
    fail(label, 'confidence must be low, medium, or high');
  }
  requireArray(label, recommendation, 'observations');
  return recommendation;
}

export function validateHistoryIndex(history) {
  const label = 'History index';
  if (!isObject(history)) fail(label, 'must be an object');
  requireString(label, history, 'experimentId');
  requireString(label, history, 'createdAt');
  requireString(label, history, 'skillGoal');
  requireArray(label, history, 'trajectory');
  requireArray(label, history, 'parameterLog');
  return history;
}
