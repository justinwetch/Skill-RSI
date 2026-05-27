import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResearchPacket,
  createDeconstructionQualityReport,
  createOntologyQualityReport,
} from '../src/lib/research.js';
import { validateResearchPacket } from '../src/lib/schema.js';

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
