import { validateEvalDesign } from './schema.js';
import { callModel } from './model-client.js';
import { loadSkillPackage } from './skill-package.js';

const DEFAULT_DIFFICULTIES = ['easy', 'medium', 'medium', 'hard'];

// Model-written prompt generation, SkillEval-style. designEvalBatch still builds the
// slots (ids, parameter targeting, difficulty, criteria) so all downstream logic and
// tests are unchanged; here a model rewrites the templated slot text into realistic,
// varied user requests. Falls back to the original text on any failure.
const TEMPLATE_MARKERS = [
  'I need help with this skill goal:',
  'A user gives an incomplete but plausible request related to:',
  'Pay attention to the skill surface under test:',
];

function isTemplatedPrompt(text) {
  return typeof text === 'string' && TEMPLATE_MARKERS.some(marker => text.includes(marker));
}

function buildPromptGenInstruction(goal, slots) {
  const lines = slots.map((slot, n) => (
    `${n + 1}. difficulty=${slot.difficulty || 'medium'}; the request should involve ${slot.task || 'using the skill'}`
    + `${slot.surface ? `, with realistic ambiguity or nuance around ${slot.surface}` : ''}`
    + `; it should let a grader observe ${slot.quality || 'overall quality'} (do not mention any of this in the prompt itself).`
  ));
  return [
    'You are designing an evaluation set for an AI skill, like a careful test author.',
    `Skill goal: ${goal}`,
    `Write ${slots.length} realistic, self-contained user requests — the kind a real person would actually send to an agent using this skill.`,
    'Rules: each prompt must read naturally with no meta-commentary; never use phrases like "skill surface under test", "quality axis", or "validate it for". Vary tone, length, domain specifics, and difficulty across the set. Exercise the noted aspect implicitly, never by naming it.',
    'Slots (write one prompt per slot, in order):',
    ...lines,
    `Respond ONLY with JSON of the form {"prompts": ["...", "..."]} containing exactly ${slots.length} strings in slot order.`,
  ].join('\n');
}

function parsePromptArray(raw, expectedCount) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  const prompts = Array.isArray(parsed) ? parsed : parsed?.prompts;
  if (!Array.isArray(prompts) || prompts.length !== expectedCount) return null;
  if (!prompts.every(item => typeof item === 'string' && item.trim())) return null;
  return prompts.map(item => item.trim());
}

// Model-generated eval criteria, modeled on SkillEval's generateFromSkills (criteria half).
// Generated once on run 0 from the goal + both candidate skills, then locked/reused across runs
// (run-loop only calls this when the prompt bank has no locked core criteria yet). Falls back to
// the deterministic templates if the model is unavailable or returns something unusable.
const CRITERIA_SYSTEM_PROMPT = `You are a configuration generator for an AI skill evaluation tool.

Given a skill's goal and two candidate Agent Skill packages that will be compared head-to-head, generate fair evaluation criteria for judging the OUTPUTS those skills produce.

Generate 4-6 criteria that:
- Are specific to what these skills claim to do (not generic boilerplate)
- Can be objectively evaluated from a model's output
- Cover different aspects (correctness, usefulness, workflow/style, edge-case handling)
- Each include a clear 1-5 scoring rubric (5 = excellent, 1 = unacceptable)

Respond ONLY with JSON in this exact shape:
{"criteria":[{"id":"snake_case_id","name":"Human Readable Name","description":"What this criterion measures","rubric":{"5":"...","4":"...","3":"...","2":"...","1":"..."}}]}`;

function buildCriteriaInstruction(goal, skillAText, skillBText) {
  return [
    `Skill goal: ${goal}`,
    'Generate the evaluation criteria for comparing these two candidate skills.',
    `\n## Skill A — SKILL.md\n"""\n${skillAText}\n"""`,
    `\n## Skill B — SKILL.md\n"""\n${skillBText}\n"""`,
  ].join('\n');
}

function parseCriteriaJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.criteria;
  if (!Array.isArray(list)) return null;
  const cleaned = list
    .filter(c => c && typeof c.name === 'string' && typeof c.description === 'string' && c.rubric && typeof c.rubric === 'object')
    .map(c => ({
      id: String(c.id || c.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'criterion',
      name: c.name,
      description: c.description,
      rubric: c.rubric,
      stable: true,
    }))
    .filter(c => Object.keys(c.rubric).length >= 3);
  return cleaned.length >= 3 ? cleaned.slice(0, 6) : null;
}

export async function generateEvalCriteria({ goal, candidateA, candidateB, model, apiKeys = {}, modelClient = null }) {
  if (!model) return null;
  let aText = '';
  let bText = '';
  try {
    const [pa, pb] = await Promise.all([loadSkillPackage(candidateA.skillPath), loadSkillPackage(candidateB.skillPath)]);
    aText = (pa.files.find(f => f.path === 'SKILL.md') || pa.files[0])?.content || '';
    bText = (pb.files.find(f => f.path === 'SKILL.md') || pb.files[0])?.content || '';
  } catch { return null; }
  if (!aText || !bText) return null;
  try {
    const call = modelClient || callModel;
    const raw = await call({
      model,
      apiKeys,
      jsonMode: true,
      maxTokens: 2400,
      systemPrompt: CRITERIA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildCriteriaInstruction(goal, aText, bText) }],
    });
    return parseCriteriaJson(raw);
  } catch {
    return null;
  }
}

export async function naturalizeEvalPrompts({ design, goal, model, apiKeys = {}, modelClient = null }) {
  if (!design || !model) return design;
  const targets = design.prompts.filter(prompt => isTemplatedPrompt(prompt.text));
  if (targets.length === 0) return design;

  const slots = targets.map(prompt => ({
    task: prompt.taxonomy?.[0],
    quality: prompt.taxonomy?.[1],
    surface: prompt.taxonomy?.[2],
    difficulty: prompt.difficulty,
  }));

  let texts;
  try {
    const call = modelClient || callModel;
    const raw = await call({
      model,
      apiKeys,
      jsonMode: true,
      maxTokens: 2400,
      systemPrompt: 'You generate realistic, high-quality evaluation prompts for AI skills. Output strict JSON only.',
      messages: [{ role: 'user', content: buildPromptGenInstruction(goal, slots) }],
    });
    texts = parsePromptArray(raw, targets.length);
  } catch {
    texts = null;
  }
  if (!texts) return design;

  const replacement = new Map();
  targets.forEach((prompt, index) => replacement.set(prompt.id, texts[index]));
  const apply = list => (Array.isArray(list)
    ? list.map(prompt => (replacement.has(prompt.id) ? { ...prompt, text: replacement.get(prompt.id) } : prompt))
    : list);

  design.prompts = apply(design.prompts);
  if (design.bank) {
    design.bank.stablePrompts = apply(design.bank.stablePrompts);
    design.bank.explorationPrompts = apply(design.bank.explorationPrompts);
  }
  return design;
}

