import { callModel, createModelAttemptError, summarizeModelAttempts, withModelRetry, inferProvider } from './model-client.js';
import { validateQualityReport, validateResearchPacket } from './schema.js';

const GENERIC_TERMS = new Set([
  'task success',
  'workflow clarity',
  'validation usefulness',
  'good ux critique',
  'lean procedural',
  'reference-rich',
]);

export async function buildResearchPacket({
  runId,
  goal,
  model,
  apiKeys = {},
  modelClient = callModel,
  config = {},
  maxTokens = 8192,
}) {
  const provider = inferProvider(model);
  const mode = config.mode || 'best_effort';
  const requestedProvider = config.provider || 'model_native';
  if (mode === 'off') {
    return fallbackResearchPacket({ runId, goal, provider, reason: 'research disabled by config' });
  }

  const canUseModelNativeSearch = requestedProvider === 'model_native' && provider === 'openai';
  if (!canUseModelNativeSearch) {
    if (mode === 'required') {
      throw new Error(`Research requires model-native web search, but provider "${provider || 'unknown'}" is unsupported`);
    }
    return fallbackResearchPacket({
      runId,
      goal,
      provider,
      reason: 'model-native web search unavailable for provider',
      diagnostics: {
        requested: true,
        providerSupported: false,
        toolType: 'web_search',
        toolChoice: 'auto',
        used: false,
        webSearchCallCount: 0,
        sourceCount: 0,
      },
    });
  }

  try {
    const retryResponse = await withModelRetry({
      phase: 'research',
      model,
      maxAttempts: config.retryPolicy?.authoringMaxAttempts,
      backoffMs: config.retryPolicy?.backoffMs,
      operation: async () => {
        const modelResponse = await modelClient({
          model,
          apiKeys,
          systemPrompt: 'You are the Skill RSI research agent. Use web search before making domain or authority claims. Return only valid JSON.',
          messages: [{ role: 'user', content: buildResearchPrompt({ runId, goal }) }],
          maxTokens,
          jsonMode: false,
          tools: [{ type: 'web_search' }],
          toolChoice: 'auto',
          include: ['web_search_call.action.sources'],
          returnMetadata: true,
        });
        const rawModelText = typeof modelResponse === 'string' ? modelResponse : modelResponse.text;
        try {
          parseJson(rawModelText);
        } catch (error) {
          throw createModelAttemptError(`Research returned invalid JSON: ${error.message}`, {
            failureKind: 'invalid_json',
            rawResponse: rawModelText,
          });
        }
        return modelResponse;
      },
    });
    if (!retryResponse.ok) {
      const summary = summarizeModelAttempts(retryResponse.attempts);
      throw createModelAttemptError(`research failed after ${summary.attemptCount} attempts: ${summary.lastError?.message || 'model output was invalid'}`, {
        failureKind: summary.failureKind || 'model_error',
        rawResponse: summary.lastError?.rawResponse || null,
      });
    }
    const modelResponse = retryResponse.value;
    const rawModelText = typeof modelResponse === 'string' ? modelResponse : modelResponse.text;
    const diagnostics = createResearchDiagnostics({ provider, modelResponse });
    if (!diagnostics.used) {
      const message = 'model-native web search returned no tool-call or source evidence';
      if (mode === 'required') {
        const error = new Error(message);
        error.rawModelText = rawModelText;
        throw error;
      }
      return fallbackResearchPacket({
        runId,
        goal,
        provider,
        reason: message,
        diagnostics,
        rawModelText,
      });
    }
    const parsed = parseJson(rawModelText);
    const packet = normalizeResearchPacket(parsed, {
      runId,
      goal,
      provider,
      researchMode: 'sourced',
      rawModelText,
      diagnostics,
      apiSources: typeof modelResponse === 'string' ? [] : modelResponse.sources,
      citations: typeof modelResponse === 'string' ? [] : modelResponse.citations,
    });
    return validateResearchPacket(packet);
  } catch (error) {
    if (mode === 'required') throw error;
    const packet = fallbackResearchPacket({
      runId,
      goal,
      provider,
      reason: `research failed: ${error.message}`,
      diagnostics: {
        requested: true,
        providerSupported: true,
        toolType: 'web_search',
        toolChoice: 'auto',
        used: false,
        webSearchCallCount: 0,
        sourceCount: 0,
        error: error.message,
      },
      rawModelText: error.rawModelText || null,
    });
    return packet;
  }
}

