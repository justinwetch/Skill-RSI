import { loadSkillPackage } from './skill-package.js';
import { validateAdversarialReview } from './schema.js';
import { callModel } from './model-client.js';

const UNSAFE_SCRIPT_PATTERNS = [
  { pattern: /\brm\s+-rf\b/, message: 'script contains rm -rf' },
  { pattern: /\bcurl\b[\s\S]{0,80}\|\s*(?:sh|bash|zsh)\b/, message: 'script pipes downloaded content into a shell' },
  { pattern: /\b(?:eval|exec)\s*\(/, message: 'script uses eval/exec-style execution' },
  { pattern: /\bchild_process\b/, message: 'script imports child_process' },
  { pattern: /\bos\.system\s*\(/, message: 'script uses os.system' },
  { pattern: /\bsubprocess\.(?:run|Popen|call)\s*\(/, message: 'script uses subprocess execution' },
];

export async function reviewCandidatePackage({
  candidate,
  experimentPlan,
  evalDesign = null,
  maxSkillLines = 220,
  maxPackageFiles = 40,
  goal = null,
  model = null,
  apiKeys = {},
  modelClient = null,
  agentSkillsStandard = null,
}) {
  const skillPackage = await loadSkillPackage(candidate.skillPath);
  const blockingIssues = [];
  const recommendedEdits = [];
  const nonIssues = [];

  for (const error of skillPackage.validation.errors) {
    blockingIssues.push(issue({
      severity: 'blocking',
      surface: 'skill-spec',
      message: error,
      recommendation: 'Regenerate or repair the skill package before evaluation.',
    }));
  }

  const entrypoint = skillPackage.files.find(file => file.path === 'SKILL.md');
  if (entrypoint) {
    reviewEntrypoint({ entrypoint, candidate, blockingIssues, recommendedEdits, maxSkillLines });
  }

  if (skillPackage.files.length > maxPackageFiles) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'package-size',
      message: `Package has ${skillPackage.files.length} files, above the review budget of ${maxPackageFiles}.`,
      recommendation: 'Move only durable reference material into the package and keep generated artifacts out.',
    }));
  } else {
    nonIssues.push(`Package file count is within budget (${skillPackage.files.length}/${maxPackageFiles}).`);
  }

  reviewScripts({ skillPackage, blockingIssues, recommendedEdits, nonIssues });
  reviewExperimentAlignment({ candidate, experimentPlan, recommendedEdits, nonIssues });
  reviewEvalLeakage({ skillPackage, evalDesign, blockingIssues, recommendedEdits, nonIssues });

  let overfittingRisk = estimateOverfittingRisk({ skillPackage, evalDesign, recommendedEdits });

  // Deterministic checks above are a safety floor (spec compliance, unsafe scripts, eval
  // leakage). When a model is available, layer the spec's adversarial critique (§6.6) on top:
  // substantive attacks on trigger precision, constraints, edge cases, packaging, overfitting.
  if (model) {
    const modelReview = await modelAdversarialReview({
      skillPackage, candidate, experimentPlan, goal, model, apiKeys, modelClient, agentSkillsStandard,
    });
    if (modelReview) {
      // The model critique is ADVISORY: it informs the revision and is surfaced in the UI, but it
      // never hard-gates an autonomous run. Only the deterministic safety/spec/leakage checks above
      // can block evaluation — so a subjective design opinion can never dead-end the loop.
      recommendedEdits.push(...modelReview.blockingIssues, ...modelReview.recommendedEdits);
      nonIssues.push(...modelReview.nonIssues);
      overfittingRisk = maxRisk(overfittingRisk, modelReview.overfittingRisk);
    }
  }

  const review = validateAdversarialReview({
    candidateId: candidate.candidateId,
    blockingIssues,
    recommendedEdits,
    nonIssues,
    overfittingRisk,
    reviewer: model ? 'deterministic+model' : 'deterministic',
    approveForEval: blockingIssues.length === 0,
    packageSummary: {
      hash: skillPackage.hash,
      fileCount: skillPackage.files.length,
      omittedFileCount: skillPackage.omittedFiles.length,
      diagnostics: skillPackage.diagnostics,
    },
  });

  return review;
}

