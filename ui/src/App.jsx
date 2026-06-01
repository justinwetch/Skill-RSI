import { useEffect, useRef, useState } from 'react';
import {
  FlaskConical, Moon, Sun, Plus, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  ArrowRight, Play, Trophy, Check, CheckCircle2, ArrowUp, Minus, FileText,
  Loader2, Database, Layout, GitPullRequest, MessageSquare, TrendingUp, Scale,
  Beaker, Swords, Search, Flag, Pencil, Trash2, Upload, Sparkles, Package,
  X, ExternalLink, Clock, Inbox, AlertTriangle, AlertCircle, Terminal, Copy, Download,
} from 'lucide-react';
import {
  createProject, deleteProject, fetchProjects, fetchProjectSummary, fetchRunDetail,
  fetchComparison, fetchSkill, fetchProgress, fetchCapabilities, fetchProjectDraft, artifactUrl, runStep,
  updateProjectSettings, exportChampion,
} from './api.js';
import { resolveInitialRoute } from './routing.js';
import { createOpenAiDiagnosticMetadata, getOpenAiKeyStatus } from './key-status.js';

const STAGES = [
  {
    key: 'deconstruct', label: 'Deconstruct', icon: FlaskConical,
    desc: 'Pulls the current champion apart to find what’s worth changing — how it’s triggered, the steps it tells the agent to follow, what lives in the main file vs. references — and ranks where the biggest gains likely are.',
    done: 'Found the highest-leverage things to change.',
  },
  {
    key: 'plan', label: 'Plan test', icon: Beaker,
    desc: 'Turns that into a clean experiment: picks one or two changes to test this round and holds everything else fixed, so any difference can be traced to the change.',
    done: 'Set up a controlled experiment for this round.',
  },
  {
    key: 'generate', label: 'Generate A / B', icon: Swords,
    desc: 'Two independent authors each write a full new version of the skill from the same brief, deliberately taking different approaches so they don’t fail the same way.',
    done: 'Wrote two competing versions of the skill.',
  },
  {
    key: 'review', label: 'Adversarial review', icon: Search,
    desc: 'An adversarial reviewer attacks both versions — trigger precision, over/under-constraint, missing edge cases, packaging, safety, and overfitting — plus deterministic spec and safety checks. Anything with a blocking flaw is sent back for a model rewrite before evaluation.',
    done: 'Adversarially reviewed both versions (and rewrote any that were blocked).',
  },
  {
    key: 'evaluate', label: 'Evaluate', icon: Scale,
    desc: 'Runs both versions against the same test prompts, has a blind judge score every answer, then pits the winner against the reigning champion.',
    done: 'Scored both versions and tested the winner against the champion.',
  },
  {
    key: 'decide', label: 'Decide', icon: Flag,
    desc: 'Reads the scores, separates real differences from noise, watches for regressions, and decides whether to crown a new champion, hold, or try again.',
    done: 'Weighed the evidence and made the call.',
  },
];

// First run has no champion to deconstruct — it maps the space from the ontology instead.
const FIRST_RUN_STAGE0 = {
  label: 'Map the space',
  desc: 'No champion yet — maps the skill’s domain from the goal: what good output looks like, where it can vary, and the surfaces a strong first version must get right. Sets the initial set of things to tune.',
  done: 'Mapped the initial design space.',
};

const STAGE_KEYS = STAGES.map(s => s.key);

// real timeline events → which stage they belong to
const EVENT_STAGE = {
  'run.started': 'deconstruct',
  'run.resumed': 'deconstruct',
  'champion.snapshot_written': 'deconstruct',
  'research_packet.written': 'deconstruct', 'research_packet.reused': 'deconstruct', 'research_packet.fallback_written': 'deconstruct',
  'ontology.written': 'deconstruct', 'ontology.reused': 'deconstruct', 'ontology.refreshed': 'deconstruct', 'ontology.skipped_for_baseline': 'deconstruct',
  'ontology_quality.revision_requested': 'deconstruct', 'ontology_quality.completed': 'deconstruct',
  'deconstruction_quality.revision_requested': 'deconstruct', 'deconstruction_quality.completed': 'deconstruct',
  'parameterization.written': 'deconstruct', 'parameterization.seeded': 'deconstruct',
  'manager_plan.written': 'plan',
  'experiment_plan.written': 'plan',
  'candidates.written': 'generate', 'challenger.written': 'generate',
  'candidate_reviews.completed': 'review', 'challenger_review.completed': 'review', 'candidate_revision.started': 'review', 'candidate_revision.completed': 'review',
  'criteria.generated': 'evaluate',
  'eval_prompts.generated': 'evaluate', 'eval_config.written': 'evaluate', 'candidate_duel.completed': 'evaluate',
  'challenge.completed': 'evaluate',
  'prompt_bank.updated': 'decide', 'analysis.written': 'decide', 'state.updated': 'decide', 'manager_plan.finalized': 'decide', 'run.completed': 'decide',
};

// real timeline events → human-readable substep shown live under the active step
const EVENT_LABEL = {
  'run.started': 'Loop started',
  'run.resumed': 'Resumed an interrupted loop',
  'champion.snapshot_written': 'Saved the champion baseline for this loop',
  'research_packet.written': 'Built the research packet',
  'research_packet.reused': 'Reused the current research packet',
  'research_packet.fallback_written': 'Created an inference-labeled research packet',
  'ontology.written': 'Mapped the skill’s domain',
  'ontology.reused': 'Reused the domain map',
  'ontology.refreshed': 'Refreshed the domain map for the new champion',
  'ontology.skipped_for_baseline': 'Skipped ontology because a baseline skill was supplied',
  'ontology_quality.revision_requested': 'Requested one ontology revision from the quality gate',
  'ontology_quality.completed': 'Recorded ontology quality',
  'deconstruction_quality.revision_requested': 'Requested one deconstruction revision from the quality gate',
  'deconstruction_quality.completed': 'Recorded deconstruction quality',
  'parameterization.written': 'Broke the champion into changeable parts',
  'parameterization.seeded': 'Mapped the initial design space from the ontology',
  'manager_plan.written': 'Set the experiment strategy',
  'experiment_plan.written': 'Chose what to test this round',
  'candidates.written': 'Wrote the two cold-start candidates',
  'challenger.written': 'Wrote the challenger',
  'candidate_reviews.completed': 'Adversarially reviewed both cold-start candidates',
  'challenger_review.completed': 'Adversarially reviewed the challenger',
  'candidate_revision.started': 'Rewriting a flagged version',
  'candidate_revision.completed': 'Finished a rewrite',
  'criteria.generated': 'Generated the scoring criteria from the skills',
  'eval_prompts.generated': 'Wrote realistic test prompts',
  'eval_config.written': 'Prepared the evaluation',
  'candidate_duel.completed': 'Judged the cold-start candidates head-to-head',
  'challenge.completed': 'Judged the challenger against the champion',
  'prompt_bank.updated': 'Updated the prompt bank',
  'analysis.written': 'Analyzed the results',
  'state.updated': 'Recorded the decision',
  'manager_plan.finalized': 'Recorded the next move',
  'run.completed': 'Loop complete',
};

