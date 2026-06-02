const diagrams = [
  {
    slug: 'core-loop',
    title: 'The core loop',
    eyebrow: 'Controlled recursive improvement',
    lede: 'Each pass changes one focused thing, tests it against the champion, and records what the next loop should know.',
    kind: 'loop',
    placement: 'README How It Works anchor; blog/social overview',
    use: 'Explain the full Skill RSI loop in one frame.',
    nodes: [
      ['Goal', 'Define the behavior the skill should improve toward.'],
      ['Research', 'Build sourced priors and the ontology guardrail.'],
      ['Plan', 'Choose one testable parameter family.'],
      ['Challenger', 'Generate one localized variation.'],
      ['Evaluate', 'Run the same prompts and criteria.'],
      ['Promote', 'Gate on evidence, margin, and regressions.'],
      ['History', 'Persist findings and failed strategies.'],
      ['Next loop', 'Carry forward the strongest premise.'],
    ],
  },
  {
    slug: 'ontology-map',
    title: 'Ontology map',
    eyebrow: 'Domain guardrail',
    lede: 'Before generation starts, Skill RSI turns research into a shared model of what good work means in this domain.',
    kind: 'ontology',
    placement: 'README intro after the ontology paragraph; social explainer',
    use: 'Show what the ontology contains and why it prevents drift.',
    left: [
      ['Sourced claims', 'Research packet with labeled evidence.'],
      ['Authority map', 'Institutions, strong opinions, standards.'],
      ['Open questions', 'Gaps the loop should treat cautiously.'],
    ],
    right: [
      ['Users and tasks', 'Who activates the skill and why.'],
      ['Quality bar', 'What excellent output looks like.'],
      ['Failure modes', 'What eval prompts must catch.'],
      ['Eval criteria', 'Judging vocabulary for later loops.'],
    ],
  },
  {
    slug: 'deconstruction-map',
    title: 'Deconstruction map',
    eyebrow: 'Champion artifact analysis',
    lede: 'After a champion exists, Skill RSI maps the actual package into improvement surfaces that can be tested without wholesale rewrites.',
    kind: 'deconstruction',
    placement: 'docs/HOW_IT_WORKS deconstruction section; technical social post',
    use: 'Explain how the current champion becomes a parameter map.',
    surfaces: ['Activation boundary', 'Instruction density', 'Reference use', 'Output contract', 'Failure handling', 'Example coverage'],
    evidence: ['Artifact evidence', 'History evidence', 'Mutation hypothesis', 'Regression risk', 'Measurement plan', 'Coupling notes', 'Confidence'],
  },
  {
    slug: 'control-treatment',
    title: 'Control vs treatment',
    eyebrow: 'One variable moves',
    lede: 'The champion stays fixed. The challenger changes one focused surface. Both face the same prompts and criteria.',
    kind: 'control',
    placement: 'README controlled-experiment explanation; social carousel',
    use: 'Make the experiment design immediately legible.',
  },
  {
    slug: 'cold-start-duel',
    title: 'Cold-start duel',
    eyebrow: 'First champion selection',
    lede: 'A scratch project has no control yet, so Skill RSI creates two first-pass candidates and crowns a champion only when the evidence is usable.',
    kind: 'duel',
    placement: 'README How It Works scratch-run section',
    use: 'Explain the one case where Skill RSI generates two candidates.',
  },
  {
    slug: 'experiment-plan',
    title: 'Experiment plan card',
    eyebrow: 'Round premise',
    lede: 'The manager turns the parameter map into a clear test: what changes, what stays fixed, and what evidence would prove the hypothesis.',
    kind: 'plan',
    placement: 'README next-loop plan or UI walkthrough',
    use: 'Show the shape of a well-formed loop premise.',
  },
  {
    slug: 'preflight-review',
    title: 'Preflight review gate',
    eyebrow: 'Before evaluation',
    lede: 'The reviewer attacks package validity and experiment fidelity before a candidate is allowed into the expensive comparison step.',
    kind: 'gate',
    placement: 'docs/HOW_IT_WORKS preflight review section',
    use: 'Explain why broken or drifting candidates stop cleanly.',
  },
  {
    slug: 'prompt-evidence-stack',
    title: 'Prompt-level evidence stack',
    eyebrow: 'Inspectable decisions',
    lede: 'Every promotion links back to the prompt, scores, judge rationale, and both candidate outputs.',
    kind: 'evidence',
    placement: 'README Evidence-Backed Decisions section',
    use: 'Show that decisions are traceable, not just summary scores.',
  },
  {
    slug: 'promotion-policy',
    title: 'Promotion policy gate',
    eyebrow: 'Champion replacement',
    lede: 'Skill RSI does not blindly promote a numerical winner. The analyst reads the evidence and blocks flashy regressions.',
    kind: 'promotion',
    placement: 'docs/HOW_IT_WORKS promotion section; social technical post',
    use: 'Explain score thresholds, regression protection, and analyst recommendation.',
  },
  {
    slug: 'history-memory',
    title: 'History as memory',
    eyebrow: 'Learning from dead ends',
    lede: 'Each run leaves compact guidance, failed strategies, and next-loop direction so the system does not retest the same bad idea.',
    kind: 'history',
    placement: 'README history screenshot section; social proof post',
    use: 'Show why the loop compounds rather than resets.',
  },
  {
    slug: 'artifact-contract',
    title: 'Artifact contract',
    eyebrow: 'Evaluation stays honest',
    lede: 'The output type controls what prompts can ask for and what the evaluator must judge.',
    kind: 'contract',
    placement: 'docs/HOW_IT_WORKS project inputs/output artifact section',
    use: 'Explain text, code, and code + visuals modes.',
  },
  {
    slug: 'operator-surfaces',
    title: 'Operator surfaces',
    eyebrow: 'Same loop, three controls',
    lede: 'The UI, CLI, and Codex plugin all operate the same underlying Skill RSI loop.',
    kind: 'surfaces',
    placement: 'README Codex Plugin and Local UI sections',
    use: 'Orient users across the product surfaces.',
  },
];

