---
name: pseudo-code-agent
description: Bidirectional code↔pseudo-code pipeline with two-tier OpenSpec specs. Annotates code into heavily-commented form (L1), derives human-readable pseudo-code (L2), reconciles pseudo-code edits back into real code via full OpenSpec change ceremony, and strips annotations. Use when capturing durable understanding of a file as a spec, editing intent via pseudo-code, or syncing pseudo-code edits back into the codebase.
license: MIT
compatibility: Requires the openspec CLI, git, and the openspec-explore Pi skill.
metadata:
  author: pseudo-code-agent
  version: "2.0"
  generatedBy: "spec-driven"
---

# Pseudo-Code Agent

A bidirectional pipeline across three representations of each tracked file:

- **L0** — original code in the repo (humans and other tools edit this directly)
- **L1** — `L0 + comments only` (additive, never structural); per-function marked annotation blocks, each prefixed by the marker
- **L2** — human-readable pseudo-code; the human editing surface for intent (and the authoring surface for new behavior)

Five operations, invoked as `/skill:pseudo-code-agent <op> [args]`:

| Op | Command | Direction |
| ---- | --------- | ----------- |
| Op0 | `discover` | codebase → capability decomposition + capability specs |
| Op1 | `annotate <file>` | L0 → L1 (per-function marked) + whole-file spec + log |
| Op2 | `pseudocode <file>` | L1 → L2 (per-function, via T_pseudo) |
| Op3 | `reconcile <file>` | L2 edit → OpenSpec change → patch/create L1 → strip L0 → commit + archive |
| Op4 | `strip <file>` | L1 → L0 (standalone; also auto-chained by Op3) |

> **The `pca/` directory is committed to git in full** — config, manifest, annotated, pseudo, and logs. This is reviewable project state, not ephemeral cache. Do NOT add `pca/` to `.gitignore`.

## Two templates (independent)

The skill uses two independent templates, both in `pca/config.yaml`:

- **`annotate.template` (T_annotate)** — the query schema for Op1. Sections (default: PURPOSE, DEPENDS_ON, BEHAVIOR, INVARIANTS, EDGE_CASES) drive L1's per-function annotation blocks and the per-file spec. The per-file spec mirrors T_annotate.
- **`pseudocode.template` (T_pseudo)** — the query schema for Op2. Sections (default: BEHAVIOR only) drive L2. L2 is the lean human steering surface.

The two are fully independent: T_pseudo's sections need not match T_annotate's. Op3 ABSORB uses LLM inference (not name identity) to map L2 edits to spec sections.

## Shared setup (all ops)

Before any op:

