import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from './store.js';

export async function acquireProjectLock(projectDir) {
  const lockPath = path.join(projectDir, 'run.lock');
  await ensureDir(projectDir);

  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify({
      pid: process.pid,
      createdAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Project is already locked: ${lockPath}`);
    }
    throw error;
  } finally {
    await handle?.close();
  }

  return {
    lockPath,
    async release() {
      await fs.rm(lockPath, { force: true });
    },
  };
}
