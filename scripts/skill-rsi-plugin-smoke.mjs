#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSkillRsiMcpServer } from '../plugins/skill-rsi/mcp/server.mjs';

const expectedTools = [
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
  'skill_rsi_progress',
  'skill_rsi_record_context',
  'skill_rsi_run_next',
  'skill_rsi_run_with_context',
].sort();

const { server } = await createSkillRsiMcpServer({ services: {} });
const registeredTools = Object.keys(server._registeredTools || {}).sort();

assert.deepEqual(registeredTools, expectedTools);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'skill-rsi');
const mcpConfig = JSON.parse(await fs.readFile(path.join(pluginRoot, '.mcp.json'), 'utf8'));
const mcpArgs = mcpConfig.mcpServers?.['skill-rsi']?.args || [];
assert.deepEqual(mcpArgs, ['mcp/server.mjs']);
await fs.access(path.join(pluginRoot, mcpArgs[0]));

console.log(`Skill RSI plugin smoke passed: ${registeredTools.length} MCP tools registered.`);