1. Load `pca/config.yaml`. If it does not exist, refuse and tell the human to create it (see `references/template-schema.md` and the sample in `assets/sample-config.yaml`). Require BOTH `annotate.template` and `pseudocode.template` — refuse if either is missing.
2. Load `pca/manifest.yaml`. If it does not exist, create it with `capabilities: {}` and `entries: []` (use `scripts/update-manifest.js` for atomic write).
3. Run `scripts/check-drift.sh` for any mutating op (pass the entry's fields via env vars — see `references/spec-regime.md`). Handle drift:
   - **L0 stale** (`hash(strip(L1)) != hashes.original`): warn "original changed outside the skill; spec is stale. Re-annotate to update understanding?" Confirm before proceeding.
   - **L1 anomalous** (`hash(L1) != hashes.annotated`): hard warn "annotated code was edited directly; this shouldn't happen. Confirm to continue?"
   - **Annotate template changed** (current T_annotate hash != stored `annotateTemplateHash`): warn "annotate template changed since this file was annotated; existing L1/specs use the old template. Re-annotate to refresh, or continue with mismatch?" Confirm before proceeding.
   - **Pseudocode template changed** (current T_pseudo hash != stored `pseudocodeTemplateHash`): warn "pseudocode template changed since L2 was generated; L2 uses the old template. Re-run pseudocode to refresh, or continue?" Confirm before proceeding.
   - **Provisional note** (non-empty `provisional` list): informational — "these functions have thin (BEHAVIOR-only) specs pending Op1 confirmation: <list>". Does not block; surface to the human.

Resolve a file's manifest entry by `id` == the L0 path. If no entry exists and the op is `annotate`, create one; for other ops, refuse if no entry exists.

## Config & manifest references

- `pca/config.yaml` schema: see `references/template-schema.md` (dirs, two templates with marker + sections, wholeFile glob, languages map with optional symbolRule).
- `pca/manifest.yaml` schema: see `references/manifest-schema.md` (capabilities map + entries with hashes, mode, symbols, provisional, dual template hashes, pendingChange, lastOp, syncedAt).
- Spec regime (two-tier, live-constraint vs mutable-document, LLM-bridged ABSORB): see `references/spec-regime.md`.

---

## Op0 — discover

Synthesize/refresh **capability specs** (cross-file). Only Op0 ever writes capability specs.

### First-run mode (no per-file specs exist in `openspec/specs/`)

1. Read the codebase (or a subtree if scoped) to understand its structure.
2. Propose a capability decomposition: group files by the capability they serve. A file may belong to multiple capabilities.
3. For each discovered capability `C`:
   - Write `openspec/specs/<C>.spec.md` stating the WHAT (behavior, invariants, cross-file concerns), with a `## Member files` section listing members.
4. Update the manifest `capabilities` map: `{ C: { spec: openspec/specs/<C>.spec.md, members: [...] } }` and set each member entry's `capabilities` list.

### Steady-state mode (per-file specs exist)

1. For each capability `C`, **incrementally merge** only the *changed* member per-file specs into `openspec/specs/<C>.spec.md`:
   - Detect changed members by comparing each member per-file spec's hash (store capability-spec member hashes in the manifest `capabilities.C.memberSpecHashes`, or recompute) against the last-merged hash.
   - Update only the capability-spec sections corresponding to changed members; **preserve untouched sections and any hand-refinement**.
2. Detect membership drift: report files no capability claims, and per-file specs whose content no longer matches their declared capability membership.
3. Update the manifest `capabilities` map (members, memberSpecHashes) and each entry's `capabilities` list.
4. Append a log marker to each affected file's log: `--- DISCOVER <timestamp> ---`.

> **Do NOT regenerate capability specs wholesale.** Incremental merge preserves hand-refinement and avoids recomputing untouched sections.

---

## Op1 — annotate `<file>`

Produce L1 (per-function marked) + the paired whole-file per-file spec + an audit-log run, using the OpenSpec explore skill as the reasoning engine.

1. Resolve the file's entry (create new if annotating for the first time). Look up the language mapping by running `scripts/resolve-language.js --config pca/config.yaml --file <file>` (it prints `language=<lang> comment=<line|block>` or **refuses** with a non-zero exit if the extension is unmapped — no silent fallback).
2. **Discover every function** via LLM-primary discovery (widest coverage by default: top-level functions, methods, nested closures, exported lambdas). Apply the per-extension `symbolRule` from config as a filter on what counts as a symbol (e.g. "exclude arrow-const exports"). If zero functions are discovered:
   - Check the config `wholeFile` globs (gitignore-style). If the file matches a glob, annotate as one whole-file block (`mode: whole`; see step 6b).
   - If no glob matches, **refuse** — report that the file has no discoverable functions and no `wholeFile` override applies.
3. **Enter a constrained explore stance** (adopt the explore skill's curious, grounded, visual mode, but with Op1 exit criteria):
   - Read the L0 file and relevant codebase context (imports, callers, related files).
   - For each discovered function, answer each T_annotate section's `prompt` about that function.
   - **Provisional completion**: if the manifest entry lists `provisional` functions (created by a prior Op3), re-discover them in L0 and run **full** T_annotate comprehension on them — fill in PURPOSE, DEPENDS_ON, INVARIANTS, EDGE_CASES (not just BEHAVIOR). Enrich their spec entries. They will be cleared from `provisional` in step 7.
   - **Exit criteria**: understanding is sufficient when you can write the per-file spec's requirements + scenarios for every function's behavior. Do not explore indefinitely.
4. **Emit a placement plan**: for each function, record `{ name, insertAtLine, sections: [{ name, answer }, ...] }` where `insertAtLine` is the 1-indexed line where the function begins (the marked block will be inserted directly above it).
5. **Append the explore reasoning to the paired log** (`<log path>`) as ONE UNDERSTANDING run with `### FN: <name>` sub-delimiters per function:

   ```
   --- UNDERSTANDING <ISO-8601 timestamp> ---
   ### FN: login
   <explore reasoning for login>
   ### FN: logout
   <explore reasoning for logout>
   ```

6a. **Write/update the paired per-file spec** (`<spec path>`) as ONE whole-file document structured by the T_annotate sections (shared schema — each section's answer distilled into requirements/scenarios). There are NO per-symbol `### <name>` sections — the spec is whole-file. Op1 writes ONLY the per-file spec — never the capability spec.

6b. **Generate L1** by feeding the placement plan to `scripts/render-template.js` (it reads L0, inserts `@pca BEGIN FN: <name> … END FN` blocks at each function's start line, and outputs L1). For `mode: whole`, it inserts one `@pca BEGIN ANNOTATION … END ANNOTATION` block at the top of the file. Comments are additive only; no renaming/reordering.

1. **Update the manifest entry** via `scripts/update-manifest.js`:
   - `hashes.original = sha256(L0)`, `hashes.annotated = sha256(L1)`
   - `annotateTemplateHash = sha256(config.annotate.template)`
   - `mode: auto` (or `whole`)
   - `symbols`: the auto-populated locator registry — `{ <fn>: { pseudoAnchor: "## <fn>", markerLine: <N> } }` for each discovered function
   - `provisional`: remove any functions that were confirmed this run (enriched from thin to full spec)
   - `lastOp: annotate`, `syncedAt: <now>`

2. **Verify the invariant**: run `scripts/check-drift.sh <file>`; `hash(strip(L1))` MUST equal `hashes.original`. If not, the annotation was not purely additive — fix before proceeding.

---

## Op2 — pseudocode `<file>`

Derive human-readable L2 from L1, per function, using T_pseudo.

1. Read the L1 file and the paired per-file spec.
2. For each function in the file (each `@pca BEGIN FN: <name>` block in L1), render T_pseudo's sections (default: BEHAVIOR only) for that function, derived from L1's T_annotate answers grounded by the spec. Every function in the file MUST get a section — no function is skipped.
3. Assemble L2 with `## <name>` anchors matching the manifest's `symbols.<name>.pseudoAnchor`:

   ```
   ## login
   BEHAVIOR: <step-by-step pseudo-code for login>

   ## logout
   BEHAVIOR: <step-by-step pseudo-code for logout>
   ```

4. Write L2 to `<pseudo path>`.
5. Append a one-line marker to the log: `--- PSEUDOCODE <ISO-8601 timestamp> ---`.
6. Update the manifest: `pseudocodeTemplateHash = sha256(config.pseudocode.template)`, `lastOp: pseudocode`, `syncedAt`.

> L2 is the human steering surface. After this, the human edits L2 to change intent (existing functions) or author new behavior (new `## <name>` sections). Then run `reconcile`.

---

## Op3 — reconcile `<file>`

Propagate a human edit to L2 back into L1 and L0 via **full OpenSpec change ceremony**, in four phases. Op3 auto-chains Op4 (strip) and closes with one atomic git commit + `openspec archive`. Pseudo-code is an **authoring surface**: a human may edit existing functions OR introduce new ones.

### Phase ABSORB (spec = MUTABLE here)

1. Diff the prior L2 (from manifest `pseudo` path, or a git-tracked prior version) against the edited L2 to determine the intent change.
2. **Map the diff to affected spec sections via LLM inference** (fire-and-forget — no human confirmation gate). Because T_pseudo and T_annotate are independent, the mapping is semantic, not name-identity: the LLM infers which T_annotate-corresponding spec sections the L2 edit touches (e.g. a BEHAVIOR edit that implies a new error path may also touch EDGE_CASES). Also consider capability-spec sections if the change touches capability-level invariants.
3. **Detect authoring**: for each `## <name>` section in the edited L2, check whether a matching `@pca BEGIN FN: <name>` block exists in L1.
   - **Existing function** → patch path (IMPLEMENT patches at the marker site).
   - **New function** (no matching marker) → **authoring path**: register `<name>` in the manifest `symbols` map, add `<name>` to `provisional`, and write a **thin (BEHAVIOR-only)** spec entry for it (the system captures what the human told it — behavior — not what it wasn't told).
4. `openspec new change "<name>"` (derive a kebab-case name from the diff; confirm with the human if ambiguous).
5. Write the change's `proposal.md` (the intent, derived from the diff), spec deltas (per-file; capability if touched), and `tasks.md` ("patch/create L1 to implement <change>").
6. **Update the per-file spec** (and capability spec if touched) to reflect the human's declared intent. For new functions, the spec entry is thin (BEHAVIOR-only) and the function is marked provisional. The agent does NOT update the spec to match its own output — only to match what the human declared.
7. Set manifest `pendingChange: <name>`.
8. Log: append `--- RECONCILE / ABSORB <timestamp> ---` with the diff analysis, the LLM-inferred section mapping, and the spec-update reasoning. Note any new (provisional) functions.

### Phase IMPLEMENT (spec = LIVE CONSTRAINT)

1. For each touched function:
   - **Existing function**: produce a **minimal patch** to L1 at the function's `@pca BEGIN FN: <name>` marker site. Touch only that function.
   - **New function (authoring)**: synthesize the function body from the human's L2 behavior description; choose an **LLM-judged placement** in L1 (e.g. "near other session functions"); write the real code AND a `@pca BEGIN FN: <name>` annotation block (thin: BEHAVIOR only, matching the L2 input) above it.
2. The patch MUST conform to the updated per-file spec AND the capability spec (the sections ABSORB inferred). If a candidate patch would violate either, **refuse or ask the human**. Do not commit a violating patch.
3. Log: append `--- RECONCILE / IMPLEMENT <timestamp> ---` with the patch reasoning and (for new functions) the chosen placement.

### Phase STRIP (auto-chained Op4)

1. Run `scripts/strip-comments.js` on the patched L1 to produce L0 at the linked `original` path.
2. Verify `hash(strip(L1)) == hash(L0)` (the invariant). If it fails, abort — do not commit.
3. Log: append `--- RECONCILE / STRIP <timestamp> ---`.

### Phase CLOSE

1. `git add` the L1 patch, L0 strip, spec deltas (per-file + capability), manifest update, and the change artifacts under `openspec/changes/<name>/`.
2. Make **one atomic commit**: `git commit -m "pca(reconcile): <name> — <summary>"`.
3. `openspec archive <name>`.
4. Clear manifest `pendingChange: null`; set `lastOp: reconcile`, `syncedAt`, `hashes.original = sha256(L0)`, `hashes.annotated = sha256(L1)`. Keep `provisional` and `symbols` updated (new functions remain provisional until the next Op1 confirms them).
5. Log: append `--- RECONCILE / CLOSE <timestamp> ---`.

The human can undo the entire reconcile with `git revert <commit>` — L0, L1, L2, specs, and manifest all roll back atomically.

> **Provisional lifecycle**: Op3-created functions remain `provisional` (thin BEHAVIOR-only spec) until the next Op1 re-annotate re-discovers them in L0, runs full T_annotate comprehension, enriches the spec, and clears the provisional flag. This is the system being honest: it captures what the human told it (behavior), not what it wasn't told (invariants, edge cases — those come from Op1 comprehending the implemented code).

---

## Op4 — strip `<file>` (standalone)

Mechanically remove this skill's annotations from L1, writing L0. Deterministic; no LLM.

1. Run `scripts/strip-comments.js <file>` on the L1 file → write the result to the linked `original` (L0) path.
2. Verify `hash(strip(L1)) == hash(L0)`.
3. Make a standalone git commit: `git commit -m "pca(strip): <file>"`.
4. Update manifest: `hashes.original`, `hashes.annotated`, `lastOp: strip`, `syncedAt`.
5. Append a one-line log marker: `--- STRIP <ISO-8601 timestamp> ---`.

> When Op4 is auto-chained by Op3 STRIP, do NOT make a separate commit — the Op3 CLOSE commit covers it. Strip keys on the marker and removes ALL `@pca BEGIN FN: … END FN` (and `BEGIN ANNOTATION … END ANNOTATION`) blocks, leaving human-authored comments untouched.

---

## Scripts

- `scripts/render-template.js` — read L0 + a placement plan, insert per-function `@pca BEGIN FN` blocks (or one whole-file block) at the right lines, output L1. Refuses unmapped extensions.
- `scripts/strip-comments.js` — delete exactly marker-prefixed comments; deterministic; preserves human comments. Removes all `BEGIN/END FN` and `BEGIN/END ANNOTATION` blocks.
- `scripts/check-drift.sh` — per-layer drift detection (L0 stale / L1 anomalous / annotate-template changed / pseudocode-template changed) + provisional completeness note.
- `scripts/update-manifest.js` — atomic read-modify-write of `pca/manifest.yaml`.
- `scripts/hash-file.sh` — sha256 of a file.
- `scripts/resolve-language.js` — strict extension→{language, comment} lookup; refuses unmapped extensions.

## References

- [Template schema](references/template-schema.md) — `pca/config.yaml`, the two-template model, marker, strict language mapping, symbolRule, wholeFile glob.
- [Manifest schema](references/manifest-schema.md) — `pca/manifest.yaml` fields (mode, symbols, provisional, dual template hashes).
- [Spec regime](references/spec-regime.md) — two-tier specs, live-constraint vs mutable-document, LLM-bridged ABSORB, Op0 incremental merge.
