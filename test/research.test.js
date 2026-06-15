import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResearchPacket,
  createDeconstructionQualityReport,
  createOntologyQualityReport,
  normalizeStoredResearchPacket,
} from '../src/lib/research.js';
import { validateOntology, validateResearchPacket } from '../src/lib/schema.js';

test('research packet schema validates evidence bases and authority map', () => {
  const packet = validateResearchPacket({
    runId: 'research-001',
    skillGoal: 'Help agents design better UX.',
    researchMode: 'sourced',
    provider: 'openai',
    sources: [{ id: 's1', title: 'Source', url: 'https://example.com' }],
    searchTrace: [{ query: 'ux authorities', rationale: 'find authorities', resultCount: 1 }],
    evidenceClaims: [{
      claim: 'Strong UX skills should evaluate user impact.',
      evidenceBasis: 'sourced',
      sourceRefs: ['s1'],
    }],
    authorityMap: [{
      name: 'Example Authority',
      authorityType: 'practitioner',
      strongOpinions: ['Start with the user.'],
      implicationsForSkill: ['Require user-centered critique.'],
      misuseRisks: ['Do not turn the opinion into decoration.'],
    }],
    openQuestions: [],
    gaps: [],
  });

  assert.equal(packet.evidenceClaims[0].evidenceBasis, 'sourced');
});

test('research packet schema validates practitioner lexicon and intertextual map', () => {
  const packet = validateResearchPacket({
    runId: 'research-lexicon-001',
    skillGoal: 'Help agents reason about product strategy.',
    researchMode: 'sourced',
    provider: 'openai',
    sources: [{ id: 's1', title: 'Source', url: 'https://example.com' }],
    searchTrace: [{ query: 'product strategy vocabulary', rationale: 'find expert terms', resultCount: 1 }],
    evidenceClaims: [{
      claim: 'Strong product strategy distinguishes positioning from messaging.',
      evidenceBasis: 'sourced',
      sourceRefs: ['s1'],
    }],
    authorityMap: [{
      name: 'Example Strategist',
      strongOpinions: ['Positioning should constrain choices.'],
      implicationsForSkill: ['Require clear tradeoff language.'],
      misuseRisks: ['Do not turn positioning into slogan writing.'],
    }],
    practitionerLexicon: [{
      term: 'positioning',
      category: 'boundary term',
      expertMeaning: 'The constrained market frame that clarifies who a product is for and why it should win.',
      noviceMisuse: 'Treating it as a tagline.',
      nearSynonymsToDisambiguate: ['messaging'],
      whyItMattersForThisSkill: 'The skill should preserve strategic distinctions before drafting recommendations.',
      evalImplication: 'Evaluator can penalize output that collapses positioning into messaging.',
      evidenceBasis: 'sourced',
      sourceRefs: ['s1'],
    }],
    intertextualMap: {
      canonicalTexts: ['Example strategy text'],
      standardsAndInstitutions: ['Example institution'],
      schoolsOfThought: ['positioning school'],
      recurringDebates: ['category creation vs. category capture'],
      conceptLineages: [{
        concept: 'positioning',
        drawsFrom: ['market segmentation'],
        contrastsWith: ['messaging'],
        borrowedByAdjacentDomains: ['brand strategy'],
        implicationsForSkill: 'Keep strategic frame and copywriting tasks separate.',
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
      }],
      adjacentDomainBorrowings: ['brand strategy'],
      commonMisreadings: ['positioning as tagline'],
      evidenceBasis: 'sourced',
      sourceRefs: ['s1'],
    },
    openQuestions: [],
    gaps: [],
  });

  assert.equal(packet.practitionerLexicon[0].term, 'positioning');
  assert.equal(packet.intertextualMap.conceptLineages[0].concept, 'positioning');
});

