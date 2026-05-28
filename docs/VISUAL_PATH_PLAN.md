# Skill RSI Visual Path Implementation Plan

## Summary

Add a visual evaluation path for Skill RSI by extending the existing task-contract, evaluator, prompt-bank, and run-artifact architecture. The first supported visual mode should be `code_visual_standalone`: the skill must produce a complete, self-contained browser-renderable artifact, Skill RSI renders it with Playwright, captures canonical screenshots and runtime diagnostics, then judges both the code and rendered result.

This is not a separate SkillEval clone inside Skill RSI. The clean implementation is an internal visual runner that plugs into the current champion-vs-challenger loop.

## Product Decision

Enable **Code + visuals** as the first visual path.

Keep **Visuals only** disabled. Visual-only outputs are not yet a coherent Agent Skill contract in this product because there is no image-generation/rendering artifact standard, no deterministic renderer, and no obvious promotion gate that is comparable to text/code skill outputs.

The UI should continue to expose only output artifact choices:

- Text
- Code
- Code + visuals
- Visuals only, disabled

Do not expose task-environment language. Backend task contracts remain internal guardrails.

## Contract

Add an internal task contract:

```json
{
  "id": "code_visual_standalone",
  "artifactType": "code",
  "environment": "standalone",
  "outputType": "code_visual",
  "expectedArtifact": "A complete self-contained browser-renderable implementation with visible UI.",
  "requiredPromptContext": [
    "implementation goal",
    "screen or component context",
    "visual/interaction expectations"
  ],
  "insufficientContextBehavior": "State minimal assumptions and produce a concrete standalone browser implementation.",
  "invalidPromptRules": [
    "Must not require hidden repo files.",
    "Must not ask for design recommendations only.",
    "Must request a renderable implementation, not a conceptual direction.",
    "Must be satisfiable as a single standalone HTML/CSS/JS artifact for v1."
  ]
}
```

The v1 artifact format should be strict: a single HTML document with inline CSS and JavaScript. That gives the renderer one reliable entrypoint and avoids pretending the evaluator can install arbitrary app dependencies safely.

Later, package-based React/Vite/Next rendering can be added as a separate contract after the single-file path is reliable.

## Architecture

### 1. Task Contracts

Update `src/lib/task-contracts.js`:

- Add `code_visual_standalone` to `TASK_CONTRACT_IDS`.
- Derive it from `outputType: "code_visual"`.
- Keep `codebase_edit` internal-only.
- Extend `isPromptContractValid` so `code_visual_standalone` rejects prompts asking for recommendations, moodboards, wireframe advice, hidden repo changes, or non-renderable output.

Contract-valid prompt examples:

- "Build a self-contained landing page in one HTML file for..."
- "Create a complete browser-renderable pricing component with inline CSS and JS..."
- "Implement an interactive dashboard mockup as standalone HTML..."

Invalid examples:

- "Recommend a visual direction..."
- "Tell me how to redesign..."
- "Update the existing app..."
- "Ask me for files..."

### 2. Prompt Generation

Update `src/lib/eval-design.js`:

- Make `code_visual_standalone` prompts explicitly request complete renderable code.
- Add contract-specific criteria:
  - `renderability`
  - `visual_hierarchy`
  - `layout_responsiveness`
  - `interaction_quality`
- Keep `artifact_completeness` and `contract_validity`.
- In strict real-eval mode, fail if model-authored prompts remain invalid after one repair. Do not fall back to deterministic prompts for real eval.

The prompt bank should store visual prompts with the same provenance fields as text/code prompts, plus `contractId: "code_visual_standalone"`.

### 3. Visual Runner

Add `src/lib/visual-runner.js`.

Responsibilities:

- Accept generated output content and an artifact id.
- Extract or normalize a single HTML document.
- Write it to a temporary per-run render directory.
- Launch Playwright Chromium.
- Render at canonical viewports:
  - `desktop`: 1440 x 1000
  - `tablet`: 834 x 1112
  - `mobile`: 390 x 844
