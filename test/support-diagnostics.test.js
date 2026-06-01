import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProject } from '../src/lib/run-loop.js';
import { getProjectPaths } from '../src/lib/paths.js';
import { readZipEntries } from '../src/lib/zip.js';
import {
  createSupportDiagnostics,
  createSupportPrompt,
  sanitizeText,
} from '../src/lib/support-diagnostics.js';

test('support diagnostics creates a sanitized portable zip bundle', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-diagnostics-'));
  const result = await runProject({
    cwd,
    projectName: 'Support Secret',
    goal: 'Exercise support diagnostics.',
    loops: 1,
    mode: 'mock',
  });
  const runId = result.completedRuns[0].runId;
  const paths = getProjectPaths(cwd, 'Support Secret');
  const secretValue = 'sk-proj-testsecretvalue1234567890ABCDE';
  await fs.writeFile(path.join(paths.runsDir, runId, 'secret-diagnostic.json'), JSON.stringify({
    openAiKey: secretValue,
    note: 'keep this note',
  }, null, 2));
  await fs.writeFile(path.join(cwd, '.env'), `OPENAI_API_KEY=${secretValue}\n`);

  const diagnostics = await createSupportDiagnostics({
    cwd,
    projectName: 'Support Secret',
    now: new Date('2026-06-01T18:00:00.000Z'),
  });

  assert.ok(diagnostics.bundlePath.endsWith('.zip'));
  assert.ok(diagnostics.fileCount > 5);
  assert.ok(diagnostics.redactionCount >= 1);

  const entries = readZipEntries(await fs.readFile(diagnostics.bundlePath));
  const pathsInZip = entries.map(entry => entry.path);
  assert.ok(pathsInZip.includes('README.txt'));
  assert.ok(pathsInZip.includes('manifest.json'));
  assert.ok(pathsInZip.includes('project/latest-run/secret-diagnostic.json'));
  assert.equal(pathsInZip.some(entryPath => entryPath.includes('\\')), false);
  assert.equal(pathsInZip.some(entryPath => entryPath.endsWith('.env')), false);

  const joined = entries.map(entry => entry.bytes.toString('utf8')).join('\n');
  assert.doesNotMatch(joined, new RegExp(secretValue));
  assert.match(joined, /\[REDACTED\]/);
  assert.match(joined, /keep this note/);
});

test('support prompt is copy-pasteable and avoids asking for secrets', () => {
  const prompt = createSupportPrompt({
    cwd: 'C:\\Users\\justi\\Skill-RSI',
    projectName: 'Resume Writer',
  });

  assert.match(prompt, /node src\/cli\.js diagnose "Resume Writer"/);
  assert.match(prompt, /justinwetch@me\.com/);
  assert.match(prompt, /Do not paste API keys/);
});

test('support diagnostics sanitizer redacts common key shapes', () => {
  const context = { redactionCount: 0 };
  const sanitized = sanitizeText([
    'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz',
    '{"apiKey":"sk-abcdefghijklmnopqrstuvwxyz"}',
    "'openAiKey': 'sk-abcdefghijklmnopqrstuvwxyz'",
    'AIzaabcdefghijklmnopqrstuvwxyz123456',
  ].join('\n'), context);

  assert.doesNotMatch(sanitized, /sk-proj-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(sanitized, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(sanitized, /AIzaabcdefghijklmnopqrstuvwxyz123456/);
  assert.equal(context.redactionCount, 4);
});