test('research packet schema rejects sourced practitioner lexicon entries without refs', () => {
  assert.throws(
    () => validateResearchPacket({
      runId: 'research-lexicon-bad',
      skillGoal: 'Help agents reason about product strategy.',
      researchMode: 'sourced',
      provider: 'openai',
      sources: [{ id: 's1', title: 'Source', url: 'https://example.com' }],
      searchTrace: [{ query: 'product strategy vocabulary', rationale: 'find expert terms', resultCount: 1 }],
      evidenceClaims: [{ claim: 'Evidence.', evidenceBasis: 'sourced', sourceRefs: ['s1'] }],
      authorityMap: [{
        name: 'Example Strategist',
        strongOpinions: ['Use precise distinctions.'],
        implicationsForSkill: ['Require clear tradeoff language.'],
        misuseRisks: ['Avoid decorative jargon.'],
      }],
      practitionerLexicon: [{
        term: 'positioning',
        evidenceBasis: 'sourced',
        sourceRefs: [],
      }],
      intertextualMap: {
        evidenceBasis: 'inferred',
        conceptLineages: [],
      },
      openQuestions: [],
      gaps: [],
    }),
    /sourced practitionerLexicon entries must include sourceRefs/,
  );
});

test('ontology schema rejects oversized or unsourced expert-register fields', () => {
  const baseOntology = {
    runId: 'ontology-schema-bad',
    skillGoal: 'Help agents reason about product strategy.',
    targetUsers: ['agents'],
    targetTasks: ['design strategy'],
    invocationBoundaries: {
      shouldTriggerWhen: ['strategy task'],
      shouldNotTriggerWhen: ['unrelated task'],
    },
    inputSurface: ['user request'],
    outputArtifacts: ['recommendation'],
    requiredKnowledge: ['strategy'],
    failureModes: ['category confusion', 'positioning collapse', 'metric theater'],
    qualityAxes: ['strategic precision'],
    evalPromptTaxonomy: ['direct request'],
    candidateStrategySpace: ['lean procedural'],
  };

  assert.throws(
    () => validateOntology({
      ...baseOntology,
      practitionerLexicon: Array.from({ length: 51 }, (_, index) => ({
        term: `term-${index + 1}`,
        evidenceBasis: 'inferred',
        sourceRefs: [],
      })),
    }),
    /practitionerLexicon must contain at most 50 entries/,
  );

  assert.throws(
    () => validateOntology({
      ...baseOntology,
      practitionerLexicon: [{
        term: 'positioning',
        evidenceBasis: 'sourced',
        sourceRefs: [],
      }],
    }),
    /sourced practitionerLexicon\[\] entries must include sourceRefs/,
  );

  assert.throws(
    () => validateOntology({
      ...baseOntology,
      intertextualMap: {
        evidenceBasis: 'inferred',
        sourceRefs: [],
        conceptLineages: [{
          concept: 'positioning',
          evidenceBasis: 'sourced',
          sourceRefs: [],
        }],
      },
    }),
    /sourced intertextualMap\.conceptLineages\[\] entries must include sourceRefs/,
  );

  assert.throws(
    () => validateOntology({
      ...baseOntology,
      terminologyDiscriminators: [{
        term: 'positioning',
        distinguishFrom: 'messaging',
        evidenceBasis: 'sourced',
        sourceRefs: [],
      }],
    }),
    /sourced terminologyDiscriminators\[\] entries must include sourceRefs/,
  );

  assert.throws(
    () => validateOntology({
      ...baseOntology,
      terminologyDiscriminators: ['positioning vs messaging'],
    }),
    /each terminologyDiscriminators entry must be an object/,
  );
});

