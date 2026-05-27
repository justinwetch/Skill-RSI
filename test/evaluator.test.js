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
