import { validateRecommendation } from './schema.js';
import { callModel } from './model-client.js';

const ALLOWED_DECISIONS = ['promote', 'keep_current', 'request_new_experiment'];
const ALLOWED_CONFIDENCE = ['low', 'medium', 'high'];

// Plain-language helpers so user-facing text never leaks internal terms (skillA/B, duel, gate...).
function candidateLabel(id) {
  if (id === 'candidate-a') return 'Candidate A';
  if (id === 'candidate-b') return 'Candidate B';
  if (id === 'challenger') return 'the challenger';
  return id || 'the candidate';
}
function duelWinnerLabel(winner) {
  if (winner === 'skillA') return 'Candidate A';
  if (winner === 'skillB') return 'Candidate B';
  return 'neither version';
}
function cleanParamList(ids) {
  return (ids || []).map(id => String(id).replace(/^p\d+-/, '').replace(/_/g, ' ')).join(', ');
}

export async function analyzeRun({
  mode = 'policy',
  runId,
  goal,
  state,
  history,
  ontology,
  parameterization,
  experimentPlan,
  candidateA,
  candidateB,
  challenger = null,
  candidateDuel,
  challenge = null,
  model = null,
  apiKeys = {},
  modelClient = callModel,
  promotion = null,
}) {
  const policy = createPolicyRecommendation({
    runId,
    state,
    candidateDuel,
    challenge,
    candidateA,
    candidateB,
    challenger,
    experimentPlan,
    promotion,
  });

  if (mode !== 'real') return policy;
  if (!model) throw new Error('Real analyst requires a model');

  const text = await modelClient({
    model,
    apiKeys,
    systemPrompt: 'You are the Skill RSI analyst. Return only valid JSON matching AnalystRecommendation.',
    messages: [{
      role: 'user',
      content: buildAnalystPrompt({
        runId,
        goal,
        state,
        history,
        ontology,
        parameterization,
        experimentPlan,
        candidateA,
        candidateB,
        challenger,
        candidateDuel,
        challenge,
        policy,
      }),
    }],
    maxTokens: 8192,
    jsonMode: true,
  });

  const analyst = normalizeAnalystRecommendation(parseJson(text), {
    runId,
    policy,
    candidateA,
    candidateB,
    challenger,
  });
  return mergePolicyAndAnalyst({ policy, analyst });
}