const ACCENTS = [
  { soft: 'var(--color-info-subtle)', strong: 'var(--color-info)', icon: Database },
  { soft: 'var(--color-success-subtle)', strong: 'var(--color-success)', icon: Layout },
  { soft: 'var(--color-skill-a-subtle)', strong: 'var(--color-skill-a)', icon: GitPullRequest },
  { soft: 'var(--color-warning-subtle)', strong: 'var(--color-warning)', icon: MessageSquare },
];
const OPENAI_KEY_STORAGE_KEY = 'skill-rsi-openai-api-key';
const OPENAI_MODELS = [
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini', note: 'Default for lower-cost iteration.' },
  { id: 'gpt-5.5', label: 'gpt-5.5', note: 'Higher-capability model with higher expected cost.' },
];

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('skill-rsi-theme') || 'light');
  const [view, setView] = useState('list');
  const [screen, setScreen] = useState('home');
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [runDetail, setRunDetail] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [loops, setLoops] = useState(3);
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(null);
  const [runningLoops, setRunningLoops] = useState(1);
  const [baseRunCount, setBaseRunCount] = useState(0);
  const [runningFirst, setRunningFirst] = useState(false);
  const [openEval, setOpenEval] = useState(null);
  const [evTab, setEvTab] = useState('summary');
  const [draft, setDraft] = useState({
    mode: 'scratch',
    outputType: 'text',
    model: 'gpt-5.4-mini',
    name: '',
    goal: '',
    baselineFiles: [],
    baselineZip: null,
    baselineMarkdown: null,
    serverDraftId: null,
    serverBaseline: null,
  });
  const [openAiKey, setOpenAiKey] = useState(() => localStorage.getItem(OPENAI_KEY_STORAGE_KEY) || '');
  const [capabilities, setCapabilities] = useState(null);
  const [skillSource, setSkillSource] = useState('champion');
  const [skillData, setSkillData] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillFile, setSkillFile] = useState(0);
  const [inspectRunId, setInspectRunId] = useState(null);
  const [inspectDetail, setInspectDetail] = useState(null);
  const [inspectComparison, setInspectComparison] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [evidenceFrom, setEvidenceFrom] = useState('home');
  const [skillFrom, setSkillFrom] = useState('home');
  const [lightboxImage, setLightboxImage] = useState(null);
  const timers = useRef([]);
  const initialRouteHandled = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('skill-rsi-theme', theme);
  }, [theme]);

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    setLoading(true); setError('');
    try {
      const data = await fetchProjects();
      const loadedProjects = data.projects || [];
      setProjects(loadedProjects);
      if (!initialRouteHandled.current) {
        initialRouteHandled.current = true;
        await applyInitialRoute(loadedProjects);
      }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function applyInitialRoute(loadedProjects) {
    const route = resolveInitialRoute(window.location.search, loadedProjects);
    if (route.view === 'create') {
      if (route.draftId) {
        try {
          const serverDraft = await fetchProjectDraft(route.draftId);
          setDraft(d => mergeServerDraft(d, serverDraft));
        } catch (err) {
          setError(err.message);
        }
      }
      setView('create');
      if (!route.draftId) setError('');
      return;
    }
    if (route.view === 'project') await openProject(route.projectId);
  }

  async function deleteProjects(ids) {
    setError('');
    for (const id of ids) {
      try { await deleteProject(id); }
      catch (err) { setError(err.message); }
    }
    await loadProjects();
  }

  async function openProject(projectId) {
    setSelectedId(projectId);
    setView('project'); setScreen('home');
    setOpenEval(null); setEvTab('summary');
    await loadProjectData(projectId);
  }

  async function loadProjectData(projectId = selectedId) {
    if (!projectId) return;
    setError('');
    try {
      const s = await fetchProjectSummary(projectId);
      setSummary(s);
      setLoops(Math.max(1, s.state?.runPolicy?.targetIterations || s.config?.trigger?.targetIterations || 3));
      if (s.state.lastRunId) {
        const [detail, compare] = await Promise.all([
          fetchRunDetail(projectId).catch(() => null),
          fetchComparison(projectId).catch(() => null),
        ]);
        setRunDetail(detail); setComparison(compare);
      } else { setRunDetail(null); setComparison(null); }
    } catch (err) { setError(err.message); }
  }

  function clearTimers() { timers.current.forEach(clearTimeout); timers.current = []; }
  useEffect(() => clearTimers, []);

  async function handleStart(count) {
    if (!selectedId || busy) return;
    let runtimeCapabilities = capabilities;
    if (!getOpenAiKeyStatus(runtimeCapabilities, openAiKey).keyConfigured) {
      try {
        runtimeCapabilities = await fetchCapabilities();
        setCapabilities(runtimeCapabilities);
      } catch {
        runtimeCapabilities = null;
      }
    }
    if (!getOpenAiKeyStatus(runtimeCapabilities, openAiKey).keyConfigured) {
      setError('Add an OpenAI API key before running real loops.');
      return;
    }
    const preCount = summary?.state?.runCount || 0;
    const preLastId = summary?.state?.lastRunId || null;
    setBusy(true); setError('');
    setScreen('running'); setStageIdx(0); setElapsed(0); setProgress(null);
    setRunningLoops(count); setBaseRunCount(preCount); setRunningFirst(!summary?.state?.currentChampion);

    const startedAt = Date.now();
    timers.current.push(setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000));

    // Poll the real run timeline for live progress.
    let progressSeen = false;
    timers.current.push(setInterval(async () => {
      try {
        const p = await fetchProgress(selectedId);
        // ignore the previous run still showing as "completed" before the new run starts
        if (p && p.runId && !(p.runId === preLastId && p.status === 'completed')) {
          progressSeen = true;
          setProgress(p);
        }
      } catch { /* stale server / no endpoint — fall back to the timed animation */ }
    }, 1500));

    // Fallback animation only kicks in if the progress endpoint never responds.
    STAGES.forEach((_, i) => {
      timers.current.push(setTimeout(() => { if (!progressSeen) setStageIdx(i); }, i * 4000));
    });

    try {
      await runStep(selectedId, {
        loops: count,
        mode: 'agentic',
        evalMode: 'real',
        maxRuns: null,
        openAiApiKey: openAiKey.trim() || null,
        clientDiagnostics: {
          openai: createOpenAiDiagnosticMetadata(runtimeCapabilities, openAiKey),
        },
      });
      clearTimers();
      await loadProjectData(selectedId);
      await loadProjects();
      setScreen('home');
    } catch (err) {
      clearTimers(); setError(err.message); setScreen('home');
    } finally { setBusy(false); setProgress(null); }
  }

  async function handleModelChange(model) {
    if (!selectedId || settingsBusy) return;
    setSettingsBusy(true); setError('');
    try {
      const updated = await updateProjectSettings(selectedId, { model });
      setSummary(updated);
      await loadProjects();
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleExportChampion(outDir) {
    if (!selectedId) return null;
    return exportChampion(selectedId, { outDir });
  }

  async function handleCreate(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const fromExisting = draft.mode === 'existing';
    try {
      const fromServerDraft = Boolean(fromExisting && draft.serverDraftId && draft.serverBaseline);
      if (fromExisting && !fromServerDraft && !draft.baselineZip && !draft.baselineFiles?.length && !draft.baselineMarkdown) {
        throw new Error('Choose a baseline skill .zip or folder before starting from an existing skill.');
      }
      // Only carry a baseline when starting from an existing skill.
      const baselineFiles = fromExisting && !fromServerDraft ? await readDraftBaselineFiles(draft.baselineFiles, draft.baselineMarkdown) : [];
      const baselineArchive = fromExisting && !fromServerDraft ? await readDraftBaselineZip(draft.baselineZip) : null;

      // Name/goal are optional in the existing-skill path (auto-filled from SKILL.md). Derive
      // sensible fallbacks so the backend's non-empty validation still passes.
      let baseName = draft.name.trim();
      if (!baseName && fromExisting) {
        baseName = getDraftBaselineDisplayName(draft) || 'Imported skill';
      }
      let goal = draft.goal.trim();
      if (!goal && fromExisting) goal = `Improve the "${baseName}" skill.`;

      let created = null;
      // Auto-increment the name if it collides with an existing project (e.g. "Natural Prose" -> "Natural Prose 2").
      for (let attempt = 0; attempt < 30 && !created; attempt += 1) {
        const name = attempt === 0 ? baseName : `${baseName} ${attempt + 1}`;
        try {
          created = await createProject({
            projectName: name,
            goal,
            triggerMode: 'manual',
            outputType: draft.outputType || 'text',
            taskContract: getDraftTaskContract(draft),
            model: draft.model || 'gpt-5.4-mini',
            draftId: fromServerDraft ? draft.serverDraftId : null,
            baselineFiles,
            baselineArchive,
          });
        } catch (err) {
          if (!/already exists/i.test(err.message)) throw err;
        }
      }
      if (!created) throw new Error('Could not find an available name — try a different one.');
      setDraft({
        mode: 'scratch',
        outputType: 'text',
        model: 'gpt-5.4-mini',
        name: '',
        goal: '',
        baselineFiles: [],
        baselineZip: null,
        baselineMarkdown: null,
        serverDraftId: null,
        serverBaseline: null,
      });
      await loadProjects();
      await openProject(created.projectId);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function viewSkill(source) {
    const fromRunContext = screen === 'evidence' || skillFrom === 'evidence';
    setSkillFrom(fromRunContext ? 'evidence' : 'home');
    setScreen('skill'); setSkillSource(source); setSkillFile(0);
    setSkillData(null); setCompareData(null); setSkillLoading(true);
    try {
      const runId = inspectRunId || summary?.state?.lastRunId || null;
      if (source === 'compare') {
        const mode = (inspectRunId && inspectComparison ? inspectComparison : comparison)?.competitionMode;
        const leftSource = mode === 'cold_start_duel' ? 'candidate-a' : 'champion';
        const rightSource = mode === 'cold_start_duel' ? 'candidate-b' : 'challenger';
        const [a, b] = await Promise.all([
          fetchSkill(selectedId, leftSource, runId),
          fetchSkill(selectedId, rightSource, runId),
        ]);
        setCompareData({ a, b, leftSource, rightSource });
      } else {
        const skillRunId = source === 'champion' && !fromRunContext ? null : runId;
        setSkillData(await fetchSkill(selectedId, source, skillRunId));
      }
    } catch (err) {
      setSkillData({ available: false, error: err.message });
    }
    finally { setSkillLoading(false); }
  }

  async function openRun(runId, from = 'home') {
    const latestId = summary?.state?.lastRunId || null;
    const target = runId || latestId;
    setEvidenceFrom(from);
    setInspectRunId(target);
    setScreen('evidence'); setEvTab('summary'); setOpenEval(null);
    if (!target || target === latestId) {
      setInspectDetail(runDetail); setInspectComparison(comparison);
      return;
    }
    setInspectLoading(true);
    try {
      const [d, c] = await Promise.all([
        fetchRunDetail(selectedId, target).catch(() => null),
        fetchComparison(selectedId, target).catch(() => null),
      ]);
      setInspectDetail(d); setInspectComparison(c);
    } catch (err) { setError(err.message); }
    finally { setInspectLoading(false); }
  }

  function updateOpenAiKey(value) {
    setOpenAiKey(value);
    if (value.trim()) localStorage.setItem(OPENAI_KEY_STORAGE_KEY, value);
    else localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
  }

  return (
    <div className="app">
      <div className="topbar">
        <button className="brand" onClick={() => { setView('list'); loadProjects(); }}>
          <span className="brand-mark"><FlaskConical size={17} /></span>
          Skill RSI
        </button>
        <button className="icon-btn" aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </div>

      {error && <div className="alert">{error}</div>}

      {view === 'list' && (
        <FrontDoor loading={loading} projects={projects}
          onOpen={openProject} onNew={() => { setView('create'); setError(''); }}
          onDeleteProjects={deleteProjects} />
      )}

      {view === 'create' && (
        <CreateView draft={draft} setDraft={setDraft} busy={busy}
          capabilities={capabilities} setCapabilities={setCapabilities}
          openAiKey={openAiKey} setOpenAiKey={updateOpenAiKey}
          onSubmit={handleCreate} onCancel={() => setView('list')} />
      )}

      {view === 'project' && summary && (
        <Project
          summary={summary} runDetail={runDetail} comparison={comparison}
          screen={screen} setScreen={setScreen}
          stageIdx={stageIdx} elapsed={elapsed}
          progress={progress} runningLoops={runningLoops} baseRunCount={baseRunCount} runningFirst={runningFirst}
          loops={loops} setLoops={setLoops} busy={busy}
          openEval={openEval} setOpenEval={setOpenEval}
          evTab={evTab} setEvTab={setEvTab}
          skillSource={skillSource} skillData={skillData} compareData={compareData} skillLoading={skillLoading}
          skillFile={skillFile} setSkillFile={setSkillFile}
          inspectDetail={inspectDetail} inspectComparison={inspectComparison}
          inspectLoading={inspectLoading} inspectRunId={inspectRunId}
          evidenceFrom={evidenceFrom} skillFrom={skillFrom}
          onBack={() => { setView('list'); loadProjects(); }}
          onStart={handleStart} onModelChange={handleModelChange} settingsBusy={settingsBusy}
          onViewSkill={viewSkill} onOpenRun={openRun}
          onExportChampion={handleExportChampion}
          onOpenImage={setLightboxImage}
        />
      )}
      {lightboxImage && <ImageLightbox image={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </div>
  );
}

function getDraftTaskContract(draft) {
  if (draft.outputType === 'code_visual') {
    return {
      id: 'code_visual_standalone',
      artifactType: 'code',
      environment: 'standalone',
    };
  }
  const artifactType = draft.outputType === 'code' ? 'code' : 'text';
  return {
    id: artifactType === 'code' ? 'code_standalone' : 'text_standalone',
    artifactType,
    environment: 'standalone',
  };
}

function mergeServerDraft(current, serverDraft) {
  if (!serverDraft?.id) return current;
  return {
    ...current,
    mode: serverDraft.mode || current.mode,
    outputType: serverDraft.outputType || current.outputType,
    model: serverDraft.model || current.model,
    name: serverDraft.projectName || current.name,
    goal: serverDraft.goal || current.goal,
    targetIterations: serverDraft.targetIterations || current.targetIterations,
    outputTypeSource: serverDraft.outputTypeSource || null,
    baselineFiles: [],
    baselineZip: null,
    baselineMarkdown: null,
    serverDraftId: serverDraft.id,
    serverBaseline: serverDraft.baseline || null,
  };
}

// --- baseline SKILL.md auto-fill -------------------------------------------
// Parse YAML frontmatter for the two fields we care about: name + description.
function parseSkillFrontmatter(text = '') {
  const m = text.match(/^﻿?---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const block = m[1];
  const grab = key => {
    const line = block.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'mi'));
    if (!line) return null;
    return line[1].trim().replace(/^['"]|['"]$/g, '').trim() || null;
  };
  return { name: grab('name'), description: grab('description') };
}

// "linkedin-post-writing" -> "Linkedin Post Writing" (a friendly starting title).
function prettifySkillName(slug = '') {
  return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function getDraftBaselineDisplayName(draft) {
  if (draft.serverBaseline?.skillName) return prettifySkillName(draft.serverBaseline.skillName);
  if (draft.serverBaseline?.displayName) return prettifySkillName(draft.serverBaseline.displayName.replace(/\.(zip|md|markdown|txt)$/i, ''));
  const zipName = (draft.baselineZip?.name || '').replace(/\.zip$/i, '');
  if (zipName) return prettifySkillName(zipName);
  const markdownName = (draft.baselineMarkdown?.name || '').replace(/\.(md|markdown|txt)$/i, '');
  if (markdownName) return prettifySkillName(markdownName);
  const firstPath = draft.baselineFiles?.[0]?.webkitRelativePath || '';
  const root = firstPath.split('/').filter(Boolean)[0] || '';
  return prettifySkillName(root);
}

// From a selected folder's File[], find SKILL.md and read its frontmatter.
async function readFrontmatterFromFiles(files = []) {
  const skill = Array.from(files).find(f => /(^|\/)SKILL\.md$/i.test(f.webkitRelativePath || f.name));
  if (!skill) return {};
  try {
    const text = await skill.text();
    return parseSkillFrontmatter(text);
  } catch { return {}; }
}

// From a .zip, locate SKILL.md via local-file headers and inflate it (native DecompressionStream).
async function readFrontmatterFromZip(file) {
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    const td = new TextDecoder();
    let off = 0;
    while (off + 30 <= buf.length && dv.getUint32(off, true) === 0x04034b50) {
      const method = dv.getUint16(off + 8, true);
      const compSize = dv.getUint32(off + 18, true);
      const nameLen = dv.getUint16(off + 26, true);
      const extraLen = dv.getUint16(off + 28, true);
      const nameStart = off + 30;
      const fname = td.decode(buf.subarray(nameStart, nameStart + nameLen));
      const dataStart = nameStart + nameLen + extraLen;
      if (/(^|\/)SKILL\.md$/i.test(fname) && compSize > 0) {
        const raw = buf.subarray(dataStart, dataStart + compSize);
        let text = null;
        if (method === 0) {
          text = td.decode(raw);
        } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
          const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          text = td.decode(await new Response(stream).arrayBuffer());
        }
        if (text) {
          const fm = parseSkillFrontmatter(text);
          if (fm.name || fm.description) return fm;
        }
      }
      off = dataStart + compSize;
    }
  } catch { /* best effort — leave fields for the user to fill */ }
  return {};
}

async function readFrontmatterFromMarkdown(file) {
  if (!file) return {};
  try {
    return parseSkillFrontmatter(await file.text());
  } catch { return {}; }
}

// Merge auto-filled name/goal into a draft without clobbering anything the user already typed.
function applyBaselineAutofill(draft, fm) {
  const next = {};
  if (fm.name && !draft.name.trim()) next.name = prettifySkillName(fm.name);
  if (fm.description && !draft.goal.trim()) next.goal = fm.description;
  return next;
}

async function readDraftBaselineFiles(files = [], markdownFile = null) {
  if (markdownFile) {
    return [{
      path: 'SKILL.md',
      content: await markdownFile.text(),
    }];
  }
  if (!files.length) return [];
  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      path: file.webkitRelativePath || file.name,
      content: String(reader.result || ''),
    });
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  })));
}

