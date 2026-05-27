#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/env.js';
import { runProject } from './lib/run-loop.js';
import {
  createProjectForUi,
  deleteProject,
  readProjectSummaries,
  readProjectSummary,
  readRunComparison,
  readRunDetail,
  readRunProgress,
  readSkillContent,
  recordHumanDecision,
} from './lib/ui-api.js';

const DEFAULT_PORT = 8765;
const DEFAULT_MODEL = 'gpt-5.4-mini';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const appDist = path.join(repoRoot, 'ui', 'dist');

await loadDotEnv(repoRoot);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      writeJson(response, 204, null);
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    writeJson(response, error.statusCode || 500, {
      error: {
        message: error.message,
        name: error.name,
      },
    });
  }
});

const port = Number.parseInt(process.env.SKILL_RSI_SERVER_PORT || `${DEFAULT_PORT}`, 10);
server.listen(port, '127.0.0.1', () => {
  console.log(`Skill RSI server listening on http://127.0.0.1:${port}`);
});

async function handleApi(request, response, url) {
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'projects') {
    writeJson(response, 200, {
      schemaVersion: 1,
      projects: await readProjectSummaries({ cwd: repoRoot }),
    });
    return;
  }

  if (request.method === 'POST' && parts.length === 2 && parts[1] === 'projects') {
    const body = await readBody(request);
    writeJson(response, 201, await createProjectForUi({
      cwd: repoRoot,
      projectName: body.projectName || body.name || '',
      goal: body.goal || '',
      targetIterations: body.targetIterations || 3,
      triggerMode: body.triggerMode || 'manual',
      outputType: body.outputType || 'text',
      baselineFiles: body.baselineFiles || [],
      baselineArchive: body.baselineArchive || null,
    }));
    return;
  }

  if (parts[0] !== 'api' || parts[1] !== 'projects' || !parts[2]) {
    throw notFound();
  }

  const projectName = parts[2];

  if (request.method === 'GET' && parts.length === 4 && parts[3] === 'summary') {
    writeJson(response, 200, await readProjectSummary({ cwd: repoRoot, projectName }));
    return;
  }

  if (request.method === 'GET' && parts.length === 4 && parts[3] === 'progress') {
    writeJson(response, 200, await readRunProgress({ cwd: repoRoot, projectName }));
    return;
  }

  if (request.method === 'GET' && parts.length === 5 && parts[3] === 'runs') {
    const runId = parts[4] === 'latest' ? null : parts[4];
    writeJson(response, 200, await readRunDetail({ cwd: repoRoot, projectName, runId }));
    return;
  }

  if (request.method === 'GET' && parts.length === 6 && parts[3] === 'runs' && parts[5] === 'compare') {
    const runId = parts[4] === 'latest' ? null : parts[4];
    writeJson(response, 200, await readRunComparison({ cwd: repoRoot, projectName, runId }));
    return;
  }

  if (request.method === 'GET' && parts.length === 5 && parts[3] === 'skills') {
    const runId = url.searchParams.get('runId') || null;
    writeJson(response, 200, await readSkillContent({ cwd: repoRoot, projectName, source: parts[4], runId }));
    return;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'delete') {
    writeJson(response, 200, await deleteProject({ cwd: repoRoot, projectName }));
    return;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'decisions') {
    const body = await readBody(request);
    writeJson(response, 200, await recordHumanDecision({
      cwd: repoRoot,
      projectName,
      runId: body.runId || null,
      decision: body.decision,
      candidateId: body.candidateId || null,
      note: body.note || '',
      author: body.author || 'local-ui',
    }));
    return;
  }

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'step') {
    const body = await readBody(request);
    const mode = body.mode || 'mock';
    // Leave models unset unless explicitly requested, so the loop resolves them from the
    // per-project config (config.json) and falls back to its own default.
    const generationModel = body.generationModel || null;
    const judgeModel = body.judgeModel || null;
    const agentModel = body.agentModel || null;
    const loops = Number.parseInt(body.loops || '1', 10);
    if (!Number.isInteger(loops) || loops < 1) {
      throw badRequest('loops must be a positive integer');
    }
    const result = await runProject({
      cwd: repoRoot,
      projectName,
      goal: body.goal || `Improve the ${projectName} Agent Skill.`,
      loops,
      mode,
      maxRuns: body.maxRuns || null,
      evalMode: body.evalMode || 'mock',
      generationModel,
      judgeModel,
      agentModel,
      stopRules: body.stopRules || {},
      triggerMode: body.triggerMode || 'manual',
    });
    writeJson(response, 200, {
      schemaVersion: 1,
      projectId: result.projectId,
      completedRuns: result.completedRuns,
      state: result.state,
      stopReason: result.stopReason,
    });
    return;
  }

  throw notFound();
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.trim() ? JSON.parse(text) : {};
}

function writeJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': 'http://127.0.0.1:5173',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  if (statusCode !== 204) {
    response.end(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    response.end();
  }
}

async function serveStatic(response, requestPath) {
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const candidatePath = path.resolve(appDist, relativePath);
  if (!candidatePath.startsWith(appDist)) throw notFound();

  try {
    const stat = await fs.stat(candidatePath);
    const filePath = stat.isDirectory() ? path.join(candidatePath, 'index.html') : candidatePath;
    response.writeHead(200, { 'Content-Type': contentType(filePath) });
    response.end(await fs.readFile(filePath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const fallback = path.join(appDist, 'index.html');
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await fs.readFile(fallback));
  }
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function notFound() {
  const error = new Error('Not found');
  error.statusCode = 404;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}
