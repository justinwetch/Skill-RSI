# Skill RSI Diagram Manifest

The canonical diagram set is Mermaid-native and square-only. Editable `.mmd` sources live in `docs/assets/diagrams/mermaid`; rendered SVG and `2400x2400` PNG exports live in `docs/assets/diagrams/mermaid-svg` and `docs/assets/diagrams/mermaid-png`.

Run:

```bash
npm run render:mermaid-diagrams
```

The earlier HTML/CSS card-style exports remain in `docs/assets/diagrams/png` for comparison, but they are not the preferred diagram set.

| Diagram | Intended use | Source | Square export | Recommended placement |
| --- | --- | --- | --- | --- |
| The core loop | Explain the full Skill RSI loop in one frame. | `mermaid/core-loop.mmd` | `mermaid-png/core-loop.png` | README How It Works anchor; blog/social overview |
| Ontology map | Show what the ontology contains and why it prevents drift. | `mermaid/ontology-map.mmd` | `mermaid-png/ontology-map.png` | README intro after the ontology paragraph; social explainer |
| Deconstruction map | Explain how the current champion becomes a parameter map. | `mermaid/deconstruction-map.mmd` | `mermaid-png/deconstruction-map.png` | docs/HOW_IT_WORKS deconstruction section; technical social post |
| Control vs treatment | Make the experiment design immediately legible. | `mermaid/control-treatment.mmd` | `mermaid-png/control-treatment.png` | README controlled-experiment explanation; social carousel |
| Cold-start duel | Explain the one case where Skill RSI generates two candidates. | `mermaid/cold-start-duel.mmd` | `mermaid-png/cold-start-duel.png` | README How It Works scratch-run section |
| Experiment plan | Show the shape of a well-formed loop premise. | `mermaid/experiment-plan.mmd` | `mermaid-png/experiment-plan.png` | README next-loop plan or UI walkthrough |
| Preflight review gate | Explain why broken or drifting candidates stop cleanly. | `mermaid/preflight-review.mmd` | `mermaid-png/preflight-review.png` | docs/HOW_IT_WORKS preflight review section |
| Prompt-level evidence stack | Show that decisions are traceable, not just summary scores. | `mermaid/prompt-evidence-stack.mmd` | `mermaid-png/prompt-evidence-stack.png` | README Evidence-Backed Decisions section |
| Promotion policy gate | Explain score thresholds, regression protection, and analyst recommendation. | `mermaid/promotion-policy.mmd` | `mermaid-png/promotion-policy.png` | docs/HOW_IT_WORKS promotion section; social technical post |
| History as memory | Show why the loop compounds rather than resets. | `mermaid/history-memory.mmd` | `mermaid-png/history-memory.png` | README history screenshot section; social proof post |
| Artifact contract | Explain text, code, and code + visuals modes. | `mermaid/artifact-contract.mmd` | `mermaid-png/artifact-contract.png` | docs/HOW_IT_WORKS project inputs/output artifact section |
| Operator surfaces | Orient users across the product surfaces. | `mermaid/operator-surfaces.mmd` | `mermaid-png/operator-surfaces.png` | README Codex Plugin and Local UI sections |
