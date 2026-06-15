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

const RESEARCH_LIMITS = {
  sources: 15,
  evidenceClaims: 10,
  authorityMap: 8,
  searchTrace: 8,
  practitionerLexicon: 50,
};

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
  if (config.requireSourcesForAuthorityClaims !== false && hasUnsourcedExpertRegisterClaims(ontology)) {
    issues.push(issue('unsourced_expert_register_claims', 'Practitioner lexicon or intertextual claims are missing source refs or inference labels.'));
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
  if (!hasSubstantivePractitionerLexicon(ontology)) {
    warnings.push(issue('thin_practitioner_lexicon', 'Ontology has too little practitioner lexicon coverage; target 20-50 field-specific entries.'));
  } else if (isGenericPractitionerLexicon(ontology)) {
    warnings.push(issue('generic_practitioner_lexicon', 'Practitioner lexicon entries look generic or are not operationalized for skill/eval use.'));
  }
  if (!hasIntertextualMap(ontology)) {
    warnings.push(issue('missing_intertextual_map', 'Ontology lacks an intertextual map of canonical texts, standards, schools, debates, or concept lineages.'));
  } else if (!hasIntertextualRelationships(ontology.intertextualMap)) {
    warnings.push(issue('weak_intertextual_relationships', 'Intertextual map lists references without enough relationships among concepts, schools, debates, or adjacent domains.'));
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

Find evidence that helps an agent build a strong first skill attempt. Include domain norms, common failure modes, contemporary and all-time authorities, institutions/standards, contrarian voices, adjacent domains, practitioner vocabulary, intertextual relationships, and open questions.

Keep the packet controlled-depth rather than exhaustive. Prefer strong, diverse sources and dense synthesis over volume:
- 12-15 sources maximum
- 6-10 evidenceClaims maximum
- 4-8 authorityMap entries maximum
- 3-8 searchTrace entries maximum
- 20-50 practitionerLexicon entries
- short evidence and authority claims; practitionerLexicon may be more extensive

Return JSON with:
runId, skillGoal, researchMode, provider,
sources [{id, title, url, publisher, retrievedAt}],
searchTrace [{query, rationale, resultCount}],
evidenceClaims [{claim, evidenceBasis, sourceRefs, confidence, implicationsForSkill}],
authorityMap [{name, authorityType, whyTheyMatter, strongOpinions, implicationsForSkill, misuseRisks, evidenceBasis, sourceRefs}],
practitionerLexicon [{term, category, expertMeaning, noviceMisuse, nearSynonymsToDisambiguate, whyItMattersForThisSkill, evalImplication, evidenceBasis, sourceRefs}],
intertextualMap {canonicalTexts, standardsAndInstitutions, schoolsOfThought, recurringDebates, conceptLineages [{concept, drawsFrom, contrastsWith, borrowedByAdjacentDomains, implicationsForSkill, evidenceBasis, sourceRefs}], adjacentDomainBorrowings, commonMisreadings, evidenceBasis, sourceRefs, gaps},
openQuestions, gaps.

The practitionerLexicon is not a jargon list. Include terms, methods, artifacts, metrics, failure modes, schools, debates, boundary terms, and expert distinctions that let a top-percentile practitioner make distinctions a novice would flatten. Each entry must explain why it matters for this skill and how an evaluator could notice correct or incorrect use.

The intertextualMap must describe relationships, not just bibliography: which concepts draw from which texts, standards, schools, debates, adjacent domains, or common misreadings, and what those relationships imply for skill behavior.

Every evidenceBasis must be "sourced", "inferred", or "speculative". Authority opinions must include implicationsForSkill and misuseRisks. Sourced lexicon/intertext claims must include sourceRefs; inferred or speculative entries must be labeled clearly.`;
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
    practitionerLexicon: [],
    intertextualMap: {
      canonicalTexts: [],
      standardsAndInstitutions: [],
      schoolsOfThought: [],
      recurringDebates: [],
      conceptLineages: [],
      adjacentDomainBorrowings: [],
      commonMisreadings: [],
      evidenceBasis: 'inferred',
      gaps: ['No sourced expert-register or intertextual research was available.'],
    },
    openQuestions: ['Which contemporary and canonical authorities should shape this skill domain?'],
    gaps: [reason, 'No sourced expert-register or intertextual research was available.'],
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
  const mergedSources = mergeResearchSources(normalizeArray(packet.sources), apiSources, citations)
    .slice(0, RESEARCH_LIMITS.sources);
  const { sources: normalizedSources, sourceRefMap } = canonicalizeResearchSources(mergedSources);
  const normalizeRefs = value => normalizeSourceRefs(value, sourceRefMap);
  return {
    ...packet,
    runId: packet.runId || runId,
    skillGoal: packet.skillGoal || goal,
    researchMode: normalizeResearchMode(packet.researchMode, researchMode),
    provider: normalizeProvider(packet.provider, provider),
    sources: normalizedSources,
    evidenceClaims: normalizeArray(packet.evidenceClaims).slice(0, RESEARCH_LIMITS.evidenceClaims).map(claim => {
      const sourceRefs = normalizeRefs(claim.sourceRefs);
      return {
        ...claim,
        claim: claim.claim || claim.summary || 'Unspecified evidence claim',
        evidenceBasis: normalizeEvidenceBasisForRefs(claim.evidenceBasis, sourceRefs),
        sourceRefs,
        implicationsForSkill: normalizeArray(claim.implicationsForSkill),
      };
    }),
    authorityMap: normalizeArray(packet.authorityMap).slice(0, RESEARCH_LIMITS.authorityMap).map(authority => {
      const sourceRefs = normalizeRefs(authority.sourceRefs);
      return {
        ...authority,
        name: authority.name || 'Unnamed authority',
        authorityType: authority.authorityType || 'unknown',
        whyTheyMatter: authority.whyTheyMatter || '',
        strongOpinions: normalizeArray(authority.strongOpinions),
        implicationsForSkill: normalizeArray(authority.implicationsForSkill),
        misuseRisks: normalizeArray(authority.misuseRisks || authority.possibleMisuse),
        evidenceBasis: normalizeEvidenceBasisForRefs(authority.evidenceBasis, sourceRefs),
        sourceRefs,
      };
    }),
    searchTrace: normalizeArray(packet.searchTrace).slice(0, RESEARCH_LIMITS.searchTrace),
    practitionerLexicon: normalizePractitionerLexicon(packet.practitionerLexicon, normalizeRefs),
    intertextualMap: normalizeIntertextualMap(packet.intertextualMap, normalizeRefs),
    openQuestions: normalizeArray(packet.openQuestions),
    gaps: normalizeArray(packet.gaps),
    rawModelText,
    researchDiagnostics: diagnostics || null,
  };
}

export function normalizeStoredResearchPacket(packet, context = {}) {
  return normalizeResearchPacket(packet || {}, {
    runId: context.runId || packet?.runId,
    goal: context.goal || packet?.skillGoal,
    provider: context.provider || packet?.provider,
    researchMode: context.researchMode || packet?.researchMode || 'inference',
    rawModelText: context.rawModelText ?? packet?.rawModelText ?? null,
    diagnostics: context.diagnostics ?? packet?.researchDiagnostics ?? null,
    apiSources: context.apiSources || [],
    citations: context.citations || [],
  });
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

function normalizePractitionerLexicon(value, normalizeRefs = normalizeArray) {
  return normalizeArray(value).slice(0, RESEARCH_LIMITS.practitionerLexicon).map(entry => {
    const object = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : { term: String(entry || '') };
    const sourceRefs = normalizeRefs(object.sourceRefs);
    return {
      ...object,
      term: object.term || object.name || object.label || 'Unspecified practitioner term',
      category: object.category || 'unspecified',
      expertMeaning: object.expertMeaning || object.meaning || object.definition || '',
      noviceMisuse: object.noviceMisuse || object.misuse || '',
      nearSynonymsToDisambiguate: normalizeArray(object.nearSynonymsToDisambiguate || object.nearSynonyms),
      whyItMattersForThisSkill: object.whyItMattersForThisSkill || object.implicationsForSkill || '',
      evalImplication: object.evalImplication || object.measurementImplication || '',
      evidenceBasis: normalizeEvidenceBasisForRefs(object.evidenceBasis, sourceRefs),
      sourceRefs,
    };
  });
}

function normalizeIntertextualMap(value, normalizeRefs = normalizeArray) {
  if (Array.isArray(value)) return normalizeIntertextualMapEntries(value, normalizeRefs);
  const map = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const sourceRefs = normalizeRefs(map.sourceRefs);
  return {
    canonicalTexts: normalizeArray(map.canonicalTexts || map.canonicalWorks || map.keyTexts),
    standardsAndInstitutions: normalizeArray(map.standardsAndInstitutions || map.institutions || map.standards),
    schoolsOfThought: normalizeArray(map.schoolsOfThought || map.schools || map.traditions),
    recurringDebates: normalizeArray(map.recurringDebates || map.debates),
    conceptLineages: normalizeArray(map.conceptLineages || map.lineages).map(lineage => (
      lineage && typeof lineage === 'object'
        ? normalizeIntertextualLineage(lineage, normalizeRefs)
        : {
          concept: String(lineage),
          drawsFrom: [],
          contrastsWith: [],
          borrowedByAdjacentDomains: [],
          implicationsForSkill: '',
          evidenceBasis: 'inferred',
          sourceRefs: [],
        }
    )),
    adjacentDomainBorrowings: normalizeArray(map.adjacentDomainBorrowings || map.adjacentDomains || map.borrowings),
    commonMisreadings: normalizeArray(map.commonMisreadings || map.misreadings || map.misuses),
    evidenceBasis: normalizeEvidenceBasisForRefs(map.evidenceBasis, sourceRefs),
    sourceRefs,
    gaps: normalizeArray(map.gaps),
  };
}

function normalizeIntertextualLineage(lineage, normalizeRefs = normalizeArray) {
  const sourceRefs = normalizeRefs(lineage.sourceRefs);
  return {
    ...lineage,
    concept: lineage.concept || lineage.name || lineage.node || lineage.title || lineage.term || 'Unspecified concept',
    drawsFrom: normalizeArray(lineage.drawsFrom || lineage.connections || lineage.relatedTexts),
    contrastsWith: normalizeArray(lineage.contrastsWith || lineage.contrasts),
    borrowedByAdjacentDomains: normalizeArray(lineage.borrowedByAdjacentDomains || lineage.adjacentDomainBorrowings || lineage.borrowedBy),
    implicationsForSkill: lineage.implicationsForSkill || lineage.relevance || lineage.skillImplication || '',
    evidenceBasis: normalizeEvidenceBasisForRefs(lineage.evidenceBasis, sourceRefs),
    sourceRefs,
  };
}

function normalizeIntertextualMapEntries(entries, normalizeRefs = normalizeArray) {
  const objects = entries.filter(entry => entry && typeof entry === 'object' && !Array.isArray(entry));
  const sourceRefs = uniqueStrings(objects.flatMap(entry => normalizeRefs(entry.sourceRefs)));
  return {
    canonicalTexts: uniqueStrings(objects
      .filter(entry => /text|guide|paper|article|survey|book|rfc|standard/i.test(`${entry.type || ''} ${entry.node || entry.name || entry.title || ''}`))
      .map(entry => entry.node || entry.name || entry.title || entry.concept)),
    standardsAndInstitutions: uniqueStrings(objects
      .filter(entry => /standard|institution|w3c|ietf|nist|schema\.org|governance|vocabulary/i.test(`${entry.type || ''} ${entry.node || entry.name || entry.title || ''}`))
      .map(entry => entry.node || entry.name || entry.title || entry.concept)),
    schoolsOfThought: uniqueStrings(objects.flatMap(entry => normalizeArray(entry.schoolsOfThought || entry.schools || entry.traditions))),
    recurringDebates: uniqueStrings(objects.flatMap(entry => normalizeArray(entry.recurringDebates || entry.debates))),
    conceptLineages: objects.map(entry => normalizeIntertextualLineage({
      concept: entry.concept || entry.node || entry.name || entry.title,
      drawsFrom: entry.drawsFrom || entry.connections || entry.relatedTexts,
      contrastsWith: entry.contrastsWith || entry.contrasts,
      borrowedByAdjacentDomains: entry.borrowedByAdjacentDomains || entry.adjacentDomainBorrowings || entry.borrowedBy,
      implicationsForSkill: entry.implicationsForSkill || entry.relevance || entry.skillImplication,
      evidenceBasis: entry.evidenceBasis,
      sourceRefs: entry.sourceRefs,
    }, normalizeRefs)),
    adjacentDomainBorrowings: uniqueStrings(objects.flatMap(entry => normalizeArray(entry.adjacentDomainBorrowings || entry.adjacentDomains || entry.borrowings))),
    commonMisreadings: uniqueStrings(objects.flatMap(entry => (
      normalizeArray(entry.commonMisreadings || entry.misreadings || entry.misuses)
        .map(misreading => `${entry.node || entry.name || entry.title || entry.concept || 'intertext'}: ${misreading}`)
    ))),
    evidenceBasis: normalizeEvidenceBasisForRefs(
      objects.some(entry => entry.evidenceBasis === 'sourced') ? 'sourced' : 'inferred',
      sourceRefs,
    ),
    sourceRefs,
    gaps: [],
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

function canonicalizeResearchSources(sources) {
  const sourceRefMap = new Map();
  const canonicalSources = normalizeArray(sources).map((source, index) => {
    const id = `s${index + 1}`;
    const normalized = { ...source, id };
    for (const alias of [
      source.id,
      id,
      `S${index + 1}`,
      source.url,
      source.title,
    ]) {
      const key = normalizeSourceRefKey(alias);
      if (key && !sourceRefMap.has(key)) sourceRefMap.set(key, id);
    }
    return normalized;
  });
  return { sources: canonicalSources, sourceRefMap };
}

function normalizeSourceRefs(value, sourceRefMap) {
  return uniqueStrings(normalizeArray(value)
    .map(ref => sourceRefMap.get(normalizeSourceRefKey(ref)))
    .filter(Boolean));
}

function normalizeSourceRefKey(value) {
  return String(value || '').trim().toLowerCase();
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

function hasUnsourcedExpertRegisterClaims(ontology) {
  const lexicon = Array.isArray(ontology?.practitionerLexicon) ? ontology.practitionerLexicon : [];
  if (lexicon.some(entry => hasMissingEvidenceLabelOrRefs(entry))) return true;
  const map = ontology?.intertextualMap;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  if (hasMissingEvidenceLabelOrRefs(map)) return true;
  const lineages = Array.isArray(map.conceptLineages) ? map.conceptLineages : [];
  return lineages.some(lineage => hasMissingEvidenceLabelOrRefs(lineage));
}

function hasMissingEvidenceLabelOrRefs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  if (value.evidenceBasis === 'sourced') return !Array.isArray(value.sourceRefs) || value.sourceRefs.length === 0;
  return !value.evidenceBasis;
}

function isGenericList(list) {
  return !Array.isArray(list) || list.length === 0 || list.every(item => GENERIC_TERMS.has(String(item).toLowerCase()));
}

function hasDomainSpecificVocabulary(ontology) {
  const text = JSON.stringify(ontology || {}).toLowerCase();
  const words = text.match(/[a-z][a-z-]{5,}/g) || [];
  return new Set(words.filter(word => !GENERIC_TERMS.has(word))).size >= 12;
}

function hasSubstantivePractitionerLexicon(ontology) {
  return Array.isArray(ontology?.practitionerLexicon) && ontology.practitionerLexicon.length >= 20;
}

function isGenericPractitionerLexicon(ontology) {
  const lexicon = Array.isArray(ontology?.practitionerLexicon) ? ontology.practitionerLexicon : [];
  if (!lexicon.length) return true;
  const uniqueTerms = new Set(lexicon.map(entry => String(entry?.term || entry).trim().toLowerCase()).filter(Boolean));
  const operationalized = lexicon.filter(entry => {
    const term = String(entry?.term || '').trim().toLowerCase();
    const expertMeaning = String(entry?.expertMeaning || entry?.meaning || '').trim();
    const skillImplication = String(entry?.whyItMattersForThisSkill || entry?.implicationsForSkill || '').trim();
    const evalImplication = String(entry?.evalImplication || '').trim();
    return term && !GENERIC_TERMS.has(term) && expertMeaning.length >= 20 && skillImplication.length >= 20 && evalImplication.length >= 12;
  }).length;
  return uniqueTerms.size < Math.min(12, lexicon.length) || operationalized < Math.ceil(lexicon.length * 0.6);
}

function hasIntertextualMap(ontology) {
  const map = ontology?.intertextualMap;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return [
    'canonicalTexts',
    'standardsAndInstitutions',
    'schoolsOfThought',
    'recurringDebates',
    'conceptLineages',
    'adjacentDomainBorrowings',
    'commonMisreadings',
  ].some(field => Array.isArray(map[field]) && map[field].length > 0);
}

function hasIntertextualRelationships(map) {
  const lineages = Array.isArray(map?.conceptLineages) ? map.conceptLineages : [];
  const relationalLineage = lineages.some(lineage => {
    if (lineage && typeof lineage === 'object') {
      return ['drawsFrom', 'contrastsWith', 'borrowedByAdjacentDomains'].some(field => (
        Array.isArray(lineage[field]) && lineage[field].length > 0
      ));
    }
    return false;
  });
  const debates = Array.isArray(map?.recurringDebates) ? map.recurringDebates.length : 0;
  const schools = Array.isArray(map?.schoolsOfThought) ? map.schoolsOfThought.length : 0;
  const adjacent = Array.isArray(map?.adjacentDomainBorrowings) ? map.adjacentDomainBorrowings.length : 0;
  return relationalLineage || (debates > 0 && (schools > 0 || adjacent > 0));
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

function normalizeEvidenceBasisForRefs(value, sourceRefs) {
  const evidenceBasis = normalizeEvidenceBasis(value);
  return evidenceBasis === 'sourced' && !sourceRefs?.length ? 'inferred' : evidenceBasis;
}

function normalizeResearchMode(value, fallback) {
  return ['sourced', 'inference'].includes(value) ? value : fallback;
}

function normalizeProvider(value, fallback) {
  return ['openai', 'anthropic', 'gemini', 'reused-ontology', 'unknown'].includes(value) ? value : (fallback || 'unknown');
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function uniqueStrings(values = []) {
  return [...new Set(normalizeArray(values)
    .map(value => String(value || '').trim())
    .filter(Boolean))];
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
