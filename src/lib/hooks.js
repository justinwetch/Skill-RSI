import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getProjectPaths } from './paths.js';
import { ensureDir, readJson, writeJson } from './store.js';

const DEFAULT_STALE_PROCESSING_MS = 30 * 60 * 1000;

export async function readHookPayload({ eventPath = null, event = null, stdin = process.stdin }) {
  if (event) return event;
  if (eventPath === '-') {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString('utf8').trim();
    return raw ? JSON.parse(raw) : {};
  }
  if (eventPath) return JSON.parse(await fs.readFile(eventPath, 'utf8'));
  return { source: 'manual-hook' };
}

export function normalizeHookEvent({ cwd, projectName, payload, eventPath = null, receivedAt = new Date().toISOString() }) {
  const paths = getProjectPaths(cwd, projectName);
  const changedFiles = normalizeChangedFiles(payload);
  const sanitizedPayload = sanitizeHookPayload(payload, { changedFiles });
  return {
    schemaVersion: 1,
    id: createHookId(receivedAt),
    receivedAt,
    projectName,
    projectId: paths.projectId,
    eventName: normalizeEventName(payload),
    changedFiles,
    transcriptPath: payload?.transcriptPath || payload?.transcript_path || null,
    sourceEventPath: eventPath && eventPath !== '-' ? path.resolve(cwd, eventPath) : null,
    payload: sanitizedPayload,
    rawPayloadSha256: hashJson(payload),
  };
}

export async function recordHookEvent({ cwd, projectName, eventPath = null, event = null, queued = false }) {
  const paths = getProjectPaths(cwd, projectName);
  const hooksDir = queued ? getHookInboxDir(paths) : path.join(paths.projectDir, 'hooks');
  await ensureDir(hooksDir);

  const receivedAt = new Date().toISOString();
  const payload = await readHookPayload({ eventPath, event });
  const normalized = normalizeHookEvent({ cwd, projectName, payload, eventPath, receivedAt });
  const outputPath = path.join(hooksDir, `${normalized.id}.json`);
  await writeJson(outputPath, normalized);

  return outputPath;
}

