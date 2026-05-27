import { validateEvalDesign } from './schema.js';
import { callModel } from './model-client.js';
import { loadSkillPackage } from './skill-package.js';
import { isPromptContractValid, normalizeTaskContract, taskContractSummary } from './task-contracts.js';

const DEFAULT_DIFFICULTIES = ['easy', 'medium', 'medium', 'hard'];
const OUTPUT_CONTRACT_CRITERION_IDS = new Set([
  'implementation_readiness',
  'implemented_visual_output',
  'context_fidelity',
  'artifact_completeness',
  'contract_validity',
]);

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

function buildPromptGenInstruction(goal, slots, outputType = 'text', taskContract = null) {
  const contract = normalizeTaskContract(taskContract, outputType);
  const outputContract = getOutputContract(outputType, contract);
  const lines = slots.map((slot, n) => (
    `${n + 1}. difficulty=${slot.difficulty || 'medium'}; the request should involve ${slot.task || 'using the skill'}`
    + `${slot.surface ? `, with realistic ambiguity or nuance around ${slot.surface}` : ''}`
    + `; it should let a grader observe ${slot.quality || 'overall quality'} (do not mention any of this in the prompt itself).`
  ));
  return [
    'You are designing an evaluation set for an AI skill, like a careful test author.',
    `Skill goal: ${goal}`,
    `Write ${slots.length} realistic, self-contained user requests — the kind a real person would actually send to an agent using this skill.`,
    `Expected answer contract: ${outputContract.promptInstruction}`,
    `Task contract: ${JSON.stringify(taskContractSummary(contract))}`,
    `Invalid prompt rules: ${contract.invalidPromptRules.join(' ')}`,
    'Rules: each prompt must read naturally with no meta-commentary; never use phrases like "skill surface under test", "quality axis", or "validate it for". Vary tone, length, domain specifics, and difficulty across the set. Exercise the noted aspect implicitly, never by naming it. The user request must make the expected answer contract unavoidable.',
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

function buildCriteriaInstruction(goal, skillAText, skillBText, outputType = 'text', taskContract = null) {
  const contract = normalizeTaskContract(taskContract, outputType);
  const outputContract = getOutputContract(outputType, contract);
  return [
    `Skill goal: ${goal}`,
    `Expected answer contract: ${outputContract.criteriaInstruction}`,
    `Task contract: ${JSON.stringify(taskContractSummary(contract))}`,
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

export async function generateEvalCriteria({ goal, candidateA, candidateB, model, apiKeys = {}, modelClient = null, outputType = 'text', taskContract = null }) {
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
      messages: [{ role: 'user', content: buildCriteriaInstruction(goal, aText, bText, outputType, taskContract) }],
    });
    return parseCriteriaJson(raw);
  } catch {
    return null;
  }
}

export async function naturalizeEvalPrompts({ design, goal, model, apiKeys = {}, modelClient = null, outputType = 'text', taskContract = null }) {
  if (!design) return null;
  if (!model) {
    const promptIds = new Set((design.prompts || []).map(prompt => prompt.id));
    const provenance = createPromptAuthoringProvenance({
      source: 'deterministic_template',
      attemptedModel: false,
      model: null,
      totalPrompts: design.prompts?.length || 0,
    });
    applyPromptAuthoringProvenance(design, provenance, new Set(), promptIds);
    return provenance;
  }
  const contract = normalizeTaskContract(taskContract, outputType);
  const targets = design.prompts.filter(prompt => isTemplatedPrompt(prompt.text) || !prompt.reusedFromBank);
  if (targets.length === 0) {
    const provenance = createPromptAuthoringProvenance({
      source: 'reused_prompt_bank',
      attemptedModel: false,
      model,
      totalPrompts: design.prompts.length,
    });
    if (design.bank) design.bank.promptAuthoring = provenance;
    return provenance;
  }

  const slots = targets.map(prompt => ({
    task: prompt.taxonomy?.[0],
    quality: prompt.taxonomy?.[1],
    surface: prompt.taxonomy?.[2],
    difficulty: prompt.difficulty,
  }));

  const call = modelClient || callModel;
  const firstTexts = await requestNaturalizedPromptTexts({
    call,
    model,
    apiKeys,
    goal,
    slots,
    outputType,
    contract,
    count: targets.length,
  });
  if (!firstTexts) {
    const fallbackIds = new Set(targets.map(prompt => prompt.id));
    const provenance = createPromptAuthoringProvenance({
      source: 'deterministic_fallback',
      attemptedModel: true,
      model,
      totalPrompts: design.prompts.length,
      modelAttemptCount: 1,
      fallbackPromptIds: targets.map(prompt => prompt.id),
      failureReason: 'model_prompt_generation_failed_or_unparseable',
    });
    applyPromptAuthoringProvenance(design, provenance, fallbackIds, fallbackIds);
    return provenance;
  }

  let selectedTexts = firstTexts;
  const initialInvalidIndexes = getInvalidPromptIndexes({ targets, texts: selectedTexts, contract });
  let invalidIndexes = initialInvalidIndexes;
  if (initialInvalidIndexes.length > 0) {
    const repairedTexts = await requestNaturalizedPromptTexts({
      call,
      model,
      apiKeys,
      goal,
      slots,
      outputType,
      contract,
      count: targets.length,
      repairHint: [
        'The previous draft violated the task contract for one or more prompts.',
        `Rejected prompt numbers: ${invalidIndexes.map(index => index + 1).join(', ')}`,
        'Regenerate all prompts. Every prompt must satisfy the required context and invalid-prompt rules exactly.',
      ].join('\n'),
    });
    if (repairedTexts) {
      selectedTexts = repairedTexts;
      invalidIndexes = getInvalidPromptIndexes({ targets, texts: selectedTexts, contract });
    }
  }

  const replacement = new Map();
  const fallbackIds = new Set();
  targets.forEach((prompt, index) => {
    const fellBack = invalidIndexes.includes(index);
    if (fellBack) fallbackIds.add(prompt.id);
    replacement.set(prompt.id, {
      text: fellBack ? prompt.text : selectedTexts[index],
      promptAuthoring: {
        source: fellBack ? 'deterministic_fallback' : 'model_naturalized',
        model,
        attemptedModel: true,
        repaired: initialInvalidIndexes.length > 0,
      },
    });
  });
  const apply = list => (Array.isArray(list)
    ? list.map(prompt => (replacement.has(prompt.id) ? { ...prompt, ...replacement.get(prompt.id) } : prompt))
    : list);

  design.prompts = apply(design.prompts);
  if (design.bank) {
    design.bank.stablePrompts = apply(design.bank.stablePrompts);
    design.bank.provisionalPrompts = apply(design.bank.provisionalPrompts);
    design.bank.explorationPrompts = apply(design.bank.explorationPrompts);
  }
  const provenance = createPromptAuthoringProvenance({
    source: fallbackIds.size === targets.length ? 'deterministic_fallback' : fallbackIds.size ? 'mixed' : 'model_naturalized',
    attemptedModel: true,
    model,
    totalPrompts: design.prompts.length,
    modelAttemptCount: initialInvalidIndexes.length > 0 ? 2 : 1,
    initialInvalidPromptIds: initialInvalidIndexes.map(index => targets[index].id),
    fallbackPromptIds: [...fallbackIds],
    repairedPromptIds: initialInvalidIndexes
      .map(index => targets[index])
      .filter(prompt => !fallbackIds.has(prompt.id))
      .map(prompt => prompt.id),
  });
  applyPromptAuthoringProvenance(design, provenance, fallbackIds);
  return provenance;
}

async function requestNaturalizedPromptTexts({ call, model, apiKeys, goal, slots, outputType, contract, count, repairHint = '' }) {
  try {
    const raw = await call({
      model,
      apiKeys,
      jsonMode: true,
      maxTokens: 2400,
      systemPrompt: 'You generate realistic, high-quality evaluation prompts for AI skills. Output strict JSON only.',
      messages: [{
        role: 'user',
        content: [
          buildPromptGenInstruction(goal, slots, outputType, contract),
          repairHint,
        ].filter(Boolean).join('\n\n'),
      }],
    });
    return parsePromptArray(raw, count);
  } catch {
    return null;
  }
}

function getInvalidPromptIndexes({ targets, texts, contract }) {
  const invalid = [];
  targets.forEach((prompt, index) => {
    const nextPrompt = { ...prompt, text: texts[index], taskContract: contract };
    if (!isPromptContractValid(nextPrompt, contract)) invalid.push(index);
  });
  return invalid;
}

function createPromptAuthoringProvenance({
  source,
  attemptedModel,
  model,
  totalPrompts,
  modelAttemptCount = 0,
  initialInvalidPromptIds = [],
  repairedPromptIds = [],
  fallbackPromptIds = [],
  failureReason = null,
}) {
  return {
    source,
    attemptedModel,
    model,
    modelAttemptCount,
    totalPrompts,
    initialInvalidPromptIds,
    repairedPromptIds,
    fallbackPromptIds,
    fallbackPromptCount: fallbackPromptIds.length,
    failureReason,
  };
}

function applyPromptAuthoringProvenance(design, provenance, fallbackIds, overrideIds = new Set()) {
  if (!design) return;
  const mark = prompt => {
    if (prompt.promptAuthoring && !overrideIds.has(prompt.id)) return prompt;
    const targeted = overrideIds.has(prompt.id) || fallbackIds.has(prompt.id);
    return {
      ...prompt,
      promptAuthoring: {
        source: fallbackIds.has(prompt.id)
          ? 'deterministic_fallback'
          : targeted ? provenance.source : 'reused_prompt_bank',
        model: provenance.model,
        attemptedModel: provenance.attemptedModel,
        repaired: provenance.repairedPromptIds.includes(prompt.id),
      },
    };
  };
  design.prompts = Array.isArray(design.prompts) ? design.prompts.map(mark) : design.prompts;
  if (design.bank) {
    design.bank.promptAuthoring = provenance;
    design.bank.stablePrompts = Array.isArray(design.bank.stablePrompts) ? design.bank.stablePrompts.map(mark) : design.bank.stablePrompts;
    design.bank.provisionalPrompts = Array.isArray(design.bank.provisionalPrompts) ? design.bank.provisionalPrompts.map(mark) : design.bank.provisionalPrompts;
    design.bank.explorationPrompts = Array.isArray(design.bank.explorationPrompts) ? design.bank.explorationPrompts.map(mark) : design.bank.explorationPrompts;
  }
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
  outputType = 'text',
  taskContract = null,
}) {
  const contract = normalizeTaskContract(taskContract, outputType);
  const outputContract = getOutputContract(outputType, contract);
  const promptBank = isPromptBankCompatible(previousBank, outputType, contract) ? previousBank : null;
  const focusIds = experimentPlan.focusParameterIds.slice(0, 3);
  const qualityAxes = Array.isArray(ontology?.qualityAxes) && ontology.qualityAxes.length
    ? ontology.qualityAxes
    : ['activation precision', 'workflow clarity', 'validation usefulness'];
  const targetTasks = Array.isArray(ontology?.targetTasks) && ontology.targetTasks.length
    ? ontology.targetTasks
    : ['create a useful skill output', 'handle ambiguous requests', 'validate output quality'];
  const parameterLookup = new Map((parameterization?.parameters || []).map(parameter => [parameter.id, parameter]));

  const reusedStable = Array.isArray(promptBank?.stablePrompts)
    ? promptBank.stablePrompts
      .filter(prompt => !isRetiredPrompt(promptBank, prompt.id))
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
        outputType: contract.outputType,
        taskContract: contract,
        history,
      });
    }),
  ];

  const activePriorProvisional = Array.isArray(promptBank?.provisionalPrompts)
    ? promptBank.provisionalPrompts.filter(prompt => !isRetiredPrompt(promptBank, prompt.id))
    : [];
  const reusedProvisional = activePriorProvisional
    .slice(0, explorationPromptCount)
    .map(prompt => ({
      ...prompt,
      bucket: 'provisional',
      status: 'provisional',
      reusedFromBank: true,
      verificationTarget: 'champion_gate',
    }));

  const freshExplorationCount = Math.max(0, explorationPromptCount - reusedProvisional.length);
  const exploration = Array.from({ length: freshExplorationCount }, (_, offset) => {
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
      outputType: contract.outputType,
      taskContract: contract,
      history,
      exploratory: true,
    });
  });
  const criteria = createCriteria({ qualityAxes, focusIds, parameterLookup, previousBank: promptBank, runId, coreCriteria, outputType: contract.outputType, taskContract: contract });
  const criteriaVersion = getNextCriteriaVersion({ previousBank: promptBank, criteria });
  const retired = Array.isArray(promptBank?.retired) ? promptBank.retired : [];
  const priorExploration = Array.isArray(promptBank?.explorationPrompts) ? promptBank.explorationPrompts : [];
  const prompts = [...stable, ...reusedProvisional, ...exploration];

  const design = validateEvalDesign({
    runId,
    prompts,
    criteria,
    bank: {
      version: 3,
      createdAt: promptBank?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentRunId: runId,
      stablePromptCount,
      explorationPromptCount,
      outputType: contract.outputType,
      taskContractId: contract.id,
      taskContract: contract,
      stablePromptIds: stable.map(prompt => prompt.id),
      provisionalPromptIds: activePriorProvisional.map(prompt => prompt.id),
      explorationPromptIds: exploration.map(prompt => prompt.id),
      stablePrompts: stable.map(prompt => ({ ...prompt, reusedFromBank: undefined })),
      provisionalPrompts: activePriorProvisional,
      explorationPrompts: [...priorExploration, ...exploration],
      retired,
      promptEvidence: promptBank?.promptEvidence || {},
      criteria,
      promptAuthoring: getInitialPromptAuthoring({ promptBank, prompts }),
      criteriaAuthoring: getCriteriaAuthoring({ promptBank, coreCriteria, criteria }),
      criteriaVersion,
      criteriaVersions: updateCriteriaVersions({ previousBank: promptBank, criteria, criteriaVersion, runId }),
      designNotes: [
        'Stable prompts exercise recurring skill quality axes.',
        'Exploration prompts target the current experiment plan.',
        outputContract.designNote,
        'Candidate creators should receive taxonomy and quality axes, not this concrete prompt batch.',
      ],
    },
  });

  return design;
}