async function readDraftBaselineZip(file) {
  if (!file) return null;
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    contentBase64: arrayBufferToBase64(buffer),
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/* ---------------- front door ---------------- */

function FrontDoor({ loading, projects, onOpen, onNew, onDeleteProjects }) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  function exitEdit() { setEditing(false); setSelected(new Set()); setConfirming(false); }
  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function confirmDelete() {
    setWorking(true);
    try { await onDeleteProjects([...selected]); }
    finally { setWorking(false); exitEdit(); }
  }

  if (loading) return <div className="empty">Loading your skills…</div>;
  const ordered = [...projects].sort((a, b) => recencyTs(b) - recencyTs(a));

  return (
    <>
      <div className="list-head">
        <h1>Skills</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button className="btn sm ghost" onClick={exitEdit}>Cancel</button>
              <button className="btn sm danger" disabled={selected.size === 0} onClick={() => setConfirming(true)}>
                <Trash2 size={14} /> Delete{selected.size ? ` (${selected.size})` : ''}
              </button>
            </>
          ) : (
            <>
              {projects.length > 0 && (
                <button className="btn sm" onClick={() => setEditing(true)}><Pencil size={14} /> Edit</button>
              )}
              <button className="btn sm" onClick={onNew}><Plus size={15} /> New skill</button>
            </>
          )}
        </div>
      </div>

      {confirming && (
        <div className="confirm-bar">
          <span>Delete {selected.size} skill{selected.size === 1 ? '' : 's'}? They’ll be moved to a trash folder you can recover from.</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button className="btn sm ghost" onClick={() => setConfirming(false)} disabled={working}>Cancel</button>
            <button className="btn sm danger" onClick={confirmDelete} disabled={working}>
              {working ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Delete
            </button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="empty">
          No skills yet. Create one to start improving it.
          <div style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={onNew}><Plus size={15} /> New skill</button>
          </div>
        </div>
      ) : ordered.map((p, i) => (
        <SkillRow key={p.projectId} project={p} accent={ACCENTS[i % ACCENTS.length]}
          editing={editing} selected={selected.has(p.projectId)}
          onOpen={onOpen} onToggle={toggle} />
      ))}
    </>
  );
}

function SkillRow({ project, accent, onOpen, editing, selected, onToggle }) {
  const runs = project.state.runCount || 0;
  const latest = project.history?.recentTrajectory?.at(-1) || null;
  const Icon = accent.icon;
  const noRuns = runs === 0;
  const handleClick = editing ? () => onToggle(project.projectId) : () => onOpen(project.projectId);
  return (
    <button className={`skill-row ${noRuns ? 'dashed' : ''} ${editing && selected ? 'selected' : ''}`} onClick={handleClick}>
      {editing && (
        <span className={`checkbox ${selected ? 'checked' : ''}`} aria-hidden="true">
          {selected && <Check size={13} />}
        </span>
      )}
      <span className="skill-ico" style={{ background: accent.soft, color: accent.strong }}><Icon size={20} /></span>
      <span className="skill-main">
        <span className="skill-name">{formatName(project.projectId)}</span>
        <span className="skill-goal">{project.goal}</span>
      </span>
      <span className="skill-right">
        {noRuns ? (
          <>
            <div className="skill-sub">No runs yet</div>
            {!editing && <div className="skill-sub" style={{ color: 'var(--color-info)' }}>Start iteration</div>}
          </>
        ) : (
          <>
            <TrendChip latest={latest} />
            <div className="skill-sub">Champion v{runs}{latest ? ` · ${decisionLabel(latest.decision)}` : ''}</div>
          </>
        )}
      </span>
    </button>
  );
}

function TrendChip({ latest }) {
  if (!latest) return <span className="skill-sub">not run</span>;
  if (latest.decision === 'promote') {
    return <span className="skill-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <TrendingUp size={14} style={{ color: 'var(--color-success)' }} />improving</span>;
  }
  return <span className="skill-sub" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
    <Minus size={14} style={{ color: 'var(--color-text-muted)' }} />holding</span>;
}

/* ---------------- create ---------------- */

