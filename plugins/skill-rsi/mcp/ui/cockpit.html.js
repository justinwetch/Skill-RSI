const TOOL_NAMES = {
  open: 'skill_rsi_cockpit',
  createProject: 'skill_rsi_create_project',
  runNext: 'skill_rsi_run_next',
  runWithContext: 'skill_rsi_run_with_context',
  exportChampion: 'skill_rsi_export_champion',
  recordContext: 'skill_rsi_record_context',
  getEvidence: 'skill_rsi_get_evidence',
  getSkillContent: 'skill_rsi_get_skill_content',
};

export function renderCockpitHtml(state) {
  const dataJson = JSON.stringify(state).replaceAll('</script', '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skill RSI Console</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f7f8;
      --panel: #fff;
      --panel-2: #f1f2f5;
      --text: #1d1d21;
      --muted: #777982;
      --line: #d7d8de;
      --ink: #111114;
      --a: #2d76ad;
      --b: #b46d21;
      --accent: #2e7d46;
      --warn: #b66a17;
      --bad: #b43b3b;
      --radius: 8px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #151517;
        --panel: #1f2024;
        --panel-2: #282a30;
        --text: #f4f4f5;
        --muted: #a5a6ad;
        --line: #3b3c42;
        --ink: #f4f4f5;
        --a: #8fc6f1;
        --b: #e7a85f;
        --accent: #72c58a;
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 22px; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 16px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 28px; letter-spacing: 0; }
    h2 { font-size: 18px; margin-bottom: 10px; }
    h3 { font-size: 15px; margin-bottom: 8px; }
    .muted { color: var(--muted); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); min-width: 0; }
    .wide { grid-column: 1 / -1; }
    .nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 14px; }
    .nav button { background: transparent; color: var(--text); border-color: var(--line); }
    .nav button.active { background: var(--ink); color: var(--panel); border-color: var(--ink); }
    .row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--line), transparent 50%); }
    .row:last-child { border-bottom: 0; }
    .label { color: var(--muted); }
    .value { text-align: right; font-weight: 650; }
    select, input, textarea, button { font: inherit; }
    select, input, textarea { width: 100%; border: 1px solid var(--line); border-radius: var(--radius); background: color-mix(in srgb, var(--panel), var(--bg) 35%); color: var(--text); padding: 10px 11px; }
    textarea { min-height: 84px; resize: vertical; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    form .full { grid-column: 1 / -1; }
    button { border: 1px solid var(--ink); border-radius: var(--radius); background: var(--ink); color: var(--panel); padding: 9px 12px; cursor: pointer; font-weight: 650; }
    button.secondary { background: transparent; color: var(--text); border-color: var(--line); }
    button.linkish { background: transparent; color: var(--text); border: 0; padding: 5px 0; text-align: left; }
    button:disabled { cursor: not-allowed; opacity: 0.48; }
    .actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 12px; }
    .pill { display: inline-flex; align-items: center; border-radius: 999px; padding: 6px 10px; font-weight: 650; background: color-mix(in srgb, var(--accent), transparent 82%); color: color-mix(in srgb, var(--accent), var(--text) 30%); }
    .pill.warn { background: color-mix(in srgb, var(--warn), transparent 82%); color: color-mix(in srgb, var(--warn), var(--text) 20%); }
    .pill.bad { background: color-mix(in srgb, var(--bad), transparent 82%); color: color-mix(in srgb, var(--bad), var(--text) 15%); }
    .pill.a { background: color-mix(in srgb, var(--a), transparent 82%); color: var(--a); }
    .pill.b { background: color-mix(in srgb, var(--b), transparent 82%); color: var(--b); }
    ul { margin: 8px 0 0; padding-left: 20px; }
    code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    code { background: color-mix(in srgb, var(--line), transparent 65%); border-radius: 4px; padding: 1px 4px; }
    pre { white-space: pre-wrap; word-break: break-word; background: color-mix(in srgb, var(--panel-2), transparent 10%); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; max-height: 520px; overflow: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px 8px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-weight: 650; }
    .right { text-align: right; }
    .center { text-align: center; }
    .project-list, .stack, .history-list, .prompt-list { display: grid; gap: 8px; }
    .project-button, .history-button, .prompt-button { width: 100%; text-align: left; background: transparent; color: var(--text); border-color: var(--line); }
    .project-button[aria-current="true"] { border-color: var(--ink); }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .tabs button { background: transparent; color: var(--text); border-color: var(--line); }
    .tabs button.active { background: var(--ink); color: var(--panel); border-color: var(--ink); }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .shot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
    figure { margin: 0; }
    figcaption { color: var(--muted); margin-top: 5px; font-size: 12px; }
    .shot-button { padding: 0; border-color: var(--line); background: transparent; width: 100%; display: block; overflow: hidden; }
    .shot-button img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; object-position: top center; display: block; }
    .diff-add { color: var(--b); }
    .diff-remove { color: var(--a); }
    .diff-same { color: var(--muted); }
    .lightbox { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; padding: 24px; background: rgb(0 0 0 / 0.72); }
    .lightbox.open { display: flex; }
    .lightbox-panel { max-width: min(1100px, 96vw); max-height: 92vh; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
    .lightbox-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .lightbox img { display: block; max-width: 100%; max-height: 78vh; object-fit: contain; }
    #messages { margin-top: 14px; color: var(--muted); white-space: pre-wrap; }
    @media (max-width: 760px) {
      main { padding: 14px; }
      header, .grid, form, .split { grid-template-columns: 1fr; display: grid; }
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
        <p class="muted">Native Codex console for recursive Agent Skill improvement.</p>
      </div>
      <span id="status-pill" class="pill"></span>
    </header>
    <nav class="nav" id="nav"></nav>
    <div id="content"></div>
    <div id="messages" role="status" aria-live="polite"></div>
  </main>
  <div id="lightbox" class="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot viewer">
    <div class="lightbox-panel">
      <div class="lightbox-head">
        <div><strong id="lightbox-title"></strong><div id="lightbox-meta" class="muted"></div></div>
        <button class="secondary" onclick="closeLightbox()">Close</button>
      </div>
      <img id="lightbox-img" alt="">
    </div>
  </div>
  <script>
    let state = ${dataJson};
    const tools = ${JSON.stringify(TOOL_NAMES)};
    const $ = (id) => document.getElementById(id);
    let evidenceTab = 'summary';
    let openPrompt = null;
    let skillFilePath = state.selectedFilePath || null;

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    }
    function statusLabel(status) {
      return ({ empty: 'No projects', missing: 'Project missing', running: 'Running', max_runs: 'At run ceiling', failed: 'Needs attention', hooks_waiting: 'Codex context waiting', scheduled: 'Scheduled observed', manual: 'Manual', completed: 'Ready' })[status] || status || 'Ready';
    }
    function statusClass(status) {
      if (status === 'failed' || status === 'missing') return 'pill bad';
      if (status === 'max_runs' || status === 'hooks_waiting') return 'pill warn';
      return 'pill';
    }
    function postTool(toolName, params) {
      $('messages').textContent = 'Requesting ' + toolName + '...';
      window.parent.postMessage({ type: 'tool', messageId: 'skill-rsi-' + Date.now(), payload: { toolName, params } }, '*');
    }
    function navParams(view, extra = {}) {
      const projectName = state.selectedProject?.projectId || state.requestedProjectId || undefined;
      return Object.assign({ projectName, view, existingProjectIntent: true }, extra);
    }
    function openView(view, extra = {}) { postTool(tools.open, navParams(view, extra)); }
    function stateFromToolOutput(toolOutput) {
      if (!toolOutput) return null;
      if (toolOutput.structuredContent?.schemaVersion === 1) return toolOutput.structuredContent;
      if (toolOutput.schemaVersion === 1) return toolOutput;
      return null;
    }
    function applyState(nextState) {
      if (!nextState) return;
      state = nextState;
      evidenceTab = 'summary';
      openPrompt = null;
      skillFilePath = state.selectedFilePath || null;
      shell();
    }
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'ui-lifecycle-iframe-render-data') {
        const nextState = stateFromToolOutput(event.data?.payload?.renderData?.toolOutput);
        if (nextState) applyState(nextState);
        return;
      }
      const payload = event.data?.payload;
      if (event.data?.type === 'ui-message-response' && payload) {
        $('messages').textContent = payload.error ? 'Tool call failed: ' + JSON.stringify(payload.error) : 'Tool call completed. Reopen or refresh the console to see updated state.';
      }
    });
    window.parent.postMessage({ type: 'ui-lifecycle-iframe-ready' }, '*');
    window.parent.postMessage({ type: 'ui-request-render-data', messageId: 'skill-rsi-render-' + Date.now() }, '*');
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeLightbox(); });

    function renderNav() {
      const views = [['overview', 'Overview'], ['history', 'History'], ['evidence', 'Detailed Data'], ['skill', 'Skill'], ['automation', 'Automation']];
      $('nav').innerHTML = views.map(([view, label]) =>
        '<button class="' + (state.view === view ? 'active' : '') + '" ' + (!state.selectedProject && view !== 'overview' ? 'disabled ' : '') + 'onclick="openView(\\'' + view + '\\')">' + esc(label) + '</button>'
      ).join('');
    }
    function shell() {
      const status = state.status || 'manual';
      $('status-pill').className = statusClass(status);
      $('status-pill').textContent = statusLabel(status);
      renderNav();
      if (!state.selectedProject) return renderEmpty();
      if (state.view === 'history') return renderHistory();
      if (state.view === 'evidence') return renderEvidence();
      if (state.view === 'skill') return renderSkill();
      if (state.view === 'automation') return renderAutomationOnly();
      return renderOverview();
    }
    function renderEmpty() {
      $('content').innerHTML = '<div class="grid"><section class="panel">' +
        '<h2>' + (state.selectedProjectMissing ? 'Project missing' : 'Projects') + '</h2>' +
        '<p class="muted">' + (state.selectedProjectMissing ? 'Requested project not found: ' + esc(state.requestedProjectId) : 'No Skill RSI projects yet.') + '</p>' +
        renderProjectList() + '</section><section class="panel">' + createFormHtml() + '</section></div>';
    }
    function renderProjectList() {
      const projects = state.projects || [];
      if (!projects.length) return '';
      return '<div class="project-list">' + projects.map(project =>
        '<button class="project-button" onclick="postTool(tools.open, { projectName: \\'' + esc(project.projectId) + '\\', existingProjectIntent: true })"><strong>' + esc(project.projectId) + '</strong><br><span class="muted">' + esc(project.goal || 'No goal') + '</span></button>'
      ).join('') + '</div>';
    }
    function createFormHtml() {
      const models = state.supportedModels || ['gpt-5.4-mini', 'gpt-5.5'];
      const outputs = state.supportedOutputTypes || ['text', 'code', 'code_visual'];
      return '<h2>Create or import</h2><form onsubmit="event.preventDefault(); createProject();">' +
        '<label>Skill name<input name="projectName" required placeholder="frontend-design"></label>' +
        '<label>Model<select name="model">' + models.map(model => '<option value="' + esc(model) + '">' + esc(model) + '</option>').join('') + '</select></label>' +
        '<label class="full">Goal<textarea name="goal" required placeholder="Help agents design production-ready frontend interfaces."></textarea></label>' +
        '<label>Output<select name="outputType">' + outputs.map(type => '<option value="' + esc(type) + '">' + esc(type) + '</option>').join('') + '</select></label>' +
        '<label>Target loops<input name="targetIterations" type="number" min="1" value="3"></label>' +
        '<label class="full">Baseline path<input name="baselinePath" placeholder="/absolute/path/to/SKILL.md or skill folder"></label>' +
        '<div class="full actions"><button type="submit">Create project</button></div></form>';
    }
    function createProject() {
      const form = document.querySelector('form');
      const data = Object.fromEntries(new FormData(form).entries());
      postTool(tools.createProject, { projectName: data.projectName, goal: data.goal, outputType: data.outputType, model: data.model, targetIterations: Number(data.targetIterations || 3), baselinePath: data.baselinePath || undefined });
    }
    function renderOverview() {
      const selected = state.selectedProject;
      $('content').innerHTML = '<div class="grid">' +
        '<section class="panel">' + projectPickerHtml() + '</section>' +
        '<section class="panel">' + stateHtml() + '</section>' +
        '<section class="panel wide">' + nextPlanHtml() + '</section>' +
        '<section class="panel">' + latestEvidenceHtml() + '</section>' +
        '<section class="panel">' + championHtml() + '</section>' +
        '<section class="panel">' + promptBankHtml() + '</section>' +
        '<section class="panel">' + timelineHtml() + '</section>' +
        '<section class="panel wide">' + createFormHtml() + '</section>' +
      '</div>';
    }
    function projectPickerHtml() {
      const selected = state.selectedProject?.projectId || '';
      const projects = state.projects || [];
      return '<h2>Projects</h2><div class="project-list">' + projects.map(project =>
        '<button class="project-button" aria-current="' + (project.projectId === selected) + '" onclick="postTool(tools.open, { projectName: \\'' + esc(project.projectId) + '\\', existingProjectIntent: true })"><strong>' + esc(project.projectId) + '</strong><br><span class="muted">' + esc(project.goal || 'No goal') + '</span></button>'
      ).join('') + '</div><div class="actions"><button class="secondary" onclick="postTool(tools.open, { projectName: \\'' + esc(selected) + '\\', existingProjectIntent: true })">Refresh</button></div>';
    }
    function stateHtml() {
      const selected = state.selectedProject;
      const target = state.runAction?.targetLoops || selected.state?.runPolicy?.targetIterations || 1;
      return '<h2>Current state</h2>' +
        row('Project', selected.projectId) + row('Champion', state.champion?.available ? 'Champion available' : 'No champion yet') +
        row('Runs', selected.state?.runCount || 0) + row('Output', selected.config?.eval?.outputType || 'text') +
        '<div class="actions"><button onclick="postTool(tools.runNext, { projectName: \\'' + esc(selected.projectId) + '\\', loops: ' + Number(target) + ', mode: \\'agentic\\', evalMode: \\'real\\', runIntent: true })">' + esc(state.runAction?.label || 'Run target batch') + '</button></div>' +
        '<p class="muted">This can start model-backed work and may spend API budget.</p>';
    }
    function nextPlanHtml() {
      const premise = state.nextLoopPremise || {};
      const notes = premise.notes || [];
      return '<h2>Next Loop Plan</h2>' + (notes.length ? '<ul>' + notes.map(note => '<li>' + esc(note) + '</li>').join('') + '</ul>' : '<p class="muted">No next-loop premise yet.</p>') +
        (premise.sourceRunId ? '<p class="muted">From ' + esc(shortRun(premise.sourceRunId)) + '</p>' : '');
    }
    function latestEvidenceHtml() {
      const ev = state.evidence;
      if (!ev?.available) return '<h2>Latest evidence</h2><p class="muted">No evaluation evidence recorded yet.</p>';
      return '<h2>Latest evidence</h2>' + row('Run', ev.runId) + row('Mode', ev.competitionMode) +
        row('Winner', winnerLabel(ev.stats?.winner, ev.labels)) + row('Score delta', ev.stats?.scoreDelta ?? 'n/a') +
        '<div class="actions"><button onclick="openView(\\'evidence\\', { runId: \\'' + esc(ev.runId) + '\\' })">Detailed Data</button></div>';
    }
    function championHtml() {
      const champ = state.selectedProject?.state?.currentChampion;
      if (!champ) return '<h2>Current champion</h2><p class="muted">No champion yet.</p>';
      return '<h2>Current champion</h2>' + row('Promoted in', shortRun(champ.runId)) + row('Fingerprint', String(champ.skillHash || '').slice(0, 12)) +
        row('Files', state.champion?.fileCount || 0) + '<div class="actions"><button onclick="openView(\\'skill\\', { skillSource: \\'champion\\' })">View skill</button></div>';
    }
    function promptBankHtml() {
      const pb = state.latestEvidence?.promptBank || state.selectedProject?.promptBank;
      if (!pb) return '<h2>Prompt bank</h2><p class="muted">No prompt bank yet.</p>';
      return '<h2>Prompt bank</h2>' + row('Stable prompts', pb.stablePromptCount || 0) + row('Provisional', pb.provisionalPromptCount || 0) + row('Exploration', pb.explorationPromptCount || 0) + row('Evidence records', pb.evidenceRecordCount || 0);
    }
    function timelineHtml() {
      const timeline = state.runDetail?.timeline || [];
      if (!timeline.length) return '<h2>Run timeline</h2><p class="muted">No timeline recorded.</p>';
      return '<h2>Run timeline</h2><div class="stack">' + timeline.slice(-8).map(entry => '<div>' + esc(formatEvent(entry.event)) + '<br><span class="muted">' + esc(formatTime(entry.timestamp)) + '</span></div>').join('') + '</div>';
    }
    function renderHistory() {
      const summary = state.selectedProject;
      const rows = summary.history?.recentTrajectory || [];
      $('content').innerHTML = '<section class="panel wide"><h2>History</h2>' + (rows.length ? '<div class="history-list">' + rows.slice().reverse().map((item, index) =>
        '<button class="history-button" onclick="openView(\\'evidence\\', { runId: \\'' + esc(item.runId) + '\\' })"><strong>Iteration ' + esc(rows.length - index) + ' · ' + esc(decisionLabel(item.decision)) + '</strong>' + (summary.state?.currentChampion?.runId === item.runId ? ' <span class="pill">current champion</span>' : '') + '<br><span class="muted">' + esc(item.summary || ('Tested ' + ((item.parameterTested || []).join(', ') || 'no change'))) + '</span></button>'
      ).join('') + '</div>' : '<p class="muted">No history yet.</p>') + '</section>';
    }
    function renderEvidence() {
      const ev = state.evidence;
      if (!ev?.available) {
        $('content').innerHTML = '<section class="panel wide"><h2>Detailed Data</h2><p class="muted">No evaluation was recorded for this run.</p></section>';
        return;
      }
      $('content').innerHTML = '<section class="panel wide"><h2>Detailed Data</h2><p class="muted">' + esc(ev.experimentQuestion || 'Run evidence') + '</p>' +
        '<div class="tabs">' + ['summary', 'criteria', 'prompts'].map(tab => '<button class="' + (evidenceTab === tab ? 'active' : '') + '" onclick="evidenceTab=\\'' + tab + '\\'; renderEvidence();">' + esc(tab === 'criteria' ? 'Detailed breakdown' : tab[0].toUpperCase() + tab.slice(1)) + '</button>').join('') + '</div>' +
        '<div id="evidence-tab">' + evidenceTabHtml(ev) + '</div></section>';
    }
    function evidenceTabHtml(ev) {
      if (evidenceTab === 'criteria') return criteriaHtml(ev);
      if (evidenceTab === 'prompts') return promptsHtml(ev);
      const stats = ev.stats || {};
      return '<div class="grid">' +
        '<div class="panel">' + row(ev.labels.a + ' wins', stats.skillAWins || 0) + row(ev.labels.b + ' wins', stats.skillBWins || 0) + row('Ties', stats.ties || 0) + '</div>' +
        '<div class="panel">' + row('Winner', winnerLabel(stats.winner, ev.labels)) + row('Score delta', stats.scoreDelta ?? 'n/a') + row('Confidence', ev.recommendation?.confidence || 'n/a') + '</div>' +
        '</div><p style="margin-top:12px">' + esc(ev.recommendation?.reasoning || 'No analyst reasoning recorded.') + '</p>';
    }
    function criteriaHtml(ev) {
      const rows = (ev.criteria || []).map(c => {
        let sa = 0, sb = 0, n = 0;
        for (const e of ev.evaluations || []) {
          const a = e.judge?.breakdown?.skillA?.[c.id];
          const b = e.judge?.breakdown?.skillB?.[c.id];
          if (a == null || b == null) continue;
          sa += a; sb += b; n += 1;
        }
        const avgA = n ? sa / n : 0, avgB = n ? sb / n : 0;
        return '<tr><td>' + esc(c.name || c.id) + '</td><td class="right">' + avgA.toFixed(1) + '</td><td class="right">' + avgB.toFixed(1) + '</td><td>' + esc(avgA === avgB ? 'Tie' : avgA > avgB ? ev.labels.a : ev.labels.b) + '</td></tr>';
      }).join('');
      return '<table><thead><tr><th>Criterion</th><th class="right">' + esc(ev.labels.a) + '</th><th class="right">' + esc(ev.labels.b) + '</th><th>Leader</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
    function promptsHtml(ev) {
      return '<div class="prompt-list">' + (ev.evaluations || []).map(e => {
        const isOpen = openPrompt === e.id;
        const w = winnerLabel(e.judge?.winner, ev.labels);
        return '<div class="panel"><button class="prompt-button" onclick="togglePrompt(\\'' + esc(e.id) + '\\')"><strong>' + esc(promptGist(e.prompt?.text)) + '</strong><br><span class="muted">' + esc(ev.labels.a) + ' ' + esc(e.judge?.scoreA ?? 'n/a') + ' · ' + esc(ev.labels.b) + ' ' + esc(e.judge?.scoreB ?? 'n/a') + ' · ' + esc(w) + '</span></button>' +
          (isOpen ? promptDetailHtml(e, ev) : '') + '</div>';
      }).join('') + '</div>';
    }
    function togglePrompt(id) { openPrompt = openPrompt === id ? null : id; renderEvidence(); }
    function promptDetailHtml(e, ev) {
      return '<div class="stack" style="margin-top:12px"><pre>' + esc(e.prompt?.text || 'Prompt text was not recorded.') + '</pre><p>' + esc(e.judge?.reasoning || 'No judge rationale recorded.') + '</p>' + promptCriterionScores(e, ev) + visualHtml(e, ev) + outputsHtml(e, ev) + '</div>';
    }
    function promptCriterionScores(e, ev) {
      const rows = (ev.criteria || []).map(c => {
        const a = e.judge?.breakdown?.skillA?.[c.id], b = e.judge?.breakdown?.skillB?.[c.id];
        return '<tr><td>' + esc(c.name || c.id) + '</td><td>' + esc(a ?? '–') + '</td><td>' + esc(b ?? '–') + '</td><td>' + esc(a === b ? 'Tie' : a > b ? ev.labels.a + ' +' + (a - b) : ev.labels.b + ' +' + (b - a)) + '</td></tr>';
      }).join('');
      return rows ? '<table><thead><tr><th>Criterion</th><th>' + esc(ev.labels.a) + '</th><th>' + esc(ev.labels.b) + '</th><th>Edge</th></tr></thead><tbody>' + rows + '</tbody></table>' : '';
    }
    function visualHtml(e, ev) {
      const visuals = visualOutputs(e);
      if (!visuals) return '';
      return '<div class="split">' + visualSideHtml(ev.labels.a, visuals.a) + visualSideHtml(ev.labels.b, visuals.b) + '</div>';
    }
    function visualSideHtml(label, visual) {
      if (!visual) return '<div class="panel"><h3>' + esc(label) + ' render</h3><p class="muted">No render data.</p></div>';
      const shots = visual.screenshots || [];
      return '<div class="panel"><h3>' + esc(label) + ' render <span class="pill ' + (visual.status === 'failed' || visual.blankScreenDetected ? 'warn' : '') + '">' + esc(visual.status || 'rendered') + '</span></h3>' +
        (visual.error?.message ? '<p class="muted">' + esc(visual.error.message) + '</p>' : '') +
        '<div class="shot-grid">' + shots.map((shot, i) => screenshotHtml(label, shot, i)).join('') + '</div></div>';
    }
    function screenshotHtml(label, shot, i) {
      const embedded = shot.embeddedImage || {};
      const meta = (shot.viewport || 'viewport') + ' · ' + (shot.width || '?') + '×' + (shot.height || '?') + (shot.blank ? ' · blank flagged' : '');
      if (!embedded.available) return '<figure><div class="panel"><strong>' + esc(label) + '</strong><p class="muted">' + esc(meta) + '</p><p class="muted">Image unavailable: ' + esc(embedded.reason || 'not embedded') + '</p></div></figure>';
      const id = 'shot-' + Math.random().toString(16).slice(2);
      window.__shots ||= {};
      window.__shots[id] = { label, meta, dataUrl: embedded.dataUrl };
      return '<figure><button class="shot-button" onclick="openLightbox(\\'' + id + '\\')"><img src="' + esc(embedded.dataUrl) + '" alt="' + esc(label + ' ' + meta) + '"></button><figcaption>' + esc(meta) + '</figcaption></figure>';
    }
    function outputsHtml(e, ev) {
      const out = outputs(e);
      if (!out.a && !out.b) return '';
      return '<div class="split"><div><h3>' + esc(ev.labels.a) + ' output</h3><pre>' + esc(out.a || '—') + '</pre></div><div><h3>' + esc(ev.labels.b) + ' output</h3><pre>' + esc(out.b || '—') + '</pre></div></div>';
    }
    function renderSkill() {
      const mode = state.comparison?.competitionMode || state.evidence?.competitionMode || 'cold_start_duel';
      const sources = mode === 'cold_start_duel' ? [['champion', 'Champion'], ['candidate-a', 'Candidate A'], ['candidate-b', 'Candidate B'], ['compare', 'Compare']] : [['champion', 'Champion'], ['challenger', 'Challenger'], ['compare', 'Compare']];
      const active = state.selectedSkillSource || 'champion';
      $('content').innerHTML = '<section class="panel wide"><h2>Skill</h2><div class="tabs">' + sources.map(([source, label]) =>
        '<button class="' + (active === source || (!sources.some(s => s[0] === active) && source === 'champion') ? 'active' : '') + '" onclick="' + (source === 'compare' ? 'renderSkillCompare()' : 'openView(\\'skill\\', { skillSource: \\'' + source + '\\' })') + '">' + esc(label) + '</button>'
      ).join('') + '</div><div id="skill-body">' + skillBodyHtml(state.skill) + '</div></section>';
    }
    function skillBodyHtml(skill) {
      if (!skill) return '<p class="muted">Choose a skill source.</p>';
      if (skill.error) return '<p class="muted">Could not load skill: ' + esc(skill.error.message) + '</p>';
      if (!skill.available) return '<p class="muted">This skill package is not available for this run.</p>';
      const files = skill.files || [];
      const selected = files.find(file => file.path === skillFilePath) || files.find(file => file.path === 'SKILL.md') || files[0];
      return '<div class="tabs">' + files.map(file => '<button class="' + (file.path === selected?.path ? 'active' : '') + '" onclick="skillFilePath=\\'' + esc(file.path) + '\\'; document.getElementById(\\'skill-body\\').innerHTML=skillBodyHtml(state.skill);">' + esc(file.path) + '</button>').join('') + '</div><pre>' + esc(selected?.text || 'No readable content.') + '</pre>';
    }
    function renderSkillCompare() {
      const cmp = state.skillCompare;
      if (!cmp || cmp.error) { $('skill-body').innerHTML = '<p class="muted">Comparison is not available.</p>'; return; }
      if (!cmp.a?.available || !cmp.b?.available) {
        $('skill-body').innerHTML = '<p class="muted">Both skill packages are needed to compare; one is not available for this run.</p>';
        return;
      }
      const aText = skillMainText(cmp.a);
      const bText = skillMainText(cmp.b);
      const diff = lineDiff(aText, bText);
      const adds = diff.filter(line => line.type === 'add').length;
      const removes = diff.filter(line => line.type === 'remove').length;
      $('skill-body').innerHTML =
        '<div class="split"><div class="panel"><h3>' + esc(cmp.aLabel) + '</h3><p class="muted">' + esc(cmp.aSource) + '</p></div><div class="panel"><h3>' + esc(cmp.bLabel) + '</h3><p class="muted">' + esc(cmp.bSource) + '</p></div></div>' +
        '<p class="muted" style="margin:12px 0">SKILL.md diff — ' + esc(adds) + ' line(s) only in ' + esc(cmp.bLabel) + ', ' + esc(removes) + ' only in ' + esc(cmp.aLabel) + '.</p>' +
        '<pre>' + diff.map(line => '<span class="diff-' + line.type + '">' + esc(line.type === 'add' ? '+ ' : line.type === 'remove' ? '- ' : '  ') + esc(line.text || '') + '</span>').join('\\n') + '</pre>';
    }
    function skillMainText(skill) {
      const files = skill.files || [];
      return (files.find(file => file.path === 'SKILL.md') || files[0])?.text || '';
    }
    function lineDiff(aText, bText) {
      const A = String(aText || '').split('\\n');
      const B = String(bText || '').split('\\n');
      const m = A.length, n = B.length;
      const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
      for (let i = m - 1; i >= 0; i -= 1) {
        for (let j = n - 1; j >= 0; j -= 1) {
          dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      const out = [];
      let i = 0, j = 0;
      while (i < m && j < n) {
        if (A[i] === B[j]) { out.push({ type: 'same', text: A[i] }); i += 1; j += 1; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'remove', text: A[i] }); i += 1; }
        else { out.push({ type: 'add', text: B[j] }); j += 1; }
      }
      while (i < m) { out.push({ type: 'remove', text: A[i] }); i += 1; }
      while (j < n) { out.push({ type: 'add', text: B[j] }); j += 1; }
      return out;
    }
    function renderAutomationOnly() {
      $('content').innerHTML = '<div class="grid"><section class="panel">' + automationHtml() + '</section><section class="panel">' + exportHtml() + '</section></div>';
    }
    function automationHtml() {
      const automation = state.automation || {};
      const inbox = automation.hooks?.inbox || {};
      const files = inbox.latest?.changedFiles || [];
      return '<h2>Automation and context</h2>' + row('State', statusLabel(automation.status || state.status)) + row('Queued context', inbox.count || 0) +
        hookContextDetailHtml(inbox) +
        '<div class="actions">' +
        '<button ' + (state.contextRunAction?.enabled ? '' : 'disabled') + ' onclick="postTool(tools.runWithContext, { projectName: \\'' + esc(state.selectedProject?.projectId || '') + '\\', loops: 1, mode: \\'agentic\\', evalMode: \\'real\\', runIntent: true })">' + esc(state.contextRunAction?.label || 'Run one loop with queued Codex context') + '</button>' +
        '<button class="secondary" onclick="recordContext()">Record visible context</button>' +
        '</div>' +
        (state.contextRunAction?.disabledReason ? '<p class="muted">' + esc(state.contextRunAction.disabledReason) + '</p>' : '<p class="muted">This starts one model-backed loop and consumes the queued context as the next run premise.</p>') +
        '<h3>Schedule command</h3><pre>' + esc(automation.commands?.cron || '') + '</pre><h3>Codex hook command</h3><pre>' + esc(automation.commands?.codexHook || '') + '</pre>';
    }
    function hookContextDetailHtml(inbox) {
      const latest = inbox.latest || null;
      if (!latest) return '<p class="muted">No queued Codex context.</p>';
      const files = latest.changedFiles || [];
      return '<div class="panel" style="margin:10px 0; background: var(--panel-2)">' +
        '<h3>Waiting Codex context</h3>' +
        row('Latest event', latest.eventName || 'Codex event') +
        row('Received', formatTime(latest.receivedAt)) +
        (latest.reason ? row('Reason', latest.reason) : '') +
        (latest.focusParameterIds?.length ? row('Focus', latest.focusParameterIds.join(', ')) : '') +
        (latest.parameterIds?.length ? row('Parameters', latest.parameterIds.join(', ')) : '') +
        (files.length ? '<p class="muted">Changed files: ' + files.map(file => '<code>' + esc(file) + '</code>').join(' ') + (latest.changedFileCount > files.length ? ' +' + esc(latest.changedFileCount - files.length) + ' more' : '') + '</p>' : '<p class="muted">No changed files reported.</p>') +
      '</div>';
    }
    function exportHtml() {
      const projectId = state.selectedProject?.projectId || '';
      return '<h2>Champion export</h2><p class="muted">Export the current champion package to a local directory.</p><label>Output directory<input id="export-dir" placeholder="/absolute/path/to/exported-skill"></label><div class="actions"><button ' + (state.champion?.available ? '' : 'disabled') + ' onclick="postTool(tools.exportChampion, { projectName: \\'' + esc(projectId) + '\\', outDir: document.getElementById(\\'export-dir\\').value, existingProjectIntent: true })">Export champion</button></div>';
    }
    function recordContext() {
      if (!state.selectedProject) return;
      postTool(tools.recordContext, { projectName: state.selectedProject.projectId, eventName: 'McpUiContext', reason: 'Context recorded from the Skill RSI console.', changedFiles: [] });
    }
    function row(label, value) { return '<div class="row"><span class="label">' + esc(label) + '</span><span class="value">' + esc(value ?? 'n/a') + '</span></div>'; }
    function winnerLabel(winner, labels = {}) { return winner === 'skillA' ? labels.a || 'A' : winner === 'skillB' ? labels.b || 'B' : winner || 'n/a'; }
    function decisionLabel(value) { return ({ promote: 'promoted', keep_current: 'kept', request_new_experiment: 'inconclusive', edit_current: 'edited' })[value] || String(value || 'n/a').replaceAll('_', ' '); }
    function shortRun(runId) { const m = String(runId || '').match(/run-\\d+$/); return m ? m[0] : (runId || 'n/a'); }
    function formatEvent(e) { return String(e || '').replace(/[._]/g, ' ').replace(/\\b\\w/g, c => c.toUpperCase()); }
    function formatTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    function promptGist(text) { if (!text) return 'Prompt'; const task = String(text).split('\\n').find(line => line.trim().toLowerCase().startsWith('task:')); return (task ? task.replace(/task:\\s*/i, '') : String(text).split('\\n')[0]).trim(); }
    function outputs(e) { const vals = Object.values(e.results || {}); return { a: vals.find(v => v.sourceSkill === 'skillA')?.content || '', b: vals.find(v => v.sourceSkill === 'skillB')?.content || '' }; }
    function visualOutputs(e) { const vals = Object.values(e.results || {}); const a = vals.find(v => v.sourceSkill === 'skillA')?.visual || e.visual?.skillA || null; const b = vals.find(v => v.sourceSkill === 'skillB')?.visual || e.visual?.skillB || null; return a || b ? { a, b } : null; }
    function openLightbox(id) { const shot = window.__shots?.[id]; if (!shot) return; $('lightbox-title').textContent = shot.label; $('lightbox-meta').textContent = shot.meta; $('lightbox-img').src = shot.dataUrl; $('lightbox-img').alt = shot.label + ' ' + shot.meta; $('lightbox').classList.add('open'); }
    function closeLightbox() { $('lightbox').classList.remove('open'); $('lightbox-img').src = ''; }
    $('lightbox').addEventListener('click', event => { if (event.target.id === 'lightbox') closeLightbox(); });
    shell();
  </script>
</body>
</html>`;
}

export const COCKPIT_TOOL_NAMES = TOOL_NAMES;
