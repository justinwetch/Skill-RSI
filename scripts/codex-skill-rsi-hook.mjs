#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { recordHookEvent } from '../src/lib/hooks.js';

const execFileAsync = promisify(execFile);

async function main() {
  const cwd = path.resolve(process.env.SKILL_RSI_CWD || process.cwd());
  const projectName = process.env.SKILL_RSI_PROJECT
    || process.env.SKILL_RSI_PROJECT_NAME
    || path.basename(cwd);
  const payload = await readStdinJson();

  if (!hasChangedFiles(payload)) {
    const changedFiles = await readGitChangedFiles(cwd);
    if (changedFiles.length) payload.changedFiles = changedFiles;
  }

  const outputPath = await recordHookEvent({
    cwd,
    projectName,
    event: {
      source: 'codex-hook',
      ...payload,
    },
    queued: true,
  });

  console.error(`Queued Skill RSI hook for ${projectName}: ${outputPath}`);
  if ((payload.hook_event_name || payload.hookEventName) === 'Stop') {
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
  }
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function hasChangedFiles(payload) {
  return Array.isArray(payload?.changedFiles)
    || Array.isArray(payload?.changed_files)
    || Array.isArray(payload?.files);
}

async function readGitChangedFiles(cwd) {
  try {
    const [{ stdout: unstaged }, { stdout: staged }] = await Promise.all([
      execFileAsync('git', ['diff', '--name-only', 'HEAD'], { cwd }),
      execFileAsync('git', ['diff', '--name-only', '--cached'], { cwd }),
    ]);
    return [...new Set(`${unstaged}\n${staged}`
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean))]
      .sort();
  } catch {
    return [];
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
