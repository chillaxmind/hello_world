# pseudo-code-agent

A Pi skill for a **bidirectional code ↔ pseudo-code pipeline** with durable, structured understanding of your codebase.

The skill maintains three representations of each tracked file and moves between them:

```
   L0 (original code)  ──annotate──▶  L1 (annotated code)  ──pseudocode──▶  L2 (pseudo-code)
        ◀──strip──                         ◀──reconcile──
```

- **L0** — your real code in the repo. Humans and other tools edit this directly.
- **L1** — `L0 + comments only` (additive, never structural). Each function gets its own marker-prefixed annotation block (`@pca BEGIN FN: <name> … END FN`), so strip is deterministic and Op3 can patch/create functions at known sites.
- **L2** — human-readable pseudo-code, one `## <name>` section per function. **The human editing surface for intent — and the authoring surface for new behavior.** Edit here; the skill syncs edits back into the codebase. Add a new `## <name>` section to author a new function.

Understanding is captured durably as **OpenSpec specs** (semantic memory), and pseudo-code edits are synced back via **full OpenSpec change ceremony** with atomic, revertible git commits.

## Why

AI-generated code understanding is usually ephemeral — it lives in a turn and disappears. This skill captures it durably: every annotated file is paired with a spec that records *what the code does*, and an audit log that records *how the agent reached that understanding*. You then edit intent in readable pseudo-code, and the skill propagates those edits back into real code with spec-conformance checks, reviewable OpenSpec changes, and one-click `git revert` undo.

The pipeline is **truly bidirectional**: pseudo-code can steer *existing* behavior OR *author* new behavior. Write a `## newFunction` section in L2, run `reconcile`, and the skill synthesizes the function into L1/L0.

## Requirements

