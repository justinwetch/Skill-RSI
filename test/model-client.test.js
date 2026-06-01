import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModelAttemptError,
  withModelRetry,
} from '../src/lib/model-client.js';

test('withModelRetry retries failures and records sanitized attempts', async () => {
  let calls = 0;
  const result = await withModelRetry({
    phase: 'unit',
    model: 'gpt-test',
    maxAttempts: 2,
    backoffMs: 0,
    operation: async () => {
      calls += 1;
      if (calls === 1) {
        throw createModelAttemptError('bad key sk-test-secret-value', {
          failureKind: 'invalid_json',
          rawResponse: '{"apiKey":"sk-test-secret-value","message":"bad"}',
        });
      }
      return 'ok';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, 'ok');
  assert.equal(result.attemptCount, 2);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].failureKind, 'invalid_json');
  assert.ok(!JSON.stringify(result).includes('sk-test-secret-value'));
});

test('withModelRetry stops after max attempts and classifies empty output', async () => {
  const result = await withModelRetry({
    phase: 'unit-empty',
    model: 'gpt-test',
    maxAttempts: 2,
    backoffMs: 0,
    operation: async () => '',
  });

  assert.equal(result.ok, false);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.lastError.failureKind, 'empty_response');
  assert.match(result.lastError.message, /empty response/i);
});

test('withModelRetry does not retry non-recoverable auth failures', async () => {
  let calls = 0;
  const result = await withModelRetry({
    phase: 'unit-auth',
    model: 'gpt-test',
    maxAttempts: 3,
    backoffMs: 0,
    operation: async () => {
      calls += 1;
      throw createModelAttemptError('bad API key sk-test-secret-value', {
        failureKind: 'auth_error',
        rawResponse: '{"authorization":"Bearer sk-test-secret-value"}',
      });
    },
  });

  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.equal(result.attemptCount, 1);
  assert.equal(result.lastError.failureKind, 'auth_error');
  assert.ok(!JSON.stringify(result).includes('sk-test-secret-value'));
});

test('withModelRetry preserves sanitized malformed artifacts in attempt records', async () => {
  const result = await withModelRetry({
    phase: 'unit-artifact',
    model: 'gpt-test',
    maxAttempts: 1,
    backoffMs: 0,
    operation: async () => {
      const error = createModelAttemptError('artifact invalid', { failureKind: 'validation_error' });
      error.rawArtifact = { files: [{ path: 'SKILL.md', content: 'secret sk-test-secret-value' }] };
      throw error;
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.lastError.rawArtifact, {
    files: [{ path: 'SKILL.md', content: 'secret sk-***' }],
  });
});
