export function resolveInitialRoute(search, projects = []) {
  const params = new URLSearchParams(search || '');
  if (params.get('create') === '1') {
    return { view: 'create', projectId: null, draftId: params.get('draft') || null };
  }

  const requestedProject = params.get('project');
  if (!requestedProject) return { view: 'list', projectId: null, draftId: null };

  const match = projects.find(project => project.projectId === requestedProject);
  return match
    ? { view: 'project', projectId: match.projectId, draftId: null }
    : { view: 'list', projectId: null, draftId: null };
}
