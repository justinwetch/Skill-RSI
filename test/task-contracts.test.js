import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProjectConfig } from '../src/lib/config.js';
import { isPromptContractValid, normalizeTaskContract } from '../src/lib/task-contracts.js';

test('legacy eval output types derive deterministic task contracts', () => {
  assert.equal(normalizeProjectConfig({ eval: { outputType: 'text' } }).eval.taskContract.id, 'text_standalone');
  assert.equal(normalizeProjectConfig({ eval: { outputType: 'code' } }).eval.taskContract.id, 'code_standalone');

  const visual = normalizeProjectConfig({ eval: { outputType: 'code_visual' } });
  assert.equal(visual.eval.outputType, 'code_visual');
  assert.equal(visual.eval.taskContract.id, 'code_visual_standalone');
});

test('explicit task contracts control normalized output type', () => {
  const codebase = normalizeProjectConfig({
    eval: {
      outputType: 'text',
      taskContract: { id: 'codebase_edit' },
    },
  });
  assert.equal(codebase.eval.outputType, 'code');
  assert.equal(codebase.eval.taskContract.artifactType, 'code');
  assert.equal(codebase.eval.taskContract.environment, 'codebase_edit');

  const sourceGrounded = normalizeTaskContract({ artifactType: 'text', environment: 'source_grounded' });
  assert.equal(sourceGrounded.id, 'text_source_grounded');
});

test('task contract prompt validation distinguishes standalone and context-bound tasks', () => {
  assert.equal(isPromptContractValid({
    text: 'Build a self-contained React settings panel. There is no existing repository context.',
  }, { id: 'code_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: 'There is no existing repository context. Ask me what files you need before coding.',
  }, { id: 'code_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'Update the existing app files to improve the dashboard.',
  }, { id: 'code_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'Build a self-contained browser-renderable landing page. Return one complete HTML document with inline CSS and JavaScript.',
  }, { id: 'code_visual_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: 'Write a self-contained webpage for a checkout flow using inline CSS and JS.',
  }, { id: 'code_visual_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: 'Implement a responsive dashboard in a single file with HTML, CSS, and JavaScript.',
  }, { id: 'code_visual_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: 'Design a single-file HTML booking interface with labeled controls and inline CSS and JavaScript.',
  }, { id: 'code_visual_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: 'Make a single standalone HTML page for a personal finance snapshot with inline CSS and JavaScript.',
  }, { id: 'code_visual_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: 'Recommend a visual direction for a landing page.',
  }, { id: 'code_visual_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'File tree:\n```text\nsrc/App.jsx\n```\n\n`src/App.jsx`:\n```jsx\nexport default function App() { return <h1>Hello</h1>; }\n```\nUpdate the provided file.',
  }, { id: 'codebase_edit' }), true);

  assert.equal(isPromptContractValid({
    text: 'Rewrite the attached document into a memo.',
  }, { id: 'text_source_grounded' }), false);
});

test('text standalone prompts reject dangling source-material references', () => {
  assert.equal(isPromptContractValid({
    text: 'Please read the short screenplay outline below and label the major story beats in order. The outline is about a young paramedic who discovers a conspiracy.',
  }, { id: 'text_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'I am pasting a screenplay outline below and need you to identify the key story beats in order. The story is a legal drama about a public defender.',
  }, { id: 'text_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'I’d like a structural breakdown of this screenplay treatment at three levels: scene, sequence, and act. The story follows a burned-out hotel concierge in an inheritance scam.',
  }, { id: 'text_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'Please reshape this coming-of-age mystery and focus on the actual beats that are present in the draft. The story centers on a chess prodigy investigating a classmate.',
  }, { id: 'text_standalone' }), false);

  assert.equal(isPromptContractValid({
    text: 'Analyze this premise and produce a provisional beat map: a young paramedic discovers a conspiracy during a routine night shift.',
  }, { id: 'text_standalone' }), true);

  assert.equal(isPromptContractValid({
    text: `Please label the beats in the following outline:

Outline:
- Opening: A paramedic starts a routine night shift while trying to keep his younger brother out of trouble.
- Inciting pressure: A patient whispers about a city contract before vanishing from the hospital.
- Midpoint: The paramedic learns his supervisor is hiding evidence.
- Climax: He must choose between exposing the conspiracy and saving his brother from retaliation.`,
  }, { id: 'text_standalone' }), true);
});