export function createPolicyRecommendation({
  runId,
  state,
  candidateDuel,
  challenge = null,
  candidateA,
  candidateB,
  challenger = null,
  experimentPlan,
  promotion = null,
}) {
  const activeChallenge = challenge || null;
  const decisiveEval = activeChallenge || candidateDuel;
  const challengeMode = experimentPlan?.competitionMode !== 'cold_start_duel' && activeChallenge;
  const duelWinnerCandidateId = candidateDuel ? getCandidateWinnerId(candidateDuel, candidateDuel.stats.winner) : null;
  const coldStartBootstrap = !challengeMode && !state.currentChampion && candidateDuel
    ? chooseColdStartBootstrapWinner(candidateDuel)
    : null;
  const candidateWinnerId = challengeMode
    ? (activeChallenge.stats.winner === 'skillA' ? 'challenger' : null)
    : (duelWinnerCandidateId || coldStartBootstrap?.candidateId || null);
  const scoreDelta = activeChallenge
    ? Math.max(0, decisiveEval.stats.scoreDelta || 0)
    : Math.abs(decisiveEval.stats.scoreDelta || 0);
  const winDelta = Math.abs((decisiveEval.stats.skillAWins || 0) - (decisiveEval.stats.skillBWins || 0));
  const hasChampion = Boolean(state.currentChampion);
  const thresholds = {
    minScoreDelta: promotion?.minScoreDelta ?? 4,
    minWinDelta: promotion?.minWinDelta ?? 2,
    maxStablePromptRegression: promotion?.maxStablePromptRegression ?? 2,
    minEvalCompletionRate: promotion?.minEvalCompletionRate ?? 0.8,
  };
  const criticalRegressions = activeChallenge
    ? findStablePromptRegressions(activeChallenge, thresholds.maxStablePromptRegression)
    : [];
  const completionRate = decisiveEval.stats?.confidence?.completionRate ?? 1;
  // First run (no champion yet) uses a lenient gate; later runs use the configured margins.
  const minScoreDelta = hasChampion ? thresholds.minScoreDelta : 1;
  const minWinDelta = hasChampion ? thresholds.minWinDelta : 1;
  const canStrictlyPromote = candidateWinnerId
    && scoreDelta >= minScoreDelta
    && winDelta >= minWinDelta
    && criticalRegressions.length === 0
    && completionRate >= thresholds.minEvalCompletionRate;
  const canBootstrapPromote = coldStartBootstrap
    && candidateWinnerId === coldStartBootstrap.candidateId
    && criticalRegressions.length === 0
    && completionRate >= thresholds.minEvalCompletionRate;
  const canPromote = canStrictlyPromote || canBootstrapPromote;
  const promotedCandidateId = canPromote ? candidateWinnerId : null;
  const provisionalBootstrap = Boolean(promotedCandidateId && !canStrictlyPromote && canBootstrapPromote);

  return validateRecommendation({
    runId,
    decision: promotedCandidateId ? 'promote' : hasChampion ? 'keep_current' : 'request_new_experiment',
    recommendedChampionCandidateId: promotedCandidateId,
    confidence: provisionalBootstrap ? 'low' : promotedCandidateId && scoreDelta >= minScoreDelta + 3 ? 'high' : promotedCandidateId ? 'medium' : 'low',
    reasoning: promotedCandidateId
      ? (hasChampion
        ? `${candidateLabel(promotedCandidateId)} beat the current champion in the head-to-head test by a clear margin, so it becomes the new champion.`
        : provisionalBootstrap
          ? `${candidateLabel(promotedCandidateId)} becomes a provisional first champion because the first run produced usable evidence but no clear aggregate winner. The next loop should challenge it directly.`
          : `${candidateLabel(promotedCandidateId)} won the head-to-head test and becomes the first champion.`)
      : (hasChampion
        ? 'No new version beat the current champion by a clear enough margin, so the current champion stays.'
        : 'Neither version was a clear enough winner to crown a champion yet.'),
    observations: [
      candidateDuel
        ? `In the cold-start head-to-head test, ${duelWinnerLabel(candidateDuel.stats.winner)} scored higher.`
        : `In the challenger test, ${activeChallenge?.stats?.winner === 'skillA' ? 'the challenger scored higher' : activeChallenge?.stats?.winner === 'skillB' ? 'the current champion scored higher' : 'the result was tied'}.`,
      activeChallenge
        ? `Against the current champion, ${activeChallenge.stats.winner === 'skillA' ? 'the challenger came out ahead' : activeChallenge.stats.winner === 'skillB' ? 'the current champion held its lead' : 'it was a tie'}.`
        : 'There was no current champion to compare against yet.',
      provisionalBootstrap
        ? `The aggregate score tied, but ${candidateLabel(promotedCandidateId)} had the stronger prompt-level win pattern, so it is being used as a low-confidence starting point instead of leaving the project without a champion.`
        : null,
      criticalRegressions.length
        ? `Stable-prompt regression blocked promotion on ${criticalRegressions.length} prompt(s).`
        : 'No critical stable-prompt regression was detected.',
      completionRate < thresholds.minEvalCompletionRate
        ? `Evaluation reliability blocked promotion because only ${Math.round(completionRate * 100)}% of prompts completed.`
        : 'Evaluation completion was high enough for promotion decisions.',
      experimentPlan.focusParameterIds.length
        ? `This round tested changes to: ${cleanParamList(experimentPlan.focusParameterIds)}.`
        : 'No specific change was isolated this round.',
    ].filter(Boolean),
    nextRoundGuidance: {
      vary: promotedCandidateId ? 'next highest-priority untested parameter' : 'evaluation batch or experiment arm contrast',
      preserve: promotedCandidateId
        ? promotedCandidateId === 'challenger' ? challenger.strategy : promotedCandidateId === 'candidate-a' ? candidateA.strategy : candidateB.strategy
        : 'current champion and validated package structure',
      investigate: promotedCandidateId
        ? 'whether the promoted parameter improvement holds against stable prompts'
        : 'whether the eval batch had enough signal or needs better parameter-targeted prompts',
    },
    resultSummary: {
      ...summarizeEval(decisiveEval),
      criticalRegressions,
      provisionalBootstrap,
      bootstrapReason: provisionalBootstrap ? coldStartBootstrap.reason : null,
    },
    signalAssessment: {
      strongSignals: promotedCandidateId && !provisionalBootstrap ? [`${promotedCandidateId} cleared deterministic promotion thresholds.`] : [],
      weakSignals: promotedCandidateId && provisionalBootstrap
        ? [coldStartBootstrap.reason, 'The aggregate score did not produce a clear winner.']
        : promotedCandidateId ? [] : [
        'The score or win margin was below promotion threshold.',
        ...criticalRegressions.map(item => `Stable regression on ${item.promptId}: ${item.delta}`),
        ...(completionRate < thresholds.minEvalCompletionRate ? ['Too many prompt-level eval failures'] : []),
      ],
      likelyNoise: scoreDelta < minScoreDelta ? ['Low score margin'] : [],
      inconclusiveAreas: promotedCandidateId ? [] : ['Promotion confidence'],
    },
    actionableInsights: promotedCandidateId
      ? [`Preserve ${promotedCandidateId}'s treatment of ${experimentPlan.focusParameterIds.join(', ')}.`]
      : ['Run a sharper experiment or use a larger batch before promotion.'],
    nextExperimentNotes: promotedCandidateId
      ? provisionalBootstrap
        ? ['Treat this as a provisional baseline and challenge it immediately with a controlled tweak.']
        : ['Deconstruct the promoted champion before choosing the next surface.']
      : ['Review prompt-level judge reasoning before retrying this parameter family.'],
    historySummary: promotedCandidateId
      ? provisionalBootstrap
        ? `Selected ${candidateLabel(promotedCandidateId)} as a provisional first champion from usable but tied cold-start evidence.`
        : `Promoted ${candidateLabel(promotedCandidateId)} as the new champion.`
      : 'Kept the current champion; no clear winner this round.',
    promptBankRecommendations: diagnosePromptBank(activeChallenge || candidateDuel),
  });
}

