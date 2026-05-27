import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runHeadlessEval } from '../src/lib/evaluator.js';

test('runs a mock headless evaluation over two skill packages', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-eval-'));
  const skillA = await writeSkill(cwd, 'skill-a', 'Skill A');
  const skillB = await writeSkill(cwd, 'skill-b', 'Skill B');
  const promptsPath = path.join(cwd, 'prompts.json');
  const criteriaPath = path.join(cwd, 'criteria.json');
  const outputPath = path.join(cwd, 'result.json');

  await fs.writeFile(promptsPath, JSON.stringify([
    { id: 'p1', text: 'Do the thing.' },
    { id: 'p2', text: 'Handle an edge case.' },
  ]));
  await fs.writeFile(criteriaPath, JSON.stringify([
    { id: 'correctness', name: 'Correctness' },
    { id: 'clarity', name: 'Clarity' },
  ]));

  const result = await runHeadlessEval({
    skillAPath: skillA,
    skillBPath: skillB,
    promptsPath,
    criteriaPath,
    outputPath,
    mode: 'mock',
    runId: 'run-eval-001',
  });

  assert.equal(result.evaluations.length, 2);
  assert.equal(result.stats.totalEvals, 2);
  assert.ok(['skillA', 'skillB', 'tie'].includes(result.stats.winner));
  assert.notEqual(result.blindLabels.skillA, result.blindLabels.skillB);

  const written = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  assert.equal(written.runId, 'run-eval-001');
});

test('runs a real text evaluation with an injected model client', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-real-eval-'));
  const skillA = await writeSkill(cwd, 'skill-a', 'Skill A');
  const skillB = await writeSkill(cwd, 'skill-b', 'Skill B');
  const promptsPath = path.join(cwd, 'prompts.json');
  const criteriaPath = path.join(cwd, 'criteria.json');
  const calls = [];

  await fs.writeFile(promptsPath, JSON.stringify([
    { id: 'p1', text: 'Do the thing.' },
  ]));
  await fs.writeFile(criteriaPath, JSON.stringify([
    { id: 'correctness', name: 'Correctness', description: 'Correct output' },
  ]));

  const result = await runHeadlessEval({
    skillAPath: skillA,
    skillBPath: skillB,
    promptsPath,
    criteriaPath,
    mode: 'real',
    runId: 'run-real-001',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    maxTokens: 1234,
    judgeMaxTokens: 567,
    modelClient: async request => {
      calls.push(request);
      if (request.jsonMode) {
        return JSON.stringify({
          winner: 'skillA',
          scoreA: 5,
          scoreB: 3,
          breakdown: {
            skillA: { correctness: 5 },
            skillB: { correctness: 3 },
          },
          reasoning: 'Skill A was clearer.',
        });
      }
      return request.messages[0].content.includes('# Skill A')
        ? 'Generated answer from A'
        : 'Generated answer from B';
    },
  });

  assert.equal(result.mode, 'real');
  assert.equal(result.evaluations.length, 1);
  assert.equal(result.evaluations[0].judge.winner, 'skillA');
  assert.equal(result.stats.winner, 'skillA');
  assert.equal(calls.length, 3);
  assert.equal(result.modelMetadata.generationModel, 'fake-gen-model');
  assert.equal(result.modelMetadata.judgeModel, 'fake-judge-model');
  assert.equal(result.modelMetadata.generationMaxTokens, 1234);
  assert.equal(result.modelMetadata.judgeMaxTokens, 567);
  assert.equal(result.modelMetadata.retryPolicy.generationMaxAttempts, 2);
  assert.ok(result.timing.elapsedMs >= 0);
  assert.ok(result.hashes.prompts);
  assert.equal(result.evaluations[0].status, 'complete');
  assert.ok(result.evaluations[0].results[result.blindLabels.skillA].contentHash);
  assert.match(result.evaluations[0].judge.rawResponse, /Skill A was clearer/);
  assert.deepEqual(result.evaluations[0].judge.parsedScores.breakdown.skillA, { correctness: 5 });
});

