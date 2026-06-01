import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Buffer } from 'node:buffer';
import { getProjectPaths, getRunPaths } from './paths.js';
import { readJson, ensureDir, pathExists } from './store.js';
import { readTimeline } from './timeline.js';
import { checkVisualRunnerAvailability } from './visual-runner.js';

const execFileAsync = promisify(execFile);
const SUPPORT_EMAIL = 'justinwetch@me.com';
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 24 * 1024 * 1024;
const DEFAULT_MAX_PROJECT_FILES = 220;
const TEXT_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.md',
  '.mjs',
  '.txt',
  '.yaml',
  '.yml',
]);

export function createSupportPrompt({ command = 'node src/cli.js diagnose', projectName = null, cwd = process.cwd() } = {}) {
  const projectArg = projectName ? ` ${quoteShellArg(projectName)}` : '';
  return [
    'Please diagnose this Skill RSI install without exposing secrets.',
    '',
    `From the Skill RSI repo root (${cwd}), run:`,
    '',
    '```bash',
    `${command}${projectArg}`,
    '```',
    '',
    'Then inspect the generated `.skill-rsi-diagnostics/*.zip` bundle, confirm it does not contain API key values, and email that zip to justinwetch@me.com with a short note describing what failed.',
    '',
    'Do not paste API keys, `.env` contents, or browser-local key values into chat.',
  ].join('\n');
}

export async function createSupportDiagnostics({
  cwd = process.cwd(),
  projectName = null,
  runId = null,
  outDir = path.join(cwd, '.skill-rsi-diagnostics'),
  now = new Date(),
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxTotalBytes = DEFAULT_MAX_TOTAL_BYTES,
  maxProjectFiles = DEFAULT_MAX_PROJECT_FILES,
} = {}) {
  const createdAt = now.toISOString();
  const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const safeProject = projectName ? slugPart(projectName) : 'install';
  const bundleName = `skill-rsi-diagnostics-${safeProject}-${stamp}.zip`;
  const bundlePath = path.join(outDir, bundleName);
  const entries = [];
  const context = {
    cwd,
    projectName,
    runId,
    createdAt,
    redactionCount: 0,
    omitted: [],
    includedBytes: 0,
    maxFileBytes,
    maxTotalBytes,
    maxProjectFiles,
  };

  const addText = (entryPath, text) => {
    const sanitized = sanitizeText(String(text ?? ''), context);
    addEntry(entries, entryPath, Buffer.from(sanitized, 'utf8'), context);
  };
  const addJson = (entryPath, value) => {
    addText(entryPath, `${JSON.stringify(value, null, 2)}\n`);
  };

  const git = await collectGit(cwd);
  const npmVersion = await safeExec('npm', ['--version'], { cwd });
  const visualRunner = await safeVisualRunner();
  const serverCapabilities = await fetchServerCapabilities();
  const projectEvidence = projectName
    ? await collectProjectEvidence({ cwd, projectName, runId, entries, context })
    : null;

  addText('README.txt', renderBundleReadme({
    createdAt,
    cwd,
    projectName,
    requestedRunId: runId,
    projectEvidence,
    git,
    serverCapabilities,
  }));
  addText('SUPPORT_PROMPT.md', createSupportPrompt({ projectName, cwd }));
  addJson('environment/runtime.json', {
    schemaVersion: 1,
    createdAt,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    npm: npmVersion.ok ? npmVersion.stdout.trim() : null,
    cwd,
    serverPort: process.env.SKILL_RSI_SERVER_PORT || '8765',
    openai: {
      serverKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
      uiKeyStateKnownToCli: false,
    },
    visualRunner,
  });
  addJson('server/capabilities.json', serverCapabilities);
  addJson('git/summary.json', git.summary);
  addText('git/branch.txt', git.branch);
  addText('git/head-short.txt', git.headShort);
  addText('git/status-short.txt', git.statusShort);
  addText('git/working-tree-diff.patch', git.diff);
  await addFileIfExists({ cwd, filePath: path.join(cwd, 'package.json'), entryPath: 'package.json', entries, context });

  for (const sourcePath of [
    'src/lib/eval-design.js',
    'src/lib/model-client.js',
    'src/lib/run-loop.js',
    'src/lib/task-contracts.js',
    'src/lib/ui-api.js',
    'src/server.js',
    'src/cli.js',
    'scripts/skill-rsi-plugin-configure.mjs',
    'scripts/skill-rsi-plugin-smoke.mjs',
    'scripts/skill-rsi-plugin-validate.mjs',
    'plugins/skill-rsi/mcp/server.mjs',
  ]) {
    await addFileIfExists({ cwd, filePath: path.join(cwd, sourcePath), entryPath: `source-current/${sourcePath}`, entries, context });
  }

  addJson('manifest.json', {
    schemaVersion: 1,
    createdAt,
    supportEmail: SUPPORT_EMAIL,
    projectName,
    runId: projectEvidence?.runId || runId || null,
    files: entries.map(entry => ({ path: entry.path, bytes: entry.bytes.length })),
    omitted: context.omitted,
    redactionCount: context.redactionCount,
  });

  await ensureDir(outDir);
  await fs.writeFile(bundlePath, createZipBuffer(entries));
  return {
    schemaVersion: 1,
    bundlePath,
    supportEmail: SUPPORT_EMAIL,
    fileCount: entries.length,
    redactionCount: context.redactionCount,
    omitted: context.omitted,
    prompt: createSupportPrompt({ projectName, cwd }),
  };
}

