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
