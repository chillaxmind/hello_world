# Config Schema (`pca/config.yaml`)

The skill's static config. Human-authored once; rarely changes. Distinct from `pca/manifest.yaml` (machine-maintained state). The entire `pca/` directory is committed to git (including logs).

## Top-level fields

```yaml
dirs:
  annotated: pca/annotated   # L1 output directory
  pseudo: pca/pseudo         # L2 output directory
  logs: pca/logs             # audit log directory
  changes: openspec/changes  # OpenSpec change working directory

annotate:                    # T_annotate — the query schema for Op1
  template:
    marker: <string>         # fixed prefix; strip keys on this (default "@pca")
    sections:                # ordered list; each is a query
      - name: <NAME>
        prompt: <question about the code>
    # OR: file: ./path/to/annotate-template.yaml

pseudocode:                  # T_pseudo — the query schema for Op2
  template:
    marker: <string>         # shared marker (same as annotate by default)
    sections:
      - name: <NAME>
        prompt: <question about the code>
    # OR: file: ./path/to/pseudocode-template.yaml

wholeFile:                   # gitignore-style globs for non-function files
  - "migrations/*.sql"
  - "config/*.yaml"

languages:                   # STRICT extension→{language, comment, symbolRule?} map
  .ts:
    language: typescript
    comment: line            # "line" or "block"
    symbolRule: <prose instruction>  # optional; filters LLM discovery
  # No "default" entry. Unmapped extensions are REFUSED.
```

## The two-template model

The skill uses TWO independent templates:

- **`annotate.template` (T_annotate)** — the query schema for Op1. Each section's `prompt` is asked about the code; the answer renders as marker-prefixed comments in L1 (per-function) and is distilled into the per-file spec. The per-file spec mirrors T_annotate's shape. Default sections: PURPOSE, DEPENDS_ON, BEHAVIOR, INVARIANTS, EDGE_CASES.
- **`pseudocode.template` (T_pseudo)** — the query schema for Op2. Each section's `prompt` drives what gets rendered into L2 (human-readable pseudo-code). L2 is the lean human steering surface. Default section: BEHAVIOR only.

The two templates are **fully independent**:

- T_pseudo's sections need NOT match T_annotate's section names.
- T_pseudo can carry sections T_annotate doesn't have, and vice versa.
- Each has its own drift hash in the manifest (`annotateTemplateHash`, `pseudocodeTemplateHash`); changing one does not invalidate artifacts produced by the other.
- The per-file spec mirrors T_annotate only (NOT T_pseudo).
- Op3 ABSORB uses LLM inference to map L2 edits (governed by T_pseudo) to spec sections (structured by T_annotate) — not template-section name identity.

**Why independence?** L2 is a human steering surface. Forcing it to mirror the full annotation contract (invariants, edge cases, dependencies) makes pseudo-code noisy. A lean BEHAVIOR-only default lets a human steer *behavior* while the system keeps the rest coherent. A human who wants to steer invariants can add an INVARIANTS section to T_pseudo — the flexibility is preserved, the default is lean.

## Each template section is a query

Each section is **`name` + `prompt` + answer space**, not just a heading. Op1's explore run answers each T_annotate prompt about each function. Op2 renders each T_pseudo section per function into L2. Humans steer *what understanding gets captured* (T_annotate) and *what gets surfaced as pseudo-code* (T_pseudo) by choosing prompts.

## Marker

A fixed string (default `@pca`) prefixed onto every annotation comment this skill produces. Op4 strip deletes exactly the comments containing the marker, leaving human-authored comments untouched, across all languages. Configurable; choose a string unlikely to collide with human comments. Per-function annotation blocks are delimited by `@pca BEGIN FN: <name>` and `@pca END FN`; whole-file blocks by `@pca BEGIN ANNOTATION` and `@pca END ANNOTATION`.

## Comment types

- `line` — one marker-prefixed comment line per line of content (e.g. `// @pca PURPOSE: …`, `# @pca PURPOSE: …`).
- `block` — a single block comment containing marker-prefixed lines (e.g. `/* @pca PURPOSE: … */`, `"""@pca … """`).

The wrapper syntax is determined by the file's `languages.<ext>.comment`.

## Strict language mapping

A file whose extension has no entry in `languages` is **refused**, not silently fallen back. There is no `default` entry. This prevents mis-annotating files with the wrong comment syntax. The cost is config completeness on first run against a polyglot repo; the benefit is fully explicit behavior.

## `symbolRule` (optional, per-extension)

`languages.<ext>.symbolRule` is an optional **prose instruction** the LLM uses to FILTER its function discovery. It is NOT a regex discoverer — discovery is LLM-primary with widest coverage by default (top-level functions, methods, nested closures, exported lambdas). Use `symbolRule` to narrow the boundary, e.g.:

- `"exclude arrow-const exports"` — don't treat `export const x = () => …` as a function.
- `"only top-level functions, not nested closures"` — skip nested callables.
- `"include class methods but not private helpers"` — filter by visibility.

The rule is interpreted by the LLM during Op1's explore run, not parsed by a script.

## `wholeFile` glob (non-function file override)

Files with zero discoverable functions are **refused** by default (per-function annotation is meaningless for them). List gitignore-style globs in `wholeFile` to opt files into whole-file annotation (one `@pca BEGIN ANNOTATION … END ANNOTATION` block for the entire file). The manifest entry records `mode: whole` for these.

Glob semantics follow gitignore-style patterns (e.g. `migrations/*.sql` matches any `.sql` file directly under `migrations/`; `**/*.yaml` matches YAML files at any depth). A file with zero functions that does NOT match a `wholeFile` glob is refused — the human must explicitly opt it in.

## Template drift (dual)

The manifest stores, per entry:

- `annotateTemplateHash` (sha256 of T_annotate at annotate time) — on mismatch, warns that L1 + the per-file spec use an outdated annotate template. Re-annotate to refresh.
- `pseudocodeTemplateHash` (sha256 of T_pseudo at pseudocode time) — on mismatch, warns that L2 uses an outdated pseudocode template. Re-run Op2 to refresh.

Either warning requires confirmation to proceed. Re-annotation on annotate-template drift IS a full regenerate, since a template change invalidates all section answers.
