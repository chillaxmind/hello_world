# Spec Regime — two-tier specs, live-constraint vs mutable-document

## Two-tier model

The skill maintains OpenSpec specifications at two tiers:

```
openspec/specs/
├── <capability>.spec.md          ← CAPABILITY spec (cross-file)
│   │                               the WHAT: behavior, invariants, cross-file
│   └── Member files section        lists members
└── <capability>/
    └── <file>.spec.md             ← PER-FILE spec (mirrors L0 source tree)
                                    the HOW: implementation contracts
```

The relationship is **LAYERED**: capability specs state the WHAT; per-file specs state the HOW. Op3 constraint-checking consults both tiers.

### Per-file specs (Op1 writes)

- Mirror the L0 source tree: `openspec/specs/<capability>/<file>.spec.md`.
- Structured by the **T_annotate** (annotate template) sections — the shared schema between L1 and the spec.
- Are a single **whole-file** document. There are NO per-symbol `### <name>` sections — the file/symbol granularity distinction is collapsed. Every file gets per-function L1 markings and a whole-file spec.
- **Single writer**: Op1 on that file. Op1 never writes capability specs.

### Capability specs (Op0 writes)

- Cross-file: `openspec/specs/<capability>.spec.md`.
- **Single writer**: Op0 (the only op that writes capability specs).
- Op0 has two modes:
  - **First-run** (no per-file specs exist): read the codebase directly to propose the capability decomposition; write one capability spec per discovered capability.
  - **Steady-state** (per-file specs exist): **incrementally merge** only the changed member per-file specs into the existing capability spec (using `memberSpecHashes` to detect changed members). Preserve untouched sections and any hand-refinement. Detect membership drift (unclaimed files, per-file specs whose content no longer matches capability membership).
- A file may belong to **multiple** capabilities.

> Incremental merge (not regenerate-whole) preserves hand-refinement and avoids recomputing untouched sections. Regenerate-whole was rejected because it discards hand-tuning and recomputes needlessly.

## Agency-based regime: live constraint vs mutable document

The spec plays two roles depending on **who initiated the change**:

```
                    WHO changed the layer?
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
     the SKILL writes code       a HUMAN declares intent
     (Op3 IMPLEMENT, Op4)        (edits L2) OR L0 edited
            │                    externally
            ▼                         ▼
   spec = LIVE CONSTRAINT     spec = MUTABLE DOCUMENT
   skill's output MUST          update spec to reflect
   conform to it                the new declared reality,
                                THEN it constrains
```

**The human is the authority on intent; the spec is the authority on implementation correctness.** The constraint and the mutability apply to **different actors at different phases** — never the same actor checking its own homework.

### When the spec is a LIVE CONSTRAINT

- Op3 IMPLEMENT: the candidate patch to L1 MUST conform to the (already-updated) per-file and capability specs. A violating patch is refused or surfaced for human clarification.
- Op4: the strip is mechanical (no spec check needed), but the post-strip invariant `hash(strip(L1)) == hash(L0)` must hold.

### When the spec is a MUTABLE DOCUMENT

- Op3 ABSORB: the human's L2 diff determines the intent change; the per-file spec (and capability spec if touched) is updated to reflect that intent *before* IMPLEMENT uses it as a constraint. The agent does NOT update the spec to match its own output — only to match what the human declared.
- L0 edited externally: drift is detected (`hash(strip(L1)) != hashes.original`); the spec is now stale; the skill recommends re-annotation (Op1) to refresh understanding, rather than treating the spec as authoritative.

## Spec mirrors T_annotate (NOT T_pseudo)

The per-file spec is structured by the **T_annotate** (annotate template) sections. Each T_annotate section's prompt yields a prose answer in L1 and a distilled requirement/scenario in the per-file spec.

The spec does **NOT** mirror T_pseudo. L2 is governed by T_pseudo, which is independent of T_annotate. Because the templates are independent, Op3 ABSORB maps a human L2 edit to affected spec sections via **LLM inference** (not template-section name identity):

```
human edits L2 (governed by T_pseudo)
       │
       ▼  Op3 ABSORB — LLM inference (fire-and-forget)
       │  "which T_annotate-corresponding spec sections does this touch?"
       ▼
update inferred spec sections
       │
       ▼  Op3 IMPLEMENT
check patch against inferred spec sections + capability spec
```

This mapping is non-deterministic (LLM-bridged) and fire-and-forget: ABSORB infers, IMPLEMENT proceeds, `git revert` is the undo if the inference was wrong. There is no confirmation gate on the inferred mapping.

## Drift handling summary

| Drift | Meaning | Action |
| ------- | --------- | -------- |
| `hash(strip(L1)) != hashes.original` | L0 changed externally | spec stale → recommend re-annotate; confirm to proceed |
| `hash(L1) != hashes.annotated` | L1 edited directly (anomalous) | hard warn; confirm to continue |
| current T_annotate hash != `annotateTemplateHash` | annotate template changed since annotation | warn; re-annotate to refresh L1 + spec |
| current T_pseudo hash != `pseudocodeTemplateHash` | pseudocode template changed since L2 | warn; re-run Op2 to refresh L2 |
| non-empty `provisional` list | functions created by Op3 await full comprehension | informational note; re-run Op1 to confirm |