test('model-native research passes OpenAI web_search tools and normalizes authority fields', async () => {
  const calls = [];
  const packet = await buildResearchPacket({
    runId: 'research-002',
    goal: 'Help agents design better UX.',
    model: 'gpt-5.4-mini',
    modelClient: async request => {
      calls.push(request);
      return {
        text: JSON.stringify({
        researchMode: 'web-sourced research packet',
        provider: 'OpenAI API research agent',
        sources: [{ id: 's1', title: 'Apple HIG', url: 'https://developer.apple.com/design/human-interface-guidelines/' }],
        searchTrace: [{ query: 'Apple HIG UX design principles', rationale: 'find standards', resultCount: 1 }],
        evidenceClaims: [{ claim: 'Platform guidance matters.', evidenceBasis: 'sourced', sourceRefs: ['s1'] }],
        authorityMap: [{
          name: 'Apple Human Interface Guidelines',
          authorityType: 'institution',
          strongOpinions: ['Clarity and consistency matter.'],
          implicationsForSkill: ['Skill should evaluate platform convention fit.'],
          possibleMisuse: ['Do not overfit non-Apple interfaces to Apple conventions.'],
          evidenceBasis: 'sourced',
          sourceRefs: ['s1'],
        }],
        openQuestions: ['Which platform is canonical?'],
        gaps: [],
        }),
        webSearchCalls: [{ id: 'ws_1', type: 'web_search_call' }],
        sources: [{ id: 's1', title: 'Apple HIG', url: 'https://developer.apple.com/design/human-interface-guidelines/' }],
        citations: [],
      };
    },
  });

  assert.deepEqual(calls[0].tools, [{ type: 'web_search' }]);
  assert.equal(calls[0].toolChoice, 'auto');
  assert.equal(calls[0].jsonMode, false);
  assert.deepEqual(calls[0].include, ['web_search_call.action.sources']);
  assert.equal(calls[0].returnMetadata, true);
  assert.equal(packet.researchMode, 'sourced');
  assert.equal(packet.provider, 'openai');
  assert.equal(packet.researchDiagnostics.used, true);
  assert.deepEqual(packet.authorityMap[0].misuseRisks, ['Do not overfit non-Apple interfaces to Apple conventions.']);
});

test('model-native research normalizes practitioner fields and enforces caps', async () => {
  const makeItems = (count, factory) => Array.from({ length: count }, (_, index) => factory(index));
  const packet = await buildResearchPacket({
    runId: 'research-caps',
    goal: 'Help agents design product strategy.',
    model: 'gpt-5.4-mini',
    modelClient: async () => ({
      text: JSON.stringify({
        sources: makeItems(18, index => ({ id: `s${index + 1}`, title: `Source ${index + 1}`, url: `https://example.com/${index + 1}` })),
        searchTrace: makeItems(10, index => ({ query: `query ${index + 1}`, rationale: 'coverage', resultCount: index + 1 })),
        evidenceClaims: makeItems(12, index => ({ claim: `Evidence claim ${index + 1}`, evidenceBasis: 'sourced', sourceRefs: ['s1'] })),
        authorityMap: makeItems(10, index => ({
          name: `Authority ${index + 1}`,
          strongOpinions: ['Use precise distinctions.'],
          implicationsForSkill: ['Check domain specificity.'],
          misuseRisks: ['Avoid decorative jargon.'],
          evidenceBasis: 'sourced',
          sourceRefs: ['s1'],
        })),
        practitionerLexicon: makeItems(55, index => ({
          term: `term-${index + 1}`,
          category: 'method',
          expertMeaning: 'A field-specific distinction that changes how a practitioner reasons about the work.',
          noviceMisuse: 'Using the term as a vague label.',
          nearSynonymsToDisambiguate: ['adjacent term'],
          whyItMattersForThisSkill: 'It lets the skill preserve a practitioner-level distinction.',
          evalImplication: 'Evaluator can detect whether the distinction is used correctly.',
          evidenceBasis: 'sourced',
          sourceRefs: ['s1'],
        })),
        intertextualMap: {
          canonicalTexts: ['Canonical text'],
          conceptLineages: [{
            concept: 'positioning',
            drawsFrom: ['segmentation'],
            contrastsWith: ['messaging'],
            borrowedByAdjacentDomains: ['brand strategy'],
            evidenceBasis: 'sourced',
            sourceRefs: ['s1'],
          }],
        },
        openQuestions: [],
        gaps: [],
      }),
      webSearchCalls: [{ id: 'ws_1', type: 'web_search_call' }],
      sources: [],
      citations: [],
    }),
  });

  assert.equal(packet.sources.length, 15);
  assert.equal(packet.searchTrace.length, 8);
  assert.equal(packet.evidenceClaims.length, 10);
  assert.equal(packet.authorityMap.length, 8);
  assert.equal(packet.practitionerLexicon.length, 50);
  assert.equal(packet.intertextualMap.conceptLineages[0].concept, 'positioning');
});