function reviewEntrypoint({ entrypoint, candidate, blockingIssues, recommendedEdits, maxSkillLines }) {
  const lines = entrypoint.content.split('\n').length;
  if (lines > maxSkillLines) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'progressive-disclosure',
      message: `SKILL.md is ${lines} lines, above the review budget of ${maxSkillLines}.`,
      recommendation: 'Move detailed examples or domain notes into references and leave concise loading cues in SKILL.md.',
    }));
  }

  const frontmatter = parseFrontmatter(entrypoint.content);

  // Flag frontmatter keys that are not part of the Agent Skills spec (advisory, not blocking).
  const allowedKeys = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
  const extraKeys = frontmatter ? Object.keys(frontmatter).filter(key => !allowedKeys.has(key)) : [];
  if (extraKeys.length) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'frontmatter-spec',
      message: `Frontmatter has non-standard top-level key(s): ${extraKeys.join(', ')}. The Agent Skills spec allows only name, description, license, compatibility, metadata, and allowed-tools.`,
      recommendation: 'Remove them, or move custom data such as author/version under the metadata map.',
    }));
  }

  const description = frontmatter?.description || '';
  if (description.length < 40) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'activation-metadata',
      message: 'Frontmatter description is too short to encode precise activation behavior.',
      recommendation: 'Make the description specific to the skill goal and expected user intent.',
    }));
  }
  if (/use when applying .*skill rsi candidate/i.test(description)) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'activation-metadata',
      message: 'Frontmatter description still reads like a Skill RSI test candidate rather than the target skill.',
      recommendation: 'Rewrite the description for the end user of the generated skill.',
    }));
  }
  if (!entrypoint.content.match(/when to use|trigger|use this skill|do not use/i)) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'trigger-boundaries',
      message: 'SKILL.md does not clearly define activation or non-activation boundaries.',
      recommendation: 'Add concise in-scope and out-of-scope guidance.',
    }));
  }
  if (!entrypoint.content.match(/validat|check|test|verify|review/i)) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'validation-strategy',
      message: 'SKILL.md does not include an obvious validation step.',
      recommendation: 'Add a compact final check aligned to the skill output contract.',
    }));
  }
  if (candidate.changedParameterIds.length === 0) {
    blockingIssues.push(issue({
      severity: 'blocking',
      surface: 'candidate-metadata',
      message: 'Candidate metadata lists no changed parameters.',
      recommendation: 'Regenerate candidate metadata with the experiment focus parameters.',
    }));
  }
}

function reviewScripts({ skillPackage, blockingIssues, recommendedEdits, nonIssues }) {
  const scripts = skillPackage.files.filter(file => file.role === 'script');
  if (!scripts.length) {
    nonIssues.push('No generated scripts are present.');
    return;
  }

  for (const script of scripts) {
    for (const { pattern, message } of UNSAFE_SCRIPT_PATTERNS) {
      if (pattern.test(script.content)) {
        blockingIssues.push(issue({
          severity: 'blocking',
          surface: `script:${script.path}`,
          message,
          recommendation: 'Remove unsafe execution behavior or move it behind an explicit sandboxed tool contract.',
        }));
      }
    }
  }

  recommendedEdits.push(issue({
    severity: 'recommended',
    surface: 'script-policy',
    message: `Package includes ${scripts.length} script file(s).`,
    recommendation: 'Confirm scripts are deterministic helpers and are not required during ordinary skill activation.',
  }));
}

function reviewExperimentAlignment({ candidate, experimentPlan, recommendedEdits, nonIssues }) {
  const focus = new Set(experimentPlan.focusParameterIds || []);
  const changed = new Set(candidate.changedParameterIds || []);
  const overlap = [...changed].filter(id => focus.has(id));
  if (!overlap.length) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'experiment-alignment',
      message: 'Candidate changedParameterIds do not overlap the experiment focus parameters.',
      recommendation: 'Align candidate metadata and implementation to the A/B experiment plan.',
    }));
  } else {
    nonIssues.push(`Candidate metadata overlaps focus parameters: ${overlap.join(', ')}.`);
  }
}

function reviewEvalLeakage({ skillPackage, evalDesign, blockingIssues, recommendedEdits, nonIssues }) {
  if (!evalDesign) {
    nonIssues.push('Eval batch was not generated before review, so concrete prompt leakage was not checked.');
    return;
  }

  const content = skillPackage.files
    .filter(file => file.kind === 'text')
    .map(file => file.content)
    .join('\n');
  const leakedPromptIds = evalDesign.prompts
    .map(prompt => prompt.id)
    .filter(id => content.includes(id));
  const leakedPromptTexts = evalDesign.prompts
    .map(prompt => prompt.text)
    .filter(text => typeof text === 'string' && text.trim().length >= 40)
    .filter(text => content.includes(text.trim()));

  if (leakedPromptIds.length || leakedPromptTexts.length) {
    blockingIssues.push(issue({
      severity: 'blocking',
      surface: 'eval-leakage',
      message: [
        leakedPromptIds.length ? `Candidate package mentions eval prompt IDs: ${leakedPromptIds.join(', ')}.` : null,
        leakedPromptTexts.length ? `Candidate package includes ${leakedPromptTexts.length} exact eval prompt text snippet(s).` : null,
      ].filter(Boolean).join(' '),
      recommendation: 'Regenerate the candidate without concrete eval prompt identifiers.',
    }));
  } else {
    nonIssues.push('No concrete eval prompt IDs were found in the candidate package.');
  }

  if (/score|rubric|judge|eval prompt|benchmark/i.test(content)) {
    recommendedEdits.push(issue({
      severity: 'recommended',
      surface: 'eval-overfitting',
      message: 'Candidate package references eval-like language.',
      recommendation: 'Ensure the skill optimizes user outcomes, not the evaluator surface.',
    }));
  }
}

