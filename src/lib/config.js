import { getProjectPaths } from './paths.js';
import { readJson } from './store.js';

// Per-project tunables the loop actually honors. Persisted as machine-readable JSON
// (config.json) so there is a single source of truth without a YAML parser dependency.
// Anything missing falls back to these defaults, so older projects keep working.
export const DEFAULT_PROJECT_CONFIG = {
  promotion: {
    // Margins a challenger must clear over the current champion to be promoted.
    minScoreDelta: 4,
    minWinDelta: 2,
  },
  eval: {
    stablePromptCount: 6,
    explorationPromptCount: 4,
  },
  models: {
    agent: 'gpt-5.4-mini',       // ontology, deconstructor, planner, creator, reviewer, analyst
    generation: 'gpt-5.4-mini',  // runs candidate skills to produce eval outputs
    judge: 'gpt-5.4-mini',       // scores eval outputs
  },
};

function mergeSection(defaults, override) {
  if (!override || typeof override !== 'object') return { ...defaults };
  return { ...defaults, ...override };
}

export function normalizeProjectConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    promotion: mergeSection(DEFAULT_PROJECT_CONFIG.promotion, r.promotion),
    eval: mergeSection(DEFAULT_PROJECT_CONFIG.eval, r.eval),
    models: mergeSection(DEFAULT_PROJECT_CONFIG.models, r.models),
  };
}

export async function loadProjectConfig({ cwd, projectName }) {
  const paths = getProjectPaths(cwd, projectName);
  const raw = await readJson(paths.configJson, null);
  return normalizeProjectConfig(raw);
}
