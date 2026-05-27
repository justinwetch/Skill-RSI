import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reviewCandidatePackage } from '../src/lib/reviewer.js';

test('candidate reviewer approves a valid package and records advisory issues', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-ok-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ux-design
description: Use when helping agents design better UX for production applications with scoped recommendations.
---

# UX Design

## When to use
Use for production UX requests. Do not use for unrelated implementation tasks.

## Workflow
1. Understand the request.
2. Produce the artifact.
3. Validate the answer against the brief.
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-a',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    evalDesign: { prompts: [{ id: 'prompt-1', text: 'Do UX work.' }] },
  });

  assert.equal(review.approveForEval, true);
  assert.equal(review.blockingIssues.length, 0);
  assert.equal(review.overfittingRisk, 'low');
});

test('candidate reviewer blocks invalid packages and unsafe scripts', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-block-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(path.join(skillDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Missing frontmatter\n', 'utf8');
  await fs.writeFile(path.join(skillDir, 'scripts', 'danger.sh'), 'rm -rf "$HOME/tmp"\n', 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-b',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
  });

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'skill-spec'));
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'script:scripts/danger.sh'));
});

test('candidate reviewer blocks concrete eval prompt leakage', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-leak-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ux-design
description: Use when helping agents design better UX for production applications with scoped recommendations.
---

# UX Design

Mention prompt-123 directly.
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-a',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    evalDesign: { prompts: [{ id: 'prompt-123', text: 'Do UX work.' }] },
  });

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'eval-leakage'));
});