function renderBundleReadme({ createdAt, cwd, projectName, requestedRunId, projectEvidence, git, serverCapabilities }) {
  const lines = [
    'Skill RSI support diagnostics',
    '=============================',
    '',
    `Created: ${createdAt}`,
    `Repo: ${cwd}`,
    `Project: ${projectName || '(not specified)'}`,
    `Run: ${projectEvidence?.runId || requestedRunId || '(latest if available)'}`,
    `Branch: ${git.branch.trim() || '(unknown)'}`,
    `HEAD: ${git.headShort.trim() || '(unknown)'}`,
    '',
    'What is included',
    '----------------',
    '- Runtime, doctor-style readiness, server capabilities, git status, selected current source files, and selected project/run artifacts.',
    '- Text content is sanitized for API key-like values before packaging.',
    '- `.env`, `node_modules`, `.git`, and browser-local storage are not included.',
    '',
    'Key-state note',
    '--------------',
    'The CLI can report only server environment key presence. Browser-local UI key presence must be added by UI diagnostics or confirmed manually.',
    '',
    'Server capabilities',
    '-------------------',
    serverCapabilities.ok === false ? `Unavailable: ${serverCapabilities.error}` : 'Captured from the local server.',
    '',
    'Send this bundle to justinwetch@me.com with a short note describing the failure.',
  ];
  return `${lines.join('\n')}\n`;
}

async function collectGit(cwd) {
  const branch = await safeExec('git', ['branch', '--show-current'], { cwd });
  const headShort = await safeExec('git', ['rev-parse', '--short', 'HEAD'], { cwd });
  const statusShort = await safeExec('git', ['status', '--short'], { cwd });
  const diff = await safeExec('git', ['diff', '--', 'src', 'scripts', 'plugins', 'README.md', 'docs', 'package.json', 'ui/src'], { cwd, maxBuffer: 5 * 1024 * 1024 });
  return {
    branch: branch.ok ? branch.stdout : branch.stderr,
    headShort: headShort.ok ? headShort.stdout : headShort.stderr,
    statusShort: statusShort.ok ? statusShort.stdout : statusShort.stderr,
    diff: diff.ok ? diff.stdout : diff.stderr,
    summary: {
      branch: branch.ok ? branch.stdout.trim() : null,
      headShort: headShort.ok ? headShort.stdout.trim() : null,
      statusShort: statusShort.ok ? statusShort.stdout.trim().split('\n').filter(Boolean) : [],
      diffCaptured: diff.ok,
    },
  };
}

