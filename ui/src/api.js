export async function fetchProjects() {
  return request('/api/projects');
}

export async function createProject(payload) {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchProjectSummary(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/summary`);
}

export async function fetchRunDetail(projectId, runId = 'latest') {
  return request(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId || 'latest')}`);
}

export async function fetchComparison(projectId, runId = 'latest') {
  return request(`/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId || 'latest')}/compare`);
}

export async function deleteProject(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/delete`, { method: 'POST' });
}

export async function fetchProgress(projectId) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/progress`);
}

export async function fetchSkill(projectId, source = 'champion', runId = null) {
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : '';
  return request(`/api/projects/${encodeURIComponent(projectId)}/skills/${encodeURIComponent(source)}${query}`);
}

export async function recordDecision(projectId, payload) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/decisions`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runStep(projectId, payload = {}) {
  return request(`/api/projects/${encodeURIComponent(projectId)}/step`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Request failed: ${response.status}`);
  }
  return data;
}
