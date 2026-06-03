#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadDotEnv } from './lib/env.js';
import { runProject } from './lib/run-loop.js';
import {
  createProjectForUi,
  createProjectFromDraftForUi,
  deleteProject,
  exportChampionForUi,
  readProjectDraftForUi,
  readProjectSummaries,
  readProjectSummary,
  readRunComparison,
  readRunDetail,
  readRunProgress,
  readSkillContent,
  recordHumanDecision,
  updateProjectModelForUi,
  UI_OPENAI_MODELS,
} from './lib/ui-api.js';
import {
  claimPendingHookEvents,
  hasProjectRunLock,
  markHookEventsFailed,
  markHookEventsProcessed,
  markHookEventsSkipped,
  requeueHookEvents,
  summarizeHookEvents,
} from './lib/hooks.js';
import { checkVisualRunnerAvailability } from './lib/visual-runner.js';

const DEFAULT_PORT = 8765;
const DEFAULT_MODEL = 'gpt-5.5';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const appDist = path.join(repoRoot, 'ui', 'dist');
const execFileAsync = promisify(execFile);

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

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'capabilities') {
    writeJson(response, 200, {
      schemaVersion: 1,
      visualRunner: await checkVisualRunnerAvailability(),
      openai: {
        keyConfigured: Boolean(process.env.OPENAI_API_KEY),
        serverKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
        uiKeySupported: true,
        models: UI_OPENAI_MODELS,
        defaultModel: DEFAULT_MODEL,
      },
    });
    return;
  }

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'update-status') {
    writeJson(response, 200, await readUpdateStatus());
    return;
  }

  if (request.method === 'GET' && parts.length === 3 && parts[1] === 'drafts') {
    writeJson(response, 200, await readProjectDraftForUi({ cwd: repoRoot, draftId: parts[2] }));
    return;
  }

  if (request.method === 'GET' && parts.length === 2 && parts[1] === 'artifacts') {
    await serveArtifact(response, url.searchParams.get('path') || '');
    return;
  }

  if (request.method === 'POST' && parts.length === 2 && parts[1] === 'projects') {
    const body = await readBody(request);
    const summary = body.draftId
      ? await createProjectFromDraftForUi({
        cwd: repoRoot,
        draftId: body.draftId,
        projectName: body.projectName || body.name || '',
        goal: body.goal || '',
        targetIterations: body.targetIterations || 3,
        triggerMode: body.triggerMode || 'manual',
        outputType: body.outputType || 'text',
        model: body.model || DEFAULT_MODEL,
      })
      : await createProjectForUi({
        cwd: repoRoot,
        projectName: body.projectName || body.name || '',
        goal: body.goal || '',
        targetIterations: body.targetIterations || 3,
        triggerMode: body.triggerMode || 'manual',
        outputType: body.outputType || 'text',
        model: body.model || DEFAULT_MODEL,
        baselineFiles: body.baselineFiles || [],
        baselineArchive: body.baselineArchive || null,
      });
    writeJson(response, 201, summary);
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

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'settings') {
    const body = await readBody(request);
    writeJson(response, 200, await updateProjectModelForUi({
      cwd: repoRoot,
      projectName,
      model: body.model || DEFAULT_MODEL,
    }));
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

  if (request.method === 'POST' && parts.length === 4 && parts[3] === 'export') {
    const body = await readBody(request);
    writeJson(response, 200, await exportChampionForUi({
      cwd: repoRoot,
      projectName,
      outDir: body.outDir || '',
    }));
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
    const consumeHooks = body.consumeHooks !== false;
    if (consumeHooks && await hasProjectRunLock({ cwd: repoRoot, projectName })) {
      throw conflict(`Project is already running; pending Codex context remains queued for ${projectName}.`);
    }
    const claimedHookEvents = consumeHooks
      ? await claimPendingHookEvents({ cwd: repoRoot, projectName })
      : [];
    if (claimedHookEvents.length && await hasProjectRunLock({ cwd: repoRoot, projectName })) {
      await requeueHookEvents({
        cwd: repoRoot,
        projectName,
        events: claimedHookEvents,
        reason: 'Project became locked after hook events were claimed',
      });
      throw conflict(`Project is already running; requeued ${claimedHookEvents.length} pending hook event(s).`);
    }
    let result;
    try {
      result = await runProject({
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
        apiKeys: {
          ...(body.openAiApiKey ? { openai: body.openAiApiKey } : {}),
        },
        stopRules: body.stopRules || {},
        triggerMode: claimedHookEvents.length ? 'hook' : body.triggerMode || 'manual',
        hookContext: summarizeHookEvents(claimedHookEvents),
        clientDiagnostics: body.clientDiagnostics || null,
      });
      if (claimedHookEvents.length) {
        if (result.completedRuns.length > 0) {
          await markHookEventsProcessed({ cwd: repoRoot, projectName, events: claimedHookEvents });
        } else {
          await markHookEventsSkipped({
            cwd: repoRoot,
            projectName,
            events: claimedHookEvents,
            reason: result.stopReason || 'no runs completed',
          });
        }
      }
    } catch (error) {
      if (claimedHookEvents.length) {
        if (isProjectLockedError(error)) {
          await requeueHookEvents({ cwd: repoRoot, projectName, events: claimedHookEvents, reason: error.message });
        } else {
          await markHookEventsFailed({ cwd: repoRoot, projectName, events: claimedHookEvents, error });
        }
      }
      throw error;
    }
    writeJson(response, 200, {
      schemaVersion: 1,
      projectId: result.projectId,
      completedRuns: result.completedRuns,
      consumedHookEvents: claimedHookEvents.length,
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

async function readUpdateStatus() {
  const [localCommit, localBranch, remoteUrl, dirtyStatus] = await Promise.all([
    git(['rev-parse', 'HEAD']),
    git(['branch', '--show-current']).catch(() => ''),
    git(['remote', 'get-url', 'origin']).catch(() => ''),
    git(['status', '--porcelain']).catch(() => ''),
  ]);
  const github = parseGitHubRemote(remoteUrl);
  if (!github) {
    return {
      schemaVersion: 1,
      status: 'unknown',
      message: 'No GitHub origin remote is configured.',
      local: formatLocalGit(localCommit, localBranch, dirtyStatus),
      remote: null,
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const repo = await fetchGitHubJson(`https://api.github.com/repos/${github.owner}/${github.repo}`);
    const defaultBranch = repo.default_branch || 'main';
    const latest = await fetchGitHubJson(`https://api.github.com/repos/${github.owner}/${github.repo}/commits/${encodeURIComponent(defaultBranch)}`);
    const remoteCommit = latest.sha || '';
    const upToDate = remoteCommit && remoteCommit === localCommit;
    return {
      schemaVersion: 1,
      status: upToDate ? 'up_to_date' : 'update_available',
      message: upToDate ? 'Skill RSI is up to date.' : `A newer GitHub commit is available on ${defaultBranch}.`,
      local: formatLocalGit(localCommit, localBranch, dirtyStatus),
      remote: {
        owner: github.owner,
        repo: github.repo,
        defaultBranch,
        commit: remoteCommit,
        shortCommit: shortCommit(remoteCommit),
        htmlUrl: latest.html_url || `https://github.com/${github.owner}/${github.repo}/commit/${remoteCommit}`,
      },
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      status: 'unknown',
      message: `Could not check GitHub updates: ${error.message}`,
      local: formatLocalGit(localCommit, localBranch, dirtyStatus),
      remote: {
        owner: github.owner,
        repo: github.repo,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}

async function git(args) {
  const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, timeout: 8000 });
  return stdout.trim();
}

function parseGitHubRemote(remoteUrl) {
  if (!remoteUrl) return null;
  const normalized = remoteUrl.trim().replace(/\.git$/i, '');
  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  try {
    const url = new URL(normalized);
    if (url.hostname !== 'github.com') return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function formatLocalGit(commit, branch, dirtyStatus) {
  return {
    branch: branch || 'detached',
    commit,
    shortCommit: shortCommit(commit),
    dirty: Boolean(dirtyStatus),
  };
}

function shortCommit(commit) {
  return String(commit || '').slice(0, 7);
}

async function fetchGitHubJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'skill-rsi-local-ui',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
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
  if (!isPathInside(candidatePath, appDist)) throw notFound();

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

async function serveArtifact(response, requestedPath) {
  if (!requestedPath) throw badRequest('artifact path is required');
  const artifactPath = path.resolve(requestedPath);
  const artifactRoot = path.join(repoRoot, '.skill-rsi');
  const [realArtifactPath, realArtifactRoot] = await Promise.all([
    fs.realpath(artifactPath),
    fs.realpath(artifactRoot),
  ]);
  if (!isPathInside(realArtifactPath, realArtifactRoot)) {
    throw badRequest('artifact path is outside Skill RSI artifacts');
  }
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.html', '.json']);
  if (!allowed.has(path.extname(realArtifactPath).toLowerCase())) {
    throw badRequest('artifact type is not supported');
  }
  response.writeHead(200, { 'Content-Type': contentType(realArtifactPath) });
  response.end(await fs.readFile(realArtifactPath));
}

function isPathInside(candidatePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
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

function conflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function isProjectLockedError(error) {
  return typeof error?.message === 'string' && error.message.startsWith('Project is already locked:');
}
