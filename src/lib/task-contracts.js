export const TASK_CONTRACT_IDS = [
  'text_standalone',
  'text_source_grounded',
  'code_standalone',
  'codebase_edit',
];

const DEFINITIONS = {
  text_standalone: {
    id: 'text_standalone',
    artifactType: 'text',
    environment: 'standalone',
    label: 'Text artifact',
    outputType: 'text',
    requiredPromptContext: ['user goal or task brief'],
    expectedArtifact: 'A complete written artifact appropriate to the skill domain.',
    insufficientContextBehavior: 'Make reasonable assumptions when safe; ask only when the missing information is truly blocking.',
    promptInstruction: 'Each user request should ask for a complete written artifact and include enough context to produce it.',
    userPromptRequirement: 'Return the appropriate text artifact, not merely meta-advice.',
    criteriaInstruction: 'The evaluated outputs are expected to be complete written artifacts appropriate to the domain.',
    invalidPromptRules: [
      'Must not require hidden source material.',
      'Must not ask for revision of a document that is not included.',
    ],
  },
  text_source_grounded: {
    id: 'text_source_grounded',
    artifactType: 'text',
    environment: 'source_grounded',
    label: 'Source-grounded text',
    outputType: 'text',
    requiredPromptContext: ['source excerpts or structured facts', 'requested transformation or analysis goal'],
    expectedArtifact: 'A written artifact grounded in the provided source material.',
    insufficientContextBehavior: 'Use only provided source material for source-dependent claims; identify genuine gaps without inventing facts.',
    promptInstruction: 'Each user request must include source material or structured facts and ask for a source-grounded written artifact.',
    userPromptRequirement: 'Use the provided source material to produce the requested artifact.',
    criteriaInstruction: 'The evaluated outputs are expected to use the provided source material faithfully and produce a complete written artifact.',
    invalidPromptRules: [
      'Must include source material, excerpts, notes, or structured facts.',
      'Must not require unstated external documents.',
    ],
  },
  code_standalone: {
    id: 'code_standalone',
    artifactType: 'code',
    environment: 'standalone',
    label: 'Standalone code',
    outputType: 'code',
    requiredPromptContext: ['implementation goal', 'platform or language when relevant'],
    expectedArtifact: 'Complete runnable code or code files that do not depend on hidden existing files.',
    insufficientContextBehavior: 'State minimal assumptions and produce a concrete standalone implementation instead of asking for repo files.',
    promptInstruction: 'Each user request must ask for self-contained production-ready code, not advice or changes to hidden existing files.',
    userPromptRequirement: 'Return complete runnable code or code files; do not ask for repository files.',
    criteriaInstruction: 'The evaluated outputs are expected to be complete runnable code artifacts. Criteria should reward completeness and penalize requests for missing repo context.',
    invalidPromptRules: [
      'Must not ask to update an existing codebase without including the relevant code.',
      'Must not imply hidden files are available.',
    ],
  },
  codebase_edit: {
    id: 'codebase_edit',
    artifactType: 'code',
    environment: 'codebase_edit',
    label: 'Existing codebase edit',
    outputType: 'code',
    requiredPromptContext: ['file tree', 'relevant source files or snippets', 'requested code change', 'constraints to preserve'],
    expectedArtifact: 'Patch-style or file-by-file code changes that modify the provided code context.',
    insufficientContextBehavior: 'Ask for missing files only when provided snippets are insufficient; otherwise patch the available files.',
    promptInstruction: 'Each user request must include a compact file tree and relevant source code snippets, then ask for production-ready changes to those files.',
    userPromptRequirement: 'Modify the provided files or return patch-style code tied to the provided file tree.',
    criteriaInstruction: 'The evaluated outputs are expected to preserve and modify provided code context. Criteria should reward faithful patches and penalize unrelated rewrites or advice-only responses.',
    invalidPromptRules: [
      'Must include a file tree.',
      'Must include at least one source file or code snippet.',
      'Must ask for changes to the provided code, not invisible files.',
    ],
  },
};

export function normalizeTaskContract(input = null, outputType = null) {
  if (typeof input === 'string') return getTaskContract(input, outputType);
  if (input && typeof input === 'object') {
    return getTaskContract(input.id || deriveTaskContractId(input.artifactType, input.environment, outputType), outputType);
  }
  return getTaskContract(deriveTaskContractId(null, null, outputType), outputType);
}

export function getTaskContract(id = 'text_standalone', outputType = null) {
  const normalizedId = TASK_CONTRACT_IDS.includes(id) ? id : deriveTaskContractId(null, null, outputType);
  const definition = DEFINITIONS[normalizedId] || DEFINITIONS.text_standalone;
  return {
    ...definition,
    requiredPromptContext: [...definition.requiredPromptContext],
    invalidPromptRules: [...definition.invalidPromptRules],
  };
}

export function taskContractOutputType(taskContract) {
  return normalizeTaskContract(taskContract).outputType;
}

export function deriveTaskContractId(artifactType = null, environment = null, outputType = null) {
  const artifact = ['text', 'code'].includes(artifactType) ? artifactType : (outputType === 'code' || outputType === 'code_visual' ? 'code' : 'text');
  const env = ['standalone', 'source_grounded', 'codebase_edit'].includes(environment) ? environment : 'standalone';
  if (artifact === 'code' && env === 'codebase_edit') return 'codebase_edit';
  if (artifact === 'text' && env === 'source_grounded') return 'text_source_grounded';
  if (artifact === 'code') return 'code_standalone';
  return 'text_standalone';
}

export function isPromptContractValid(prompt, taskContract) {
  const contract = normalizeTaskContract(taskContract);
  const text = getPromptText(prompt);
  if (!text.trim()) return false;

  if (contract.id === 'code_standalone') {
    const asksForMissingFiles = /\b(ask|tell)\s+(me|us|the user)\s+what\s+files\b/i.test(text)
      || /\b(request|ask for)\s+(the\s+)?(repo|repository|source files?|project files?)\b/i.test(text);
    if (asksForMissingFiles) return false;
    const explicitlyNoRepo = /\b(no|without)\s+(existing|current)\s+(codebase|repo|repository|app|project|files?)\b/i.test(text);
    if (explicitlyNoRepo) return true;
    return !/\b(existing|current)\s+(codebase|repo|repository|app|project|files?)\b/i.test(text)
      && !/\b(update|modify|change|patch|fix)\s+(the\s+)?(existing|current)\b/i.test(text);
  }

  if (contract.id === 'codebase_edit') {
    return /```[\s\S]*?```/.test(text)
      && /\b(file tree|files?|src\/|app\/|components?\/|index\.(?:html|js|jsx|ts|tsx)|App\.(?:js|jsx|ts|tsx))\b/i.test(text);
  }

  if (contract.id === 'text_source_grounded') {
    return /\b(source|excerpt|notes|transcript|draft|document|material|facts)\b/i.test(text)
      && (/```[\s\S]*?```/.test(text) || text.length > 500);
  }

  return !/\b(source material|attached document|provided draft|below excerpt)\b/i.test(text) || /```[\s\S]*?```/.test(text);
}

export function getPromptText(prompt) {
  return typeof prompt === 'string' ? prompt : String(prompt?.text || '');
}

export function taskContractSummary(taskContract) {
  const contract = normalizeTaskContract(taskContract);
  return {
    id: contract.id,
    artifactType: contract.artifactType,
    environment: contract.environment,
    expectedArtifact: contract.expectedArtifact,
    insufficientContextBehavior: contract.insufficientContextBehavior,
    requiredPromptContext: contract.requiredPromptContext,
    invalidPromptRules: contract.invalidPromptRules,
  };
}