function getInitialPromptAuthoring({ promptBank, prompts }) {
  const totalPrompts = prompts.length;
  const reusedCount = prompts.filter(prompt => prompt.reusedFromBank).length;
  const freshCount = totalPrompts - reusedCount;
  if (reusedCount && !freshCount) {
    return promptBank?.promptAuthoring || createPromptAuthoringProvenance({
      source: 'reused_prompt_bank',
      attemptedModel: false,
      model: null,
      totalPrompts,
    });
  }
  if (reusedCount && freshCount) {
    return createPromptAuthoringProvenance({
      source: 'mixed',
      attemptedModel: false,
      model: null,
      totalPrompts,
    });
  }
  return createPromptAuthoringProvenance({
    source: 'deterministic_template',
    attemptedModel: false,
    model: null,
    totalPrompts,
  });
}

function getCriteriaAuthoring({ promptBank, coreCriteria, criteria }) {
  if (promptBank?.criteria?.length) {
    return promptBank.criteriaAuthoring || {
      source: 'reused_prompt_bank',
      modelGeneratedCount: 0,
      deterministicCount: criteria.length,
    };
  }
  const modelGeneratedCount = Array.isArray(coreCriteria) ? coreCriteria.length : 0;
  return {
    source: modelGeneratedCount ? 'model_generated_plus_contract' : 'deterministic_template',
    modelGeneratedCount,
    deterministicCount: Math.max(0, criteria.length - modelGeneratedCount),
  };
}