function mergePolicyAndAnalyst({ policy, analyst }) {
  if (policy.decision === 'promote'
    && policy.resultSummary?.provisionalBootstrap
    && analyst.decision !== 'promote') {
    return validateRecommendation({
      ...policy,
      observations: [
        ...policy.observations,
        ...analyst.observations,
        'The analysis was cautious, but cold-start bootstrap policy selected a provisional champion so the next loop can challenge a concrete baseline.',
      ],
      nextExperimentNotes: [
        ...(policy.nextExperimentNotes || []),
        ...(analyst.nextExperimentNotes || []),
      ],
    });
  }

  if (analyst.decision !== 'promote') {
    return validateRecommendation({
      ...analyst,
      recommendedChampionCandidateId: null,
      observations: [
        ...policy.observations,
        ...analyst.observations,
        'The analysis did not support promoting a new version this round.',
      ],
    });
  }

  if (policy.decision !== 'promote') {
    return validateRecommendation({
      ...policy,
      decision: 'keep_current',
      recommendedChampionCandidateId: null,
      confidence: 'low',
      reasoning: 'A new version looked promising, but it didn’t beat the current champion by a clear enough margin, so the champion stays for now.',
      observations: [
        ...policy.observations,
        ...analyst.observations,
        'The winning margin wasn’t large enough to promote under our promotion rules.',
      ],
    });
  }

  if (analyst.confidence === 'low') {
    return validateRecommendation({
      ...analyst,
      decision: 'keep_current',
      recommendedChampionCandidateId: null,
      observations: [
        ...policy.observations,
        ...analyst.observations,
        'The result was too uncertain to promote, so the current champion stays.',
      ],
    });
  }

  return validateRecommendation({
    ...analyst,
    decision: 'promote',
    recommendedChampionCandidateId: policy.recommendedChampionCandidateId,
    observations: [
      ...policy.observations,
      ...analyst.observations,
      'Both the analysis and the promotion rules agreed this version is better.',
    ],
  });
}