export function createOntologyQualityReport({ ontology, researchPacket, config = {} }) {
  const issues = [];
  const warnings = [];
  if (!ontology?.authorityMap?.length) {
    issues.push(issue('missing_authority_map', 'Ontology lacks an authority map.'));
  }
  if (config.requireSourcesForAuthorityClaims !== false && hasUnsourcedAuthorityClaims(ontology)) {
    issues.push(issue('unsourced_authority_claims', 'Authority opinions are not connected to source refs or inference labels.'));
  }
  if (!ontology?.invocationBoundaries?.shouldNotTriggerWhen?.length) {
    issues.push(issue('missing_non_goals', 'Ontology lacks clear non-goals or should-not-trigger boundaries.'));
  }
  if (!ontology?.failureModes?.length || ontology.failureModes.length < 3) {
    issues.push(issue('thin_failure_modes', 'Ontology has too few failure modes.'));
  }
  if (isGenericList(ontology?.qualityAxes)) {
    warnings.push(issue('generic_quality_axes', 'Quality axes look generic rather than domain-specific.'));
  }
  if (!hasDomainSpecificVocabulary(ontology)) {
    warnings.push(issue('low_domain_specificity', 'Ontology appears to use little domain-specific vocabulary.'));
  }
  if (!researchPacket || researchPacket.researchMode === 'inference') {
    warnings.push(issue('inference_only_research', 'Research packet is inference-only; sourced confidence should be low.'));
  }

  return validateQualityReport(createReport({
    artifactType: 'ontology',
    issues,
    warnings,
  }));
}

export function createDeconstructionQualityReport({ parameterization, championPackage }) {
  const issues = [];
  const warnings = [];
  const parameters = Array.isArray(parameterization?.parameters) ? parameterization.parameters : [];
  for (const parameter of parameters) {
    if (!hasSubstantiveList(parameter.artifactEvidence, ['no artifact evidence returned'])) {
      issues.push(issue('missing_artifact_evidence', `Parameter ${parameter.id || 'unknown'} lacks artifact evidence.`));
    }
    if (!hasSubstantiveList(parameter.couplingNotes, ['no coupling notes returned'])) {
      warnings.push(issue('missing_coupling_notes', `Parameter ${parameter.id || 'unknown'} lacks coupling notes.`));
    }
    if (isGenericText(parameter.improvementHypothesis)) {
      warnings.push(issue('generic_hypothesis', `Parameter ${parameter.id || 'unknown'} has a generic hypothesis.`));
    }
  }
  if (!championPackage && parameterization?.championSkillHash !== 'none') {
    warnings.push(issue('missing_champion_package', 'Deconstruction did not receive a full champion package.'));
  }

  return validateQualityReport(createReport({
    artifactType: 'deconstruction',
    issues,
    warnings,
  }));
}

function buildResearchPrompt({ runId, goal }) {
  return `Build a research packet for a Skill RSI ontology.

Goal: ${goal}
Run ID: ${runId}

Find evidence that helps an agent build a strong first skill attempt. Include domain norms, common failure modes, contemporary and all-time authorities, institutions/standards, contrarian voices, adjacent domains, and open questions.

Keep the packet compact and complete. Prefer the strongest evidence over volume:
- 6-10 sources maximum
- 6-10 evidenceClaims maximum
- 4-8 authorityMap entries maximum
- 3-6 searchTrace entries maximum
- short arrays and sentence-length claims

Return JSON with:
runId, skillGoal, researchMode, provider, sources [{id, title, url, publisher, retrievedAt}], searchTrace [{query, rationale, resultCount}], evidenceClaims [{claim, evidenceBasis, sourceRefs, confidence, implicationsForSkill}], authorityMap [{name, authorityType, whyTheyMatter, strongOpinions, implicationsForSkill, misuseRisks, evidenceBasis, sourceRefs}], openQuestions, gaps.

Every evidenceBasis must be "sourced", "inferred", or "speculative". Authority opinions must include implicationsForSkill and misuseRisks.`;
}

