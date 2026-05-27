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
  if (!isObject(ontology.invocationBoundaries)) {
    fail(label, 'invocationBoundaries must be an object');
  }
  requireArray(label, ontology.invocationBoundaries, 'shouldTriggerWhen');
  requireArray(label, ontology.invocationBoundaries, 'shouldNotTriggerWhen');
  return ontology;
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
  requireString(label, plan, 'experimentQuestion');
  requireString(label, plan, 'hypothesis');
  requireArray(label, plan, 'focusParameterIds');
  requireArray(label, plan, 'controlledParameterIds');
  requireArray(label, plan, 'successMetrics');
  if (plan.focusParameterIds.length < 1 || plan.focusParameterIds.length > 3) {
    fail(label, 'focusParameterIds must contain one to three parameters');
  }
  if (!isObject(plan.arms) || !isObject(plan.arms.candidateA) || !isObject(plan.arms.candidateB)) {
    fail(label, 'arms.candidateA and arms.candidateB are required');
  }
  requireString(label, plan.arms.candidateA, 'strategyName');
  requireString(label, plan.arms.candidateB, 'strategyName');
  requireArray(label, plan.arms.candidateA, 'mutationInstructions');
  requireArray(label, plan.arms.candidateB, 'mutationInstructions');
  return plan;
}

export function validateEvalResult(result) {
  const label = 'Eval result';
  if (!isObject(result)) fail(label, 'must be an object');
  requireString(label, result, 'runId');
  requireString(label, result, 'phase');
  requireArray(label, result, 'prompts');
  requireArray(label, result, 'scores');
  if (!['candidate-a', 'candidate-b', 'current'].includes(result.winner)) {
    fail(label, 'winner must be candidate-a, candidate-b, or current');
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
  if (!['promote', 'keep_current', 'edit_current', 'request_new_experiment'].includes(recommendation.decision)) {
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
