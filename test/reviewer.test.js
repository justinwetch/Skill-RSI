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

test('candidate reviewer blocks exact eval prompt text leakage', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-text-leak-'));
  const skillDir = path.join(cwd, 'skill');
  const promptText = 'Design a subscription settings screen for a finance app with confusing cancellation rules.';
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ux-design
description: Use when helping agents design better UX for production applications with scoped recommendations.
---

# UX Design

Practice against this exact case: ${promptText}
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-a',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
    evalDesign: { prompts: [{ id: 'prompt-456', text: promptText }] },
  });

  assert.equal(review.approveForEval, false);
  assert.match(review.blockingIssues.find(issue => issue.surface === 'eval-leakage').message, /exact eval prompt text/);
});

test('candidate reviewer blocks Skill RSI provenance leakage in generated packages', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-provenance-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: frontend-code
description: Use when helping agents produce production-ready frontend implementation code.
metadata:
  author: skill-rsi
---

# Frontend Code

## When to use
Use for implementation tasks.

## Workflow
1. Produce code.
2. Validate the implementation.
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-a',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
  });

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'internal-leakage'));
});

test('candidate reviewer blocks revision drift that contradicts assigned arm', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-arm-fidelity-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: frontend-code
description: Use when helping agents produce production-ready frontend implementation code.
---

# Frontend Code

## When to use
Use for implementation tasks.

## Workflow
1. Use a blocking-fact checklist before producing code.
2. Produce concrete files.
3. Validate the implementation.
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-b',
      experimentArm: 'candidateB',
      skillPath: skillDir,
      changedParameterIds: ['p03'],
    },
    experimentPlan: {
      focusParameterIds: ['p03'],
      arms: {
        candidateA: {
          strategyName: 'explicit-blocking-gate',
          mutationInstructions: ['Add a short blocking-fact checklist.'],
        },
        candidateB: {
          strategyName: 'status-quo',
          mutationInstructions: ['Keep the existing clarification rule unchanged, with no explicit blocking-fact checklist or stronger proceed-default guidance.'],
        },
      },
    },
  });

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'arm-fidelity'));
});

test('candidate reviewer blocks severe compression of rich champion in local ablation', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-depth-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: frontend-code
description: Use when helping agents produce production-ready frontend implementation code.
---

# Frontend Code

## When to use
Use for implementation tasks.

## Workflow
1. Produce code.
2. Validate the implementation.
`, 'utf8');

  const championBody = Array.from({ length: 90 }, (_, index) => `Detailed champion instruction ${index} preserves domain nuance and operational specificity.`).join('\n');
  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-a',
      experimentArm: 'candidateA',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: {
      focusParameterIds: ['p01'],
      arms: {
        candidateA: { strategyName: 'local edit', mutationInstructions: ['Change one local parameter.'] },
        candidateB: { strategyName: 'control', mutationInstructions: ['Preserve current behavior.'] },
      },
    },
    championPackage: {
      files: [{
        path: 'SKILL.md',
        kind: 'text',
        content: `---
name: frontend-code
description: Use when helping agents produce production-ready frontend implementation code.
---

# Frontend Code

${championBody}
`,
      }],
    },
  });

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => issue.surface === 'instructional-depth'));
});

test('candidate reviewer treats frontmatter-only missing license files as advisory', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-missing-license-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: frontend-design
description: Use when helping agents produce production-ready frontend implementation code.
license: Complete terms in LICENSE.txt
---

# Frontend Design

## Workflow
1. Produce code.
2. Validate the implementation.
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-a',
      experimentArm: 'candidateA',
      skillPath: skillDir,
      changedParameterIds: ['p01'],
    },
    experimentPlan: { focusParameterIds: ['p01'] },
  });

  assert.equal(review.approveForEval, true);
  assert.equal(review.blockingIssues.some(issue => issue.surface === 'package-fidelity'), false);
  assert.ok(review.recommendedEdits.some(issue => (
    issue.surface === 'package-fidelity'
    && issue.message.includes('LICENSE.txt')
  )));
  assert.equal(review.nonIssues.some(item => item.includes('preserved champion auxiliary')), false);
});

test('candidate reviewer blocks dropped champion auxiliary files still referenced by SKILL.md', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-review-dropped-reference-'));
  const skillDir = path.join(cwd, 'skill');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: ux-design
description: Use when helping agents design production UX.
---

# UX Design

Load references/heuristics.md before giving final guidance.
`, 'utf8');

  const review = await reviewCandidatePackage({
    candidate: {
      candidateId: 'candidate-b',
      experimentArm: 'candidateB',
      skillPath: skillDir,
      changedParameterIds: ['p02'],
    },
    experimentPlan: {
      focusParameterIds: ['p02'],
      arms: {
        candidateA: { strategyName: 'local edit', mutationInstructions: ['Adjust the example density.'] },
        candidateB: { strategyName: 'control', mutationInstructions: ['Preserve the reference-loading behavior.'] },
      },
    },
    championPackage: {
      files: [
        {
          path: 'SKILL.md',
          kind: 'text',
          content: `---
name: ux-design
description: Use when helping agents design production UX.
---

# UX Design

Load references/heuristics.md before giving final guidance.
`,
        },
        {
          path: 'references/heuristics.md',
          kind: 'text',
          content: '# Heuristics\n\nPrefer clarity over novelty.\n',
        },
      ],
    },
  });

  assert.equal(review.approveForEval, false);
  assert.ok(review.blockingIssues.some(issue => (
    issue.surface === 'package-fidelity'
    && issue.message.includes('references/heuristics.md')
  )));
});