function buildAnalystPrompt({
  runId,
  goal,
  state,
  history,
  ontology,
  parameterization,
  experimentPlan,
  candidateA,
  candidateB,
  challenger,
  candidateDuel,
  challenge,
  policy,
}) {
  return `Interpret this Skill RSI run and recommend the next state.

Goal: ${goal}
Run ID: ${runId}
Current champion: ${state.currentChampion?.skillHash || 'none'}

Ontology:
${formatBlock(ontology)}

Parameterization summary:
${parameterization?.summary || 'None'}

Experiment plan:
${formatBlock(experimentPlan)}

Candidates:
${formatBlock(experimentPlan?.competitionMode === 'cold_start_duel' ? { candidateA, candidateB } : { champion: state.currentChampion, challenger })}

History summary:
${formatBlock({
  trajectory: history?.trajectory?.slice(-8) || [],
  parameterLog: history?.parameterLog?.slice(-16) || [],
})}

Cold-start duel summary:
${formatBlock(summarizeEval(candidateDuel))}

Champion challenge summary:
${formatBlock(challenge ? summarizeEval(challenge) : null)}

Deterministic policy recommendation:
${formatBlock(policy)}

Return JSON with:
runId, decision, recommendedChampionCandidateId, confidence, reasoning, observations, nextRoundGuidance {vary, preserve, investigate}, resultSummary, signalAssessment, actionableInsights, nextExperimentNotes, historySummary.

Rules:
- Use decision promote only when evidence is meaningful and no critical regression is visible.
- Prefer keep_current or request_new_experiment when results are close, noisy, or prompt quality looks suspect.
- Do not use edit_current; surgical editing is not an implemented run branch yet.
- recommendedChampionCandidateId must be challenger for champion-present runs, or candidate-a/candidate-b for cold-start runs, only when decision is promote.
- Write reasoning, historySummary, and every observation for a non-technical reader who has not seen any of the internals. Use plain language: say what happened and what it means. In cold-start runs, refer to the two versions as "Candidate A" and "Candidate B". In champion-present runs, refer to them as "the challenger" and "the current champion". Never use internal terms such as "policy gate", "deterministic policy", "duel", "champion gate", "skillA"/"skillB", "raw scores", "promotion signal", "parameter ids", or content hashes. Keep reasoning to 1-3 sentences.`;
}

function normalizeAnalystRecommendation(value, { runId, policy, candidateA, candidateB, challenger }) {
  const decision = ALLOWED_DECISIONS.includes(value?.decision) ? value.decision : policy.decision;
  const confidence = ALLOWED_CONFIDENCE.includes(value?.confidence) ? value.confidence : 'low';
  let recommendedChampionCandidateId = value?.recommendedChampionCandidateId || null;
  const allowedIds = [candidateA?.candidateId, candidateB?.candidateId, challenger?.candidateId].filter(Boolean);
  if (!allowedIds.includes(recommendedChampionCandidateId)) {
    recommendedChampionCandidateId = decision === 'promote' ? policy.recommendedChampionCandidateId : null;
  }

  return validateRecommendation({
    ...value,
    runId: value?.runId || runId,
    decision,
    recommendedChampionCandidateId,
    confidence,
    reasoning: typeof value?.reasoning === 'string' && value.reasoning.trim()
      ? value.reasoning
      : policy.reasoning,
    observations: normalizeArray(value?.observations, policy.observations),
    nextRoundGuidance: {
      vary: value?.nextRoundGuidance?.vary || policy.nextRoundGuidance.vary,
      preserve: value?.nextRoundGuidance?.preserve || policy.nextRoundGuidance.preserve,
      investigate: value?.nextRoundGuidance?.investigate || policy.nextRoundGuidance.investigate,
    },
    resultSummary: value?.resultSummary || policy.resultSummary,
    signalAssessment: value?.signalAssessment || policy.signalAssessment,
    actionableInsights: normalizeArray(value?.actionableInsights, policy.actionableInsights),
    nextExperimentNotes: normalizeArray(value?.nextExperimentNotes, policy.nextExperimentNotes),
    historySummary: value?.historySummary || policy.historySummary,
    promptBankRecommendations: {
      promotePromptIds: normalizeArray(value?.promptBankRecommendations?.promotePromptIds || value?.promotePromptIds, policy.promptBankRecommendations?.promotePromptIds || []),
      retirePromptIds: normalizeArray(value?.promptBankRecommendations?.retirePromptIds || value?.retirePromptIds, policy.promptBankRecommendations?.retirePromptIds || []),
      promptBankNotes: normalizeArray(value?.promptBankRecommendations?.promptBankNotes || value?.promptBankNotes, policy.promptBankRecommendations?.promptBankNotes || []),
    },
  });
}

function diagnosePromptBank(evalRun) {
  const promotePromptIds = [];
  const retirePromptIds = [];
  const promptBankNotes = [];

  for (const evaluation of evalRun.evaluations || []) {
    const prompt = evaluation.prompt || {};
    const judge = evaluation.judge || {};
    const delta = Math.abs((judge.scoreA || 0) - (judge.scoreB || 0));
    if (prompt.bucket === 'exploration' && judge.winner !== 'tie' && delta >= 2 && prompt.parameterIds?.length) {
      promotePromptIds.push(prompt.id);
      promptBankNotes.push(`Candidate ${prompt.id}: exploration prompt produced score delta ${delta}; prompt-bank update must verify it before stable promotion.`);
    }
    if (prompt.bucket !== 'stable' && (judge.winner === 'tie' || delta === 0 || !prompt.parameterIds?.length || !judge.reasoning)) {
      retirePromptIds.push(prompt.id);
      promptBankNotes.push(`Retire ${prompt.id}: weak or missing signal.`);
    } else if (prompt.bucket === 'stable' && (judge.winner === 'tie' || delta === 0)) {
      promptBankNotes.push(`Keep ${prompt.id}: stable prompt tied and remains useful as a neutral anchor.`);
    }
  }

  return {
    promotePromptIds: unique(promotePromptIds),
    retirePromptIds: unique(retirePromptIds.filter(id => !promotePromptIds.includes(id))),
    promptBankNotes,
  };
}

