import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from './store.js';

export async function appendTimeline(filePath, event, details = {}) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    details,
  })}\n`, 'utf8');
}

export async function readTimeline(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line, index) => parseTimelineLine(line, index + 1));
}

export function renderTimeline(entries, { runId = null } = {}) {
  const lines = [
    `# Timeline${runId ? `: ${runId}` : ''}`,
    '',
  ];

  for (const entry of entries) {
    const details = summarizeDetails(entry.details);
    lines.push(`- ${entry.timestamp} ${entry.event}${details ? ` - ${details}` : ''}`);
  }

  return `${lines.join('\n')}\n`;
}

function parseTimelineLine(line, lineNumber) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`Timeline line ${lineNumber} is invalid JSON: ${error.message}`);
  }
}

function summarizeDetails(details) {
  if (!details || typeof details !== 'object') return '';
  const priorityKeys = [
    'mode',
    'agent',
    'model',
    'path',
    'winner',
    'decision',
    'status',
    'reason',
    'message',
  ];
  const parts = [];

  for (const key of priorityKeys) {
    if (details[key] !== undefined && details[key] !== null) {
      parts.push(`${key}: ${formatDetailValue(details[key])}`);
    }
  }

  for (const [key, value] of Object.entries(details)) {
    if (priorityKeys.includes(key) || value === undefined || value === null) continue;
    if (parts.length >= 6) break;
    parts.push(`${key}: ${formatDetailValue(value)}`);
  }

  return parts.join(', ');
}

function formatDetailValue(value) {
  if (Array.isArray(value)) return value.join('|');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
