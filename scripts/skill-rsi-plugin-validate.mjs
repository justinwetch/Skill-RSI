#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateMcpConfig } from './skill-rsi-plugin-configure.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginPath = path.join(repoRoot, 'plugins', 'skill-rsi');
const mcpConfigPath = path.join(pluginPath, '.mcp.json');
const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const candidates = [
  process.env.SKILL_RSI_PLUGIN_VALIDATOR,
  path.join(codexHome, 'skills', '.system', 'plugin-creator', 'scripts', 'validate_plugin.py'),
].filter(Boolean);

const validatorPath = candidates.find(candidate => fs.existsSync(candidate));

export function resolvePythonCommand(env = process.env) {
  const candidates = [
    env.SKILL_RSI_PYTHON ? { command: env.SKILL_RSI_PYTHON, args: [], label: 'SKILL_RSI_PYTHON' } : null,
    { command: 'python3', args: [], label: 'python3' },
    { command: 'python', args: [], label: 'python' },
    { command: 'py', args: ['-3'], label: 'py -3' },
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status === 0) return candidate;
  }

  return null;
}

function readMcpConfig() {
  try {
    return JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function main() {
  const mcpConfig = readMcpConfig();
  const mcpValidation = mcpConfig
    ? validateMcpConfig(mcpConfig, repoRoot)
    : { ok: false, issues: ['plugins/skill-rsi/.mcp.json has not been generated'] };

  if (!mcpValidation.ok) {
    console.error('Skill RSI plugin MCP config is missing or stale. Run npm run plugin:configure.');
    for (const issue of mcpValidation.issues) console.error(`- ${issue}`);
    process.exit(1);
  }

  if (!validatorPath) {
    console.error('Could not find the Codex plugin validator.');
    console.error('Set SKILL_RSI_PLUGIN_VALIDATOR=/absolute/path/to/validate_plugin.py, or install the Codex plugin-creator system skill.');
    process.exit(1);
  }

  const python = resolvePythonCommand();
  if (!python) {
    console.error('Could not find Python for the Codex plugin validator.');
    console.error('Set SKILL_RSI_PYTHON=/absolute/path/to/python, or install python3/python/py launcher.');
    process.exit(1);
  }

  const result = spawnSync(python.command, [...python.args, validatorPath, pluginPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  });

  process.exit(result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