function isRetiredPrompt(bank, promptId) {
  return Array.isArray(bank?.retired) && bank.retired.some(item => (
    typeof item === 'string' ? item === promptId : item?.id === promptId || item?.promptId === promptId
  ));
}

function isPromptBankCompatible(previousBank, outputType, taskContract = null) {
  if (!previousBank) return false;
  const contract = normalizeTaskContract(taskContract, outputType);
  const bankOutputType = previousBank.outputType || 'text';
  const bankTaskContractId = previousBank.taskContractId || previousBank.taskContract?.id || null;
  return bankOutputType === contract.outputType && bankTaskContractId === contract.id;
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
  outputType,
  taskContract = null,
  exploratory = false,
}) {
  const contract = normalizeTaskContract(taskContract, outputType);
  const surface = parameter?.surface || parameterId;
  const mutationHint = parameter?.possibleMutations?.[0] || 'a focused improvement';
  const scenario = exploratory
    ? createExplorationScenario({ goal, surface, mutationHint, qualityAxis, outputType: contract.outputType, taskContract: contract })
    : createStableScenario({ goal, surface, targetTask, qualityAxis, outputType: contract.outputType, taskContract: contract });

  return {
    id: `${runId}-${bucket}-${String(index + 1).padStart(2, '0')}`,
    text: scenario,
    parameterIds: [parameterId],
    difficulty,
    bucket,
    outputType: contract.outputType,
    taskContractId: contract.id,
    taskContract: contract,
    status: bucket,
    origin: bucket === 'stable' ? 'ontology_seed' : 'experiment_probe',
    createdAtRunId: runId,
    taxonomy: [targetTask, qualityAxis, surface].filter(Boolean),
    expectedSignals: [
      `Observes ${surface}`,
      `Should reveal differences in ${qualityAxis}`,
    ],
    promptAuthoring: {
      source: 'deterministic_template',
      attemptedModel: false,
      model: null,
      repaired: false,
    },
  };
}