export function designEvalBatch({
  runId,
  goal,
  ontology = null,
  parameterization = null,
  experimentPlan,
  history = null,
  previousBank = null,
  stablePromptCount = 6,
  explorationPromptCount = 4,
  coreCriteria = null,
}) {
  const focusIds = experimentPlan.focusParameterIds.slice(0, 3);
  const qualityAxes = Array.isArray(ontology?.qualityAxes) && ontology.qualityAxes.length
    ? ontology.qualityAxes
    : ['activation precision', 'workflow clarity', 'validation usefulness'];
  const targetTasks = Array.isArray(ontology?.targetTasks) && ontology.targetTasks.length
    ? ontology.targetTasks
    : ['create a useful skill output', 'handle ambiguous requests', 'validate output quality'];
  const parameterLookup = new Map((parameterization?.parameters || []).map(parameter => [parameter.id, parameter]));

  const reusedStable = Array.isArray(previousBank?.stablePrompts)
    ? previousBank.stablePrompts
      .filter(prompt => !isRetiredPrompt(previousBank, prompt.id))
      .slice(0, stablePromptCount)
      .map(prompt => ({ ...prompt, bucket: 'stable', reusedFromBank: true }))
    : [];
  const stable = [
    ...reusedStable,
    ...Array.from({ length: Math.max(0, stablePromptCount - reusedStable.length) }, (_, offset) => {
      const index = reusedStable.length + offset;
      const parameterId = focusIds[index % focusIds.length] || `p${index + 1}`;
      return createPrompt({
        runId,
        index,
        bucket: 'stable',
        difficulty: DEFAULT_DIFFICULTIES[index % DEFAULT_DIFFICULTIES.length],
        goal,
        parameterId,
        parameter: parameterLookup.get(parameterId),
        targetTask: targetTasks[index % targetTasks.length],
        qualityAxis: qualityAxes[index % qualityAxes.length],
        history,
      });
    }),
  ];

  const exploration = Array.from({ length: explorationPromptCount }, (_, offset) => {
    const index = stablePromptCount + offset;
    const parameterId = focusIds[index % focusIds.length] || `p${index + 1}`;
    return createPrompt({
      runId,
      index,
      bucket: 'exploration',
      difficulty: offset < 2 ? 'medium' : 'hard',
      goal,
      parameterId,
      parameter: parameterLookup.get(parameterId),
      targetTask: targetTasks[(index + 1) % targetTasks.length],
      qualityAxis: qualityAxes[(index + 1) % qualityAxes.length],
      history,
      exploratory: true,
    });
  });
  const criteria = createCriteria({ qualityAxes, focusIds, parameterLookup, previousBank, runId, coreCriteria });
  const criteriaVersion = getNextCriteriaVersion({ previousBank, criteria });
  const retired = Array.isArray(previousBank?.retired) ? previousBank.retired : [];
  const priorExploration = Array.isArray(previousBank?.explorationPrompts) ? previousBank.explorationPrompts : [];

  const design = validateEvalDesign({
    runId,
    prompts: [...stable, ...exploration],
    criteria,
    bank: {
      version: 2,
      createdAt: previousBank?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentRunId: runId,
      stablePromptCount,
      explorationPromptCount,
      stablePromptIds: stable.map(prompt => prompt.id),
      explorationPromptIds: exploration.map(prompt => prompt.id),
      stablePrompts: stable.map(prompt => ({ ...prompt, reusedFromBank: undefined })),
      explorationPrompts: [...priorExploration, ...exploration],
      retired,
      criteria,
      criteriaVersion,
      criteriaVersions: updateCriteriaVersions({ previousBank, criteria, criteriaVersion, runId }),
      designNotes: [
        'Stable prompts exercise recurring skill quality axes.',
        'Exploration prompts target the current experiment plan.',
        'Candidate creators should receive taxonomy and quality axes, not this concrete prompt batch.',
      ],
    },
  });

  return design;
}

function isRetiredPrompt(bank, promptId) {
  return Array.isArray(bank?.retired) && bank.retired.some(item => (
    typeof item === 'string' ? item === promptId : item?.id === promptId || item?.promptId === promptId
  ));
}

function createPrompt({
  runId,
  index,
  bucket,
  difficulty,
  goal,
  parameterId,
  parameter,
  targetTask,
  qualityAxis,
  exploratory = false,
}) {
  const surface = parameter?.surface || parameterId;
  const mutationHint = parameter?.possibleMutations?.[0] || 'a focused improvement';
  const scenario = exploratory
    ? createExplorationScenario({ goal, surface, mutationHint, qualityAxis })
    : createStableScenario({ goal, surface, targetTask, qualityAxis });

  return {
    id: `${runId}-${bucket}-${String(index + 1).padStart(2, '0')}`,
    text: scenario,
    parameterIds: [parameterId],
    difficulty,
    bucket,
    taxonomy: [targetTask, qualityAxis, surface].filter(Boolean),
    expectedSignals: [
      `Observes ${surface}`,
      `Should reveal differences in ${qualityAxis}`,
    ],
  };
}

function createStableScenario({ goal, surface, targetTask, qualityAxis }) {
  return [
    `I need help with this skill goal: ${goal}`,
    `Task: ${targetTask}.`,
    `Please produce the appropriate artifact for a realistic production use case, then briefly validate it for ${qualityAxis}.`,
    `Pay attention to the skill surface under test: ${surface}.`,
  ].join('\n');
}

