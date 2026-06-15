import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureDir, writeText } from './store.js';
import { readZipEntries } from './zip.js';

const TEXT_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.xml',
  '.csv',
  '.tsv',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.sql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.svg',
]);

const MAX_FILES = 250;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_ZIP_BYTES = 25 * 1024 * 1024;

export async function loadSkillPackage(sourcePath) {
  const absoluteSourcePath = path.resolve(sourcePath);
  const stat = await fs.stat(absoluteSourcePath);

  if (stat.isDirectory()) {
    return finalizePackage(await loadDirectoryPackage(absoluteSourcePath));
  }

  if (stat.isFile() && isZipPath(absoluteSourcePath)) {
    if (stat.size > MAX_ZIP_BYTES) {
      throw new Error(`ZIP is too large. Maximum supported size is ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB.`);
    }
    return finalizePackage(await loadZipPackage(absoluteSourcePath));
  }

  if (stat.isFile() && isPlainSkillPath(absoluteSourcePath)) {
    return finalizePackage(await loadSingleFilePackage(absoluteSourcePath));
  }

  throw new Error('Skill package source must be a directory, .zip package, .md file, or .txt file');
}

export function validateSkillPackage(skillPackage) {
  const errors = [];
  const entrypoint = skillPackage.files.find(file => file.path === skillPackage.entrypoint && file.kind === 'text');

  if (!entrypoint) {
    errors.push('Root SKILL.md entrypoint is required');
  } else {
    const frontmatter = parseFrontmatter(entrypoint.content);
    if (!frontmatter) {
      errors.push('SKILL.md must start with YAML frontmatter');
    } else {
      if (!frontmatter.name) {
        errors.push('SKILL.md frontmatter requires name');
      } else if (frontmatter.name.length > 64) {
        errors.push('SKILL.md name must be at most 64 characters');
      } else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(frontmatter.name)) {
        errors.push('SKILL.md name must be lowercase letters, numbers, and single hyphens (no uppercase, spaces, leading/trailing or consecutive hyphens)');
      }
      if (!frontmatter.description) {
        errors.push('SKILL.md frontmatter requires description');
      } else if (frontmatter.description.length > 1024) {
        errors.push('SKILL.md description must be at most 1024 characters');
      }
    }
  }

  const paths = new Set(skillPackage.files.map(file => file.path));
  const referencedPaths = entrypoint ? findReferencedPackagePaths(entrypoint.content) : [];
  for (const referencedPath of referencedPaths) {
    if (!paths.has(referencedPath)) {
      errors.push(`Referenced package file does not exist: ${referencedPath}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export async function materializeSkillPackage(skillPackage, destinationDir) {
  await fs.rm(destinationDir, { recursive: true, force: true });
  await ensureDir(destinationDir);

  for (const file of skillPackage.files) {
    if (file.kind !== 'text') continue;
    await writeText(path.join(destinationDir, file.path), file.content);
  }
}

async function loadDirectoryPackage(sourcePath) {
  const rawFiles = [];

  async function visit(currentDir, prefix = '') {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const relativePath = normalizePath(path.join(prefix, entry.name));
      const absolutePath = path.join(currentDir, entry.name);
      if (isJunkPath(relativePath)) continue;

      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        rawFiles.push({ path: relativePath, bytes: await fs.readFile(absolutePath) });
      }
    }
  }

  await visit(sourcePath);

  return {
    sourcePath,
    packageType: 'directory',
    filename: path.basename(sourcePath),
    rawFiles,
  };
}

async function loadZipPackage(sourcePath) {
  const bytes = await fs.readFile(sourcePath);
  const rawEntries = readZipEntries(bytes)
    .map(entry => ({ path: normalizePath(entry.path), bytes: entry.bytes }))
    .filter(entry => entry.path && !isUnsafePath(entry.path) && !isJunkPath(entry.path));
  const commonRoot = getCommonRoot(rawEntries.map(entry => entry.path));

  return {
    sourcePath,
    packageType: 'zip',
    filename: path.basename(sourcePath),
    rawFiles: rawEntries.map(entry => ({
      ...entry,
      path: commonRoot ? entry.path.slice(commonRoot.length + 1) : entry.path,
    })),
  };
}

async function loadSingleFilePackage(sourcePath) {
  return {
    sourcePath,
    packageType: 'single-file',
    filename: path.basename(sourcePath),
    rawFiles: [{
      path: 'SKILL.md',
      bytes: await fs.readFile(sourcePath),
    }],
  };
}

async function finalizePackage({ sourcePath, packageType, filename, rawFiles }) {
  const diagnostics = [];
  const omittedFiles = [];
  const safeFiles = rawFiles
    .filter(file => file.path && !isUnsafePath(file.path))
    .slice(0, MAX_FILES);

  if (rawFiles.length > MAX_FILES) {
    diagnostics.push(`Only the first ${MAX_FILES} package files were included; ${rawFiles.length - MAX_FILES} were omitted.`);
  }

  const files = [];
  let textBytes = 0;

  for (const rawFile of safeFiles) {
    const extension = path.extname(rawFile.path).toLowerCase();
    const baseRecord = {
      path: rawFile.path,
      role: inferRole(rawFile.path),
      mediaType: inferMediaType(rawFile.path),
      size: rawFile.bytes.length,
      sha256: sha256(rawFile.bytes),
    };

    if (!TEXT_EXTENSIONS.has(extension)) {
      omittedFiles.push({ ...baseRecord, reason: 'Unsupported binary file type' });
      continue;
    }

    if (rawFile.bytes.length > MAX_TEXT_FILE_BYTES) {
      omittedFiles.push({ ...baseRecord, reason: 'Text file exceeds per-file limit' });
      continue;
    }

    if (textBytes + rawFile.bytes.length > MAX_TOTAL_TEXT_BYTES) {
      omittedFiles.push({ ...baseRecord, reason: 'Text budget exceeded' });
      continue;
    }

    textBytes += rawFile.bytes.length;
    files.push({
      ...baseRecord,
      kind: 'text',
      content: rawFile.bytes.toString('utf8'),
      truncated: false,
    });
  }

  files.sort(sortSkillFiles);
  normalizeNestedEntrypoint(files, diagnostics);

  const skillPackage = {
    id: createPackageId(sourcePath),
    sourcePath,
    filename,
    kind: 'agent-skill',
    packageType,
    entrypoint: 'SKILL.md',
    files,
    omittedFiles,
    diagnostics,
  };
  const validation = validateSkillPackage(skillPackage);

  return {
    ...skillPackage,
    validation,
    hash: hashSkillPackage(skillPackage),
  };
}

function normalizeNestedEntrypoint(files, diagnostics) {
  if (files.some(file => file.path === 'SKILL.md')) return;
  const nested = files.filter(file => /(^|\/)SKILL\.md$/i.test(file.path));
  if (nested.length === 1) {
    diagnostics.push(`Using nested entrypoint ${nested[0].path}; Agent Skills should place SKILL.md at the package root.`);
    nested[0].path = 'SKILL.md';
    nested[0].role = 'entrypoint';
  }
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split('\n')) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    result[field[1]] = field[2].replace(/^["']|["']$/g, '').trim();
  }
  return result;
}

function findReferencedPackagePaths(content) {
  const paths = new Set();
  const pattern = /(?:\]\(|[`'"]|(?:^|\s))(references\/[^)`'"\s]+|scripts\/[^)`'"\s]+|assets\/[^)`'"\s]+)/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    paths.add(normalizePath(match[1].replace(/[.,;:]$/, '')));
  }
  return [...paths];
}

function hashSkillPackage(skillPackage) {
  const hash = crypto.createHash('sha256');
  for (const file of [...skillPackage.files].sort(sortSkillFiles)) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.kind);
    hash.update('\0');
    if (file.kind === 'text') hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function createPackageId(sourcePath) {
  return `${path.basename(sourcePath).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-${sha256(Buffer.from(path.resolve(sourcePath))).slice(0, 8)}`;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function inferRole(filePath) {
  if (filePath === 'SKILL.md') return 'entrypoint';
  if (/^references\//i.test(filePath)) return 'reference';
  if (/^scripts\//i.test(filePath)) return 'script';
  if (/^assets\//i.test(filePath)) return 'asset';
  if (/^commands\//i.test(filePath)) return 'command';
  return 'support';
}

function inferMediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') return 'application/json';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.html' || extension === '.htm') return 'text/html';
  if (extension === '.css') return 'text/css';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.md' || extension === '.mdx') return 'text/markdown';
  return 'text/plain';
}

function sortSkillFiles(a, b) {
  const score = file => {
    if (file.path === 'SKILL.md') return 0;
    if (/^references\//i.test(file.path)) return 1;
    if (/^scripts\//i.test(file.path)) return 2;
    if (/^assets\//i.test(file.path)) return 3;
    return 4;
  };
  return score(a) - score(b) || a.path.localeCompare(b.path);
}

function normalizePath(value) {
  return String(value)
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

function isUnsafePath(filePath) {
  const parts = normalizePath(filePath).split('/');
  return parts.includes('..') || filePath.startsWith('/') || /^[a-z]:/i.test(filePath);
}

function isJunkPath(filePath) {
  const parts = normalizePath(filePath).split('/');
  return parts.some(part => (
    part === '__MACOSX' ||
    part === '.DS_Store' ||
    part === '.git' ||
    part === '.svn' ||
    part === 'node_modules' ||
    part === 'dist' ||
    part === 'build' ||
    part === '.next' ||
    part === '.cache' ||
    part === '.venv' ||
    part === 'venv' ||
    part === '__pycache__'
  ));
}

function getCommonRoot(paths) {
  if (paths.length < 2) return null;
  const firstRoot = paths[0].split('/')[0];
  if (!firstRoot) return null;
  return paths.every(filePath => filePath.startsWith(`${firstRoot}/`)) ? firstRoot : null;
}

function isZipPath(filePath) {
  return filePath.toLowerCase().endsWith('.zip');
}

function isPlainSkillPath(filePath) {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.txt');
}
