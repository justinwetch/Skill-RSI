#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillRsiMcpServer } from '../plugins/skill-rsi/mcp/server.mjs';
import { validateMcpConfig } from './skill-rsi-plugin-configure.mjs';

const expectedTools = [
  'skill_rsi_cockpit',
  'skill_rsi_create_project',
  'skill_rsi_doctor',
  'skill_rsi_export_champion',
  'skill_rsi_get_champion',
  'skill_rsi_get_evidence',
  'skill_rsi_get_next_loop_plan',
  'skill_rsi_get_run_comparison',
  'skill_rsi_get_run_detail',
  'skill_rsi_get_skill_content',
  'skill_rsi_list_projects',
  'skill_rsi_open',
  'skill_rsi_prepare_project',
  'skill_rsi_progress',
  'skill_rsi_record_context',
  'skill_rsi_run_next',
  'skill_rsi_run_with_context',
].sort();

const { server } = await createSkillRsiMcpServer({ services: {} });
const registeredTools = Object.keys(server._registeredTools || {}).sort();

assert.deepEqual(registeredTools, expectedTools);
assert.equal(server._registeredTools.skill_rsi_cockpit?._meta?.ui?.resourceUri, 'ui://skill-rsi/cockpit.html');
assert.equal(server._registeredTools.skill_rsi_cockpit?._meta?.['ui/resourceUri'], 'ui://skill-rsi/cockpit.html');
assert.ok(server._registeredResources?.['ui://skill-rsi/cockpit.html']);
assert.equal(
  server._registeredResources['ui://skill-rsi/cockpit.html'].metadata?.mimeType,
  'text/html;profile=mcp-app',
);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'skill-rsi');
let mcpConfig;
try {
  mcpConfig = JSON.parse(await fs.readFile(path.join(pluginRoot, '.mcp.json'), 'utf8'));
} catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error('plugins/skill-rsi/.mcp.json has not been generated. Run npm run plugin:configure.');
  }
  throw error;
}
const mcpValidation = validateMcpConfig(mcpConfig, repoRoot);
assert.deepEqual(mcpValidation.issues, []);
const skillRsiMcp = mcpConfig.mcpServers?.['skill-rsi'] || {};
const mcpArgs = skillRsiMcp.args || [];
assert.equal(skillRsiMcp.command, 'node');
assert.ok(mcpArgs.length > 0);
const mcpCwd = skillRsiMcp.cwd ? path.resolve(skillRsiMcp.cwd) : pluginRoot;
await fs.access(path.resolve(mcpCwd, mcpArgs[0]));

const cacheSimRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-plugin-cache-'));
try {
  await fs.cp(pluginRoot, cacheSimRoot, { recursive: true });
  const cacheServer = await import(path.join(cacheSimRoot, 'mcp', 'server.mjs'));
  const { server: cacheRegisteredServer } = await cacheServer.createSkillRsiMcpServer({
    services: { cwd: repoRoot },
  });
  assert.deepEqual(Object.keys(cacheRegisteredServer._registeredTools || {}).sort(), expectedTools);
} finally {
  await fs.rm(cacheSimRoot, { recursive: true, force: true });
}

console.log(`Skill RSI plugin smoke passed: ${registeredTools.length} MCP tools registered.`);
