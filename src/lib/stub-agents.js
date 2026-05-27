import path from 'node:path';
import { ensureDir, writeJson, writeText } from './store.js';

export function createStubOntology({ projectId, goal, runId }) {
  return {
    runId,
    skillGoal: goal,
    targetUsers: ['agent using a generated skill'],
    targetTasks: ['follow a skill workflow', 'produce a useful artifact', 'validate output quality'],
    invocationBoundaries: {
      shouldTriggerWhen: ['the user asks for this skill domain'],
      shouldNotTriggerWhen: ['the request is unrelated to the project goal'],
    },
    inputSurface: ['goal', 'context', 'current champion', 'history summary'],
    outputArtifacts: ['SKILL.md', 'references when needed', 'validation notes'],
    requiredKnowledge: ['Agent Skill structure', 'progressive disclosure', 'evaluation criteria'],
    referencePoints: ['stub reference point for vertical slice'],
    adjacentDomainsToBorrowFrom: ['test design', 'prompt engineering'],
    optionalResources: {
      references: ['references/domain-notes.md'],
      scripts: [],
      assets: [],
    },
    platformAssumptions: {
      portableAgentSkills: ['root SKILL.md', 'YAML frontmatter', 'references directory'],
      clientSpecificFeatures: [],
    },
    failureModes: ['overbroad trigger', 'bloated SKILL.md', 'missing validation step'],
    qualityAxes: ['activation precision', 'workflow clarity', 'validation usefulness'],
    evalPromptTaxonomy: ['easy direct request', 'ambiguous request', 'edge case request'],
    candidateStrategySpace: ['lean procedural', 'reference-rich'],
    openQuestions: [`What real domain evidence should ${projectId} use?`],
  };
}

export function createStubParameterization({ runId, championSkillHash }) {
  const surfaces = [
    'activation_metadata',
    'trigger_boundaries',
    'workflow_sequence',
    'decision_heuristics',
    'context_loading_strategy',
    'reference_architecture',
    'script_strategy',
    'output_contract',
    'validation_strategy',
    'failure_mode_handling',
    'edge_case_coverage',
    'progressive_disclosure_budget',
  ];

  return {
    runId,
    championSkillHash: championSkillHash || 'none',
    summary: 'Stub parameterization for proving loop mechanics.',
    parameters: surfaces.map((surface, index) => ({
      id: `p${String(index + 1).padStart(2, '0')}-${surface}`,
      surface,
      currentImplementation: 'stub baseline',
      improvementHypothesis: `Changing ${surface} should produce an observable score delta in stub evals.`,
      expectedBenefit: 'clearer generated skill behavior',
      regressionRisk: 'could reduce generality',
      evidenceFromHistory: [],
      possibleMutations: ['increase specificity', 'preserve current behavior'],
      measurementPlan: 'compare candidate scores on stub prompt batch',
      priority: index < 3 ? 'high' : 'medium',
      confidence: 'low',
      granularity: index < 2 ? 'micro' : 'section',
    })),
    crossParameterInteractions: [{
      parameterIds: ['p03-workflow_sequence', 'p09-validation_strategy'],
      interaction: 'Validation placement depends on workflow order.',
      risk: 'Changing both at once can obscure which one caused score movement.',
    }],
    highestLeverageHypotheses: ['Test whether a stricter validation strategy improves score consistency.'],
    doNotTouchYet: [],
    suggestedExperimentFamilies: ['one-parameter challenger test'],
  };
}

export function createStubExperimentPlan({ runId, runNumber, parameterization, competitionMode = 'cold_start_duel' }) {
  const focus = parameterization.parameters.slice(0, Math.min(3, parameterization.parameters.length));
  const base = {
    runId,
    competitionMode,
    experimentQuestion: `Stub run ${runNumber}: does targeted specificity beat the current baseline?`,
    focusParameterIds: focus.map(parameter => parameter.id),
    controlledParameterIds: parameterization.parameters.slice(3).map(parameter => parameter.id),
    hypothesis: 'A more explicit workflow and validation surface will score better in the stub harness.',
    evalFocus: {
      promptTaxonomyTargets: ['easy direct request', 'edge case request'],
      criteriaEmphasis: ['workflow clarity', 'validation usefulness'],
      expectedObservableDifferences: ['candidate step ordering', 'validation detail'],
    },
    successMetrics: ['stub total score', 'no schema validation failure'],
    promotionRisks: ['stub scores are deterministic placeholders'],
    reasonNotTestingOtherHighPriorityParameters: ['vertical slice should keep the experiment small'],
  };

  if (competitionMode === 'cold_start_duel') {
    return {
      ...base,
      arms: {
      candidateA: {
        strategyName: 'specific-workflow',
        mutationInstructions: ['make the workflow sequence more explicit', 'add a validation checklist'],
        constraints: ['keep package shape minimal'],
        expectedStrengths: ['clearer steps'],
        expectedWeaknesses: ['less flexible wording'],
      },
      candidateB: {
        strategyName: 'reference-rich',
        mutationInstructions: ['move detail into a reference file', 'keep SKILL.md shorter'],
        constraints: ['preserve trigger boundaries'],
        expectedStrengths: ['better progressive disclosure'],
        expectedWeaknesses: ['more package complexity'],
      },
      },
    };
  }

  return {
    ...base,
    arms: {
      challenger: {
        strategyName: competitionMode === 'high_divergence_reset' ? 'high-divergence-reset' : 'targeted-challenger',
        mutationInstructions: competitionMode === 'high_divergence_reset'
          ? ['use a substantially different structure while preserving proven champion constraints']
          : ['make a narrow challenger mutation against the current champion', 'preserve unrelated champion behavior'],
        constraints: ['keep package shape valid'],
        expectedStrengths: ['controlled improvement attempt'],
        expectedWeaknesses: ['may not beat champion'],
      },
    },
  };
}

export async function writeStubCandidate({ candidateDir, candidateId, arm, projectId, goal, runId, changedParameterIds }) {
  const skillDir = path.join(candidateDir, 'skill');
  await ensureDir(skillDir);

  // Offline placeholder skill. Kept as a clean, valid Agent Skill (name + description only,
  // no Skill RSI run metadata in the package) so even mock/dev runs don't leak internals.
  const skill = `---
name: ${projectId}
description: ${goal}
---

# ${projectId}

${goal}

## Approach

This version takes a ${arm.strategyName} approach.

## Workflow

1. Read the user's request and confirm it fits this skill.
2. Produce the appropriate artifact for the request.
3. Validate the result against the user's goal before returning it.
`;

  await writeText(path.join(skillDir, 'SKILL.md'), skill);

  const rationale = {
    candidateId,
    experimentArm: candidateId,
    strategy: arm.strategyName,
    changedParameterIds,
    skillPath: skillDir,
    rationale: `Stub candidate using ${arm.strategyName}.`,
    expectedAdvantages: arm.expectedStrengths,
    expectedRisks: arm.expectedWeaknesses,
    selfCritique: ['This is a deterministic placeholder and not a real skill improvement.'],
  };

  await writeJson(path.join(candidateDir, 'rationale.json'), rationale);
  await writeText(path.join(candidateDir, 'rationale.md'), `# ${candidateId} Rationale

Strategy: ${arm.strategyName}

Changed parameters: ${changedParameterIds.join(', ')}
`);
  await writeJson(path.join(candidateDir, 'review.json'), {
    candidateId,
    blockingIssues: [],
    recommendedEdits: [],
    nonIssues: ['Stub candidate is allowed for Chunk 1 vertical-slice testing.'],
    overfittingRisk: 'low',
    approveForEval: true,
  });

  return rationale;
}