- The [`openspec`](https://openspec.io) CLI
- `git` (the safety model is git-commits-as-undo)
- The `openspec-explore` Pi skill (used as the reasoning engine for `annotate`)
- Node.js (for the helper scripts)

## Setup

1. Copy the sample config to your repo root:

   ```bash
   cp .pi/skills/pseudo-code-agent/assets/sample-config.yaml pca/config.yaml
   ```

2. Edit `pca/config.yaml`:
   - Set `dirs` (where L1, L2, logs, and OpenSpec changes go — defaults use `pca/`).
   - Edit `annotate.template` (T_annotate — the marker + sections that steer what understanding gets captured in L1 + the spec).
   - Edit `pseudocode.template` (T_pseudo — the sections that get rendered into L2; default is BEHAVIOR only).
   - Optionally add `wholeFile` globs for non-function files (config files, SQL migrations).
   - Fill in `languages` — map every file extension your repo uses to `{ language, comment }`. **Unmapped extensions are refused** (no silent fallback). Add an optional `symbolRule` per extension to filter what counts as a function.
3. Install the script dependency:

   ```bash
   cd .pi/skills/pseudo-code-agent && npm install
   ```

The manifest (`pca/manifest.yaml`) is created automatically on first use.

> **The entire `pca/` directory is committed to git** — config, manifest, annotated, pseudo, and logs. This is reviewable project state. Do NOT add `pca/` to `.gitignore`.

## The two templates

The skill uses **two independent templates**:

| Template | Config key | Drives | Default sections |
| --- | --- | --- | --- |
| **T_annotate** | `annotate.template` | L1 (per-function marked comments) + the per-file spec | PURPOSE, DEPENDS_ON, BEHAVIOR, INVARIANTS, EDGE_CASES |
| **T_pseudo** | `pseudocode.template` | L2 (human-readable pseudo-code, the steering surface) | BEHAVIOR only |

They are fully independent: T_pseudo's sections need not match T_annotate's. The per-file spec mirrors T_annotate only. Op3 ABSORB uses LLM inference (not name identity) to map L2 edits back to spec sections. A lean BEHAVIOR-only L2 keeps the human steering surface clean; a human who wants to steer invariants can add an INVARIANTS section to T_pseudo.

## The five operations

Invoke as `/skill:pseudo-code-agent <op> [args]`.

### `discover` — Op0: synthesize capability specs

**codebase → capability decomposition + capability specs**

Capability specs are cross-file specs that state the *WHAT* (behavior, invariants) across a group of files. Only `discover` ever writes them.

- **First run** (no per-file specs exist yet): reads the codebase directly and proposes a capability decomposition, writing one capability spec per discovered capability with its member list.
- **Steady state** (per-file specs exist): **incrementally merges** only the *changed* member per-file specs into the existing capability specs — untouched sections and any hand-refinement are preserved. Also detects membership drift.

### `annotate <file>` — Op1: L0 → L1 + per-file spec + log

**original code → annotated code + understanding**

1. Looks up the file's language mapping (refuses if unmapped).
2. **Discovers every function** via LLM-primary discovery (widest coverage: top-level functions, methods, nested closures, exported lambdas), filtered by an optional per-extension `symbolRule`. Refuses files with zero functions unless a `wholeFile` glob matches (then one whole-file block, `mode: whole`).
3. Enters a **constrained explore stance**: reads the file + codebase context, answers each T_annotate section's prompt per function, exits when it can write the spec's requirements + scenarios. If `provisional` functions exist (created by a prior `reconcile`), runs full comprehension on them and clears their provisional flag.
4. Appends the explore reasoning to the paired **audit log** as one UNDERSTANDING run with `### FN: <name>` sub-delimiters per function.
5. Writes/updates the paired **per-file spec** — one whole-file document structured by the T_annotate sections.
6. Generates **L1** by inserting `@pca BEGIN FN: <name> … END FN` blocks at each function's start line (additive only — no renaming/reordering).
7. Records hashes + the auto-populated `symbols` locator registry in the manifest and verifies `hash(strip(L1)) == hash(L0)`.

### `pseudocode <file>` — Op2: L1 → L2

**annotated code → human-readable pseudo-code (per function)**

Reads L1 and the paired per-file spec, renders T_pseudo's sections (default: BEHAVIOR) for each function, and writes L2 with `## <name>` anchors. Every function gets a section.

**After this, you edit L2 to change intent.** Edit an existing `## <name>` section to steer behavior, or add a new `## <name>` section to author a new function. Then run `reconcile`.

### `reconcile <file>` — Op3: L2 edit → L1 + L0 (full OpenSpec ceremony)

**edited pseudo-code → patched/created code, reviewable and revertible**

Propagates a human edit to L2 back into L1 and L0 via full OpenSpec change ceremony, in four phases:

- **ABSORB** — diffs prior-L2 vs edited-L2; uses **LLM inference** (fire-and-forget) to map the diff to affected spec sections (the templates are independent, so mapping is semantic, not name-identity). Detects new `## <name>` sections with no matching L1 marker → **authoring path**: registers the function in `symbols`, marks it `provisional`, writes a thin (BEHAVIOR-only) spec entry. Creates an OpenSpec change with proposal, spec deltas, and tasks. **Updates the spec to reflect the human's declared intent.**
- **IMPLEMENT** — for existing functions, patches L1 at the `@pca BEGIN FN:` marker site. For new functions, synthesizes the function body from the L2 behavior description, chooses an LLM-judged placement, and writes the annotation block + real code. Checks the patch against the ABSORB-inferred spec sections + capability spec; refuses or asks on violation.
- **STRIP** — auto-chains `strip` to produce L0 from the patched L1; verifies the invariant.
- **CLOSE** — makes **one atomic git commit** bundling the L1 patch, L0 strip, spec deltas, manifest, and change artifacts, then runs `openspec archive`.

**Undo:** `git revert <commit>` restores L0, L1, L2, specs, and manifest atomically.

**Provisional lifecycle:** Op3-created functions have thin (BEHAVIOR-only) specs until the next `annotate` re-discovers them in L0, runs full T_annotate comprehension, enriches the spec, and clears the provisional flag. The system captures what it was told; it doesn't invent what it wasn't.

### `strip <file>` — Op4: L1 → L0 (standalone)

**annotated code → original code**

Mechanically removes this skill's marker-prefixed comments from L1 and writes L0. Deterministic; no LLM. Human-authored comments are preserved. Makes its own git commit (`pca(strip): <file>`).

## The round trip, end to end

```
   1. discover           2. annotate <file>        3. pseudocode <file>
      ──────────            ───────────────            ────────────────
      capability specs      L1 (per-fn marked) +       L2 (per-fn, ## anchors)
                             whole-file spec + log     ← edit existing fn
                                ▲                      ← OR add new ## fn (author)
                                │                            │
                                └─── reconcile <file> ◀──────┘
                                       ────────────────
                                       OpenSpec change +
                                       patch/create L1 +
                                       strip + git commit +
                                       archive
                                          │
                                          ▼
                                       L0 + L1 updated,
                                       in sync, one revertable commit
                                          │
                                 (next annotate confirms
                                  provisional functions)
```

## Key invariants & safety model

- **Comments-only annotation** → `strip` is deterministic and `hash(strip(L1)) == hash(L0)` always holds.
- **`@pca` marker** → `strip` deletes exactly this skill's comments, never human comments, across all languages. Per-function blocks are delimited by `@pca BEGIN FN: <name>` / `@pca END FN`.
- **Per-function L1 markings** → Op3 patches functions at known sites; new functions get LLM-chosen placement.
- **Drift detection** (runs before every mutating op):
  - L0 changed externally → spec is stale → recommends re-annotate.
  - L1 edited directly → anomalous → hard warn.
  - Annotate template changed → L1/specs outdated → warn; re-annotate to refresh.
  - Pseudocode template changed → L2 outdated → warn; re-run pseudocode to refresh.
  - Non-empty `provisional` list → informational note (functions awaiting Op1 confirmation).
- **Agency-based spec regime** → the spec is a *live constraint* when the skill writes code; a *mutable document* when a human declares intent. The agent never updates the spec to match its own output.
- **Atomic git commits** → one reconcile = one commit = one `git revert` undo.

## Configuration

### `pca/config.yaml` (static, human-authored)

```yaml
dirs:
  annotated: pca/annotated
  pseudo: pca/pseudo
  logs: pca/logs
  changes: openspec/changes

annotate:
  template:
    marker: "@pca"
    sections:
      - name: PURPOSE
        prompt: "What is the primary responsibility of this code?"
      - name: INVARIANTS
        prompt: "What conditions must always hold for this code to be correct?"
      # ...add your own sections to steer what gets captured

pseudocode:
  template:
    marker: "@pca"
    sections:
      - name: BEHAVIOR
        prompt: "What does this code do, step by step?"

wholeFile:            # opt non-function files into whole-file annotation
  - "migrations/*.sql"

languages:            # STRICT — unmapped extensions are refused
  .ts:
    language: typescript
    comment: line
    # symbolRule: "exclude arrow-const exports"   # optional LLM-output filter
  .py:
    language: python
    comment: line
  # No "default" entry.
```

### `pca/manifest.yaml` (machine-maintained)

The single source of truth: entries (one per tracked file) with paths, capability memberships, `mode` (auto/whole), `symbols` (auto-populated locator registry), `provisional` list, hashes, dual template hashes (`annotateTemplateHash` + `pseudocodeTemplateHash`), `lastOp`, `syncedAt`, `pendingChange`. Updated atomically by every op. See [`references/manifest-schema.md`](references/manifest-schema.md).

## Specs produced

Two tiers of OpenSpec specs, written by different ops:

| Tier | Path | Writer | Role |
| --- | --- | --- | --- |
| **Capability** | `openspec/specs/<capability>.spec.md` | `discover` (Op0) only | the WHAT — cross-file behavior & invariants |
| **Per-file** | `openspec/specs/<capability>/<file>.spec.md` | `annotate` (Op1) | the HOW — whole-file implementation contracts, structured by T_annotate |

Per-file specs are whole-file documents (no per-symbol sections). `annotate` writes only per-file specs; `discover` is the sole writer of capability specs.

## Helper scripts

| Script | Purpose |
| --- | --- |
| `scripts/hash-file.sh` | sha256 of a file |
| `scripts/resolve-language.js` | strict extension → {language, comment} lookup; refuses unmapped |
| `scripts/render-template.js` | read L0 + placement plan, insert per-function `BEGIN/END FN` blocks (or whole-file block), output L1 |
| `scripts/strip-comments.js` | delete exactly marker-prefixed comments (deterministic; preserves human comments) |
| `scripts/check-drift.sh` | per-layer drift detection (L0 stale / L1 anomalous / dual template drift) + provisional note |
| `scripts/update-manifest.js` | atomic read-modify-write of the manifest (via `js-yaml`) |

## References

- [`references/template-schema.md`](references/template-schema.md) — config schema, two-template model, marker, strict language mapping, symbolRule, wholeFile glob
- [`references/manifest-schema.md`](references/manifest-schema.md) — manifest fields, capability registry, mode, symbols, provisional, dual template hashes
- [`references/spec-regime.md`](references/spec-regime.md) — two-tier specs, live-constraint vs mutable-document, LLM-bridged ABSORB, `discover` incremental merge

## Typical workflow

```bash
# 1. One-time: set up config
cp .pi/skills/pseudo-code-agent/assets/sample-config.yaml pca/config.yaml
$EDITOR pca/config.yaml
cd .pi/skills/pseudo-code-agent && npm install && cd -

# 2. Discover capabilities (first run)
/skill:pseudo-code-agent discover

# 3. Annotate a file (produces per-function L1 + whole-file spec + log)
/skill:pseudo-code-agent annotate src/auth/login.ts

# 4. Derive pseudo-code (produces per-function L2)
/skill:pseudo-code-agent pseudocode src/auth/login.ts

# 5. Edit pca/pseudo/src/auth/login.md to change intent OR add a new ## fn, then reconcile
/skill:pseudo-code-agent reconcile src/auth/login.ts
#   → creates an OpenSpec change, patches/creates L1, strips to L0,
#     commits atomically, archives the change

# 6. Undo a reconcile if needed
git revert <reconcile-commit>

# 7. Re-annotate to confirm provisional (Op3-created) functions
/skill:pseudo-code-agent annotate src/auth/login.ts
```

## License

MIT