function createExplorationScenario({ goal, surface, mutationHint, qualityAxis }) {
  return [
    `A user gives an incomplete but plausible request related to: ${goal}`,
    `They need an immediately useful response, but the request has ambiguity around ${surface}.`,
    `Handle the ambiguity, avoid over-triggering, and show how ${mutationHint} affects the final answer.`,
    `End with a compact quality check focused on ${qualityAxis}.`,
  ].join('\n');
}

function createCriteria({ qualityAxes, focusIds, parameterLookup, previousBank = null, runId, coreCriteria = null }) {
  const existingCore = Array.isArray(previousBank?.criteria)
    ? previousBank.criteria.filter(criterion => !criterion.parameterIds?.length)
    : null;
  const base = [
    {
      id: 'task_success',
      name: 'Task Success',
      description: 'The output directly satisfies the user request and produces the right kind of artifact.',
    },
    {
      id: 'workflow_clarity',
      name: 'Workflow Clarity',
      description: 'The output follows a clear, efficient sequence that a user or agent can act on.',
    },
    {
      id: 'activation_and_scope',
      name: 'Activation And Scope Control',
      description: 'The output applies the skill only when appropriate, handles ambiguity, and avoids unrelated work.',
    },
    {
      id: 'validation_usefulness',
      name: 'Validation Usefulness',
      description: 'The output includes meaningful checks that catch likely defects or gaps.',
    },
  ];

  // Locked criteria from a prior run win (stability); else model-generated core (run 0); else templates.
  const stableCriteria = existingCore?.length
    ? existingCore
    : (Array.isArray(coreCriteria) && coreCriteria.length
      ? coreCriteria.map(criterion => ({ ...criterion, stable: true }))
      : base.map(criterion => ({ ...criterion, stable: true })));

  const parameterCriteria = focusIds.slice(0, 2).map(parameterId => {
    const parameter = parameterLookup.get(parameterId);
    return {
      id: `parameter_${parameterId.replace(/[^a-zA-Z0-9]+/g, '_')}`,
      name: `Parameter Signal: ${parameter?.surface || parameterId}`,
      description: parameter?.measurementPlan || `The output reveals whether changes to ${parameterId} improved behavior.`,
      parameterIds: [parameterId],
      stable: false,
      generatedForRunId: runId,
    };
  });

  return [...stableCriteria, ...parameterCriteria].slice(0, 6).map(criterion => ({
    ...criterion,
    qualityAxes: qualityAxes.slice(0, 4),
    rubric: criterion.rubric || {
      5: 'Excellent: specific, correct, complete, and directly useful.',
      4: 'Good: useful with minor omissions.',
      3: 'Adequate: partially useful but missing important precision.',
      2: 'Weak: unclear, generic, or noticeably incomplete.',
      1: 'Poor: wrong task, harmful scope, or unusable output.',
    },
  }));
}

function getNextCriteriaVersion({ previousBank, criteria }) {
  const previousVersion = Number.isInteger(previousBank?.criteriaVersion) ? previousBank.criteriaVersion : 0;
  if (!previousBank?.criteria) return 1;
  return sameCriteriaShape(previousBank.criteria, criteria) ? previousVersion || 1 : previousVersion + 1;
}

function updateCriteriaVersions({ previousBank, criteria, criteriaVersion, runId }) {
  const versions = Array.isArray(previousBank?.criteriaVersions) ? previousBank.criteriaVersions : [];
  if (versions.some(version => version.version === criteriaVersion)) return versions;
  return [
    ...versions,
    {
      version: criteriaVersion,
      runId,
      criteriaIds: criteria.map(criterion => criterion.id),
      createdAt: new Date().toISOString(),
      changeReason: versions.length ? 'Parameter-focused criteria changed for this experiment.' : 'Initial criteria set.',
    },
  ];
}

function sameCriteriaShape(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((criterion, index) => (
    criterion.id === b[index].id &&
    JSON.stringify(criterion.parameterIds || []) === JSON.stringify(b[index].parameterIds || [])
  ));
}
