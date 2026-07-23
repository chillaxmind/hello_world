# Manifest Schema (`pca/manifest.yaml`)

The single source of truth for all file linkages, capability memberships, hashes, and operation state. Machine-maintained; updated by every op via `scripts/update-manifest.js` (atomic read-modify-write). Never edited by hand during normal operation.

## Top-level structure

```yaml
capabilities:
  <capability-name>:
    spec: openspec/specs/<capability-name>.spec.md
    members: [<L0 path>, ...]
    memberSpecHashes:      # used by Op0 steady-state incremental merge
      <L0 path>: sha256:<per-file spec hash at last merge>

entries:
  - id: <L0 path>          # identity; the original file path
    original: <L0 path>
    annotated: <L1 path>
    log: <audit log path>
    pseudo: <L2 path>
    spec: <per-file spec path>
    capabilities: [<capability-name>, ...]   # multi-membership allowed
    mode: auto | whole     # auto = per-function; whole = single-block override
    symbols:                # auto-populated locator registry (NOT human-declared)
      <function-name>:
        pseudoAnchor: "## <function-name>"  # L2 anchor for this function
        markerLine: <N>                     # L1 line of the @pca BEGIN FN block
    provisional: [<function-name>, ...]     # thin-spec fns pending Op1 confirm; or []
    hashes:
      original: sha256:<L0 hash at annotate time>   # drift anchor
      annotated: sha256:<L1 hash at annotate time>  # detects direct L1 edits
    lastOp: annotate | pseudocode | reconcile | strip | discover
    syncedAt: <ISO-8601 timestamp>
    pendingChange: <open Op3 change name> | null
    annotateTemplateHash: sha256:<T_annotate hash at annotate time>
    pseudocodeTemplateHash: sha256:<T_pseudo hash at pseudocode time>
```

## Field semantics

- **`id`** — the L0 path; the stable identity of a tracked file.
- **`original` / `annotated` / `log` / `pseudo` / `spec`** — paths to the five paired artifacts.
- **`capabilities`** — list of capability memberships; a file MAY belong to more than one.
- **`mode`** — `auto` (per-function annotation; the default) or `whole` (single-block whole-file annotation via `wholeFile` glob override). There is NO `granularity` field — the file/symbol granularity distinction is collapsed; every `auto` file gets per-function L1 and a whole-file spec.
- **`symbols`** — an auto-populated locator registry, NOT a human-declared structural map. Written by Op1 (discovery) and Op3 (created functions). Maps each function name to its `pseudoAnchor` (the `## <name>` L2 anchor) and `markerLine` (the L1 line of its `@pca BEGIN FN:` block). Op2/Op3 use this to locate functions. When `mode: whole`, `symbols` is absent.
- **`provisional`** — a list of function names whose per-file spec entry is thin (BEHAVIOR-only) because they were created by Op3 (not Op1) and have not yet been confirmed by a full Op1 comprehension run. Empty list (or absent) when no functions are provisional. Op3 adds to it; Op1 clears from it after full comprehension.
- **`hashes.original`** — sha256 of L0 at annotate time. The drift-detection anchor: `hash(strip(L1))` must equal this. If not, L0 changed externally → spec is stale → recommend re-annotate.
- **`hashes.annotated`** — sha256 of L1. Detects anomalous direct edits to L1 (humans should edit L2, not L1).
- **`lastOp`** — the most recent op that touched this entry.
- **`syncedAt`** — when `lastOp` ran.
- **`pendingChange`** — name of an open Op3-created OpenSpec change, or null. Set by Op3 ABSORB; cleared by Op3 CLOSE.
- **`annotateTemplateHash`** — sha256 of T_annotate at annotate time. Enables annotate-template drift detection (L1 + spec outdated).
- **`pseudocodeTemplateHash`** — sha256 of T_pseudo at pseudocode time. Enables pseudocode-template drift detection (L2 outdated).

## Who writes `symbols`

Both Op1 and Op3 may write `symbols`:

- **Op1** populates `symbols` during annotate, registering every discovered function.
- **Op3** populates `symbols` when it creates a new function from an L2 edit (authoring surface), registering the created function AND adding its name to `provisional`.

This expands manifest write scope beyond Op1. Op3-registered symbols are always provisional until the next Op1 re-annotate confirms them.

## Capability registry

`capabilities` is a map keyed by capability name. Each records its spec path (`spec`), member list (`members`), and `memberSpecHashes` (per-member per-file spec hashes at last merge — used by Op0 steady-state to detect which members changed and need incremental merge). Only Op0 writes capability specs and this registry's spec/members fields; Op1 only tags each entry's `capabilities` membership.

## Atomic updates

The manifest is rewritten in full after an in-memory update (see `scripts/update-manifest.js`), so a partial write never leaves it inconsistent. Concurrent ops on different entries are out of scope (single-user, local-git model).