function createStableScenario({ goal, surface, targetTask, qualityAxis, outputType, taskContract = null }) {
  const contract = normalizeTaskContract(taskContract, outputType);
  return createContractScenario({ contract, goal, surface, targetTask, qualityAxis, exploratory: false });
}

function createExplorationScenario({ goal, surface, mutationHint, qualityAxis, outputType, taskContract = null }) {
  const contract = normalizeTaskContract(taskContract, outputType);
  return createContractScenario({ contract, goal, surface, targetTask: mutationHint, qualityAxis, exploratory: true });
}

function createContractScenario({ contract, goal, surface, targetTask, qualityAxis, exploratory }) {
  const outputContract = getOutputContract(contract.outputType, contract);
  const intro = exploratory
    ? `A user gives an incomplete but plausible request related to: ${goal}`
    : `I need help with this skill goal: ${goal}`;
  const taskLine = exploratory
    ? `They need an immediately useful response, with realistic ambiguity around ${surface}.`
    : `Task: ${targetTask}.`;

  if (contract.id === 'code_standalone') {
    return [
      'Build a self-contained implementation for a realistic production use case.',
      'Create complete runnable code in the language or framework that best fits the request; include all files or code blocks needed to run it.',
      'There is no existing repository context; make reasonable assumptions and do not ask me to provide files.',
      `The result should support the broader skill goal: ${goal}`,
      `Emphasize ${surface} and include a compact validation check for ${qualityAxis}.`,
    ].join('\n');
  }

  if (contract.id === 'codebase_edit') {
    return [
      'I need you to update this existing code, preserving the current structure and public behavior unless the request says otherwise.',
      '',
      'File tree:',
      '```text',
      'src/summary.js',
      'src/index.js',
      '```',
      '',
      '`src/summary.js`:',
      '```js',
      'export function summarizeItems(items) {',
      '  if (!items || items.length === 0) return "No items";',
      '  return items.map(item => item.title).join(", ");',
      '}',
      '```',
      '',
      '`src/index.js`:',
      '```js',
      'import { summarizeItems } from "./summary.js";',
      '',
      'console.log(summarizeItems([{ title: "First" }, { title: "Second" }]));',
      '```',
      '',
      `Make the implementation more production-ready for ${goal}. Keep changes tied to the provided files, emphasize ${surface}, and include a compact validation check for ${qualityAxis}.`,
    ].join('\n');
  }

  if (contract.id === 'text_source_grounded') {
    return [
      intro,
      taskLine,
      '',
      'Source material:',
      '```text',
      'Audience: busy readers who need a clear, useful artifact without extra background.',
      'Goal: communicate the main idea accurately, concretely, and without unsupported claims.',
      'Constraint: keep the result concise and preserve important caveats.',
      'Current draft: The project helps people get better results, but the explanation is too generic.',
      '```',
      '',
      `Use only the source material above to produce the requested artifact. Emphasize ${surface} and briefly validate it for ${qualityAxis}.`,
    ].join('\n');
  }

  return [
    intro,
    taskLine,
    `Output requirement: ${outputContract.userPromptRequirement}`,
    `Please produce the appropriate artifact for a realistic production use case, then briefly validate it for ${qualityAxis}.`,
    `Pay attention to: ${surface}.`,
  ].join('\n');
}