async function collectProjectEvidence({ cwd, projectName, runId, entries, context }) {
  const paths = getProjectPaths(cwd, projectName);
  const exists = await pathExists(paths.projectDir);
  if (!exists) {
    addEntry(entries, 'project/PROJECT_NOT_FOUND.txt', Buffer.from(`Project directory was not found: ${paths.projectDir}\n`, 'utf8'), context);
    return { projectId: paths.projectId, runId: null, exists: false };
  }

  for (const [entryPath, filePath] of [
    ['project/project.yaml', paths.configYaml],
    ['project/config.json', paths.configJson],
    ['project/state.json', paths.stateJson],
    ['project/history/index.json', paths.historyIndex],
    ['project/history/current-summary.md', paths.historySummary],
    ['project/prompt-bank/index.json', paths.promptBankIndex],
    ['project/prompt-bank/prompts.json', paths.promptBankPrompts],
    ['project/prompt-bank/criteria.json', paths.promptBankCriteria],
  ]) {
    await addFileIfExists({ cwd, filePath, entryPath, entries, context });
  }

  const state = await readJson(paths.stateJson, {});
  const selectedRunId = runId || state.lastRunId || await newestRunId(paths.runsDir);
  if (!selectedRunId) return { projectId: paths.projectId, runId: null, exists: true };

  const runPaths = getRunPaths(paths, selectedRunId);
  await addRunDirectory({ runDir: runPaths.runDir, entries, context });

  try {
    const timeline = await readTimeline(runPaths.timelineJsonl);
    addEntry(
      entries,
      'project/latest-run/timeline-summary.json',
      Buffer.from(`${JSON.stringify(summarizeTimeline(timeline), null, 2)}\n`, 'utf8'),
      context,
    );
  } catch {
    // The raw timeline file, if present, is still included by the directory walk.
  }

  return { projectId: paths.projectId, runId: selectedRunId, exists: true };
}

async function addRunDirectory({ runDir, entries, context }) {
  const exists = await pathExists(runDir);
  if (!exists) {
    context.omitted.push({ path: normalizeEntryPath(runDir), reason: 'run directory not found' });
    return;
  }
  let count = 0;
  await walkFiles(runDir, async filePath => {
    if (count >= context.maxProjectFiles) {
      context.omitted.push({ path: normalizeEntryPath(filePath), reason: `project file limit ${context.maxProjectFiles} reached` });
      return;
    }
    count += 1;
    const relative = path.relative(runDir, filePath);
    await addFileIfExists({
      cwd: context.cwd,
      filePath,
      entryPath: `project/latest-run/${normalizeEntryPath(relative)}`,
      entries,
      context,
    });
  });
}

async function addFileIfExists({ filePath, entryPath, entries, context }) {
  if (shouldSkipFile(filePath)) return;
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!stat.isFile()) return;
  if (stat.size > context.maxFileBytes) {
    context.omitted.push({ path: normalizeEntryPath(entryPath), reason: `file exceeds ${context.maxFileBytes} bytes`, bytes: stat.size });
    return;
  }

  const bytes = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const entryBytes = isProbablyText(bytes, ext)
    ? Buffer.from(sanitizeText(bytes.toString('utf8'), context), 'utf8')
    : bytes;
  addEntry(entries, entryPath, entryBytes, context);
}

function addEntry(entries, entryPath, bytes, context) {
  const normalized = normalizeEntryPath(entryPath);
  if (context.includedBytes + bytes.length > context.maxTotalBytes) {
    context.omitted.push({ path: normalized, reason: `bundle size limit ${context.maxTotalBytes} reached`, bytes: bytes.length });
    return;
  }
  entries.push({ path: normalized, bytes });
  context.includedBytes += bytes.length;
}

