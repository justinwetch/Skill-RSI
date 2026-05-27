import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadDotEnv } from '../src/lib/env.js';

test('loads .env values without overwriting existing environment', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-env-'));
  await fs.writeFile(path.join(cwd, '.env'), [
    'OPENAI_API_KEY=from-file',
    'QUOTED_VALUE="hello world"',
    '# ignored',
    '',
  ].join('\n'));

  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'already-set';

  const loaded = await loadDotEnv(cwd);

  assert.equal(loaded, true);
  assert.equal(process.env.OPENAI_API_KEY, 'already-set');
  assert.equal(process.env.QUOTED_VALUE, 'hello world');

  if (previousOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = previousOpenAiKey;
  }
  delete process.env.QUOTED_VALUE;
});