const params = new URLSearchParams(window.location.search);
const requestedSlug = params.get('diagram');
const requestedFormat = params.get('format') || 'wide';
const gallery = document.querySelector('#gallery');

gallery.classList.toggle('single', Boolean(requestedSlug));

const selected = requestedSlug
  ? diagrams.filter(diagram => diagram.slug === requestedSlug)
  : diagrams;

if (selected.length === 0) {
  gallery.innerHTML = `<p class="card pad">Unknown diagram: ${escapeHtml(requestedSlug)}</p>`;
} else {
  gallery.innerHTML = selected.map(diagram => renderFrame(diagram, requestedFormat)).join('');
}

window.SKILL_RSI_DIAGRAMS = diagrams.map(diagram => ({
  slug: diagram.slug,
  title: diagram.title,
  use: diagram.use,
  placement: diagram.placement,
}));

function renderFrame(diagram, format) {
  const square = format === 'square';
  return `
    <section class="diagram-frame ${square ? 'square' : ''}" data-diagram="${diagram.slug}">
      <article class="diagram ${square ? 'compact' : ''}">
        ${renderHeader(diagram)}
        <div class="content">
          ${renderBody(diagram)}
          <div class="footer-note">docs/assets/diagrams · ${diagram.slug}</div>
        </div>
      </article>
    </section>
  `;
}

function renderHeader(diagram) {
  return `
    <header class="diagram-header">
      <div>
        <p class="eyebrow">${escapeHtml(diagram.eyebrow)}</p>
        <h1>${escapeHtml(diagram.title)}</h1>
        <p class="lede">${escapeHtml(diagram.lede)}</p>
      </div>
      <div class="brand"><span class="brand-mark">∴</span><span>Skill RSI</span></div>
    </header>
  `;
}

function renderBody(diagram) {
  switch (diagram.kind) {
    case 'loop': return renderLoop(diagram);
    case 'ontology': return renderOntology(diagram);
    case 'deconstruction': return renderDeconstruction(diagram);
    case 'control': return renderControl();
    case 'duel': return renderDuel();
    case 'plan': return renderPlan();
    case 'gate': return renderGate();
    case 'evidence': return renderEvidence();
    case 'promotion': return renderPromotion();
    case 'history': return renderHistory();
    case 'contract': return renderContract();
    case 'surfaces': return renderSurfaces();
    default: return '';
  }
}

