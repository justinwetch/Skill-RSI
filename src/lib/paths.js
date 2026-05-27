import path from 'node:path';

export function slugifyProjectName(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    throw new Error('Project name must contain at least one letter or number');
  }

  return slug;
}

export function getProjectPaths(cwd, projectName) {
  const projectId = slugifyProjectName(projectName);
  const rootDir = path.join(cwd, '.skill-rsi');
  const projectsDir = path.join(rootDir, 'projects');
  const projectDir = path.join(projectsDir, projectId);
  const championSkillDir = path.join(projectDir, 'champion', 'skill');
  const historyDir = path.join(projectDir, 'history');
  const runsDir = path.join(projectDir, 'runs');

  return {
    projectId,
    rootDir,
    projectsDir,
    projectDir,
    configYaml: path.join(projectDir, 'project.yaml'),
    configJson: path.join(projectDir, 'config.json'),
    stateJson: path.join(projectDir, 'state.json'),
    championSkillDir,
    ontologyCurrent: path.join(projectDir, 'ontology', 'current.json'),
    parameterizationCurrent: path.join(projectDir, 'parameterization', 'current.json'),
    experimentPlanCurrent: path.join(projectDir, 'experiment-plan', 'current.json'),
    promptBankIndex: path.join(projectDir, 'prompt-bank', 'index.json'),
    promptBankPrompts: path.join(projectDir, 'prompt-bank', 'prompts.json'),
    promptBankCriteria: path.join(projectDir, 'prompt-bank', 'criteria.json'),
    historyDir,
    historyIndex: path.join(historyDir, 'index.json'),
    historySummary: path.join(historyDir, 'current-summary.md'),
    historyDetailedDir: path.join(historyDir, 'detailed'),
    runsDir,
  };
}

export function getRunPaths(projectPaths, runId) {
  const runDir = path.join(projectPaths.runsDir, runId);
  return {
    runDir,
    runJson: path.join(runDir, 'run.json'),
    timelineJsonl: path.join(runDir, 'timeline.jsonl'),
    deconstructionDir: path.join(runDir, 'deconstruction'),
    parameterizationJson: path.join(runDir, 'deconstruction', 'parameterization.json'),
    experimentPlanJson: path.join(runDir, 'deconstruction', 'experiment-plan.json'),
    candidatesDir: path.join(runDir, 'candidates'),
    candidateADir: path.join(runDir, 'candidates', 'candidate-a'),
    candidateBDir: path.join(runDir, 'candidates', 'candidate-b'),
    evalDir: path.join(runDir, 'eval'),
    evalConfigJson: path.join(runDir, 'eval', 'config.json'),
    promptBankUpdateJson: path.join(runDir, 'eval', 'prompt-bank-update.json'),
    candidateDuelJson: path.join(runDir, 'eval', 'candidate-duel.json'),
    championGateJson: path.join(runDir, 'eval', 'champion-gate.json'),
    evalRawDir: path.join(runDir, 'eval', 'raw'),
    analysisDir: path.join(runDir, 'analysis'),
    recommendationJson: path.join(runDir, 'analysis', 'recommendation.json'),
    reportMd: path.join(runDir, 'analysis', 'report.md'),
    promotedSkillDir: path.join(runDir, 'promoted-skill'),
  };
}

export function createRunId(runNumber, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `${stamp}-run-${String(runNumber).padStart(3, '0')}`;
}