test('model-native research canonicalizes source ids and sourceRefs', async () => {
  const packet = await buildResearchPacket({
    runId: 'research-source-refs',
    goal: 'Help agents analyze screenplay structure.',
    model: 'gpt-5.4-mini',
    modelClient: async () => ({
      text: JSON.stringify({
        sources: [],
        evidenceClaims: [{ claim: 'Beat labels vary by framework.', evidenceBasis: 'sourced', sourceRefs: ['S1', 'api-2', 'missing'] }],
        authorityMap: [{
          name: 'Screenwriting source',
          strongOpinions: ['Function matters more than page number.'],
          implicationsForSkill: ['Preserve functional labels.'],
          misuseRisks: ['Do not treat page counts as law.'],
          evidenceBasis: 'sourced',
          sourceRefs: ['https://example.com/source-b'],
        }],
        practitionerLexicon: [{
          term: 'inciting incident',
          evidenceBasis: 'sourced',
          sourceRefs: ['S1'],
        }],
        intertextualMap: {
          evidenceBasis: 'sourced',
          sourceRefs: ['api-2'],
          conceptLineages: [{
            concept: 'three-act structure',
            evidenceBasis: 'sourced',
            sourceRefs: ['api-2'],
          }],
        },
        openQuestions: [],
        gaps: [],
      }),
      webSearchCalls: [{ id: 'ws_1', type: 'web_search_call' }],
      sources: [
        { id: 'api-1', title: 'Source A', url: 'https://example.com/source-a' },
        { id: 'api-2', title: 'Source B', url: 'https://example.com/source-b' },
      ],
      citations: [],
    }),
  });

  assert.deepEqual(packet.sources.map(source => source.id), ['s1', 's2']);
  assert.deepEqual(packet.evidenceClaims[0].sourceRefs, ['s1', 's2']);
  assert.deepEqual(packet.authorityMap[0].sourceRefs, ['s2']);
  assert.deepEqual(packet.practitionerLexicon[0].sourceRefs, ['s1']);
  assert.deepEqual(packet.intertextualMap.sourceRefs, ['s2']);
  assert.deepEqual(packet.intertextualMap.conceptLineages[0].sourceRefs, ['s2']);
});

test('stored research canonicalizes legacy source ids and refs on reuse', () => {
  const packet = normalizeStoredResearchPacket({
    runId: 'legacy-research-source-refs',
    skillGoal: 'Help agents analyze screenplay structure.',
    researchMode: 'sourced',
    provider: 'openai',
    sources: [
      { id: 'api-26', title: 'Source A', url: 'https://example.com/source-a' },
      { id: 'api-26', title: 'Source B', url: 'https://example.com/source-b' },
    ],
    searchTrace: [],
    evidenceClaims: [{
      claim: 'Legacy packets may mix ordinal and API refs.',
      evidenceBasis: 'sourced',
      sourceRefs: ['S1', 'https://example.com/source-b', 'missing'],
    }],
    authorityMap: [],
    practitionerLexicon: [{
      term: 'inciting incident',
      evidenceBasis: 'sourced',
      sourceRefs: ['S2'],
    }],
    intertextualMap: {
      evidenceBasis: 'sourced',
      sourceRefs: ['S2'],
      conceptLineages: [{
        concept: 'three-act structure',
        evidenceBasis: 'sourced',
        sourceRefs: ['S1'],
      }],
    },
    openQuestions: [],
    gaps: [],
  });

  assert.deepEqual(packet.sources.map(source => source.id), ['s1', 's2']);
  assert.deepEqual(packet.evidenceClaims[0].sourceRefs, ['s1', 's2']);
  assert.deepEqual(packet.practitionerLexicon[0].sourceRefs, ['s2']);
  assert.deepEqual(packet.intertextualMap.sourceRefs, ['s2']);
  assert.deepEqual(packet.intertextualMap.conceptLineages[0].sourceRefs, ['s1']);
});

