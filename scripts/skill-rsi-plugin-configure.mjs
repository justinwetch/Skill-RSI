#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pluginRoot = path.join(repoRoot, 'plugins', 'skill-rsi');
export const mcpConfigPath = path.join(pluginRoot, '.mcp.json');
export const mcpServerRelativePath = path.posix.join('plugins', 'skill-rsi', 'mcp', 'server.mjs');

export function buildMcpConfig(root = repoRoot, { pathModule = path } = {}) {
  const resolvedRoot = pathModule.resolve(root);
  return {
    mcpServers: {
      'skill-rsi': {
        command: 'node',
        args: [mcpServerRelativePath],
        cwd: resolvedRoot,
        env: {
          SKILL_RSI_ROOT: resolvedRoot,
        },
      },
    },
  };
}

export function validateMcpConfig(config, root = repoRoot) {
  const expected = buildMcpConfig(root).mcpServers['skill-rsi'];
  const actual = config?.mcpServers?.['skill-rsi'];
  const issues = [];

  if (!actual) issues.push('missing mcpServers.skill-rsi');
  if (actual?.command !== expected.command) issues.push('command must be "node"');
  if (JSON.stringify(actual?.args) !== JSON.stringify(expected.args)) {
    issues.push(`args must be ${JSON.stringify(expected.args)}`);
  }
  if (path.resolve(actual?.cwd || '') !== expected.cwd) {
    issues.push(`cwd must be ${expected.cwd}`);
  }
  if (path.resolve(actual?.env?.SKILL_RSI_ROOT || '') !== expected.env.SKILL_RSI_ROOT) {
    issues.push(`env.SKILL_RSI_ROOT must be ${expected.env.SKILL_RSI_ROOT}`);
  }
  if (!fs.existsSync(path.join(root, mcpServerRelativePath))) {
    issues.push(`MCP server file is missing at ${mcpServerRelativePath}`);
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
    json: argv.includes('--json'),
  };
}

function readExistingConfig() {
  try {
    return JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function print(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (result.ok) {
    console.log(result.message);
    return;
  }

  console.error(result.message);
  for (const issue of result.issues || []) console.error(`- ${issue}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.check) {
    const existing = readExistingConfig();
    const validation = existing
      ? validateMcpConfig(existing)
      : { ok: false, issues: ['plugins/skill-rsi/.mcp.json has not been generated'] };
    const result = {
      ok: validation.ok,
      mode: 'check',
      path: mcpConfigPath,
      repoRoot,
      message: validation.ok
        ? 'Skill RSI plugin MCP config is current.'
        : 'Skill RSI plugin MCP config is missing or stale. Run npm run plugin:configure.',
      issues: validation.issues,
    };
    print(result, args.json);
    process.exit(result.ok ? 0 : 1);
  }

  const config = buildMcpConfig();
  fs.writeFileSync(mcpConfigPath, `${JSON.stringify(config, null, 2)}\n`);
  const result = {
    ok: true,
    mode: 'write',
    path: mcpConfigPath,
    repoRoot,
    message: `Wrote Skill RSI plugin MCP config for ${repoRoot}`,
  };
  print(result, args.json);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
