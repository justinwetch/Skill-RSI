# Agent Skills Standard (reference)

Extracted from the official Agent Skills specification at
<https://agentskills.io/specification> (fetched 2026-05-26). This file is the
single source of truth that Skill RSI feeds to the skill-creator agent so that
generated packages conform to the real open standard rather than an
approximation. If the upstream spec changes, re-fetch and update this file.

## Directory structure

A skill is a directory whose only required member is a root `SKILL.md`:

```
skill-name/
├── SKILL.md          # Required: frontmatter + instructions
├── scripts/          # Optional: executable helpers
├── references/       # Optional: documentation loaded on demand
├── assets/           # Optional: templates, schemas, images
└── ...
```

## SKILL.md frontmatter

YAML frontmatter, then a Markdown body.

| Field           | Required | Constraints |
| --------------- | -------- | ----------- |
| `name`          | Yes      | 1–64 chars. Lowercase letters, digits, and hyphens only. No leading/trailing hyphen, no consecutive `--`. Should match the skill's directory name. |
| `description`   | Yes      | 1–1024 chars, non-empty. States **what** the skill does and **when** to use it; include concrete trigger keywords. |
| `license`       | No       | License name or reference to a bundled license file. |
| `compatibility` | No       | ≤500 chars. Environment requirements (intended product, system packages, network access). Most skills omit it. |
| `metadata`      | No       | Arbitrary string→string map. Put extra properties like `author` and `version` **here**, not as top-level keys. |
| `allowed-tools` | No       | Space-separated pre-approved tool list. Experimental; support varies. |

`name` and `description` are the ONLY two required fields, and the ONLY optional
top-level keys are the four above. Any other top-level key (e.g. `id`, `status`,
`audience`, `summary`, a top-level `version`) is **not** part of the spec.

Minimal:

```yaml
---
name: skill-name
description: A description of what this skill does and when to use it.
---
```

With optional fields done correctly:

```yaml
---
name: pdf-processing
description: Extract PDF text, fill forms, merge files. Use when handling PDFs.
license: Apache-2.0
metadata:
  author: example-org
  version: "1.0"
---
```

### `description` quality

Good: "Extracts text and tables from PDF files, fills PDF forms, and merges
multiple PDFs. Use when working with PDF documents or when the user mentions
PDFs, forms, or document extraction."

Poor: "Helps with PDFs."

## Body

Markdown instructions; no required format. Recommended: step-by-step
instructions, input/output examples, common edge cases.

## Progressive disclosure

Agents load skills in layers, so structure for it:

1. Metadata (~100 tokens): `name` + `description`, loaded at startup for all skills.
2. Instructions (recommend < 5000 tokens; keep `SKILL.md` under ~500 lines): the body, loaded on activation.
3. Resources (as needed): files under `scripts/`, `references/`, `assets/`, loaded only when required.

Move detailed reference material out of `SKILL.md` into `references/`.

## File references

Use relative paths from the skill root, e.g. `references/REFERENCE.md` or
`scripts/extract.py`. Keep references one level deep; avoid deep chains.

## Optional directories

- `scripts/` — executable code; self-contained or documents its dependencies, with helpful errors.
- `references/` — focused docs (`REFERENCE.md`, domain files) loaded on demand.
- `assets/` — templates, images, data files (lookup tables, schemas).

## Validation

The `skills-ref` reference library validates a skill's frontmatter and naming
conventions: `skills-ref validate ./my-skill`.
