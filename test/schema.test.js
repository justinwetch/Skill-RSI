import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateExperimentPlan,
  validateHistoryIndex,
  validateParameterization,
  validateProjectConfig,
} from '../src/lib/schema.js';
import { createStubExperimentPlan, createStubParameterization } from '../src/lib/stub-agents.js';

test('validates project config', () => {
  const config = validateProjectConfig({
    name: 'ux-design',
    goal: 'Improve UX design skill',
    createdAt: new Date().toISOString(),
  });

  assert.equal(config.name, 'ux-design');
});

test('rejects missing project goal', () => {
  assert.throws(() => validateProjectConfig({
    name: 'ux-design',
    createdAt: new Date().toISOString(),
  }), /goal/);
});

test('validates history index shape', () => {
  const history = validateHistoryIndex({
    experimentId: 'ux-design',
    createdAt: new Date().toISOString(),
    skillGoal: 'Improve UX design skill',
    currentChampion: null,
    trajectory: [],
    parameterLog: [],
  });

  assert.equal(history.experimentId, 'ux-design');
});

test('validates parameterization minimum surfaces', () => {
  const parameterization = validateParameterization(createStubParameterization({
    runId: 'run-1',
    championSkillHash: 'none',
  }));

  assert.equal(parameterization.parameters.length, 12);
});

test('validates experiment plan focus width', () => {
  const parameterization = createStubParameterization({
    runId: 'run-1',
    championSkillHash: 'none',
  });
  const plan = validateExperimentPlan(createStubExperimentPlan({
    runId: 'run-1',
    runNumber: 1,
    parameterization,
  }));

  assert.equal(plan.focusParameterIds.length, 3);
});