test('model-native research downgrades sourced claims with invalid sourceRefs', async () => {
  const packet = await buildResearchPacket({
    runId: 'research-invalid-source-refs',
    goal: 'Help agents analyze screenplay structure.',
    model: 'gpt-5.4-mini',
    modelClient: async () => ({
      text: JSON.stringify({
        sources: [{ id: 's1', title: 'Source', url: 'https://example.com/source' }],
        evidenceClaims: [{ claim: 'Unsupported.', evidenceBasis: 'sourced', sourceRefs: ['missing'] }],
        authorityMap: [],
        practitionerLexicon: [{
          term: 'unsupported term',
          evidenceBasis: 'sourced',
          sourceRefs: ['missing'],
        }],
        intertextualMap: {
          evidenceBasis: 'sourced',
          sourceRefs: ['missing'],
          conceptLineages: [{
            concept: 'unsupported lineage',
            evidenceBasis: 'sourced',
            sourceRefs: ['missing'],
          }],
        },
        openQuestions: [],
        gaps: [],
      }),
      webSearchCalls: [{ id: 'ws_1', type: 'web_search_call' }],
      sources: [],
      citations: [],
    }),
  });

  assert.deepEqual(packet.evidenceClaims[0].sourceRefs, []);
  assert.equal(packet.evidenceClaims[0].evidenceBasis, 'inferred');
  assert.deepEqual(packet.practitionerLexicon[0].sourceRefs, []);
  assert.equal(packet.practitionerLexicon[0].evidenceBasis, 'inferred');
  assert.deepEqual(packet.intertextualMap.sourceRefs, []);
  assert.equal(packet.intertextualMap.evidenceBasis, 'inferred');
  assert.deepEqual(packet.intertextualMap.conceptLineages[0].sourceRefs, []);
  assert.equal(packet.intertextualMap.conceptLineages[0].evidenceBasis, 'inferred');
});

test('model-native research normalizes node-style intertextual maps', async () => {
  const packet = await buildResearchPacket({
    runId: 'research-node-intertext',
    goal: 'Help agents build ontology packets.',
    model: 'gpt-5.4-mini',
    modelClient: async () => ({
      text: JSON.stringify({
        sources: [{ id: 's1', title: 'Source', url: 'https://example.com' }],
        searchTrace: [{ query: 'ontology standards', rationale: 'find standards', resultCount: 1 }],
        evidenceClaims: [{ claim: 'Validation is distinct from semantics.', evidenceBasis: 'sourced', sourceRefs: ['s1'] }],
        authorityMap: [],
        practitionerLexicon: [],
        intertextualMap: [{
          node: 'W3C SHACL',
          type: 'web standard',
          connections: ['Separates validation from semantics'],
          commonMisreadings: ['Using SHACL as ontology semantics'],
          relevance: 'Validation layer for ontology checks',
          sourceRefs: ['s1'],
        }],
        openQuestions: [],
        gaps: [],
      }),
      webSearchCalls: [{ id: 'ws_1', type: 'web_search_call' }],
      sources: [],
      citations: [],
    }),
  });

  assert.equal(packet.intertextualMap.conceptLineages[0].concept, 'W3C SHACL');
  assert.deepEqual(packet.intertextualMap.conceptLineages[0].drawsFrom, ['Separates validation from semantics']);
  assert.match(packet.intertextualMap.commonMisreadings[0], /W3C SHACL: Using SHACL/);
});

