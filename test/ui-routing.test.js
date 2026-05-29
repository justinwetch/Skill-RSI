import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialRoute } from '../ui/src/routing.js';

const projects = [
  { projectId: 'frontend-design' },
  { projectId: 'writing-style' },
];

test('UI initial route opens a requested project deep link', () => {
  assert.deepEqual(resolveInitialRoute('?project=frontend-design', projects), {
    view: 'project',
    projectId: 'frontend-design',
    draftId: null,
  });
});

test('UI initial route opens create flow deep link', () => {
  assert.deepEqual(resolveInitialRoute('?create=1', projects), {
    view: 'create',
    projectId: null,
    draftId: null,
  });
});

test('UI initial route carries setup draft id into create flow', () => {
  assert.deepEqual(resolveInitialRoute('?create=1&draft=abc', projects), {
    view: 'create',
    projectId: null,
    draftId: 'abc',
  });
});

test('UI initial route ignores missing project deep links', () => {
  assert.deepEqual(resolveInitialRoute('?project=missing-project', projects), {
    view: 'list',
    projectId: null,
    draftId: null,
  });
});