function estimateOverfittingRisk({ skillPackage, evalDesign, recommendedEdits }) {
  const content = skillPackage.files
    .filter(file => file.kind === 'text')
    .map(file => file.content)
    .join('\n');
  if (evalDesign?.prompts?.some(prompt => content.includes(prompt.text.slice(0, 40)))) return 'high';
  if (recommendedEdits.some(edit => edit.surface === 'eval-overfitting')) return 'medium';
  return 'low';
}

function issue({ severity, surface, message, recommendation }) {
  return { severity, surface, message, recommendation };
}

async function modelAdversarialReview({ skillPackage, candidate, experimentPlan, goal, model, apiKeys, modelClient, agentSkillsStandard }) {
  const entrypoint = skillPackage.files.find(file => file.path === 'SKILL.md');
  if (!entrypoint) return null;
  const manifest = skillPackage.files.map(file => `- ${file.path} (${file.role})`).join('\n');
  const call = modelClient || callModel;
  try {
    const raw = await call({
      model,
      apiKeys,
      jsonMode: true,
      maxTokens: 1800,
      systemPrompt: 'You are an exacting adversarial reviewer of Agent Skills. Output strict JSON only.',
      messages: [{ role: 'user', content: buildReviewPrompt({ goal, experimentPlan, candidate, entrypoint, manifest, agentSkillsStandard }) }],
    });
    return parseReviewJson(raw);
  } catch {
    return null;
  }
}

function buildReviewPrompt({ goal, experimentPlan, candidate, entrypoint, manifest, agentSkillsStandard }) {
  return [
    'You are an adversarial reviewer for Skill RSI. Review this candidate Agent Skill before it is evaluated — attack it, do not praise it.',
    goal ? `Skill goal: ${goal}` : '',
    experimentPlan?.experimentQuestion ? `This round is testing: ${experimentPlan.experimentQuestion}` : '',
    `Candidate: ${candidate.candidateId}${candidate.strategy ? ` — strategy: ${candidate.strategy}` : ''}`,
    `Package files:\n${manifest}`,
    `SKILL.md:\n"""\n${entrypoint.content}\n"""`,
    agentSkillsStandard ? `\nThe package must conform to the Agent Skills standard below. Flag any deviation (non-standard frontmatter keys, oversized SKILL.md, missing progressive disclosure, bad name/description).\n=== AGENT SKILLS STANDARD ===\n${agentSkillsStandard}\n=== END STANDARD ===` : '',
    '',
    'Find the real weaknesses across: conformance to the Agent Skills standard above, trigger precision (when it should and should not activate), over- or under-constraint, missing edge cases, workflow gaps, decision heuristics, output-contract clarity, reference/packaging choices, progressive-disclosure bloat, security, and overfitting to an evaluator rather than real users.',
    'Reserve blockingIssues for genuine spec, safety, or correctness breakers that must be fixed before evaluation; everything else is a recommendedEdit. Be specific and concise; do not invent problems that are not in the package.',
    'Respond ONLY as JSON: {"blockingIssues":[{"surface":"...","message":"...","recommendation":"..."}],"recommendedEdits":[{"surface":"...","message":"...","recommendation":"..."}],"nonIssues":["..."],"overfittingRisk":"low|medium|high"}',
  ].filter(Boolean).join('\n');
}

function parseReviewJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { parsed = JSON.parse(match[0]); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const risk = ['low', 'medium', 'high'].includes(parsed.overfittingRisk) ? parsed.overfittingRisk : 'low';
  return {
    blockingIssues: normalizeModelIssues(parsed.blockingIssues, 'blocking').slice(0, 6),
    recommendedEdits: normalizeModelIssues(parsed.recommendedEdits, 'recommended').slice(0, 10),
    nonIssues: Array.isArray(parsed.nonIssues) ? parsed.nonIssues.filter(item => typeof item === 'string').slice(0, 8) : [],
    overfittingRisk: risk,
  };
}

function normalizeModelIssues(list, severity) {
  if (!Array.isArray(list)) return [];
  return list
    .map(item => ({
      severity,
      surface: typeof item?.surface === 'string' && item.surface ? `review:${item.surface}` : 'review:model',
      message: typeof item?.message === 'string' ? item.message : String(item || ''),
      recommendation: typeof item?.recommendation === 'string' ? item.recommendation : 'Address before evaluation.',
    }))
    .filter(item => item.message);
}

function maxRisk(a, b) {
  const order = { low: 0, medium: 1, high: 2 };
  return (order[b] ?? 0) > (order[a] ?? 0) ? b : a;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (field) result[field[1]] = field[2].replace(/^["']|["']$/g, '').trim();
  }
  return result;
}
