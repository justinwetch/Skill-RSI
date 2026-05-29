const TOOL_NAMES = {
  open: 'skill_rsi_open',
  createProject: 'skill_rsi_create_project',
  runNext: 'skill_rsi_run_next',
  exportChampion: 'skill_rsi_export_champion',
  recordContext: 'skill_rsi_record_context',
};

export function renderCockpitHtml(state) {
  const dataJson = JSON.stringify(state).replaceAll('</script', '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skill RSI Cockpit</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7f8;
      --panel: #ffffff;
      --text: #1d1d21;
      --muted: #777982;
      --line: #d7d8de;
      --ink: #111114;
      --accent: #2e7d46;
      --warn: #b66a17;
      --bad: #b43b3b;
      --radius: 8px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151517;
        --panel: #1f2024;
        --text: #f4f4f5;
        --muted: #a5a6ad;
        --line: #3b3c42;
        --ink: #f4f4f5;
        --accent: #72c58a;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1040px;
      margin: 0 auto;
      padding: 22px;
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; letter-spacing: 0; }
    h2 { font-size: 18px; margin-bottom: 10px; }
    h3 { font-size: 15px; margin-bottom: 6px; }
    .muted { color: var(--muted); }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 16px;
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.06);
    }
    .wide { grid-column: 1 / -1; }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 7px 0;
      border-bottom: 1px solid color-mix(in srgb, var(--line), transparent 50%);
    }
    .row:last-child { border-bottom: 0; }
    .label { color: var(--muted); }
    .value { text-align: right; font-weight: 600; }
    select, input, textarea, button {
      font: inherit;
    }
    select, input, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: color-mix(in srgb, var(--panel), var(--bg) 35%);
      color: var(--text);
      padding: 10px 11px;
    }
    textarea { min-height: 84px; resize: vertical; }
    form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    form .full { grid-column: 1 / -1; }
    button {
      border: 1px solid var(--ink);
      border-radius: var(--radius);
      background: var(--ink);
      color: var(--panel);
      padding: 10px 13px;
      cursor: pointer;
      font-weight: 650;
    }
    button.secondary {
      background: transparent;
      color: var(--text);
      border-color: var(--line);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.48;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 9px;
      margin-top: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 6px 10px;
      font-weight: 650;
      background: color-mix(in srgb, var(--accent), transparent 82%);
      color: color-mix(in srgb, var(--accent), var(--text) 30%);
    }
    .pill.warn {
      background: color-mix(in srgb, var(--warn), transparent 82%);
      color: color-mix(in srgb, var(--warn), var(--text) 20%);
    }
    .pill.bad {
      background: color-mix(in srgb, var(--bad), transparent 82%);
      color: color-mix(in srgb, var(--bad), var(--text) 15%);
    }
    ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }
    code {
      background: color-mix(in srgb, var(--line), transparent 65%);
      border-radius: 4px;
      padding: 1px 4px;
    }
    #messages {
      margin-top: 14px;
      color: var(--muted);
      white-space: pre-wrap;
    }
    .project-list {
      display: grid;
      gap: 8px;
    }
    .project-button {
      width: 100%;
      text-align: left;
      background: transparent;
      color: var(--text);
      border-color: var(--line);
    }
    .project-button[aria-current="true"] {
      border-color: var(--ink);
    }
    @media (max-width: 760px) {
      main { padding: 14px; }
      header, .grid, form { grid-template-columns: 1fr; display: grid; }
      .wide, form .full { grid-column: auto; }
      .value { text-align: left; }
      .row { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Skill RSI</h1>
        <p class="muted">Codex-native cockpit for creating and improving Agent Skills.</p>
      </div>
      <span id="status-pill" class="pill"></span>
    </header>

    <div class="grid">
      <section class="panel" id="projects-panel"></section>
      <section class="panel" id="state-panel"></section>
      <section class="panel wide" id="create-panel"></section>
      <section class="panel" id="next-plan-panel"></section>
      <section class="panel" id="evidence-panel"></section>
      <section class="panel" id="automation-panel"></section>
      <section class="panel" id="export-panel"></section>
    </div>

    <div id="messages" role="status" aria-live="polite"></div>
  </main>
  <script>
    const state = ${dataJson};
    const tools = ${JSON.stringify(TOOL_NAMES)};
    const $ = (id) => document.getElementById(id);

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]);
    }

    function statusLabel(status) {
      const labels = {
        empty: 'No projects',
        missing: 'Project missing',
        running: 'Running',
        max_runs: 'At run ceiling',
        failed: 'Needs attention',
        hooks_waiting: 'Codex context waiting',
        scheduled: 'Scheduled observed',
        manual: 'Manual',
        completed: 'Ready',
      };
      return labels[status] || status || 'Ready';
    }

    function statusClass(status) {
      if (status === 'failed' || status === 'missing') return 'pill bad';
      if (status === 'max_runs' || status === 'hooks_waiting') return 'pill warn';
      return 'pill';
    }

    function postTool(toolName, params) {
      const messageId = 'skill-rsi-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      $('messages').textContent = 'Requesting ' + toolName + '...';
      window.parent.postMessage({
        type: 'tool',
        messageId,
        payload: { toolName, params },
      }, '*');
    }

    window.addEventListener('message', (event) => {
      const payload = event.data?.payload;
      if (event.data?.type === 'ui-message-response' && payload) {
        if (payload.error) $('messages').textContent = 'Tool call failed: ' + JSON.stringify(payload.error);
        else $('messages').textContent = 'Tool call completed. Reopen or refresh the cockpit to see updated state.';
      }
    });

    function renderProjects() {
      const selected = state.selectedProject?.projectId || '';
      const projects = state.projects || [];
      const items = projects.length ? projects.map((project) => \`
        <button class="project-button" aria-current="\${project.projectId === selected}" onclick="postTool(tools.open, { projectName: '\${esc(project.projectId)}' })">
          <strong>\${esc(project.projectId)}</strong><br>
          <span class="muted">\${esc(project.goal || 'No goal')}</span>
        </button>
      \`).join('') : '<p class="muted">No Skill RSI projects yet.</p>';
      $('projects-panel').innerHTML = \`
        <h2>Projects</h2>
        <div class="project-list">\${items}</div>
        <div class="actions">
          <button class="secondary" onclick="postTool(tools.open, {})">Refresh</button>
        </div>
      \`;
    }

    function renderState() {
      const selected = state.selectedProject;
      if (!selected) {
        $('state-panel').innerHTML = '<h2>Current state</h2><p class="muted">Create or import a skill project to start.</p>';
        return;
      }
      const champion = state.champion?.available ? 'Champion available' : 'No champion yet';
      const runCount = selected.state?.runCount ?? 0;
      const target = state.runAction?.targetLoops ?? selected.state?.runPolicy?.targetIterations ?? 1;
      $('state-panel').innerHTML = \`
        <h2>Current state</h2>
        <div class="row"><span class="label">Project</span><span class="value">\${esc(selected.projectId)}</span></div>
        <div class="row"><span class="label">Champion</span><span class="value">\${esc(champion)}</span></div>
        <div class="row"><span class="label">Runs</span><span class="value">\${esc(runCount)}</span></div>
        <div class="row"><span class="label">Output</span><span class="value">\${esc(selected.config?.eval?.outputType || 'text')}</span></div>
        <div class="actions">
          <button onclick="postTool(tools.runNext, { projectName: '\${esc(selected.projectId)}', loops: \${Number(target) || 1}, mode: 'agentic', evalMode: 'real' })">\${esc(state.runAction?.label || 'Run target batch')}</button>
        </div>
        <p class="muted">This can start model-backed work and may spend API budget.</p>
      \`;
    }

    function renderCreate() {
      $('create-panel').innerHTML = \`
        <h2>Create or import</h2>
        <form onsubmit="event.preventDefault(); createProject();">
          <label>Skill name<input name="projectName" required placeholder="frontend-design"></label>
          <label>Model
            <select name="model">
              \${state.supportedModels.map((model) => \`<option value="\${esc(model)}">\${esc(model)}</option>\`).join('')}
            </select>
          </label>
          <label class="full">Goal<textarea name="goal" required placeholder="Help agents design production-ready frontend interfaces."></textarea></label>
          <label>Output
            <select name="outputType">
              \${state.supportedOutputTypes.map((type) => \`<option value="\${esc(type)}">\${esc(type)}</option>\`).join('')}
            </select>
          </label>
          <label>Target loops<input name="targetIterations" type="number" min="1" value="3"></label>
          <label class="full">Baseline path<input name="baselinePath" placeholder="/absolute/path/to/SKILL.md or skill folder"></label>
          <div class="full actions"><button type="submit">Create project</button></div>
        </form>
      \`;
    }

    function createProject() {
      const form = $('create-panel').querySelector('form');
      const data = Object.fromEntries(new FormData(form).entries());
      postTool(tools.createProject, {
        projectName: data.projectName,
        goal: data.goal,
        outputType: data.outputType,
        model: data.model,
        targetIterations: Number(data.targetIterations || 3),
        baselinePath: data.baselinePath || undefined,
      });
    }

    function renderNextPlan() {
      const notes = state.nextLoopPremise?.notes || [];
      $('next-plan-panel').innerHTML = \`
        <h2>Next loop plan</h2>
        \${notes.length ? '<ul>' + notes.map((note) => \`<li>\${esc(note)}</li>\`).join('') + '</ul>' : '<p class="muted">No next-loop premise yet.</p>'}
        \${state.nextLoopPremise?.sourceRunId ? \`<p class="muted">From \${esc(state.nextLoopPremise.sourceRunId)}</p>\` : ''}
      \`;
    }

    function renderEvidence() {
      const progress = state.progress || {};
      const trajectory = state.latestEvidence?.latestTrajectory || null;
      $('evidence-panel').innerHTML = \`
        <h2>Latest evidence</h2>
        <div class="row"><span class="label">Run</span><span class="value">\${esc(progress.runId || 'none')}</span></div>
        <div class="row"><span class="label">Status</span><span class="value">\${esc(progress.status || 'none')}</span></div>
        <div class="row"><span class="label">Competition</span><span class="value">\${esc(progress.competitionMode || 'n/a')}</span></div>
        <div class="row"><span class="label">Last decision</span><span class="value">\${esc(trajectory?.decision || 'n/a')}</span></div>
        <p class="muted">Detailed prompt evidence and screenshot inspection stay in the local app until the Phase 4 evidence panels.</p>
      \`;
    }

    function renderAutomation() {
      const automation = state.automation || {};
      const inbox = automation.hooks?.inbox || {};
      const files = inbox.latest?.changedFiles || [];
      $('automation-panel').innerHTML = \`
        <h2>Automation and context</h2>
        <div class="row"><span class="label">State</span><span class="value">\${esc(statusLabel(automation.status || state.status))}</span></div>
        <div class="row"><span class="label">Queued context</span><span class="value">\${esc(inbox.count || 0)}</span></div>
        \${files.length ? '<p class="muted">Latest files: ' + files.map(esc).join(', ') + '</p>' : '<p class="muted">No queued Codex context.</p>'}
        <div class="actions">
          <button class="secondary" \${state.selectedProject ? '' : 'disabled'} onclick="recordContext()">Record visible context</button>
        </div>
      \`;
    }

    function recordContext() {
      if (!state.selectedProject) return;
      postTool(tools.recordContext, {
        projectName: state.selectedProject.projectId,
        eventName: 'McpUiContext',
        reason: 'Context recorded from the Skill RSI cockpit.',
        changedFiles: [],
      });
    }

    function renderExport() {
      const projectId = state.selectedProject?.projectId;
      $('export-panel').innerHTML = \`
        <h2>Champion export</h2>
        <p class="muted">Export the current champion package to a local directory.</p>
        <label>Output directory<input id="export-dir" placeholder="/absolute/path/to/exported-skill"></label>
        <div class="actions">
          <button \${projectId && state.champion?.available ? '' : 'disabled'} onclick="postTool(tools.exportChampion, { projectName: '\${esc(projectId || '')}', outDir: document.getElementById('export-dir').value })">Export champion</button>
        </div>
      \`;
    }

    function render() {
      const status = state.status || 'manual';
      $('status-pill').className = statusClass(status);
      $('status-pill').textContent = statusLabel(status);
      renderProjects();
      renderState();
      renderCreate();
      renderNextPlan();
      renderEvidence();
      renderAutomation();
      renderExport();
      $('messages').textContent = state.capabilities?.uiActions ? '' : 'If this host does not support MCP-UI actions, ask Codex to call the matching Skill RSI MCP tool instead.';
    }

    render();
  </script>
</body>
</html>`;
}

export const COCKPIT_TOOL_NAMES = TOOL_NAMES;