test('model-native research falls back when OpenAI returns no web-search evidence', async () => {
  const packet = await buildResearchPacket({
    runId: 'research-no-tool-evidence',
    goal: 'Help agents design better UX.',
    model: 'gpt-5.4-mini',
    modelClient: async () => ({
      text: JSON.stringify({
        sources: [],
        searchTrace: [],
        evidenceClaims: [{ claim: 'Unsourced claim.', evidenceBasis: 'sourced', sourceRefs: [] }],
        authorityMap: [],
        openQuestions: [],
        gaps: [],
      }),
      webSearchCalls: [],
      sources: [],
      citations: [],
    }),
  });

  assert.equal(packet.researchMode, 'inference');
  assert.equal(packet.researchDiagnostics.requested, true);
  assert.equal(packet.researchDiagnostics.used, false);
  assert.match(packet.gaps.join('\n'), /no tool-call or source evidence/);
});

test('required model-native research fails when OpenAI returns no web-search evidence', async () => {
  await assert.rejects(
    buildResearchPacket({
      runId: 'research-required-no-tool-evidence',
      goal: 'Help agents design better UX.',
      model: 'gpt-5.4-mini',
      config: { mode: 'required', provider: 'model_native' },
      modelClient: async () => ({
        text: JSON.stringify({
          sources: [],
          searchTrace: [],
          evidenceClaims: [],
          authorityMap: [],
          openQuestions: [],
          gaps: [],
        }),
        webSearchCalls: [],
        sources: [],
        citations: [],
      }),
    }),
    /no tool-call or source evidence/,
  );
});

test('unsupported model-native research falls back to inference labels', async () => {
  const packet = await buildResearchPacket({
    runId: 'research-003',
    goal: 'Help agents design better UX.',
    model: 'claude-fake',
    modelClient: async () => {
      throw new Error('should not call unsupported provider');
    },
  });

  assert.equal(packet.researchMode, 'inference');
  assert.equal(packet.evidenceClaims[0].evidenceBasis, 'inferred');
  assert.equal(packet.sources.length, 0);
});

test('quality gates flag sloppy ontology and deconstruction artifacts', () => {
  const ontologyReport = createOntologyQualityReport({
    ontology: {
      invocationBoundaries: { shouldNotTriggerWhen: [] },
      failureModes: ['bad'],
      qualityAxes: ['task success', 'workflow clarity'],
      authorityMap: [],
    },
    researchPacket: { researchMode: 'inference' },
  });
  assert.equal(ontologyReport.revisionRecommended, true);
  assert.ok(ontologyReport.issues.some(issue => issue.code === 'missing_authority_map'));

  const deconstructionReport = createDeconstructionQualityReport({
    parameterization: {
      championSkillHash: 'hash',
      parameters: [{ id: 'p01', improvementHypothesis: 'improve clarity' }],
    },
    championPackage: { files: [] },
  });
  assert.equal(deconstructionReport.revisionRecommended, true);
  assert.ok(deconstructionReport.issues.some(issue => issue.code === 'missing_artifact_evidence'));
});

test('ontology quality gate treats lexicon and intertext gaps as advisory warnings', () => {
  const report = createOntologyQualityReport({
    ontology: {
      invocationBoundaries: {
        shouldTriggerWhen: ['the request concerns product strategy'],
        shouldNotTriggerWhen: ['the request only asks for copy editing'],
      },
      failureModes: ['category confusion', 'positioning collapse', 'metric theater'],
      qualityAxes: ['strategic tradeoff clarity', 'category frame precision', 'decision usefulness'],
      authorityMap: [{
        name: 'Sourced authority',
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
      }],
      practitionerLexicon: [{
        term: 'positioning',
        expertMeaning: 'A market frame for strategic fit.',
        whyItMattersForThisSkill: 'It matters.',
        evalImplication: 'Check it.',
        evidenceBasis: 'inferred',
        sourceRefs: [],
      }],
    },
    researchPacket: { researchMode: 'sourced' },
  });

  assert.equal(report.revisionRecommended, false);
  assert.equal(report.issues.length, 0);
  assert.ok(report.warnings.some(warning => warning.code === 'thin_practitioner_lexicon'));
  assert.ok(report.warnings.some(warning => warning.code === 'missing_intertextual_map'));
});

