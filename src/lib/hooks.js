import fs from 'node:fs/promises';
import path from 'node:path';
import { getProjectPaths } from './paths.js';
import { ensureDir, writeJson } from './store.js';

export async function recordHookEvent({ cwd, projectName, eventPath = null, event = null }) {
  const paths = getProjectPaths(cwd, projectName);
  const hooksDir = path.join(paths.projectDir, 'hooks');
  await ensureDir(hooksDir);

  const payload = event || (eventPath
    ? JSON.parse(await fs.readFile(eventPath, 'utf8'))
    : { source: 'manual-hook', receivedAt: new Date().toISOString() });
  const hookId = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const outputPath = path.join(hooksDir, `${hookId}.json`);

  await writeJson(outputPath, {
    id: hookId,
    receivedAt: new Date().toISOString(),
    payload,
  });

  return outputPath;
}