function fallbackResearchPacket({ runId, goal, provider, reason, diagnostics = null, rawModelText = null }) {
  return validateResearchPacket({
    runId,
    skillGoal: goal,
    researchMode: 'inference',
    provider: provider || 'unknown',
    sources: [],
    searchTrace: [{ query: goal, rationale: reason, resultCount: 0 }],
    evidenceClaims: [{
      claim: `Domain map for "${goal}" must be treated as model inference until sourced research is available.`,
      evidenceBasis: 'inferred',
      sourceRefs: [],
      confidence: 'low',
      implicationsForSkill: ['Label ontology claims as inference and keep open questions visible.'],
    }],
    authorityMap: [{
      name: 'Unresolved domain authorities',
      authorityType: 'unknown',
      whyTheyMatter: 'Authority research was unavailable in this run.',
      strongOpinions: ['No sourced authority opinions were gathered.'],
      implicationsForSkill: ['Avoid treating named principles as sourced unless later research verifies them.'],
      misuseRisks: ['The skill may lean on generic model priors.'],
      evidenceBasis: 'inferred',
      sourceRefs: [],
    }],
    openQuestions: ['Which contemporary and canonical authorities should shape this skill domain?'],
    gaps: [reason],
    rawModelText,
    researchDiagnostics: diagnostics || {
      requested: false,
      providerSupported: false,
      toolType: 'web_search',
      toolChoice: 'none',
      used: false,
      webSearchCallCount: 0,
      sourceCount: 0,
      error: reason,
    },
  });
}

function normalizeResearchPacket(packet, { runId, goal, provider, researchMode, rawModelText, diagnostics = null, apiSources = [], citations = [] }) {
  const normalizedSources = mergeResearchSources(normalizeArray(packet.sources), apiSources, citations);
  return {
    ...packet,
    runId: packet.runId || runId,
    skillGoal: packet.skillGoal || goal,
    researchMode: normalizeResearchMode(packet.researchMode, researchMode),
    provider: normalizeProvider(packet.provider, provider),
    sources: normalizedSources.slice(0, 20),
    evidenceClaims: normalizeArray(packet.evidenceClaims).slice(0, 10).map(claim => ({
      ...claim,
      claim: claim.claim || claim.summary || 'Unspecified evidence claim',
      evidenceBasis: normalizeEvidenceBasis(claim.evidenceBasis),
      sourceRefs: normalizeArray(claim.sourceRefs),
      implicationsForSkill: normalizeArray(claim.implicationsForSkill),
    })),
    authorityMap: normalizeArray(packet.authorityMap).slice(0, 8).map(authority => ({
      ...authority,
      name: authority.name || 'Unnamed authority',
      authorityType: authority.authorityType || 'unknown',
      whyTheyMatter: authority.whyTheyMatter || '',
      strongOpinions: normalizeArray(authority.strongOpinions),
      implicationsForSkill: normalizeArray(authority.implicationsForSkill),
      misuseRisks: normalizeArray(authority.misuseRisks || authority.possibleMisuse),
      evidenceBasis: normalizeEvidenceBasis(authority.evidenceBasis),
      sourceRefs: normalizeArray(authority.sourceRefs),
    })),
    searchTrace: normalizeArray(packet.searchTrace).slice(0, 6),
    openQuestions: normalizeArray(packet.openQuestions),
    gaps: normalizeArray(packet.gaps),
    rawModelText,
    researchDiagnostics: diagnostics || null,
  };
}

