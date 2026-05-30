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

function readMcpConfig() {
  try {
    return JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

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

const result = spawnSync('python3', [validatorPath, pluginPath], {
  cwd: repoRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
