#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const argv = process.argv.slice(2);
  const projectName = firstProjectName(argv);
  if (!projectName) {
    throw new Error('Usage: node scripts/skill-rsi-cron-runner.mjs <project> --max-runs <n> [continuous options]');
  }
  if (!hasOption(argv, 'max-runs')) {
    throw new Error('Cron runner requires --max-runs for unattended runs.');
  }

  const forwarded = argv.filter(item => item !== '--no-consume-hooks');
  if (!hasOption(forwarded, 'consume-hooks') && !argv.includes('--no-consume-hooks')) {
    forwarded.push('--consume-hooks');
  }

  console.log(`[skill-rsi-cron] ${new Date().toISOString()} starting ${projectName}`);
  const status = await runCli(['continuous', ...forwarded], process.env.SKILL_RSI_CWD || process.cwd());
  console.log(`[skill-rsi-cron] ${new Date().toISOString()} finished ${projectName} with status ${status}`);
  process.exitCode = status;
}

function firstProjectName(argv) {
  return argv.find(item => !item.startsWith('--')) || null;
}

function hasOption(argv, name) {
  return argv.includes(`--${name}`);
}

function runCli(args, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'src', 'cli.js'), ...args], {
      cwd,
      stdio: 'inherit',
    });
    child.on('close', code => resolve(code ?? 1));
    child.on('error', error => {
      console.error(error.stack || error.message);
      resolve(1);
    });
  });
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