export async function claimPendingHookEvents({
  cwd,
  projectName,
  staleProcessingMs = DEFAULT_STALE_PROCESSING_MS,
  now = new Date(),
}) {
  const paths = getProjectPaths(cwd, projectName);
  const inboxDir = getHookInboxDir(paths);
  const processingDir = path.join(paths.projectDir, 'hooks', 'processing');
  await ensureDir(processingDir);
  await reclaimStaleProcessingHookEvents({ paths, staleProcessingMs, now });
  let entries = [];
  try {
    entries = await fs.readdir(inboxDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(inboxDir, entry.name))
    .sort();

  const events = [];
  for (const filePath of files) {
    const processingPath = path.join(processingDir, path.basename(filePath));
    try {
      await fs.rename(filePath, processingPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    events.push({
      ...(await markHookEventInPlace({
        filePath: processingPath,
        status: 'processing',
        reason: null,
      })),
      path: processingPath,
    });
  }
  return events;
}

export async function hasProjectRunLock({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  return isProjectLocked(paths.projectDir);
}

export async function markHookEventsProcessed({ cwd, projectName, events }) {
  await moveHookEvents({ cwd, projectName, events, status: 'processed' });
}

export async function markHookEventsSkipped({ cwd, projectName, events, reason }) {
  await moveHookEvents({ cwd, projectName, events, status: 'skipped', reason });
}

export async function requeueHookEvents({ cwd, projectName, events, reason }) {
  await moveHookEvents({ cwd, projectName, events, status: 'inbox', reason });
}

export async function markHookEventsFailed({ cwd, projectName, events, error }) {
  await moveHookEvents({ cwd, projectName, events, status: 'failed', error });
}

export function summarizeHookEvents(events) {
  if (!events.length) return null;
  const changedFiles = [...new Set(events.flatMap(event => normalizeChangedFiles(event)))].sort();
  const eventNames = [...new Set(events.map(event => event.eventName).filter(Boolean))].sort();
  const transcriptPaths = uniqueStrings(events.map(event => event.transcriptPath));
  const sourceEventPaths = uniqueStrings(events.map(event => event.sourceEventPath));
  const focusParameterIds = uniqueStrings(events.flatMap(event => normalizeArray(event.payload?.focusParameterIds || event.focusParameterIds)));
  const parameterIds = uniqueStrings(events.flatMap(event => normalizeArray(event.payload?.parameterIds || event.parameterIds)));
  const reasons = uniqueStrings(events.map(event => event.payload?.reason || event.reason));
  const reason = reasons.slice(0, 4).join(' | ') || null;
  return {
    id: events.map(event => event.id).filter(Boolean).join('+') || null,
    source: 'hook-inbox',
    eventName: eventNames.join(', ') || 'hook-inbox',
    eventCount: events.length,
    changedFiles,
    receivedAt: events[events.length - 1]?.receivedAt || null,
    transcriptPaths,
    sourceEventPaths,
    reason,
    payload: {
      source: 'hook-inbox',
      eventNames,
      changedFiles,
      hookEventCount: events.length,
      transcriptPaths,
      sourceEventPaths,
      focusParameterIds,
      parameterIds,
      reason,
    },
  };
}

async function moveHookEvents({ cwd, projectName, events, status, error = null, reason = null }) {
  if (!events.length) return [];
  const paths = getProjectPaths(cwd, projectName);
  const destinationDir = status === 'inbox' ? getHookInboxDir(paths) : path.join(paths.projectDir, 'hooks', status);
  await ensureDir(destinationDir);
  const moved = [];

  for (const event of events) {
    const sourcePath = event.path;
    if (!sourcePath) continue;
    const destinationPath = path.join(destinationDir, path.basename(sourcePath));
    await fs.rename(sourcePath, destinationPath);
    await markHookEventInPlace({
      filePath: destinationPath,
      status: status === 'inbox' ? 'queued' : status,
      error,
      reason,
    });
    moved.push(destinationPath);
  }

  return moved;
}

function getHookInboxDir(paths) {
  return path.join(paths.projectDir, 'hooks', 'inbox');
}

async function reclaimStaleProcessingHookEvents({ paths, staleProcessingMs, now }) {
  const processingDir = path.join(paths.projectDir, 'hooks', 'processing');
  const inboxDir = getHookInboxDir(paths);
  if (await isProjectLocked(paths.projectDir)) return [];
  let entries = [];
  try {
    entries = await fs.readdir(processingDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  await ensureDir(inboxDir);
  const reclaimed = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const processingPath = path.join(processingDir, entry.name);
    const stale = await isProcessingEventStale({ filePath: processingPath, staleProcessingMs, now });
    if (!stale) continue;
    await markHookEventInPlace({
      filePath: processingPath,
      status: 'queued',
      reason: `reclaimed stale processing event after ${staleProcessingMs}ms`,
    });
    const inboxPath = path.join(inboxDir, entry.name);
    try {
      await fs.rename(processingPath, inboxPath);
      reclaimed.push(inboxPath);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return reclaimed;
}

async function isProjectLocked(projectDir) {
  try {
    await fs.access(path.join(projectDir, 'run.lock'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function isProcessingEventStale({ filePath, staleProcessingMs, now }) {
  const [event, stat] = await Promise.all([
    readJson(filePath, {}),
    fs.stat(filePath),
  ]);
  const timestamp = Date.parse(event.queueUpdatedAt || stat.mtime.toISOString());
  if (!Number.isFinite(timestamp)) return true;
  return now.getTime() - timestamp > staleProcessingMs;
}

async function markHookEventInPlace({ filePath, status, error = null, reason = null }) {
  const value = await readJson(filePath, {});
  const next = {
    ...value,
    path: undefined,
    queueStatus: status,
    queueUpdatedAt: new Date().toISOString(),
    queueError: error ? { name: error.name, message: error.message } : null,
    queueReason: reason,
  };
  await writeJson(filePath, next);
  return next;
}

function createHookId(receivedAt) {
  const stamp = receivedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEventName(payload) {
  return payload?.hook_event_name
    || payload?.hookEventName
    || payload?.eventName
    || payload?.event
    || payload?.source
    || 'codex-hook';
}

function normalizeChangedFiles(value) {
  const source = value?.payload || value || {};
  const candidates = [
    source.changedFiles,
    source.changed_files,
    source.files,
    source.modifiedFiles,
    source.modified_files,
  ];
  return candidates
    .find(Array.isArray)
    ?.map(item => String(item).trim())
    .filter(Boolean) || [];
}

function sanitizeHookPayload(payload, { changedFiles }) {
  return removeNullish({
    source: payload?.source || 'codex-hook',
    hookEventName: normalizeEventName(payload),
    eventName: normalizeEventName(payload),
    turnId: payload?.turn_id || payload?.turnId || null,
    permissionMode: payload?.permission_mode || payload?.permissionMode || null,
    changedFiles,
    reason: payload?.reason || null,
    focusParameterIds: normalizeArray(payload?.focusParameterIds),
    parameterIds: normalizeArray(payload?.parameterIds),
    transcriptPath: payload?.transcriptPath || payload?.transcript_path || null,
  });
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : [];
}

function removeNullish(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === null || item === undefined) return false;
    if (Array.isArray(item) && item.length === 0) return false;
    return true;
  }));
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => value ? String(value).trim() : '').filter(Boolean))].sort();
}

function hashJson(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex');
}