function renderLoop(diagram) {
  return `
    <div class="rail" style="--cols: 4">
      ${diagram.nodes.map(([title, copy], index) => `
        <div class="card rail-card ${index === 5 ? 'active' : ''}">
          <span class="stage-node">${String(index + 1).padStart(2, '0')}</span>
          <div class="node-title">${escapeHtml(title)}</div>
          <div class="node-copy">${escapeHtml(copy)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderOntology(diagram) {
  return `
    <div class="hub-map">
      <div class="stack">${diagram.left.map(item => renderSmallCard(item, 'info')).join('')}</div>
      <div class="card hub">
        <div>
          <span class="pill info"><span class="dot"></span> Shared map</span>
          <strong>Ontology</strong>
          <span>Domain model, evaluator vocabulary, and drift guardrail for later loops.</span>
        </div>
      </div>
      <div class="stack">${diagram.right.map(item => renderSmallCard(item, 'success')).join('')}</div>
    </div>
  `;
}

function renderDeconstruction(diagram) {
  return `
    <div class="plan-grid">
      <div class="card plan-card">
        <span class="pill success"><span class="dot"></span> Champion package</span>
        <h2>Break the current skill into testable surfaces</h2>
        <div class="artifact-preview">
          <div class="file-line strong"></div>
          <div class="file-line wide"></div>
          <div class="file-line"></div>
          <div class="file-line short"></div>
          <div class="file-line wide muted"></div>
          <div class="file-line muted"></div>
        </div>
        <div class="chip-list">
          ${diagram.surfaces.map(surface => `<span class="chip">${escapeHtml(surface)}</span>`).join('')}
        </div>
      </div>
      <div class="stack">
        ${diagram.evidence.map((label, index) => `
          <div class="card small-card">
            <div class="mini-label">parameter ${String(index + 1).padStart(2, '0')}</div>
            <div class="node-title">${escapeHtml(label)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderControl() {
  return `
    <div class="grid-3">
      <div class="card candidate-card">
        <div class="candidate-head">
          <span class="pill success"><span class="dot"></span> Control</span>
          <span class="mono">champion v4</span>
        </div>
        <div class="strategy">Validated skill package stays fixed.</div>
        <div class="node-copy">Known strengths, known weaknesses, full history.</div>
      </div>
      <div class="card candidate-card">
        <div class="candidate-head">
          <span class="pill info"><span class="dot"></span> Treatment</span>
          <span class="mono">challenger</span>
        </div>
        <div class="strategy">One focused mutation gets tested.</div>
        <div class="node-copy">Preserve unrelated behavior so the result stays interpretable.</div>
      </div>
      <div class="card candidate-card">
        <div class="candidate-head">
          <span class="pill"><span class="dot"></span> Same trial</span>
          <span class="mono">blind eval</span>
        </div>
        <div class="score-row"><span>Stable prompts</span><b>same</b></div>
        <div class="score-row"><span>Criteria</span><b>same</b></div>
        <div class="score-row"><span>Judge policy</span><b>same</b></div>
      </div>
    </div>
  `;
}

function renderDuel() {
  return `
    <div class="grid-3">
      <div class="card candidate-card a">
        <div class="candidate-head"><span class="pill info"><span class="dot"></span> Candidate A</span><span class="mono">strategy 1</span></div>
        <div class="strategy accent-a">Format-first drafting</div>
        <div class="node-copy">Independent first attempt when no champion exists yet.</div>
      </div>
      <div class="card candidate-card b">
        <div class="candidate-head"><span class="pill"><span class="dot"></span> Candidate B</span><span class="mono">strategy 2</span></div>
        <div class="strategy accent-b">Structure-first drafting</div>
        <div class="node-copy">Different initial plan, same goal and same judging criteria.</div>
      </div>
      <div class="card candidate-card">
        <div class="candidate-head"><span class="pill success"><span class="dot"></span> Champion</span><span class="mono">v1</span></div>
        <div class="metric"><b>7/10</b><span>prompts won</span></div>
        <div class="node-copy">First champion is crowned only when evidence is usable.</div>
      </div>
    </div>
  `;
}

function renderPlan() {
  return `
    <div class="plan-grid">
      <div class="card plan-card">
        <span class="pill info"><span class="dot"></span> Next loop plan</span>
        <h2>Narrow the activation boundary without compressing the package.</h2>
        <div class="mono">from run-004 · champion challenge</div>
      </div>
      <div class="card plan-card">
        <div class="check-list">
          <div class="check">Change: tighten when the skill should activate.</div>
          <div class="check">Preserve: reference files, examples, and output contract.</div>
          <div class="check">Evidence: fewer false positives on stable prompts.</div>
          <div class="check warn">Regression: missed legitimate documentation tasks.</div>
        </div>
      </div>
    </div>
  `;
}

function renderGate() {
  const checks = ['Valid SKILL.md and frontmatter', 'Referenced files still present', 'No unsafe scripts or package behavior', 'No eval prompt leakage', 'No drift from assigned experiment', 'No severe compression of validated structure'];
  return `
    <div class="rail" style="--cols: 3">
      ${checks.map((check, index) => `
        <div class="card rail-card ${index < 4 ? 'active' : ''}">
          <span class="stage-node">${String(index + 1).padStart(2, '0')}</span>
          <div class="node-title">${escapeHtml(check)}</div>
          <div class="node-copy">${index === 5 ? 'One bounded revision allowed before the run stops cleanly.' : 'Candidate must pass before evaluation.'}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderEvidence() {
  return `
    <div class="evidence-stack">
      <div class="card prompt-card">
        <span class="pill"><span class="dot"></span> Prompt 04</span>
        <p>Diagnose why this thriller opening feels flat, then rewrite it into a stronger sequence.</p>
        <div class="mono">stable prompt · artifact completeness · context fidelity</div>
      </div>
      <div class="stack">
        <div class="card criteria-table">
          <div class="table-row header"><span>Criterion</span><span>A</span><span>B</span><span>Winner</span></div>
          <div class="table-row"><span>Format conformance</span><span class="win-a">5</span><span>4</span><span class="win-a">A</span></div>
          <div class="table-row"><span>Context fidelity</span><span>4</span><span class="win-b">5</span><span class="win-b">B</span></div>
          <div class="table-row"><span>Completeness</span><span class="win-a">5</span><span>3</span><span class="win-a">A</span></div>
        </div>
        <div class="grid-2">
          ${renderSmallCard(['Judge rationale', 'Candidate A fixes structure while preserving the user’s premise.'], 'success')}
          ${renderSmallCard(['Outputs', 'Both candidate responses remain inspectable beside the scores.'], 'info')}
        </div>
      </div>
    </div>
  `;
}

function renderPromotion() {
  return `
    <div class="plan-grid">
      <div class="card plan-card">
        <span class="pill success"><span class="dot"></span> Recommendation</span>
        <h2>Promote only when the win survives policy.</h2>
        <div class="grid-2">
          <div class="metric"><b>12%</b><span>overall edge</span></div>
          <div class="metric"><b>7/10</b><span>prompts won</span></div>
        </div>
      </div>
      <div class="card plan-card">
        <div class="check-list">
          <div class="check">Score and win-margin thresholds cleared.</div>
          <div class="check">Stable prompts show no critical regression.</div>
          <div class="check">Enough evals completed to trust the result.</div>
          <div class="check warn">Analyst checks noise, rationale, and risk.</div>
        </div>
      </div>
    </div>
  `;
}

function renderHistory() {
  return `
    <div class="grid-2">
      <div class="card plan-card">
        <div class="timeline">
          <div class="tl-item"><span class="tl-node promoted">01</span><div><div class="tl-title">First champion crowned</div><div class="tl-copy">Candidate A wins on format conformance.</div></div></div>
          <div class="tl-item"><span class="tl-node">02</span><div><div class="tl-title">Challenger held</div><div class="tl-copy">Better examples, but activation drifted too wide.</div></div></div>
          <div class="tl-item"><span class="tl-node promoted">03</span><div><div class="tl-title">Champion promoted</div><div class="tl-copy">Narrower trigger improves stable prompts.</div></div></div>
          <div class="tl-item"><span class="tl-node">04</span><div><div class="tl-title">Next loop queued</div><div class="tl-copy">Investigate reference-file density.</div></div></div>
        </div>
      </div>
      <div class="card plan-card">
        <span class="pill"><span class="dot"></span> Compact memory</span>
        <h2>What the next run reads first.</h2>
        <div class="chip-list">
          <span class="chip">known weaknesses</span><span class="chip">failed strategies</span><span class="chip">do-not-repeat</span><span class="chip">next experiment</span>
        </div>
      </div>
    </div>
  `;
}

function renderContract() {
  const items = [
    ['TXT', 'Text', 'Complete written artifacts', 'Judge clarity, fidelity, and completeness.'],
    ['CODE', 'Code', 'Runnable code answers', 'Penalize advice-only output or hidden dependencies.'],
    ['UI', 'Code + visuals', 'Browser-renderable UI', 'Capture screenshots and judge visible result.'],
  ];
  return `<div class="grid-3">${items.map(([icon, title, subtitle, copy]) => `
    <div class="card surface">
      <span class="surface-icon">${escapeHtml(icon)}</span>
      <div class="strategy">${escapeHtml(title)}</div>
      <div class="node-title">${escapeHtml(subtitle)}</div>
      <div class="node-copy">${escapeHtml(copy)}</div>
    </div>
  `).join('')}</div>`;
}

function renderSurfaces() {
  const items = [
    ['APP', 'UI', 'Watch runs, inspect evidence, open champions, compare candidates.'],
    ['CLI', 'CLI', 'Create projects, run loops, export skills, schedule automation.'],
    ['MCP', 'Codex plugin', 'Open the local app, prepare projects, call MCP tools explicitly.'],
  ];
  return `
    <div class="grid-3">
      ${items.map(([icon, title, copy]) => `
        <div class="card surface">
          <span class="surface-icon">${escapeHtml(icon)}</span>
          <div class="strategy">${escapeHtml(title)}</div>
          <div class="node-copy">${escapeHtml(copy)}</div>
          <div class="score-row"><span>Underlying loop</span><b>same</b></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSmallCard([title, copy]) {
  return `
    <div class="card small-card">
      <div class="node-title">${escapeHtml(title)}</div>
      <div class="node-copy">${escapeHtml(copy)}</div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