- Capture screenshots.
- Capture console errors, page errors, request failures, and basic timing.
- Return a structured render result.

Persist artifacts under each run:

```text
runs/<run-id>/eval/visual/
  prompt-001/
    skillA/
      artifact.html
      render.json
      desktop.png
      tablet.png
      mobile.png
    skillB/
      artifact.html
      render.json
      desktop.png
      tablet.png
      mobile.png
```

The eval JSON preserves which side is champion/challenger or Candidate A/B. The visual runner itself stays generic and stores side artifacts as `skillA` and `skillB`.

`render.json` should include:

- status: `complete | warning | failed`
- artifact path
- screenshot paths
- viewport metadata
- console errors
- page errors
- request failures
- elapsed milliseconds
- blank-screen heuristic result

### 4. Evaluator Integration

Update `src/lib/evaluator.js`:

- Keep text/code generation exactly as it is for non-visual contracts.
- For `code_visual_standalone`, after each side generates output:
  - Render champion output.
  - Render challenger output.
  - If either render fails, mark render failure explicitly.
  - Send text output plus screenshot references to the judge.
- Store render artifacts on each per-prompt evaluation.

Promotion policy:

- A challenger with render failures cannot be promoted over a rendering champion.
- If both fail rendering, the round is invalid/inconclusive, not a promotion.
- If champion fails but challenger renders, challenger may promote only if code and visual judge scores clear normal thresholds.
- Visual score should be primary for visual criteria, but code completeness still matters.

### 5. Model Client

Update `src/lib/model-client.js` only as needed to support multimodal judging.

The judge request for visual runs should include:

- The original eval prompt.
- Task contract summary.
- The generated code from both sides.
- Screenshot images for matching viewports from both sides.
- Render diagnostics for both sides.
- Existing criteria plus visual criteria.

Use structured output for judge results where possible. If the selected provider/model cannot accept image inputs, visual eval should fail clearly before the run starts rather than silently falling back to text-only judging.

### 6. Analyst And History

Update analyst inputs so visual runs distinguish:

- prompt quality
- generation quality
- render success/failure
- visual quality
- code completeness
- responsive behavior
- interaction behavior

History should record:

- visual contract id
- render failure count
- screenshot artifact paths
- winning side by viewport when available
- whether promotion was blocked by rendering
- next-loop visual guidance

The "Next Loop Plan" UI should be able to say things like:

- "Improve mobile layout density while preserving desktop hierarchy."
- "Fix render failures before testing visual polish."
- "Challenger looked stronger on desktop but regressed mobile navigation."

### 7. UI

Update `ui/src/App.jsx`:

- Enable Code + visuals.
- Persist `outputType: "code_visual"` from the UI.
- Show run bar label as `code + visuals output`.
- In run detail, show visual eval artifacts when present:
  - Champion screenshots
  - Challenger screenshots
  - viewport tabs or segmented control
  - render diagnostics in progressive disclosure
- Keep the primary UI simple: next loop plan, run status, champion/challenger outcome, detailed data.

Do not expose backend contract names in user-facing UI.

### 8. Dependencies

Add Playwright as the visual rendering dependency.

The implementation should decide between:

- `playwright`, if using the library directly from Skill RSI.
- `@playwright/test`, only if tests also rely on Playwright assertions.

Prefer `playwright` for the runtime runner and keep tests using Node's test runner unless there is a clear need for Playwright's test harness.

Install browser binaries as part of setup or doctor flow. Add a clear diagnostic if Chromium is missing.

## Implementation Order

### Phase 1: Contract And Prompt Correctness

- Add `code_visual_standalone`.
- Enable `outputType: "code_visual"` through config and UI creation.
- Update prompt generation and validation.
- Add tests that prove visual prompts request renderable implementation, not advice.
- Add early capability checks so visual mode cannot be selected or run without a local browser renderer.

Acceptance:

- Code + visuals can be selected in UI.
- Prompt bank for visual projects contains only renderable-code tasks.
- If no local renderer is available, the UI shows install guidance before project creation and real eval fails before model calls.

