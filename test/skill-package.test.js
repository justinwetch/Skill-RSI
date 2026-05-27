import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { loadSkillPackage, materializeSkillPackage } from '../src/lib/skill-package.js';

test('loads and validates a directory skill package', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-package-'));
  await fs.mkdir(path.join(cwd, 'references'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'SKILL.md'), `---
name: ux-design
description: Use when designing product UX.
---

# UX Design

Read [notes](references/notes.md).
`);
  await fs.writeFile(path.join(cwd, 'references', 'notes.md'), '# Notes\n');

  const skillPackage = await loadSkillPackage(cwd);

  assert.equal(skillPackage.packageType, 'directory');
  assert.equal(skillPackage.validation.valid, true);
  assert.equal(skillPackage.files[0].path, 'SKILL.md');
  assert.equal(skillPackage.files.length, 2);
  assert.ok(skillPackage.hash);
});

test('loads a single markdown file as SKILL.md', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-single-'));
  const filePath = path.join(cwd, 'skill.md');
  await fs.writeFile(filePath, `---
name: single-skill
description: Use for single-file loading.
---

# Single Skill
`);

  const skillPackage = await loadSkillPackage(filePath);

  assert.equal(skillPackage.packageType, 'single-file');
  assert.equal(skillPackage.validation.valid, true);
  assert.equal(skillPackage.files[0].path, 'SKILL.md');
});

test('reports missing references as validation errors', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-invalid-'));
  await fs.writeFile(path.join(cwd, 'SKILL.md'), `---
name: broken
description: Broken reference skill.
---

Read references/missing.md.
`);

  const skillPackage = await loadSkillPackage(cwd);

  assert.equal(skillPackage.validation.valid, false);
  assert.match(skillPackage.validation.errors.join('\n'), /references\/missing\.md/);
});

test('loads a stored zip skill package', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-zip-'));
  const zipPath = path.join(cwd, 'skill.zip');
  await fs.writeFile(zipPath, createStoredZip({
    'skill/SKILL.md': `---
name: zipped-skill
description: Use for zip loading.
---

# Zipped Skill
`,
    'skill/references/notes.md': '# Notes\n',
  }));

  const skillPackage = await loadSkillPackage(zipPath);

  assert.equal(skillPackage.packageType, 'zip');
  assert.equal(skillPackage.validation.valid, true);
  assert.deepEqual(skillPackage.files.map(file => file.path), ['SKILL.md', 'references/notes.md']);
});

test('materializes a loaded package to disk', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-rsi-materialize-'));
  const source = path.join(cwd, 'source.md');
  const destination = path.join(cwd, 'out');
  await fs.writeFile(source, `---
name: materialized
description: Use for materialization.
---

# Materialized
`);

  const skillPackage = await loadSkillPackage(source);
  await materializeSkillPackage(skillPackage, destination);

  const materialized = await fs.readFile(path.join(destination, 'SKILL.md'), 'utf8');
  assert.match(materialized, /name: materialized/);
});

function createStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [filePath, content] of Object.entries(files)) {
    const name = Buffer.from(filePath);
    const data = Buffer.from(content);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});