test('ontology quality gate blocks sourced expert-register claims without refs', () => {
  const report = createOntologyQualityReport({
    ontology: {
      invocationBoundaries: {
        shouldTriggerWhen: ['the request concerns product strategy'],
        shouldNotTriggerWhen: ['the request only asks for copy editing'],
      },
      failureModes: ['category confusion', 'positioning collapse', 'metric theater'],
      qualityAxes: ['strategic tradeoff clarity', 'category frame precision', 'decision usefulness'],
      authorityMap: [{
        name: 'Sourced authority',
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
      }],
      practitionerLexicon: [{
        term: 'positioning',
        expertMeaning: 'A market frame for strategic fit.',
        whyItMattersForThisSkill: 'It matters for strategy.',
        evalImplication: 'Check distinction use.',
        evidenceBasis: 'sourced',
        sourceRefs: [],
      }],
      intertextualMap: {
        canonicalTexts: ['Canonical strategy text'],
        evidenceBasis: 'inferred',
        sourceRefs: [],
      },
    },
    researchPacket: { researchMode: 'sourced' },
  });

  assert.equal(report.revisionRecommended, true);
  assert.ok(report.issues.some(issue => issue.code === 'unsourced_expert_register_claims'));
});

test('ontology quality gate blocks sourced intertextual claims without refs', () => {
  const report = createOntologyQualityReport({
    ontology: {
      invocationBoundaries: {
        shouldTriggerWhen: ['the request concerns product strategy'],
        shouldNotTriggerWhen: ['the request only asks for copy editing'],
      },
      failureModes: ['category confusion', 'positioning collapse', 'metric theater'],
      qualityAxes: ['strategic tradeoff clarity', 'category frame precision', 'decision usefulness'],
      authorityMap: [{
        name: 'Sourced authority',
        evidenceBasis: 'sourced',
        sourceRefs: ['s1'],
      }],
      practitionerLexicon: Array.from({ length: 20 }, (_, index) => ({
        term: `term-${index + 1}`,
        expertMeaning: 'A precise practitioner-level distinction used in product strategy decisions.',
        whyItMattersForThisSkill: 'It lets the skill preserve expert distinctions during strategy work.',
        evalImplication: 'Evaluator can check whether the distinction is applied correctly.',
        evidenceBasis: 'inferred',
        sourceRefs: [],
      })),
      intertextualMap: {
        canonicalTexts: ['Canonical strategy text'],
        evidenceBasis: 'sourced',
        sourceRefs: [],
        conceptLineages: [{
          concept: 'positioning',
          drawsFrom: ['segmentation'],
          evidenceBasis: 'sourced',
          sourceRefs: [],
        }],
      },
    },
    researchPacket: { researchMode: 'sourced' },
  });

  assert.equal(report.revisionRecommended, true);
  assert.ok(report.issues.some(issue => issue.code === 'unsourced_expert_register_claims'));
});

test('deconstruction quality gate treats normalized placeholders as missing evidence', () => {
  const report = createDeconstructionQualityReport({
    parameterization: {
      championSkillHash: 'hash',
      parameters: [{
        id: 'p01',
        improvementHypothesis: 'Change activation boundaries for better precision.',
        artifactEvidence: ['No artifact evidence returned; treat this parameter as low-confidence.'],
        couplingNotes: ['No coupling notes returned.'],
      }],
    },
    championPackage: { files: [{ path: 'SKILL.md' }] },
  });

  assert.ok(report.issues.some(issue => issue.code === 'missing_artifact_evidence'));
  assert.ok(report.warnings.some(warning => warning.code === 'missing_coupling_notes'));
});
