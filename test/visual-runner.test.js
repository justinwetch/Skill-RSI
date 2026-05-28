import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractHtmlDocument, findSystemChromium, renderVisualArtifact } from '../src/lib/visual-runner.js';

test('visual runner extracts fenced html documents', () => {
  const html = extractHtmlDocument([
    'Here is the implementation:',
    '```html',
    '<!doctype html><html><body><main>Visible UI</main></body></html>',
    '```',
  ].join('\n'));

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Visible UI/);
});

test('visual runner wraps html fragments as standalone documents', () => {
  const html = extractHtmlDocument('<main><h1>Dashboard</h1></main>');

  assert.match(html, /<!doctype html>/i);
  assert.match(html, /<meta name="viewport"/i);
  assert.match(html, /Dashboard/);
});

test('visual runner can report system chromium fallback availability', () => {
  const executable = findSystemChromium();
  assert.equal(typeof executable === 'string' || executable === null, true);
});

test('visual runner fails prose-only outputs instead of fake-rendering them', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-visual-prose-'));
  const result = await renderVisualArtifact({
    content: 'Recommended direction: make it cleaner and more premium.',
    outputDir: path.join(cwd, 'artifact with spaces'),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error.name, 'InvalidVisualArtifact');
  assert.equal(result.screenshots.length, 0);
});