function createCriteria({ qualityAxes, focusIds, parameterLookup, previousBank = null, runId, coreCriteria = null, outputType = 'text', taskContract = null }) {
  const contract = normalizeTaskContract(taskContract, outputType);
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

  const contractCriteria = createOutputContractCriteria(contract);
  const stableWithoutOutputContract = stableCriteria
    .filter(criterion => !OUTPUT_CONTRACT_CRITERION_IDS.has(criterion.id));
  const lockedContractCriteria = contractCriteria.map(criterion => (
    stableCriteria.find(stable => stable.id === criterion.id) || criterion
  ));
  const stableCore = stableWithoutOutputContract.slice(0, 1);
  const allCriteria = [...stableCore, ...lockedContractCriteria, ...parameterCriteria];

  return allCriteria.slice(0, 6).map(criterion => ({
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

export function getOutputContract(outputType = 'text', taskContract = null) {
  const contract = normalizeTaskContract(taskContract, outputType);
  if (contract.outputType === 'code') {
    return {
      label: contract.label,
      promptInstruction: contract.promptInstruction,
      criteriaInstruction: contract.criteriaInstruction,
      userPromptRequirement: contract.userPromptRequirement,
      creatorInstruction: `The skill must train agents to produce ${contract.expectedArtifact}`,
      designNote: `Task contract: ${contract.id}; eval prompts require ${contract.expectedArtifact}`,
    };
  }
  return {
    label: contract.label,
    promptInstruction: contract.promptInstruction,
    criteriaInstruction: contract.criteriaInstruction,
    userPromptRequirement: contract.userPromptRequirement,
    creatorInstruction: `The skill must train agents to produce ${contract.expectedArtifact}`,
    designNote: `Task contract: ${contract.id}; eval prompts require ${contract.expectedArtifact}`,
  };
}

function createOutputContractCriteria(taskContract) {
  const contract = normalizeTaskContract(taskContract);
  return [
    {
      id: 'context_fidelity',
      name: 'Context Fidelity',
      description: contract.id === 'codebase_edit'
        ? 'The output preserves and modifies the provided file context instead of inventing an unrelated codebase.'
        : 'The output respects the prompt context and does not demand unavailable hidden context.',
      stable: true,
    },
    {
      id: 'artifact_completeness',
      name: 'Artifact Completeness',
      description: `The output provides the expected artifact: ${contract.expectedArtifact}`,
      stable: true,
    },
    {
      id: 'contract_validity',
      name: 'Contract Validity',
      description: `The output follows the ${contract.id} task environment, including insufficient-context behavior: ${contract.insufficientContextBehavior}`,
      stable: true,
    },
  ];
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
