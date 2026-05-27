import { getProjectPaths } from './paths.js';
import { readJson } from './store.js';

export async function readProjectStatus({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  const state = await readJson(paths.stateJson);
  const history = await readJson(paths.historyIndex);

  if (!state || !history) {
    throw new Error(`Project "${paths.projectId}" has not been initialized`);
  }

  return {
    projectId: paths.projectId,
    runCount: state.runCount,
    currentChampion: state.currentChampion,
    lastRunId: state.lastRunId,
    trajectoryLength: history.trajectory.length,
    projectDir: paths.projectDir,
  };
}
