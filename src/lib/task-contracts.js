export const TASK_CONTRACT_IDS = [
  'text_standalone',
  'text_source_grounded',
  'code_standalone',
  'code_visual_standalone',
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
      'Must not refer to an outline, script, treatment, draft, excerpt, or other source as below, attached, pasted, or provided unless that material is included in the prompt.',
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
  code_visual_standalone: {
    id: 'code_visual_standalone',
    artifactType: 'code',
    environment: 'standalone',
    label: 'Standalone visual code',
    outputType: 'code_visual',
    requiredPromptContext: ['implementation goal', 'screen or component context', 'visual and interaction expectations'],
    expectedArtifact: 'A complete self-contained browser-renderable implementation with visible UI.',
    insufficientContextBehavior: 'State minimal assumptions and produce a concrete standalone browser implementation instead of asking for repo files.',
    promptInstruction: 'Each user request must ask for a complete browser-renderable implementation as a single standalone HTML document with inline CSS and JavaScript.',
    userPromptRequirement: 'Return one complete standalone HTML document with inline CSS and JavaScript; do not return visual advice only.',
    criteriaInstruction: 'The evaluated outputs are expected to be complete browser-renderable UI implementations. Criteria should reward renderability, visual quality, responsiveness, and implementation completeness.',
    invalidPromptRules: [
      'Must not require hidden repo files.',
      'Must not ask for design recommendations only.',
      'Must not ask for a moodboard, direction, critique, or advice instead of implementation.',
      'Must request a single self-contained HTML document with visible UI.',
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
  if (outputType === 'code_visual') return 'code_visual_standalone';
  const artifact = ['text', 'code'].includes(artifactType) ? artifactType : (outputType === 'code' ? 'code' : 'text');
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

  if (contract.id === 'code_visual_standalone') {
    const asksForMissingFiles = /\b(ask|tell)\s+(me|us|the user)\s+what\s+files\b/i.test(text)
      || /\b(request|ask for)\s+(the\s+)?(repo|repository|source files?|project files?)\b/i.test(text);
    if (asksForMissingFiles) return false;
    if (/\b(existing|current)\s+(codebase|repo|repository|app|project|files?)\b/i.test(text)) return false;
    if (/\b(recommend|recommendation|advise|advice|critique|moodboard|visual direction|design direction)\b/i.test(text)) return false;
    const asksForStandalone = /\b(single|one|self-contained|standalone|single-file|single file)\b/i.test(text);
    const asksForBrowserArtifact = /\b(html|HTML|webpage|web page|page|screen|component|interface|dashboard|landing page)\b/i.test(text);
    const asksForInlineWebCode = /\binline\s+(css|CSS)\b/i.test(text)
      || /\b(css|CSS)[\s,]*(?:and\s+)?(javascript|JavaScript|JS|js)\b/i.test(text)
      || /\b(html|HTML)[\s,/+]*(css|CSS)[\s,/+]*(?:and\s+)?(javascript|JavaScript|JS|js)\b/i.test(text);
    const asksForVisibleImplementation = /\b(build|create|implement|code|write|make|design)\b/i.test(text)
      && /\b(browser-renderable|renderable|visible UI|UI|interface|component|page|screen|dashboard|landing page|webpage|web page)\b/i.test(text);
    return asksForStandalone && asksForBrowserArtifact && asksForInlineWebCode && asksForVisibleImplementation;
  }

  if (contract.id === 'codebase_edit') {
    return /```[\s\S]*?```/.test(text)
      && /\b(file tree|files?|src\/|app\/|components?\/|index\.(?:html|js|jsx|ts|tsx)|App\.(?:js|jsx|ts|tsx))\b/i.test(text);
  }

  if (contract.id === 'text_source_grounded') {
    return /\b(source|excerpt|notes|transcript|draft|document|material|facts)\b/i.test(text)
      && (/```[\s\S]*?```/.test(text) || text.length > 500);
  }

  if (hasDanglingTextSourceReference(text) && !hasEmbeddedTextSourceMaterial(text)) return false;
  return true;
}

export function getPromptText(prompt) {
  return typeof prompt === 'string' ? prompt : String(prompt?.text || '');
}

function hasDanglingTextSourceReference(text) {
  return /\b(?:attached|provided|pasted|included|following|below)\s+(?:source material|document|draft|excerpt|outline|treatment|screenplay|script|scene list|notes|transcript|brief|material|text)\b/i.test(text)
    || /\b(?:source material|document|draft|excerpt|outline|treatment|screenplay|script|scene list|notes|transcript|brief|material|text)\s+(?:attached|provided|pasted|included|below|following)\b/i.test(text)
    || /\b(?:read|analy[sz]e|review|revise|rewrite|diagnose|compare|break\s*down|label|identify)\s+(?:the\s+)?(?:attached|provided|pasted|following|below)\b/i.test(text)
    || /\b(?:read|analy[sz]e|review|revise|rewrite|diagnose|compare|break\s*down|label|identify)\b[\s\S]{0,80}\b(?:this|the|my|our)\s+(?:screenplay|script|outline|treatment|draft|scene list|excerpt|document)\b/i.test(text)
    || /\b(?:this|the|my|our)\s+(?:screenplay|script|outline|treatment|draft|scene list|excerpt|document)(?:'s)?\s+(?:structure|beats?|scenes?|pages?|source|material|turning points?|reversals?|draft)\b/i.test(text)
    || /\b(?:actual beats?|what is actually on the page|on the page|present in the draft)\b/i.test(text);
}

function hasEmbeddedTextSourceMaterial(text) {
  if (/```[\s\S]*?```/.test(text)) return true;
  const marker = /(?:^|\n)\s*(?:source material|document|draft|excerpt|outline|treatment|screenplay|script|scene list|notes|transcript|brief|material|text)\s*:\s*/i.exec(text);
  if (!marker) return false;
  const after = text.slice(marker.index + marker[0].length).trim();
  if (after.length < 80) return false;
  return /\n\s*(?:[-*]|\d+[.)])\s+\S/.test(after)
    || /\b(?:act|scene|opening|setup|midpoint|climax|ending|resolution|beat|sequence)\b/i.test(after)
    || after.split(/[.!?]\s+/).filter(Boolean).length >= 3;
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