function createResearchDiagnostics({ provider, modelResponse }) {
  if (typeof modelResponse === 'string') {
    return {
      requested: true,
      providerSupported: provider === 'openai',
      toolType: 'web_search',
      toolChoice: 'auto',
      used: false,
      webSearchCallCount: 0,
      sourceCount: 0,
    };
  }
  const webSearchCallCount = Array.isArray(modelResponse.webSearchCalls) ? modelResponse.webSearchCalls.length : 0;
  const sourceCount = Array.isArray(modelResponse.sources) ? modelResponse.sources.length : 0;
  const citationCount = Array.isArray(modelResponse.citations) ? modelResponse.citations.length : 0;
  return {
    requested: true,
    providerSupported: provider === 'openai',
    toolType: 'web_search',
    toolChoice: 'auto',
    used: webSearchCallCount > 0 || sourceCount > 0 || citationCount > 0,
    webSearchCallCount,
    sourceCount,
    citationCount,
  };
}

function mergeResearchSources(modelSources, apiSources = [], citations = []) {
  const byUrl = new Map();
  for (const source of modelSources) {
    const normalized = normalizeResearchSource(source, `s${byUrl.size + 1}`);
    byUrl.set(normalized.url || normalized.id, normalized);
  }
  for (const source of apiSources) {
    const normalized = normalizeResearchSource(source, `api-${byUrl.size + 1}`);
    byUrl.set(normalized.url || normalized.id, normalized);
  }
  for (const citation of citations) {
    const normalized = normalizeResearchSource(citation, `cite-${byUrl.size + 1}`);
    byUrl.set(normalized.url || normalized.id, normalized);
  }
  return [...byUrl.values()];
}

function normalizeResearchSource(source, fallbackId) {
  return {
    id: source.id || fallbackId,
    title: source.title || source.name || source.url || fallbackId,
    url: source.url || source.uri || '',
    publisher: source.publisher || source.domain || '',
    retrievedAt: source.retrievedAt || new Date().toISOString(),
  };
}

function createReport({ artifactType, issues, warnings }) {
  return {
    artifactType,
    status: issues.length ? 'needs_revision' : warnings.length ? 'warning' : 'pass',
    revisionRecommended: issues.length > 0,
    confidence: issues.length ? 'low' : warnings.length ? 'medium' : 'high',
    issues,
    warnings,
    createdAt: new Date().toISOString(),
  };
}

function issue(code, message) {
  return { code, message };
}

function hasUnsourcedAuthorityClaims(ontology) {
  return (ontology?.authorityMap || []).some(authority => (
    authority.evidenceBasis === 'sourced'
      ? !authority.sourceRefs?.length
      : !authority.evidenceBasis
  ));
}

function isGenericList(list) {
  return !Array.isArray(list) || list.length === 0 || list.every(item => GENERIC_TERMS.has(String(item).toLowerCase()));
}

function hasDomainSpecificVocabulary(ontology) {
  const text = JSON.stringify(ontology || {}).toLowerCase();
  const words = text.match(/[a-z][a-z-]{5,}/g) || [];
  return new Set(words.filter(word => !GENERIC_TERMS.has(word))).size >= 12;
}

function isGenericText(text) {
  const normalized = String(text || '').toLowerCase();
  return ['improve clarity', 'make it better', 'improve skill quality'].some(term => normalized.includes(term));
}

function hasSubstantiveList(list, placeholderFragments = []) {
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some(item => {
    const normalized = String(item || '').trim().toLowerCase();
    if (!normalized) return false;
    return !placeholderFragments.some(fragment => normalized.includes(fragment));
  });
}

function normalizeEvidenceBasis(value) {
  return ['sourced', 'inferred', 'speculative'].includes(value) ? value : 'inferred';
}

function normalizeResearchMode(value, fallback) {
  return ['sourced', 'inference'].includes(value) ? value : fallback;
}

function normalizeProvider(value, fallback) {
  return ['openai', 'anthropic', 'gemini', 'unknown'].includes(value) ? value : (fallback || 'unknown');
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function parseJson(text) {
  const raw = String(text || '').trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fullFence = raw.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
    const jsonFence = raw.match(/```json\s*([\s\S]*?)```/i);
    const fenced = fullFence || jsonFence;
    if (!fenced) throw error;
    return JSON.parse(fenced[1].trim());
  }
}