### Phase 2: Playwright Visual Runner

- Add `visual-runner.js`.
- Render a single HTML artifact at canonical viewports.
- Persist screenshots and diagnostics.
- Add unit tests for artifact extraction, render success, render failure, and blank output detection.

Acceptance:

- A known good HTML artifact produces three screenshots.
- Broken HTML/runtime JS produces structured render failure.
- Blank or near-blank output is flagged.

### Phase 3: Evaluator And Judge Wiring

- Integrate visual rendering into `runHeadlessEval`.
- Add multimodal judge support.
- Persist visual artifacts in eval output.
- Block challenger promotion when the challenger has render failures.

Acceptance:

- Champion-vs-challenger visual eval produces screenshots for both sides.
- Judge receives images and structured render diagnostics.
- Promotion cannot happen when the challenger fails to render.

### Phase 4: Analyst, History, And UI Evidence

- Feed visual results to analyst.
- Extend history summaries.
- Render screenshots and diagnostics in the UI.
- Make "Next Loop Plan" reflect visual evidence.

Acceptance:

- User can inspect what each visual loop rendered.
- Analyst guidance references actual visual evidence.
- History remains readable without opening raw JSON.

### Phase 5: Full Run Hardening

- Run end-to-end visual projects with real models.
- Audit prompt validity, render artifacts, judge scoring, promotion behavior, and UI clarity.
- Add docs for setup, limitations, and troubleshooting.

Acceptance:

- A real Code + visuals project can complete at least two loops.
- Second loop generates one challenger against champion.
- Artifacts are inspectable from the UI.
- Failures are explicit and non-promoting.

## Test Plan

Unit tests:

- `normalizeTaskContract(null, "code_visual")` returns `code_visual_standalone`.
- Visual prompt validation rejects recommendation-only prompts.
- Visual prompt validation rejects hidden-codebase prompts.
- Visual prompt validation accepts standalone HTML implementation prompts.
- Visual criteria include renderability and visual quality dimensions.
- Visual runner captures screenshots for valid HTML.
- Visual runner records diagnostics for render/runtime failures.
- Promotion policy blocks rendering regressions.

Integration tests:

- UI-created Code + visuals project persists `outputType: "code_visual"` and internal `code_visual_standalone`.
- Real prompt authoring for visual projects produces renderable-code requests.
- Visual eval stores screenshots and `render.json`.
- Judge payload includes screenshots and task contract.
- Run history records visual artifacts and render outcomes.

Browser smoke:

- Code + visuals is selectable.
- Run detail shows screenshot comparison after eval.
- Detailed Data exposes render diagnostics without cluttering the main loop view.

## Non-Goals For First Release

- Existing-codebase visual edits.
- Arbitrary npm install/build for generated projects.
- Next.js/Vite/React package rendering.
- Visual-only image generation.
- Pixel-perfect snapshot regression testing as the primary judge.
- Human approval as a required promotion step.

## Risks And Mitigations

- **Model returns prose instead of HTML.** Mitigate with contract validation, artifact extraction, and render failure blocking promotion.
- **Generated code depends on unavailable libraries.** V1 requires single-file HTML/CSS/JS. External CDN use should be either forbidden or tightly controlled.
- **Screenshots are blank but no exception occurs.** Add blank-screen heuristics and screenshot size checks.
- **Visual judge overweights aesthetics.** Keep contract criteria explicit: renderability, completeness, hierarchy, responsiveness, interaction, accessibility.
- **Cost increases.** Visual mode should use small prompt batches during testing and record per-run timing/model metadata.
- **UI becomes too busy.** Keep screenshots inside Detailed Data and show only summary evidence in the main loop.

## Open Questions

- Should external fonts/CDNs be allowed in generated standalone HTML, or should v1 require fully local browser-native assets?
- Should visual scoring use three fixed viewports every time, or let project config choose viewports?
- Should accessibility checks include an automated axe-like pass in addition to visual judging?
- Should generated HTML be sandboxed more aggressively than local file rendering before executing JavaScript?