function shouldSkipFile(filePath) {
  const parts = normalizeEntryPath(filePath).split('/');
  if (parts.includes('node_modules') || parts.includes('.git')) return true;
  const base = path.basename(filePath).toLowerCase();
  return base === '.env' || base.startsWith('.env.');
}

async function walkFiles(dir, onFile) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipFile(filePath)) continue;
      await walkFiles(filePath, onFile);
    } else if (entry.isFile()) {
      await onFile(filePath);
    }
  }
}

async function newestRunId(runsDir) {
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort().at(-1) || null;
  } catch {
    return null;
  }
}

function summarizeTimeline(timeline) {
  return {
    eventCount: timeline.length,
    firstEvent: timeline[0]?.event || null,
    lastEvent: timeline.at(-1)?.event || null,
    failures: timeline
      .filter(entry => String(entry.event || '').includes('failed'))
      .map(entry => ({
        timestamp: entry.timestamp,
        event: entry.event,
        name: entry.details?.name || null,
        message: entry.details?.message || entry.details?.reason || null,
        failureKind: entry.details?.failureKind || entry.details?.provenance?.failureKind || null,
        attemptCount: entry.details?.attemptCount || entry.details?.provenance?.modelAttemptCount || null,
      })),
  };
}

async function safeVisualRunner() {
  try {
    return await checkVisualRunnerAvailability();
  } catch (error) {
    return { available: false, browser: null, error: error.message, installHint: 'Run `npx playwright install chromium`, or install Google Chrome/Chromium locally.' };
  }
}

async function fetchServerCapabilities() {
  const port = process.env.SKILL_RSI_SERVER_PORT || '8765';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/capabilities`, { signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: `http://127.0.0.1:${port}/api/capabilities`,
      body: tryParseJson(text) ?? sanitizeText(text, { redactionCount: 0 }),
    };
  } catch (error) {
    return {
      ok: false,
      url: `http://127.0.0.1:${port}/api/capabilities`,
      error: error.name === 'AbortError' ? 'request timed out' : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function safeExec(command, args, options = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer || 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message,
    };
  }
}

export function sanitizeText(text, context = { redactionCount: 0 }) {
  let redacted = String(text ?? '');
  const replacements = [
    [
      /\b((?:OPENAI|ANTHROPIC|GEMINI|GOOGLE|MISTRAL|COHERE|TOGETHER|XAI|PERPLEXITY)_API_KEY\s*=\s*)([^\s"'`]+)/gi,
      (_match, prefix) => `${prefix}[REDACTED]`,
    ],
    [
      /("(?:openAiKey|openaiKey|apiKey|api_key|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)"\s*:\s*")([^"]+)(")/gi,
      (_match, prefix, _secret, suffix) => `${prefix}[REDACTED]${suffix}`,
    ],
    [
      /('(?:openAiKey|openaiKey|apiKey|api_key|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY)'\s*:\s*')([^']+)(')/gi,
      (_match, prefix, _secret, suffix) => `${prefix}[REDACTED]${suffix}`,
    ],
    [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, () => '[REDACTED_API_KEY]'],
    [/\bAIza[0-9A-Za-z_-]{20,}\b/g, () => '[REDACTED_API_KEY]'],
  ];
  for (const [pattern, replacement] of replacements) {
    redacted = redacted.replace(pattern, (...match) => {
      context.redactionCount = (context.redactionCount || 0) + 1;
      return replacement(...match);
    });
  }
  return redacted;
}

function isProbablyText(bytes, ext) {
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  return !sample.includes(0);
}

function normalizeEntryPath(value) {
  return String(value)
    .replace(/^[A-Za-z]:[\\/]/, '')
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/');
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9._/-]+$/.test(text)) return text;
  return `"${text.replaceAll('"', '\\"')}"`;
}

function slugPart(value) {
  return String(value || 'project')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const bytes = entry.bytes;
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + bytes.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralOffset = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

let crcTable = null;

function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