function summarizeEval(evalRun) {
  if (!evalRun) return null;
  return {
    runId: evalRun.runId,
    mode: evalRun.mode,
    winner: evalRun.stats.winner,
    wins: {
      skillA: evalRun.stats.skillAWins,
      skillB: evalRun.stats.skillBWins,
      ties: evalRun.stats.ties,
    },
    meanScore: {
      skillA: (evalRun.stats.completedEvals || evalRun.stats.totalEvals) ? evalRun.stats.totalScoreA / (evalRun.stats.completedEvals || evalRun.stats.totalEvals) : 0,
      skillB: (evalRun.stats.completedEvals || evalRun.stats.totalEvals) ? evalRun.stats.totalScoreB / (evalRun.stats.completedEvals || evalRun.stats.totalEvals) : 0,
    },
    scoreDelta: evalRun.stats.scoreDelta,
    criticalRegressions: [],
    promptSignals: evalRun.evaluations.map(evaluation => ({
      promptId: evaluation.prompt.id,
      bucket: evaluation.prompt.bucket,
      parameterIds: evaluation.prompt.parameterIds || [],
      winner: evaluation.judge.winner,
      scoreA: evaluation.judge.scoreA,
      scoreB: evaluation.judge.scoreB,
      reasoning: evaluation.judge.reasoning,
    })),
  };
}

function findStablePromptRegressions(evalRun, maxRegression) {
  if (!evalRun || !Array.isArray(evalRun.evaluations)) return [];
  return evalRun.evaluations
    .filter(evaluation => evaluation?.prompt?.bucket === 'stable')
    .map(evaluation => {
      const scoreA = Number(evaluation?.judge?.scoreA || 0);
      const scoreB = Number(evaluation?.judge?.scoreB || 0);
      return {
        promptId: evaluation.prompt.id,
        scoreA,
        scoreB,
        delta: scoreA - scoreB,
        reasoning: evaluation?.judge?.reasoning || '',
      };
    })
    .filter(item => item.delta <= -Math.abs(maxRegression));
}

function getCandidateWinnerId(evalRun, winner) {
  if (!evalRun || winner === 'tie') return null;
  if (winner === 'skillA') return 'candidate-a';
  if (winner === 'skillB') return 'candidate-b';
  return null;
}

function chooseColdStartBootstrapWinner(evalRun) {
  if (!evalRun?.stats) return null;
  const completionRate = evalRun.stats?.confidence?.completionRate ?? 1;
  if (completionRate <= 0) return null;
  const skillAWins = Number(evalRun.stats.skillAWins || 0);
  const skillBWins = Number(evalRun.stats.skillBWins || 0);
  const promptWinDelta = Math.abs(skillAWins - skillBWins);
  if (promptWinDelta >= 2) {
    return {
      candidateId: skillAWins > skillBWins ? 'candidate-a' : 'candidate-b',
      reason: `Prompt-level wins favored ${skillAWins > skillBWins ? 'Candidate A' : 'Candidate B'} by ${promptWinDelta}.`,
    };
  }

  const totalScoreA = Number(evalRun.stats.totalScoreA || 0);
  const totalScoreB = Number(evalRun.stats.totalScoreB || 0);
  const scoreDelta = Math.abs(totalScoreA - totalScoreB);
  if (scoreDelta >= 1) {
    return {
      candidateId: totalScoreA > totalScoreB ? 'candidate-a' : 'candidate-b',
      reason: `Aggregate score favored ${totalScoreA > totalScoreB ? 'Candidate A' : 'Candidate B'} by ${scoreDelta}.`,
    };
  }

  return null;
}

function parseJson(text) {
  const match = String(text || '').match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((match ? match[1] : text).trim());
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return [value];
  return fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function formatBlock(value, maxChars = 16000) {
  if (!value) return 'None.';
  const text = JSON.stringify(value, null, 2);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...[truncated]` : text;
}
