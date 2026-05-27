import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadDotEnv(cwd = process.cwd(), filename = '.env') {
  const envPath = path.join(cwd, filename);
  let raw;
  try {
    raw = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = stripQuotes(match[2].trim());
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return true;
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