test('real evaluation records per-prompt generation failure without failing whole run', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-real-eval-failure-'));
  const skillA = await writeSkill(cwd, 'skill-a', 'Skill A');
  const skillB = await writeSkill(cwd, 'skill-b', 'Skill B');
  const promptsPath = path.join(cwd, 'prompts.json');
  const criteriaPath = path.join(cwd, 'criteria.json');
  let callCount = 0;

  await fs.writeFile(promptsPath, JSON.stringify([
    { id: 'p1', text: 'Do the first thing.' },
    { id: 'p2', text: 'Do the second thing.' },
  ]));
  await fs.writeFile(criteriaPath, JSON.stringify([
    { id: 'correctness', name: 'Correctness', description: 'Correct output' },
  ]));

  const result = await runHeadlessEval({
    skillAPath: skillA,
    skillBPath: skillB,
    promptsPath,
    criteriaPath,
    mode: 'real',
    runId: 'run-real-failure-001',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    retryPolicy: { generationMaxAttempts: 1, judgeMaxAttempts: 1 },
    modelClient: async request => {
      callCount += 1;
      if (!request.jsonMode && request.messages[0].content.includes('Do the first thing.')) {
        throw new Error('generation unavailable');
      }
      if (request.jsonMode) {
        return JSON.stringify({
          winner: 'skillB',
          scoreA: 2,
          scoreB: 4,
          breakdown: {
            skillA: { correctness: 2 },
            skillB: { correctness: 4 },
          },
          reasoning: 'Skill B handled the prompt better.',
        });
      }
      return 'Generated answer';
    },
  });

  assert.equal(result.evaluations.length, 2);
  assert.equal(result.evaluations[0].status, 'failed');
  assert.equal(result.evaluations[0].judge.status, 'skipped');
  assert.equal(result.evaluations[0].judge.failures.length, 2);
  assert.equal(result.evaluations[1].status, 'complete');
  assert.equal(result.stats.totalEvals, 2);
  assert.equal(result.stats.completedEvals, 1);
  assert.equal(result.stats.failedEvals, 1);
  assert.equal(result.stats.winner, 'skillB');
  assert.equal(result.stats.confidence.level, 'low');
  assert.ok(callCount >= 5);
});

test('real evaluation retries judge parsing failures and records attempt metadata', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-real-eval-retry-'));
  const skillA = await writeSkill(cwd, 'skill-a', 'Skill A');
  const skillB = await writeSkill(cwd, 'skill-b', 'Skill B');
  const promptsPath = path.join(cwd, 'prompts.json');
  const criteriaPath = path.join(cwd, 'criteria.json');
  let judgeCalls = 0;

  await fs.writeFile(promptsPath, JSON.stringify([{ id: 'p1', text: 'Do the thing.' }]));
  await fs.writeFile(criteriaPath, JSON.stringify([{ id: 'correctness', name: 'Correctness', description: 'Correct output' }]));

  const result = await runHeadlessEval({
    skillAPath: skillA,
    skillBPath: skillB,
    promptsPath,
    criteriaPath,
    mode: 'real',
    runId: 'run-real-retry-001',
    generationModel: 'fake-gen-model',
    judgeModel: 'fake-judge-model',
    retryPolicy: { generationMaxAttempts: 1, judgeMaxAttempts: 2 },
    modelClient: async request => {
      if (!request.jsonMode) return 'Generated answer';
      judgeCalls += 1;
      if (judgeCalls === 1) return 'not json';
      return JSON.stringify({
        winner: 'skillA',
        scoreA: 5,
        scoreB: 3,
        breakdown: {
          skillA: { correctness: 5 },
          skillB: { correctness: 3 },
        },
        reasoning: 'Recovered judge response.',
      });
    },
  });

  assert.equal(result.evaluations[0].status, 'complete');
  assert.equal(result.evaluations[0].judge.attempts, 2);
  assert.equal(result.evaluations[0].judge.failures.length, 1);
  assert.match(result.evaluations[0].judge.failures[0].message, /invalid JSON/);
  assert.equal(result.evaluations[0].judge.failures[0].rawResponse, 'not json');
});

test('real evaluation requires model information at evaluator boundary', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-real-models-'));
  const skillA = await writeSkill(cwd, 'skill-a', 'Skill A');
  const skillB = await writeSkill(cwd, 'skill-b', 'Skill B');
  const promptsPath = path.join(cwd, 'prompts.json');
  const criteriaPath = path.join(cwd, 'criteria.json');

  await fs.writeFile(promptsPath, JSON.stringify([{ id: 'p1', text: 'Do the thing.' }]));
  await fs.writeFile(criteriaPath, JSON.stringify([{ id: 'correctness', name: 'Correctness' }]));

  await assert.rejects(() => runHeadlessEval({
    skillAPath: skillA,
    skillBPath: skillB,
    promptsPath,
    criteriaPath,
    mode: 'real',
  }), /requires generationModel and judgeModel/);
});

async function writeSkill(cwd, dirName, skillName) {
  const skillDir = path.join(cwd, dirName);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ${dirName}
description: Use for mock evaluation.
---

# ${skillName}

Follow the request.
`);
  return skillDir;
}