function CreateView({
  draft,
  setDraft,
  busy,
  onSubmit,
  onCancel,
  capabilities,
  setCapabilities,
  openAiKey,
  setOpenAiKey,
}) {
  const existing = draft.mode === 'existing';
  const hasBaseline = Boolean(draft.serverBaseline || draft.baselineZip || draft.baselineFiles?.length || draft.baselineMarkdown);
  const [visualRunnerNotice, setVisualRunnerNotice] = useState('');
  const setMode = mode => setDraft(d => mode === 'scratch'
    ? ({ ...d, mode, serverDraftId: null, serverBaseline: null, baselineZip: null, baselineFiles: [], baselineMarkdown: null })
    : ({ ...d, mode }));
  const keyStatus = getOpenAiKeyStatus(capabilities, openAiKey);
  const serverKeyConfigured = keyStatus.serverKeyConfigured;
  useEffect(() => {
    if (!capabilities) fetchCapabilities().then(setCapabilities).catch(() => {});
  }, [capabilities, setCapabilities]);
  async function setOutputType(outputType) {
    if (outputType !== 'code_visual') {
      setVisualRunnerNotice('');
      setDraft(d => ({ ...d, outputType }));
      return;
    }

    if (outputType === 'code_visual') {
      try {
        const nextCapabilities = await fetchCapabilities();
        setCapabilities(nextCapabilities);
        if (!nextCapabilities.visualRunner?.available) {
          setVisualRunnerNotice(formatVisualRunnerNotice(nextCapabilities.visualRunner));
          return;
        }
      } catch {
        const fallbackCapabilities = {
          visualRunner: {
            available: false,
            error: 'Could not check local visual runner.',
            installHint: 'Start or restart the Skill RSI server, then try Code + visuals again.',
          },
        };
        setCapabilities(fallbackCapabilities);
        setVisualRunnerNotice(formatVisualRunnerNotice(fallbackCapabilities.visualRunner));
        return;
      }
    }
    setVisualRunnerNotice('');
    setDraft(d => ({ ...d, outputType }));
  }
  const outputTypes = [
    {
      key: 'text',
      icon: FileText,
      title: 'Text',
      desc: 'Answers are judged as written artifacts: plans, drafts, analyses, rubrics, or recommendations.',
    },
    {
      key: 'code',
      icon: GitPullRequest,
      title: 'Code',
      desc: 'Prompts require production-ready code instead of implementation advice.',
    },
    {
      key: 'code_visual',
      icon: Layout,
      title: 'Code + visuals',
      desc: 'Prompts require complete browser-renderable UI code, then judge the rendered result.',
    },
  ];
  return (
    <div className="create animate-slide-up">
      <div className="crumbs">
        <button className="back" onClick={onCancel}><ChevronLeft size={16} /> Skills</button>
      </div>
      <div className="eyebrow">New skill</div>
      <h1>Create a skill to improve</h1>
      <p className="lede">Skill RSI evolves a skill over rounds of automated improvement. First, choose where version 1 comes from.</p>
      {draft.serverDraftId && (
        <div className="handoff-banner">
          <CheckCircle2 size={16} />
          <span>Codex prepared this setup from your attached skill. Review output type and model before creating the project.</span>
        </div>
      )}

      <div className="mode-grid">
        <button type="button" className={`mode-card${!existing ? ' active' : ''}`}
          aria-pressed={!existing} onClick={() => setMode('scratch')}>
          <Sparkles size={19} />
          <div>
            <b>Start from scratch</b>
            <p>The system writes version 1 from your description, then improves it.</p>
          </div>
        </button>
        <button type="button" className={`mode-card${existing ? ' active' : ''}`}
          aria-pressed={existing} onClick={() => setMode('existing')}>
          <Package size={19} />
          <div>
            <b>Start from an existing skill</b>
            <p>Upload a skill to use as version 1. Improvement begins from there.</p>
          </div>
        </button>
      </div>

      <div className="field">
        <span>Output artifact</span>
        <div className="output-grid" role="radiogroup" aria-label="Expected output">
          {outputTypes.map(type => {
            const Icon = type.icon;
            const active = draft.outputType === type.key;
            return (
              <button key={type.key} type="button"
                className={`mode-card output-card${active ? ' active' : ''}`}
                role="radio" aria-checked={active} disabled={type.disabled}
                onClick={() => !type.disabled && setOutputType(type.key)}>
                <Icon size={18} />
                <div>
                  <b>{type.title}</b>
                  <p>{type.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        {visualRunnerNotice && (
          <p className="field-hint warning-text">
            {visualRunnerNotice}
          </p>
        )}
        <p className="field-hint">This controls the artifact Skill RSI expects candidate skills to produce.</p>
        {draft.serverDraftId && draft.outputTypeSource === 'inferred' && (
          <p className="field-hint">Suggested by Codex from the skill/request; change it if needed.</p>
        )}
      </div>

      <div className="field">
        <span>Model</span>
        <select value={draft.model || 'gpt-5.4-mini'}
          onChange={e => setDraft({ ...draft, model: e.target.value })}>
          {OPENAI_MODELS.map(model => (
            <option key={model.id} value={model.id}>{model.label}</option>
          ))}
        </select>
        <p className="field-hint">
          {(OPENAI_MODELS.find(model => model.id === (draft.model || 'gpt-5.4-mini')) || OPENAI_MODELS[0]).note}
          {' '}This model is fixed for the project’s run history.
        </p>
      </div>

      <label className="field">
        <span>OpenAI API key</span>
        <input type="password" value={openAiKey}
          placeholder={serverKeyConfigured ? 'Using server environment key' : 'Paste key'}
          onChange={e => setOpenAiKey(e.target.value)}
          autoComplete="off" />
        <p className={`field-hint ${!keyStatus.keyConfigured ? 'warning-text' : ''}`}>
          {keyStatus.uiKeyConfigured
            ? 'OpenAI key saved locally in this browser.'
            : serverKeyConfigured
              ? 'OpenAI key available from local server environment.'
              : 'Add an OpenAI key before running real loops.'}
        </p>
      </label>

      <form onSubmit={onSubmit}>
        {existing && (
          <div className="field">
            <span>Baseline skill</span>
            <BaselineDropzone draft={draft} setDraft={setDraft} />
          </div>
        )}

        <label className="field">
          <span>Skill name{existing ? ' (optional)' : ''}</span>
          <input value={draft.name} autoFocus required={!existing}
            placeholder={existing ? 'Auto-filled from the uploaded skill' : 'SQL query writing'}
            onChange={e => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="field">
          <span>What should it get better at?{existing ? ' (optional)' : ''}</span>
          <textarea value={draft.goal} required={!existing}
            placeholder="Help agents write correct, readable SQL across dialects."
            onChange={e => setDraft({ ...draft, goal: e.target.value })} />
          <p className="field-hint">
            {existing
              ? 'Guides the loop. Leave blank to infer the goal from the uploaded skill.'
              : 'This becomes the target the improvement loop optimizes toward.'}
          </p>
        </label>

        <div className="form-actions">
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={busy || (existing && !hasBaseline)}>
            {busy ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
            {existing ? 'Create from baseline' : 'Create skill'}
          </button>
        </div>
      </form>
    </div>
  );
}

function BaselineDropzone({ draft, setDraft }) {
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState('');
  const zip = draft.baselineZip;
  const folderCount = draft.baselineFiles?.length || 0;
  const md = draft.baselineMarkdown;
  const serverBaseline = draft.serverBaseline;

  async function chooseZip(file) {
    if (!file) return;
    const fm = await readFrontmatterFromZip(file);
    setDraft(d => ({ ...d, ...applyBaselineAutofill(d, fm), baselineZip: file, baselineFiles: [], baselineMarkdown: null, serverDraftId: null, serverBaseline: null }));
    setNote('');
  }
  async function chooseMarkdown(file) {
    if (!file) return;
    const fm = await readFrontmatterFromMarkdown(file);
    setDraft(d => ({ ...d, ...applyBaselineAutofill(d, fm), baselineMarkdown: file, baselineZip: null, baselineFiles: [], serverDraftId: null, serverBaseline: null }));
    setNote('');
  }
  async function chooseFolder(files) {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    const fm = await readFrontmatterFromFiles(arr);
    setDraft(d => ({ ...d, ...applyBaselineAutofill(d, fm), baselineFiles: arr, baselineZip: null, baselineMarkdown: null, serverDraftId: null, serverBaseline: null }));
    setNote('');
  }
  function clearSel() {
    setDraft(d => ({ ...d, baselineZip: null, baselineFiles: [], baselineMarkdown: null, serverDraftId: null, serverBaseline: null }));
    setNote('');
  }
  function onDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = Array.from(e.dataTransfer?.files || [])[0];
    if (file && /\.zip$/i.test(file.name)) chooseZip(file);
    else if (file && /\.(md|markdown|txt)$/i.test(file.name)) chooseMarkdown(file);
    else if (file) setNote('Drop a .zip or a single markdown skill file. For a folder, use “browse for a folder”.');
    else setNote('');
  }

  const selected = zip ? zip.name
    : md ? md.name
      : folderCount ? `${folderCount} file${folderCount === 1 ? '' : 's'} selected`
        : serverBaseline ? serverBaseline.displayName || serverBaseline.skillName || 'Prepared baseline skill'
          : null;

  return (
    <div className={`dropzone${dragOver ? ' over' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}>
      <Upload size={20} />
      {selected ? (
        <div className="dz-body">
          <b>{selected}</b>
          <p>{serverBaseline ? 'Prepared from Codex. ' : ''}This becomes version 1. <button type="button" className="dz-link" onClick={clearSel}>Choose a different one</button></p>
        </div>
      ) : (
        <div className="dz-body">
          <b>Drop a .zip or .md here, or browse</b>
          <p>Must contain a <code>SKILL.md</code>. This becomes version 1.</p>
          <div className="dz-actions">
            <label className="dz-link">
              browse for a .zip
              <input type="file" accept=".zip,application/zip" aria-label="Choose baseline skill zip"
                onChange={e => chooseZip(e.target.files?.[0] || null)} />
            </label>
            <span className="dz-sep">·</span>
            <label className="dz-link">
              browse for a .md file
              <input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" aria-label="Choose baseline skill markdown file"
                onChange={e => chooseMarkdown(e.target.files?.[0] || null)} />
            </label>
            <span className="dz-sep">·</span>
            <label className="dz-link">
              browse for a folder
              <input type="file" multiple webkitdirectory="" aria-label="Choose baseline skill folder"
                onChange={e => chooseFolder(e.target.files)} />
            </label>
          </div>
        </div>
      )}
      {note && <p className="dz-note">{note}</p>}
    </div>
  );
}

/* ---------------- project shell ---------------- */

function Project(props) {
  const {
    summary, runDetail, comparison, screen, setScreen, stageIdx, elapsed,
    progress, runningLoops, baseRunCount, runningFirst,
    loops, setLoops, busy, openEval, setOpenEval, evTab, setEvTab,
    skillSource, skillData, compareData, skillLoading, skillFile, setSkillFile,
    inspectDetail, inspectComparison, inspectLoading, inspectRunId,
    evidenceFrom, skillFrom,
    onBack, onStart, onModelChange, settingsBusy, onViewSkill, onOpenRun, onExportChampion, onOpenImage,
  } = props;

  const runs = summary.state.runCount || 0;
  const hasChampion = !!summary.state.currentChampion;
  const latestId = summary.state.lastRunId || null;
  const skillCmp = (inspectRunId && inspectRunId !== latestId) ? inspectComparison : comparison;
  const deep = screen === 'evidence' || screen === 'skill' || screen === 'history';
  const deepLabel = screen === 'evidence' ? 'Evidence' : screen === 'skill' ? 'Skill' : 'History';
  // back returns to wherever you came from
  const backTarget = screen === 'evidence' ? evidenceFrom
    : screen === 'skill' ? skillFrom
    : 'home';
  const backLabel = backTarget === 'history' ? 'History'
    : backTarget === 'evidence' ? 'Evidence'
    : formatName(summary.projectId);

  return (
    <div className="animate-slide-up">
      <div className="crumbs">
        <button className="back" onClick={deep ? () => setScreen(backTarget) : onBack}>
          <ChevronLeft size={16} /> {deep ? backLabel : 'Skills'}
        </button>
        {deep && (<><span className="sep">/</span><span className="cur">{deepLabel}</span></>)}
        {!deep && hasChampion && (
          <span style={{ marginLeft: 'auto' }} className="pill success"><Trophy size={13} /> Champion v{runs}</span>
        )}
      </div>

      {screen === 'history' && (
        <HistoryScreen summary={summary} onOpenRun={id => onOpenRun(id, 'history')} />
      )}

      {screen === 'evidence' && (
        inspectLoading
          ? <div className="empty">Loading run…</div>
          : <Evidence runDetail={inspectDetail} comparison={inspectComparison}
              openEval={openEval} setOpenEval={setOpenEval}
              evTab={evTab} setEvTab={setEvTab} onViewSkill={onViewSkill}
              iterLabel={iterationLabel(summary, inspectRunId)} onOpenImage={onOpenImage} />
      )}

      {screen === 'skill' && (
        <SkillViewer source={skillSource} data={skillData} compareData={compareData} loading={skillLoading}
          activeFile={skillFile} setActiveFile={setSkillFile} onViewSkill={onViewSkill}
          summary={summary} onExportChampion={onExportChampion}
          strategies={{
            competitionMode: skillCmp?.competitionMode || 'cold_start_duel',
            a: skillCmp?.competitionMode === 'cold_start_duel' ? skillCmp?.sides?.candidateA?.strategy : skillCmp?.sides?.champion?.strategy,
            b: skillCmp?.competitionMode === 'cold_start_duel' ? skillCmp?.sides?.candidateB?.strategy : skillCmp?.sides?.challenger?.strategy,
            aParams: skillCmp?.competitionMode === 'cold_start_duel' ? skillCmp?.sides?.candidateA?.changedParameterIds : skillCmp?.sides?.champion?.changedParameterIds,
            bParams: skillCmp?.competitionMode === 'cold_start_duel' ? skillCmp?.sides?.candidateB?.changedParameterIds : skillCmp?.sides?.challenger?.changedParameterIds,
          }} />
      )}

      {(screen === 'home' || screen === 'running') && (
        <>
          <h1 className="h-title">{formatName(summary.projectId)}</h1>
          <p className="goal">{summary.goal}</p>

          {screen === 'running' ? (
            <RunningLoop fallbackStage={stageIdx} elapsed={elapsed} progress={progress}
              totalLoops={runningLoops} baseRunCount={baseRunCount} defaultIteration={runs + 1}
              firstRun={runningFirst} premise={summary.history?.nextLoopPremise}
              outputType={summary.config?.eval?.outputType} />
          ) : (
            <>
              {summary.latestLoopResult && (
                <LoopResultCard result={summary.latestLoopResult} summary={summary}
                  onEvidence={() => onOpenRun(null, 'home')} onViewSkill={onViewSkill} />
              )}
              <NextLoopPremise premise={summary.history?.nextLoopPremise} />
              <RunBar summary={summary} loops={loops} setLoops={setLoops} busy={busy}
                settingsBusy={settingsBusy} onStart={onStart} onModelChange={onModelChange} />
              <div className="grid home">
                <HistoryCard summary={summary} onOpenRun={id => onOpenRun(id, 'home')} onOpenAll={() => setScreen('history')} />
              </div>
              <SecondaryRow summary={summary} runDetail={runDetail} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- run control ---------------- */

function NextLoopPremise({ premise }) {
  if (!premise?.notes?.length) return null;
  return (
    <div className="premise">
      <div className="premise-head">
        <Flag size={15} />
        <span>Next Loop Plan</span>
        {premise.sourceRunId && <em>from {shortRun(premise.sourceRunId)}</em>}
      </div>
      <ul>
        {premise.notes.slice(0, 3).map((note, index) => <li key={index}>{note}</li>)}
      </ul>
    </div>
  );
}

function RunBar({ summary, loops, setLoops, busy, settingsBusy, onStart, onModelChange }) {
  const [automationOpen, setAutomationOpen] = useState(false);
  const policy = summary.state.runPolicy || summary.config?.trigger || {};
  const budget = summary.config?.budget || {};
  const usage = summary.state.budgetUsage || {};
  const maxRuns = budget.maxRuns;
  const automation = summary.automation || null;
  const taskContractLabel = formatTaskContract(summary.config?.eval?.taskContract);
  const modelLabel = summary.config?.models?.agent || 'gpt-5.4-mini';
  const hasRuns = (summary.state.runCount || 0) > 0;
  const automationState = describeAutomation(automation);
  const StatusIcon = automationState.icon;
  const runDisabled = busy || settingsBusy || automation?.locked;
  return (
    <div className="run-bar">
      <div className="run-bar-main">
        <div className="copy">
          <div>
            Run
            <input className="num" type="number" min="1" value={loops}
              onChange={e => setLoops(Math.max(1, Number.parseInt(e.target.value, 10) || 1))} />
            improvement {loops === 1 ? 'loop' : 'loops'}
          </div>
          <div className="subtle">
            {taskContractLabel} · {modelLabel} · target {policy.targetIterations || loops}
            {maxRuns ? ` · max ${maxRuns} runs` : ''}
            {usage.estimatedTokens ? ` · ~${formatCompact(usage.estimatedTokens)} tokens used` : ''}
          </div>
        </div>
        <button className="btn primary" disabled={runDisabled} onClick={() => onStart(loops)}>
          {busy || settingsBusy || automation?.locked ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
          {automation?.locked ? 'Running…' : hasRuns ? 'Run next iteration(s)' : 'Start iteration'}
        </button>
      </div>
      <div className="run-settings">
        <label className="run-setting">
          <span>Model</span>
          <select value={modelLabel} disabled={hasRuns || busy || settingsBusy || automation?.locked}
            onChange={e => onModelChange?.(e.target.value)}>
            {OPENAI_MODELS.map(model => (
              <option key={model.id} value={model.id}>{model.label}</option>
            ))}
          </select>
        </label>
        <span className="run-setting-note">
          {hasRuns
            ? 'Model is fixed after iterations exist.'
            : `${(OPENAI_MODELS.find(model => model.id === modelLabel) || OPENAI_MODELS[0]).note} Used for agent, generation, judge, and scheduler commands.`}
        </span>
      </div>
      <div className={`automation-line ${automationState.kind}`}>
        <span className="automation-copy">
          <StatusIcon size={15} />
          <span>{automationState.text}</span>
        </span>
        <button className={`automation-toggle ${automationOpen ? 'open' : ''}`} onClick={() => setAutomationOpen(!automationOpen)}>
          Automation <ChevronDown size={15} />
        </button>
      </div>
      {automationOpen && <AutomationPanel automation={automation} />}
    </div>
  );
}

function AutomationPanel({ automation }) {
  const hooks = automation?.hooks || {};
  const pending = hooks.inbox || { count: 0, latest: null };
  const failed = hooks.failed || { count: 0, latest: null };
  const processed = hooks.processed?.count || 0;
  const skipped = hooks.skipped?.count || 0;
  const processing = hooks.processing?.count || 0;
  const latest = pending.latest;
  const failedLatest = failed.latest;
  return (
    <div className="automation-panel">
      <div className="automation-status-list">
        <AutomationFact icon={automation?.locked ? Loader2 : Clock} tone={automation?.locked ? 'success' : 'muted'}>
          {automation?.locked
            ? 'A loop is running now. Scheduled wake-ups will wait rather than overlap.'
            : automation?.scheduledObserved
              ? `Automation has been observed on this project${automation.lastRun?.completedAt ? `; latest run completed ${fmtTime(automation.lastRun.completedAt)}` : ''}.`
              : 'This project only runs when you press the run button until you install a schedule.'}
        </AutomationFact>
        {automation?.status === 'max_runs' && (
          <AutomationFact icon={AlertTriangle} tone="warning">
            At the {automation.maxRuns}-run ceiling. Raise the scheduled command’s <code>--max-runs</code> value to keep unattended runs going.
          </AutomationFact>
        )}
        {automation?.status === 'failed' && failed.count > 0 && (
          <AutomationFact icon={AlertCircle} tone="error">
            {failed.count} failed automation {failed.count === 1 ? 'event' : 'events'} recorded{failedLatest?.error?.message ? `: ${failedLatest.error.message}` : '.'}
          </AutomationFact>
        )}
        {pending.count > 0 ? (
          <AutomationFact icon={Inbox} tone="info">
            {pending.count} Codex {pending.count === 1 ? 'change is' : 'changes are'} waiting. The next manual or scheduled loop will use this context; a queued change is not a run.
          </AutomationFact>
        ) : (
          <AutomationFact icon={Inbox} tone="muted">
            No Codex hook context is waiting.
          </AutomationFact>
        )}
      </div>
      {latest && (
        <div className="hook-context">
          <div className="hook-context-head">Waiting Codex Context</div>
          <div className="hook-context-meta">
            {latest.eventName || 'Codex event'} · received {fmtTime(latest.receivedAt)}
            {latest.reason ? ` · ${latest.reason}` : ''}
          </div>
          {latest.changedFiles?.length ? (
            <div className="hook-files">
              {latest.changedFiles.map(file => <code key={file}>{file}</code>)}
              {latest.changedFileCount > latest.changedFiles.length && <span>+{latest.changedFileCount - latest.changedFiles.length} more</span>}
            </div>
          ) : (
            <div className="hook-context-meta">No changed files were reported for the latest queued event.</div>
          )}
        </div>
      )}
      <div className="automation-queue">
        queue · waiting {pending.count || 0} · processing {processing} · processed {processed} · skipped {skipped} · failed {failed.count || 0}
      </div>
      <details className="automation-setup">
        <summary>Set up scheduled runs</summary>
        <div className="automation-setup-grid">
          <div className="automation-setup-block">
            <div className="automation-setup-title"><Clock size={15} /> On a schedule</div>
            <p>Install this in cron or a LaunchAgent to wake Skill RSI on your schedule. The cron runner consumes queued Codex context by default.</p>
            <CommandBlock command={automation?.commands?.cron || ''} />
            <p>PowerShell:</p>
            <CommandBlock command={automation?.commands?.powershell?.cron || ''} />
          </div>
          <div className="automation-setup-block">
            <div className="automation-setup-title"><Terminal size={15} /> From Codex</div>
            <p>Add this to a Codex Stop hook. It records context only; it never starts RSI or spends model budget.</p>
            <CommandBlock command={automation?.commands?.codexHook || ''} />
            <p>PowerShell:</p>
            <CommandBlock command={automation?.commands?.powershell?.codexHook || ''} />
          </div>
        </div>
      </details>
    </div>
  );
}

function AutomationFact({ icon: Icon, tone = 'muted', children }) {
  return (
    <div className={`automation-fact ${tone}`}>
      <Icon size={15} className={Icon === Loader2 ? 'spin' : ''} />
      <span>{children}</span>
    </div>
  );
}

function CommandBlock({ command }) {
  const [copied, setCopied] = useState(false);
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="command-block">
      <code>{command}</code>
      <button className="copy-command" type="button" onClick={copyCommand} aria-label="Copy command">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function describeAutomation(automation) {
  if (!automation) return { kind: 'muted', icon: Play, text: 'Runs only when you press Run.' };
  const pending = automation.hooks?.inbox?.count || 0;
  switch (automation.status) {
    case 'running':
      return { kind: 'success', icon: Loader2, text: 'A loop is running right now.' };
    case 'max_runs':
      return { kind: 'warning', icon: AlertTriangle, text: `Paused at the ${automation.maxRuns}-run ceiling.` };
    case 'failed':
      return { kind: 'error', icon: AlertCircle, text: 'Last automation event needs attention.' };
    case 'hooks_waiting':
      return { kind: 'info', icon: Inbox, text: `${pending} Codex ${pending === 1 ? 'change is' : 'changes are'} waiting — they’ll shape your next run.` };
    case 'scheduled':
      return { kind: 'muted', icon: Clock, text: 'Automation has been observed for this project.' };
    case 'manual':
    default:
      return { kind: 'muted', icon: Play, text: 'Runs only when you press Run.' };
  }
}

function formatTaskContract(taskContract) {
  switch (taskContract?.id) {
    case 'code_visual_standalone':
      return 'code + visuals output';
    case 'code_standalone':
    case 'codebase_edit':
      return 'code output';
    case 'text_source_grounded':
    case 'text_standalone':
    default:
      return 'text output';
  }
}

function formatVisualRunnerNotice(visualRunner = {}) {
  const detail = visualRunner.error ? ` Current check: ${visualRunner.error}` : '';
  return `Code + visuals needs a local browser so Skill RSI can render candidates before judging them. Ask your agent to install Playwright Chromium for this repo, or install Chrome/Chromium locally, then try Code + visuals again.${detail}`;
}

/* ---------------- running loop ---------------- */

function RunningLoop({ fallbackStage, elapsed, progress, totalLoops, baseRunCount, defaultIteration, firstRun, premise, outputType }) {
  const [openStages, setOpenStages] = useState(() => new Set());
  const events = progress?.events || [];
  // Whether stage 0 is "map the space" vs "deconstruct" is decided by what the run actually did.
  // parameterization.seeded => mapped from scratch (no champion); parameterization.written OR
  // ontology.refreshed => a champion exists (refresh only fires for a changed champion), so it's
  // deconstructing. Fall back to the pre-run guess only until one of those signals arrives — this
  // closes the window in a multi-loop batch where the batch-level "first run" guess goes stale.
  const championSignal = events.some(e => e.event === 'parameterization.written' || e.event === 'ontology.refreshed');
  const seedSignal = events.some(e => e.event === 'parameterization.seeded');
  const stage0First = seedSignal ? true : championSignal ? false : firstRun;
  const view = STAGES.map((s, i) => (stage0First && i === 0 ? { ...s, ...FIRST_RUN_STAGE0 } : s));
  const live = events.length > 0;
  const completed = progress?.status === 'completed';

  // current stage index: from real events if we have them, else the timed fallback
  let stageIdx = fallbackStage;
  if (live) {
    let idx = 0;
    for (const e of events) {
      const key = EVENT_STAGE[e.event];
      if (key) idx = Math.max(idx, STAGE_KEYS.indexOf(key));
    }
    stageIdx = completed ? STAGES.length : idx;
  }

  // substeps per stage, from real events
  const substepsByStage = {};
  for (const e of events) {
    const key = EVENT_STAGE[e.event];
    if (!key || !EVENT_LABEL[e.event]) continue;
    (substepsByStage[key] ||= []).push(EVENT_LABEL[e.event]);
  }

  const iteration = progress?.runNumber || defaultIteration;
  const loopK = Math.min(totalLoops, Math.max(1, iteration - baseRunCount));
  const intent = getLoopIntent({ progress, stageIdx, stage0First, premise, outputType });
  function toggleStage(key, currentlyOpen) {
    setOpenStages(prev => {
      const next = new Set(prev);
      const closedKey = `closed:${key}`;
      if (currentlyOpen) {
        next.delete(key);
        next.add(closedKey);
      } else {
        next.add(key);
        next.delete(closedKey);
      }
      return next;
    });
  }

  return (
    <div className="card loop-card">
      <div className="loop-head">
        <div className="iter-block">
          <span className="iter-num">{iteration}</span>
          <div>
            <div className="iter-label">Iteration</div>
            {totalLoops > 1 && <div className="iter-loop">Loop {loopK} of {totalLoops}</div>}
          </div>
        </div>
        <span className="pill success"><span className="dot live" /> Running · {fmtElapsed(elapsed)}</span>
      </div>

      <div className="loop-intent">
        <Flag size={15} />
        <span>{intent}</span>
      </div>

      <div className="pipeline">
        {view.map((s, i) => {
          const state = i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'upcoming';
          return (
            <Stage key={s.key} state={state} label={s.label} Icon={s.icon}
              line={i < STAGES.length - 1} lineFilled={i < stageIdx} />
          );
        })}
      </div>

      <div className="steps">
        {view.map((s, i) => {
          const state = i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'upcoming';
          const subs = substepsByStage[s.key] || [];
          const details = progress?.stageDetails?.[s.key] || [];
          const autoOpen = details.length > 0 && !openStages.has(`closed:${s.key}`);
          const open = openStages.has(s.key) || autoOpen;
          const expandable = subs.length > 0 || details.length > 0;
          return (
            <div className={`step-row ${state}`} key={s.key}>
              <span className="step-mark">
                {state === 'done' ? <Check size={15} />
                  : state === 'active' ? <Loader2 size={15} className="spin" />
                  : <span className="step-num">{i + 1}</span>}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="step-title-line">
                  <div className="step-label">{s.label}</div>
                  {expandable && (
                    <button type="button" className="step-expand" aria-expanded={open} onClick={() => toggleStage(s.key, open)}>
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </div>
                <div className="step-desc">{state === 'done' && subs.length === 0 ? s.done : s.desc}</div>
                {open && subs.length > 0 && (state === 'active' || state === 'done') && (
                  <div className="substeps">
                    {subs.map((label, n) => (
                      <div className="substep" key={n}><Check size={12} /> {label}</div>
                    ))}
                    {state === 'active' && !completed && <div className="substep working"><Loader2 size={12} className="spin" /> working…</div>}
                  </div>
                )}
                {open && details.length > 0 && (
                  <div className="stage-detail">
                    {details.map((detail, n) => <div key={n}>{detail}</div>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        <Loader2 size={13} className="spin" /> Real model-backed run — this can take a few minutes. Keep this tab open.
      </p>
    </div>
  );
}

function getLoopIntent({ progress, stageIdx, stage0First, premise, outputType }) {
  const currentStage = STAGE_KEYS[Math.min(stageIdx, STAGE_KEYS.length - 1)] || 'deconstruct';

  if (currentStage === 'deconstruct') {
    return stage0First
      ? 'Mapping the skill space and research context'
      : 'Deconstructing the current champion';
  }
  if (currentStage === 'plan') return 'Planning this round’s experiment';
  if (currentStage === 'generate') {
    return progress?.competitionMode === 'cold_start_duel'
      ? 'Generating Candidate A and Candidate B'
      : 'Generating a challenger';
  }
  if (currentStage === 'review') {
    return progress?.competitionMode === 'cold_start_duel'
      ? 'Reviewing Candidate A and Candidate B'
      : 'Reviewing the challenger';
  }
  if (currentStage === 'evaluate') {
    return outputType === 'code_visual'
      ? 'Rendering and judging screenshots'
      : 'Evaluating outputs against the prompt bank';
  }
  if (currentStage === 'decide') return 'Analyzing results and recording the next loop plan';
  if (premise?.notes?.length) return `Premise: ${premise.notes[0]}`;
  return stage0First
    ? 'Mapping the skill space and creating first candidates'
    : 'Deconstructing the current champion and planning the next ablation';
}

function Stage({ state, label, Icon, line, lineFilled }) {
  return (
    <>
      <div className={`stage ${state}`}>
        <div className="stage-node">
          {state === 'done' ? <Check size={16} /> : <Icon size={16} className={state === 'active' ? 'spin' : ''} />}
        </div>
        <span className="stage-label">{label}</span>
      </div>
      {line && <div className={`stage-line ${lineFilled ? 'filled' : ''}`} />}
    </>
  );
}

/* ---------------- loop result ---------------- */

function LoopResultCard({ result, summary, onEvidence, onViewSkill }) {
  const outcomeTone = resultTone(result.outcome);
  const OutcomeIcon = resultIcon(result.outcome);
  const hasScores = result.sides?.sideA?.totalScore != null || result.sides?.sideB?.totalScore != null;
  const delta = result.scoreDelta;
  const deltaSide = delta > 0 ? 'sideA' : delta < 0 ? 'sideB' : 'tie';
  const deltaLabel = delta == null ? 'n/a' : delta === 0 ? 'even' : `+${Math.abs(delta)}`;
  const hasChampion = !!summary.state.currentChampion;
  const prompts = result.promptOutcomes || [];
  const sideATotal = result.sides?.sideA?.totalScore;
  const sideBTotal = result.sides?.sideB?.totalScore;
  const numericSideA = Number(sideATotal) || 0;
  const numericSideB = Number(sideBTotal) || 0;
  const policyWinner = resultPolicyWinnerSide(result);
  const advantage = buildResultAdvantage({
    result,
    policyWinner,
    deltaSide,
    numericSideA,
    numericSideB,
  });
  const visibleEdges = policyWinner
    ? (result.topCriterionEdges || []).filter(edge => edge.leader === policyWinner)
    : (result.topCriterionEdges || []);
  const totalPrompts = result.promptWins?.total ?? prompts.length;
  const winnerPromptWins = policyWinner === 'sideA'
    ? result.promptWins?.sideA ?? 0
    : policyWinner === 'sideB'
      ? result.promptWins?.sideB ?? 0
      : result.promptWins?.ties ?? 0;
  const promptMetricLabel = policyWinner ? 'prompts won' : 'prompts tied';
  const scoreMeta = buildScoreMeta({ result, sideATotal, sideBTotal, deltaLabel });
  return (
    <section className={`loop-result ${outcomeTone} policy-${policyWinner || 'tie'}`}>
      <div className="loop-result-inner">
        <div className="loop-result-head">
          <div className="loop-result-title">
            <span className="loop-result-icon"><OutcomeIcon size={22} /></span>
            <div className="eyebrow">Loop result · iteration {result.runNumber || summary.state.runCount}</div>
            <h2>{result.headline}</h2>
          </div>
          <span className={`loop-result-status ${outcomeTone}`}>{loopResultStatus(result)}</span>
        </div>

        <div className="result-metrics">
          {advantage && (
            <div className={`result-metric ${resultSideTone(policyWinner, policyWinner)}`}>
              <b>{advantage.value}</b>
              <span>{advantage.label}</span>
            </div>
          )}
          <div className={`result-metric ${resultSideTone(policyWinner, policyWinner)}`}>
            <b>{winnerPromptWins}<em>/</em>{totalPrompts || 0}</b>
            <span>{promptMetricLabel}</span>
          </div>
        </div>

        {result.overallProgress?.percent ? (
          <div className="overall-progress">
            <TrendingUp size={14} />
            <strong>+{result.overallProgress.percent}%</strong>
            <span>{result.overallProgress.label}</span>
          </div>
        ) : null}

        {visibleEdges.length > 0 && (
          <div className="result-insights">
            <div className="edge-list">
              <div className="mini-label">Where {result.labels?.[policyWinner] || leadLabel || 'the winner'} was stronger</div>
              {visibleEdges.map(edge => (
                <div className="edge-row" key={edge.id}>
                  <span>{edge.name}</span>
                  <b className={resultSideTone(edge.leader, policyWinner)}>{criterionEdgePercent(edge)}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        {scoreMeta.length > 0 && (
          <div className="score-meta">
            {scoreMeta.map(item => <span className={item.tone} key={item.label}>{item.label}</span>)}
          </div>
        )}

        <div className="result-actions">
          {hasChampion && <button className="btn" onClick={() => onViewSkill('champion')}><Trophy size={15} /> View champion</button>}
          {hasScores && <button className="btn" onClick={onEvidence}><FileText size={16} /> Detailed Data <ArrowRight size={15} /></button>}
        </div>
      </div>
    </section>
  );
}

function buildResultAdvantage({ result, policyWinner, deltaSide, numericSideA, numericSideB }) {
  if (!policyWinner || deltaSide === 'tie') return { value: 'Even', label: 'no overall score edge' };
  const winnerScore = policyWinner === 'sideA' ? numericSideA : numericSideB;
  const loserScore = policyWinner === 'sideA' ? numericSideB : numericSideA;
  const percent = percentAdvantage(winnerScore, loserScore);
  if (percent == null) return null;
  const winnerLabel = result.labels?.[policyWinner] || 'Winner';
  if (result.outcome === 'promoted') {
    return { value: `${percent}%`, label: 'overall improvement over the champion' };
  }
  if (result.outcome === 'first_champion') {
    return { value: `${percent}%`, label: `${winnerLabel} stronger overall` };
  }
  if (result.outcome === 'kept' || result.decision === 'keep_current') {
    return { value: `${percent}%`, label: `${winnerLabel} stronger overall` };
  }
  return { value: `${percent}%`, label: `${winnerLabel} overall edge` };
}

function percentAdvantage(winnerScore, loserScore) {
  if (!Number.isFinite(winnerScore) || !Number.isFinite(loserScore)) return null;
  const delta = winnerScore - loserScore;
  if (delta <= 0) return 0;
  const denominator = Math.max(Math.abs(loserScore), 1);
  return Math.round((delta / denominator) * 100);
}

function buildScoreMeta({ result, sideATotal, sideBTotal, deltaLabel }) {
  const sideA = result.labels?.sideA || 'A';
  const sideB = result.labels?.sideB || 'B';
  const sideAScore = sideATotal == null ? 'n/a' : formatCompact(sideATotal);
  const sideBScore = sideBTotal == null ? 'n/a' : formatCompact(sideBTotal);
  const items = [
    { label: `${sideB} ${sideBScore}`, tone: resultSideTone('sideB', resultPolicyWinnerSide(result)) },
    { label: `${sideA} ${sideAScore}`, tone: resultSideTone('sideA', resultPolicyWinnerSide(result)) },
    { label: `${deltaLabel} edge`, tone: 'muted' },
  ];
  return items;
}

function loopResultStatus(result) {
  if (result.outcome === 'promoted') return 'promoted';
  if (result.outcome === 'first_champion') return 'champion';
  if (result.outcome === 'kept') return 'held';
  if (result.outcome === 'inconclusive') return 'no clear winner';
  if (result.outcome === 'failed') return 'failed';
  return result.decision || 'complete';
}

function resultTone(outcome) {
  if (outcome === 'promoted' || outcome === 'first_champion') return 'promoted';
  if (outcome === 'failed' || outcome === 'blocked') return 'blocked';
  if (outcome === 'inconclusive') return 'inconclusive';
  return 'held';
}

function resultPolicyWinnerSide(result) {
  if (result.promotedSide === 'sideA' || result.promotedSide === 'sideB') return result.promotedSide;
  if (result.decision === 'keep_current' && result.competitionMode !== 'cold_start_duel') return 'sideB';
  if (result.outcome === 'promoted') return 'sideA';
  if (result.outcome === 'first_champion') return result.rawWinner === 'sideA' || result.rawWinner === 'sideB' ? result.rawWinner : null;
  if (result.outcome === 'kept') return result.competitionMode === 'cold_start_duel' ? null : 'sideB';
  return null;
}

function resultSideTone(side, policyWinner) {
  if (side !== 'sideA' && side !== 'sideB') return 'tie';
  if (!policyWinner) return 'tie';
  return side === policyWinner ? 'winner' : 'loser';
}

function resultIcon(outcome) {
  if (outcome === 'promoted' || outcome === 'first_champion') return Trophy;
  if (outcome === 'failed' || outcome === 'blocked') return AlertTriangle;
  if (outcome === 'inconclusive') return Scale;
  return Flag;
}

function criterionEdgeDelta(edge) {
  const value = Math.abs(edge.delta || 0).toFixed(Math.abs(edge.delta || 0) % 1 ? 1 : 0);
  return edge.leader === 'tie' ? 'Tie' : `+${value}`;
}

function criterionEdgePercent(edge) {
  const winnerScore = edge.leader === 'sideA' ? edge.avgA : edge.leader === 'sideB' ? edge.avgB : null;
  const loserScore = edge.leader === 'sideA' ? edge.avgB : edge.leader === 'sideB' ? edge.avgA : null;
  const percent = percentAdvantage(winnerScore, loserScore);
  return percent == null ? criterionEdgeDelta(edge) : `${percent}% better`;
}

/* ---------------- history ---------------- */

function HistoryCard({ summary, onOpenRun, onOpenAll }) {
  const traj = summary.history?.recentTrajectory || [];
  const total = summary.history?.trajectoryLength || traj.length;
  const offset = total - traj.length;
  if (traj.length === 0) {
    return <div className="card"><p className="card-label">History</p><p className="muted">No iterations yet.</p></div>;
  }
  const rows = traj.map((item, i) => ({ item, iterNum: offset + i + 1 })).reverse().slice(0, 4);
  return (
    <div className="card">
      <div className="card-head">
        <span className="card-label">History</span>
        <button className="btn sm ghost" onClick={onOpenAll}>Open <ArrowRight size={13} /></button>
      </div>
      {rows.map(({ item, iterNum }) => (
        <HistItem key={item.runId + iterNum} item={item} iterNum={iterNum} onOpen={onOpenRun} />
      ))}
    </div>
  );
}

function HistItem({ item, iterNum, onOpen }) {
  const promoted = item.decision === 'promote';
  return (
    <button className="hist-item clickable" onClick={() => onOpen && onOpen(item.runId)}>
      <span className="hist-ico">
        {promoted ? <ArrowUp size={17} style={{ color: 'var(--color-success)' }} />
          : item.decision === 'request_new_experiment' ? <RefreshCw size={16} style={{ color: 'var(--color-text-muted)' }} />
          : <Minus size={17} style={{ color: 'var(--color-text-muted)' }} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="hist-title">Iteration {iterNum} · {decisionLabel(item.decision)}{promoted ? ` v${iterNum}` : ''}</div>
        <div className="hist-sub">
          {item.parameterTested?.length ? cleanParam(item.parameterTested[0]) : 'no change'}
          {item.scoreDelta != null ? ` · ${signed(item.scoreDelta)}` : ''}
        </div>
      </div>
      <ChevronRight size={15} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
    </button>
  );
}

function HistoryScreen({ summary, onOpenRun }) {
  const traj = summary.history?.recentTrajectory || [];
  const total = summary.history?.trajectoryLength || traj.length;
  const offset = total - traj.length;
  const champ = summary.state.currentChampion;
  if (traj.length === 0) return <div className="empty">No history yet — start an iteration.</div>;
  const rows = traj.map((item, i) => ({ item, iterNum: offset + i + 1 })).reverse();
  const promotes = traj.filter(t => t.decision === 'promote').length;
  return (
    <div className="animate-slide-up">
      <h1 className="h-title">History</h1>
      <p className="goal">{total} iteration{total === 1 ? '' : 's'} · {promotes} promotion{promotes === 1 ? '' : 's'} · champion v{summary.state.runCount}{champ ? '' : ' (none yet)'}</p>
      <div className="hist-track">
        {rows.map(({ item, iterNum }) => {
          const promoted = item.decision === 'promote';
          const isChampion = champ && item.runId === champ.runId;
          return (
            <button className="hist-track-row" key={item.runId + iterNum} onClick={() => onOpenRun(item.runId)}>
              <span className="hist-rail">
                <span className={`hist-node ${promoted ? 'promoted' : ''}`}>
                  {promoted ? <ArrowUp size={15} /> : item.decision === 'request_new_experiment' ? <RefreshCw size={14} /> : <Minus size={15} />}
                </span>
              </span>
              <div className="hist-track-body">
                <div className="hist-track-head">
                  <span className="hist-track-title">Iteration {iterNum}</span>
                  <span className={`pill ${promoted ? 'success' : ''}`}>{decisionLabel(item.decision)}</span>
                  {isChampion && <span className="pill"><Trophy size={12} /> current champion</span>}
                  {item.scoreDelta != null && <span className="hist-delta">{signed(item.scoreDelta)}</span>}
                </div>
                <div className="hist-track-sub">{item.summary || `Tested ${item.parameterTested?.map(cleanParam).join(', ') || 'no change'}.`}</div>
                <div className="hist-track-meta">{item.parameterTested?.length ? `Tested: ${item.parameterTested.map(cleanParam).join(', ')}` : 'No surface changed'} · {shortRun(item.runId)}</div>
              </div>
              <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0, alignSelf: 'center' }} />
            </button>
          );
        })}
      </div>
      {total > traj.length && <p className="hint">Showing the {traj.length} most recent of {total} iterations.</p>}
    </div>
  );
}

/* ---------------- secondary row: prompt bank + timeline ---------------- */

function SecondaryRow({ summary, runDetail }) {
  const pb = summary.promptBank;
  const timeline = runDetail?.timeline || [];
  if (!pb && timeline.length === 0) return null;
  return (
    <div className="grid two secondary-grid">
      {pb && (
        <div className="card">
          <p className="card-label">Prompt bank</p>
          <dl className="kv">
            <dt>Stable prompts</dt><dd>{pb.stablePromptCount}</dd>
            <dt>Provisional</dt><dd>{pb.provisionalPromptCount}</dd>
            <dt>Exploration</dt><dd>{pb.explorationPromptCount}</dd>
            <dt>Retired</dt><dd>{pb.retiredPromptCount}</dd>
            <dt>Evidence records</dt><dd>{pb.evidenceRecordCount}</dd>
            <dt>Criteria versions</dt><dd>{pb.criteriaVersionCount}</dd>
          </dl>
        </div>
      )}
      {timeline.length > 0 && (
        <div className="card">
          <details className="disclosure" open style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
            <summary style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              <Flag size={14} /> Run timeline · {timeline.length} steps
            </summary>
            <div className="timeline" style={{ marginTop: 12 }}>
              {timeline.map((entry, i) => (
                <div className="tl-item" key={i}>
                  <span className="tl-dot" />
                  <div>
                    <div className="tl-title">{formatEvent(entry.event)}</div>
                    <div className="tl-meta">{fmtTime(entry.timestamp)}</div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

/* ---------------- evidence (SkillEval-style) ---------------- */

function Evidence({ runDetail, comparison, openEval, setOpenEval, evTab, setEvTab, onViewSkill, iterLabel, onOpenImage }) {
  const mode = comparison?.competitionMode || runDetail?.experimentPlan?.competitionMode || 'cold_start_duel';
  const duel = mode === 'cold_start_duel' ? runDetail?.evals?.candidateDuel : runDetail?.evals?.challenge;
  if (!duel) return <div className="empty">No evaluation was recorded for this run.</div>;

  const stats = duel.stats;
  const labels = mode === 'cold_start_duel'
    ? { a: 'Candidate A', b: 'Candidate B', aSource: 'candidate-a', bSource: 'candidate-b' }
    : { a: 'Challenger', b: 'Champion', aSource: 'challenger', bSource: 'champion' };
  const aStrat = mode === 'cold_start_duel' ? comparison?.sides?.candidateA?.strategy : comparison?.sides?.challenger?.strategy;
  const bStrat = mode === 'cold_start_duel' ? comparison?.sides?.candidateB?.strategy : comparison?.sides?.champion?.strategy;
  const criteria = (duel.criteria || []).filter(c => !c.id.startsWith('parameter_'));
  const evals = duel.evaluations || [];

  return (
    <>
      {iterLabel && <div className="eyebrow" style={{ marginBottom: 10 }}>{iterLabel} · evidence</div>}
      <div className="ev-cands">
        <div className="ev-cand">
          <div className="ev-cand-head">
            <span className="ev-cand-name"><span className="dot" style={{ background: 'var(--color-skill-a)' }} /> {labels.a}</span>
            <button className="btn sm" onClick={() => onViewSkill(labels.aSource)}><FileText size={13} /> View skill</button>
          </div>
          {aStrat && <div className="ev-cand-strat">{aStrat}</div>}
        </div>
        <div className="ev-cand">
          <div className="ev-cand-head">
            <span className="ev-cand-name"><span className="dot" style={{ background: 'var(--color-skill-b)' }} /> {labels.b}</span>
            <button className="btn sm" onClick={() => onViewSkill(labels.bSource)}><FileText size={13} /> View skill</button>
          </div>
          {bStrat && <div className="ev-cand-strat">{bStrat}</div>}
        </div>
      </div>

      <div className="rtabs">
        <button className={`rtab ${evTab === 'summary' ? 'active' : ''}`} onClick={() => setEvTab('summary')}>Summary</button>
        <button className={`rtab ${evTab === 'criteria' ? 'active' : ''}`} onClick={() => setEvTab('criteria')}>Detailed breakdown</button>
        <button className={`rtab ${evTab === 'prompts' ? 'active' : ''}`} onClick={() => setEvTab('prompts')}>Prompts</button>
      </div>

      {evTab === 'summary' && <SummaryTab stats={stats} evals={evals} labels={labels} />}
      {evTab === 'criteria' && <CriteriaTab criteria={criteria} evals={evals} labels={labels} />}
      {evTab === 'prompts' && (
        <div className="card" style={{ padding: '8px 16px' }}>
          {evals.map(ev => (
            <PromptRow key={ev.id} ev={ev} criteria={criteria} labels={labels}
              open={openEval === ev.id}
              onToggle={() => setOpenEval(openEval === ev.id ? null : ev.id)}
              onOpenImage={onOpenImage} />
          ))}
        </div>
      )}
    </>
  );
}

function SummaryTab({ stats, evals, labels = { a: 'Candidate A', b: 'Candidate B' } }) {
  return (
    <div className="card animate-slide-up">
      <div className="stat-row">
        <div className={`stat ${stats.skillAWins > stats.skillBWins ? 'a-win' : ''}`}>
          <span className="num">{stats.skillAWins}</span><div className="lab">{labels.a} wins</div>
        </div>
        <div className={`stat ${stats.skillBWins > stats.skillAWins ? 'b-win' : ''}`}>
          <span className="num">{stats.skillBWins}</span><div className="lab">{labels.b} wins</div>
        </div>
        <div className="stat"><span className="num">{stats.ties}</span><div className="lab">Ties</div></div>
      </div>
      <table className="etable">
        <thead><tr>
          <th style={{ width: 32 }}>#</th><th>Prompt</th>
          <th className="r">{labels.a} score</th><th className="r">{labels.b} score</th><th className="c">Winner</th>
        </tr></thead>
        <tbody>
          {evals.map(ev => {
            const w = ev.judge?.winner;
            return (
              <tr key={ev.id}>
                <td style={{ color: 'var(--color-text-muted)' }}>{ev.id}</td>
                <td className="prompt-cell">{promptGist(ev.prompt?.text)}</td>
                <td className={`r ${w === 'skillA' ? 'win-a' : ''}`}>{ev.judge?.scoreA}</td>
                <td className={`r ${w === 'skillB' ? 'win-b' : ''}`}>{ev.judge?.scoreB}</td>
                <td className="c">{w === 'skillA' ? <span className="lead-a">{labels.a}</span> : w === 'skillB' ? <span className="lead-b">{labels.b}</span> : <span className="lead-tie">tie</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CriteriaTab({ criteria, evals, labels = { a: 'A', b: 'B' } }) {
  const rows = criteria.map(c => {
    let aw = 0, bw = 0, t = 0, sa = 0, sb = 0, n = 0;
    for (const ev of evals) {
      const a = ev.judge?.breakdown?.skillA?.[c.id];
      const b = ev.judge?.breakdown?.skillB?.[c.id];
      if (a == null || b == null) continue;
      n++; sa += a; sb += b;
      if (a > b) aw++; else if (b > a) bw++; else t++;
    }
    return { id: c.id, name: c.name, aw, bw, t, avgA: n ? sa / n : 0, avgB: n ? sb / n : 0 };
  });
  return (
    <div className="card animate-slide-up">
      <p className="card-label">Per-criterion summary</p>
      <table className="etable">
        <thead><tr>
          <th>Criterion</th><th className="c">{labels.a} wins</th><th className="c">{labels.b} wins</th><th className="c">Ties</th>
          <th className="r">Avg {labels.a}</th><th className="r">Avg {labels.b}</th><th className="c">Leader</th>
        </tr></thead>
        <tbody>
          {rows.map(r => {
            const leader = r.avgB > r.avgA ? 'b' : r.avgA > r.avgB ? 'a' : 'tie';
            return (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="c a">{r.aw}</td>
                <td className="c b">{r.bw}</td>
                <td className="c" style={{ color: 'var(--color-text-muted)' }}>{r.t}</td>
                <td className="r">{r.avgA.toFixed(1)}/5</td>
                <td className="r">{r.avgB.toFixed(1)}/5</td>
                <td className="c">{leader === 'a' ? <span className="lead-a">{labels.a}</span> : leader === 'b' ? <span className="lead-b">{labels.b}</span> : <span className="lead-tie">–</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PromptRow({ ev, criteria, labels = { a: 'Candidate A', b: 'Candidate B' }, open, onToggle, onOpenImage }) {
  const w = ev.judge?.winner;
  const winClass = w === 'skillA' ? 'a' : w === 'skillB' ? 'b' : '';
  const winLabel = w === 'skillA' ? labels.a : w === 'skillB' ? labels.b : 'tie';
  const out = outputs(ev);
  const visual = visualOutputs(ev);
  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <button className="row-click prompt-row" onClick={onToggle}>
        <span className="prompt-row-text">{promptGist(ev.prompt?.text)}</span>
        <span className="prompt-row-scores">{labels.a} {ev.judge?.scoreA} · {labels.b} {ev.judge?.scoreB}</span>
        <span className={`pill ${winClass}`} style={{ justifyContent: 'center' }}>{winLabel}</span>
        {open ? <ChevronUp size={15} style={{ color: 'var(--color-text-secondary)' }} /> : <ChevronDown size={15} style={{ color: 'var(--color-text-muted)' }} />}
      </button>
      {open && (
        <div className="ev-detail">
          <div className="full-prompt">{ev.prompt?.text || 'Prompt text was not recorded.'}</div>
          <p className="ev-reason">{ev.judge?.reasoning || 'No judge rationale recorded.'}</p>
          {criteria.length > 0 && <CriterionScoreTable criteria={criteria} ev={ev} labels={labels} />}
          {visual && (
            <div className="visual-grid">
              <VisualOutput label={labels.a} render={visual.a} side="a" onOpenImage={onOpenImage} />
              <VisualOutput label={labels.b} render={visual.b} side="b" onOpenImage={onOpenImage} />
            </div>
          )}
          {(out.a || out.b) && (
            <div className="outputs">
              <div className="output-col a"><h5>{labels.a} output</h5><pre className="output-pre">{out.a || '—'}</pre></div>
              <div className="output-col b"><h5>{labels.b} output</h5><pre className="output-pre">{out.b || '—'}</pre></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CriterionScoreTable({ criteria, ev, labels }) {
  return (
    <div className="crit-table-wrap">
      <table className="crit-table">
        <thead>
          <tr>
            <th>Criterion</th>
            <th>{labels.a}</th>
            <th>{labels.b}</th>
            <th>Edge</th>
          </tr>
        </thead>
        <tbody>
          {criteria.map(c => {
            const a = ev.judge?.breakdown?.skillA?.[c.id];
            const b = ev.judge?.breakdown?.skillB?.[c.id];
            const edge = scoreEdge(a, b, labels);
            return (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className={edge.side === 'a' ? 'win-a' : ''}>{formatScore(a)}</td>
                <td className={edge.side === 'b' ? 'win-b' : ''}>{formatScore(b)}</td>
                <td className={`edge ${edge.side}`}>{edge.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatScore(value) {
  return value == null ? '–' : value;
}

function scoreEdge(a, b, labels) {
  if (a == null || b == null) return { side: '', label: 'n/a' };
  if (a > b) return { side: 'a', label: `${labels.a} +${a - b}` };
  if (b > a) return { side: 'b', label: `${labels.b} +${b - a}` };
  return { side: 'tie', label: 'Tie' };
}

function VisualOutput({ label, render, side, onOpenImage }) {
  if (!render) return null;
  const shots = render.screenshots || [];
  const failed = render.status === 'failed' || render.blankScreenDetected;
  return (
    <div className={`visual-output ${side}`}>
      <div className="visual-head">
        <h5>{label} render</h5>
        <span className={`pill ${failed ? 'warning' : 'success'}`}>{failed ? 'render issue' : 'rendered'}</span>
      </div>
      {render.error?.message && <p className="visual-error">{render.error.message}</p>}
      {shots.length > 0 ? (
        <div className="visual-shots">
          {shots.map(shot => (
            <figure className="visual-shot" key={`${shot.viewport}-${shot.path}`}>
              <button type="button" className="visual-shot-button" onClick={() => onOpenImage?.({ label, shot, failed })}>
                <img src={artifactUrl(shot.path)} alt={`${label} ${shot.viewport} render`} loading="lazy" />
              </button>
              <figcaption>{shot.viewport} · {shot.width}×{shot.height}{shot.blank ? ' · blank flagged' : ''}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="empty sm">No screenshot artifact recorded.</div>
      )}
    </div>
  );
}

function ImageLightbox({ image, onClose }) {
  const { label, shot, failed } = image;
  const url = artifactUrl(shot.path);
  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${label} ${shot.viewport} render`}>
      <button type="button" className="lightbox-backdrop" aria-label="Close image viewer" onClick={onClose} />
      <div className="lightbox-panel">
        <div className="lightbox-head">
          <div>
            <div className="lightbox-title">{label} render</div>
            <div className="lightbox-meta">
              {shot.viewport} · {shot.width}×{shot.height}
              {shot.blank ? ' · blank flagged' : ''}
              {failed ? ' · render issue' : ''}
            </div>
          </div>
          <div className="lightbox-actions">
            <a className="btn sm" href={url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open image</a>
            <button type="button" className="icon-btn" aria-label="Close image viewer" onClick={onClose}><X size={17} /></button>
          </div>
        </div>
        <img className="lightbox-image" src={url} alt={`${label} ${shot.viewport} render`} />
      </div>
    </div>
  );
}

/* ---------------- skill viewer ---------------- */

function SkillViewer({ source, data, compareData, loading, activeFile, setActiveFile, onViewSkill, strategies, summary, onExportChampion }) {
  const [exportState, setExportState] = useState({ busy: false, message: '', error: '' });
  const files = data?.files || [];
  const file = files[activeFile] || files[0] || null;
  const mode = strategies?.competitionMode || 'cold_start_duel';
  const tabs = mode === 'cold_start_duel'
    ? [['champion', 'Champion'], ['candidate-a', 'Candidate A'], ['candidate-b', 'Candidate B'], ['compare', 'Compare A · B']]
    : [['champion', 'Champion'], ['challenger', 'Challenger'], ['compare', 'Compare']];
  const champion = summary?.state?.currentChampion || null;
  const canExportChampion = source === 'champion' && data?.available && onExportChampion;
  async function downloadChampion() {
    if (!canExportChampion || exportState.busy) return;
    setExportState({ busy: true, message: '', error: '' });
    try {
      const result = await onExportChampion(`exports/${summary.projectId}-champion`);
      setExportState({
        busy: false,
        message: `Saved ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} to ${result.outDir}.`,
        error: '',
      });
    } catch (err) {
      setExportState({ busy: false, message: '', error: err.message });
    }
  }
  return (
    <div className="animate-slide-up">
      <div className="skill-view-head">
        <div className="seg">
          {tabs.map(([key, label]) => (
            <button key={key} className={source === key ? 'active' : ''} onClick={() => onViewSkill(key)}>{label}</button>
          ))}
        </div>
        <div className="skill-view-actions">
          {canExportChampion && (
            <button className="btn primary" onClick={downloadChampion} disabled={exportState.busy}>
              {exportState.busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
              Download champion
            </button>
          )}
        </div>
      </div>
      {(exportState.message || exportState.error) && (
        <div className={`export-note ${exportState.error ? 'error' : 'success'} skill-export-note`}>
          {exportState.error || exportState.message}
        </div>
      )}

      {source === 'compare' ? (
        <SkillCompare compareData={compareData} loading={loading} strategies={strategies} />
      ) : loading ? (
        <div className="empty">Loading skill…</div>
      ) : data && data.error ? (
        <div className="empty">
          Couldn’t load this skill: {data.error}.
          <div style={{ marginTop: 10, fontSize: 13, color: 'var(--color-text-muted)' }}>
            If you recently updated the app, restart the server (<span className="mono">node src/server.js</span>) so the skill endpoint is available, then try again.
          </div>
        </div>
      ) : !data || data.available === false ? (
        <div className="empty">This skill package isn’t available{source !== 'champion' ? ' for this run' : ''}.</div>
      ) : (
        <>
          {source === 'champion' && (
            <div className="skill-meta-card">
              <dl className="kv">
                <dt>Promoted in</dt><dd>{shortRun(champion?.runId || data.runId)}</dd>
                <dt>Files</dt><dd>{files.length}</dd>
                {data.packageType && <><dt>Package</dt><dd>{data.packageType}</dd></>}
                {data.entrypoint && <><dt>Entrypoint</dt><dd>{data.entrypoint}</dd></>}
                <dt>Fingerprint</dt><dd className="mono">{(data.hash || champion?.skillHash || '').slice(0, 12) || '–'}</dd>
                <dt>Updated</dt><dd>{fmtTime(summary?.state?.updatedAt)}</dd>
              </dl>
            </div>
          )}
          {data.validation && (
            <span className={`pill ${data.validation.valid ? 'success' : 'warning'}`}>
              {data.validation.valid ? <Check size={13} /> : <Flag size={13} />}
              {data.validation.valid ? 'Valid Agent Skill' : `${data.validation.errors.length} issue(s)`}
            </span>
          )}
          {files.length > 1 && (
            <div className="file-tabs">
              {files.map((f, i) => (
                <button key={f.path} className={`file-tab ${i === activeFile ? 'active' : ''}`} onClick={() => setActiveFile(i)}>
                  <FileText size={13} /> {f.path}
                </button>
              ))}
            </div>
          )}
          <pre className="skill-pre">{file?.text || 'No readable content.'}</pre>
        </>
      )}
    </div>
  );
}

function SkillCompare({ compareData, loading, strategies }) {
  const mode = strategies?.competitionMode || 'cold_start_duel';
  const labels = mode === 'cold_start_duel'
    ? { a: 'Candidate A', b: 'Candidate B' }
    : { a: 'Champion', b: 'Challenger' };
  if (loading) return <div className="empty">Loading comparison…</div>;
  if (!compareData) return <div className="empty">Comparison isn’t available for this run.</div>;
  const { a, b } = compareData;
  if (!a?.available || !b?.available) {
    return <div className="empty">Both skill packages are needed to compare; one isn’t available for this run.</div>;
  }
  const aSkill = (a.files.find(f => f.path === 'SKILL.md') || a.files[0])?.text || '';
  const bSkill = (b.files.find(f => f.path === 'SKILL.md') || b.files[0])?.text || '';
  const diff = lineDiff(aSkill, bSkill);
  const adds = diff.filter(d => d.type === 'add').length;
  const removes = diff.filter(d => d.type === 'remove').length;
  return (
    <>
      <div className="diff-summary">
        <div className="diff-side">
          <div className="diff-side-name"><span className="dot" style={{ background: 'var(--color-skill-a)' }} /> {labels.a}</div>
          {strategies?.a && <div className="diff-side-strat">{strategies.a}</div>}
          {strategies?.aParams?.length > 0 && <div className="diff-side-meta">changed: {strategies.aParams.map(cleanParam).join(', ')}</div>}
        </div>
        <div className="diff-side">
          <div className="diff-side-name"><span className="dot" style={{ background: 'var(--color-skill-b)' }} /> {labels.b}</div>
          {strategies?.b && <div className="diff-side-strat">{strategies.b}</div>}
          {strategies?.bParams?.length > 0 && <div className="diff-side-meta">changed: {strategies.bParams.map(cleanParam).join(', ')}</div>}
        </div>
      </div>
      <div className="hint" style={{ marginTop: 0, marginBottom: 10 }}>
        SKILL.md diff — <span style={{ color: 'var(--color-skill-b)' }}>{adds} line(s) only in {labels.b}</span>, <span style={{ color: 'var(--color-skill-a)' }}>{removes} only in {labels.a}</span>; shared lines are neutral.
      </div>
      <pre className="skill-pre diff-pre">{diff.map((d, i) => (
        <div className={`diff-line ${d.type}`} key={i}>
          <span className="diff-mark">{d.type === 'add' ? '+' : d.type === 'remove' ? '−' : ' '}</span>{d.text || ' '}
        </div>
      ))}</pre>
    </>
  );
}

// Minimal LCS line diff between two texts. type: same | add (only in B) | remove (only in A).
function lineDiff(aText, bText) {
  const A = aText.split('\n');
  const B = bText.split('\n');
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

/* ---------------- helpers ---------------- */

function formatName(id) {
  return String(id || 'Skill')
    .replace(/-\d{6,}$/, '')
    .split('-').filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
function decisionLabel(d) {
  return { promote: 'promoted', keep_current: 'kept', edit_current: 'edited', request_new_experiment: 'inconclusive' }[d]
    || String(d || '').replace(/_/g, ' ');
}
function formatCompact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${Math.round(number / 1000)}K`;
  return `${number}`;
}
function recencyTs(project) {
  const t = Date.parse(project?.state?.updatedAt || '');
  return Number.isNaN(t) ? 0 : t;
}
function iterationLabel(summary, runId) {
  const traj = summary.history?.recentTrajectory || [];
  const total = summary.history?.trajectoryLength || traj.length;
  const offset = total - traj.length;
  const idx = traj.findIndex(t => t.runId === runId);
  return idx >= 0 ? `Iteration ${offset + idx + 1}` : 'Latest run';
}
function shortRun(runId) {
  if (!runId) return '–';
  const m = String(runId).match(/run-\d+$/);
  return m ? m[0] : String(runId);
}
function cleanParam(p) { return String(p || '').replace(/^p\d+-/, '').replace(/_/g, ' '); }
function signed(v) { return v > 0 ? `+${v}` : String(v); }
function fmtTime(v) {
  if (!v) return '–';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v)
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function fmtElapsed(s) { const m = Math.floor(s / 60), r = s % 60; return `${m}m ${String(r).padStart(2, '0')}s`; }
function stepTime(s) { const m = Math.floor(s / 60), r = s % 60; return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; }
function formatEvent(e) {
  return String(e || '').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function promptGist(text) {
  if (!text) return 'Prompt';
  const taskLine = String(text).split('\n').find(l => l.trim().toLowerCase().startsWith('task:'));
  if (taskLine) {
    const t = taskLine.replace(/task:\s*/i, '').trim().replace(/\.$/, '');
    return t.charAt(0).toUpperCase() + t.slice(1) + '.';
  }
  return String(text).split('\n')[0];
}
function outputs(ev) {
  const vals = Object.values(ev.results || {});
  const a = vals.find(v => v.sourceSkill === 'skillA');
  const b = vals.find(v => v.sourceSkill === 'skillB');
  return { a: a?.content || '', b: b?.content || '' };
}
function visualOutputs(ev) {
  const vals = Object.values(ev.results || {});
  const a = vals.find(v => v.sourceSkill === 'skillA')?.visual || ev.visual?.skillA || null;
  const b = vals.find(v => v.sourceSkill === 'skillB')?.visual || ev.visual?.skillB || null;
  return a || b ? { a, b } : null;
}
