import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOpenAiDiagnosticMetadata,
  getOpenAiKeyStatus,
} from '../ui/src/key-status.js';

test('ui key status treats browser-local key as effective without exposing it', () => {
  const status = getOpenAiKeyStatus({ openai: { keyConfigured: false, serverKeyConfigured: false } }, 'sk-ui-secret');
  assert.deepEqual(status, {
    keyConfigured: true,
    serverKeyConfigured: false,
    uiKeyConfigured: true,
    keySource: 'ui',
  });

  const diagnostic = createOpenAiDiagnosticMetadata({ openai: { serverKeyConfigured: false } }, 'sk-ui-secret');
  assert.deepEqual(diagnostic, {
    serverKeyConfigured: false,
    uiKeyConfigured: true,
    effectiveKeyConfigured: true,
    keySource: 'ui',
  });
  assert.ok(!JSON.stringify(diagnostic).includes('sk-ui-secret'));
});

test('ui key status reports multiple sources when server and browser keys exist', () => {
  assert.deepEqual(getOpenAiKeyStatus({ openai: { serverKeyConfigured: true } }, 'sk-ui-secret'), {
    keyConfigured: true,
    serverKeyConfigured: true,
    uiKeyConfigured: true,
    keySource: 'multiple',
  });
});
