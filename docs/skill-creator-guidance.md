# Skill Creator Guidance

Distilled from the open `skill-creator` skill. Skill RSI feeds this to candidate
creator agents as authoring guidance. The Agent Skills standard remains the hard
conformance boundary; this document guides quality and packaging decisions.

## Core principles

- Keep `SKILL.md` concise. Assume the agent is capable; include only knowledge,
  procedures, constraints, and examples that materially improve behavior.
- Match specificity to fragility. Use flexible instructions when many good
  approaches exist, pseudocode or structured checklists when consistency matters,
  and scripts when deterministic behavior is important.
- Protect validation integrity. Do not leak expected eval answers, known prompt
  text, or Skill RSI scoring machinery into the produced skill package.
- Prefer concise examples over long explanations.
- Do not create auxiliary documentation such as `README.md`, changelogs,
  installation guides, or process notes. A skill package should contain only
  files that directly support the skill.

## Progressive disclosure

- `name` and `description` are the always-visible trigger surface. Make the
  description concrete about what the skill does and when it should be used.
- Keep the `SKILL.md` body focused on activation, workflow, decision heuristics,
  output expectations, edge cases, and validation.
- Move detailed domain knowledge, examples, schemas, policies, or variant
  playbooks into `references/` and link them from `SKILL.md` with clear loading
  cues.
- Keep references one level deep where possible; avoid chains of references that
  require the agent to hunt for context.

## Bundled resources

- Use `references/` for documentation the agent may need to read selectively.
- Use `scripts/` for fragile or repetitive deterministic work. Scripts should be
  self-contained or explain dependencies and failure modes clearly.
- Use `assets/` for templates, images, sample files, or other resources that are
  meant to be used in outputs rather than read into context.
- Avoid duplicating the same information in `SKILL.md` and references. Put
  stable details in one place and point to them.

## Creator checklist

- Does the package have exactly one root `SKILL.md` entrypoint?
- Does the frontmatter `description` include useful trigger language?
- Would the skill still work if only `SKILL.md` is loaded first?
- Are large details moved into references with clear "when to read" cues?
- Are validation steps included without overfitting to known eval prompts?
- Are all files production-facing, with no Skill RSI run IDs, candidate IDs,
  judge language, scoring language, or internal experiment notes?
