#!/usr/bin/env bash
# check-drift.sh — per-layer drift detection for a tracked file's manifest entry.
#
# Checks drift conditions and reports per-layer semantics:
#   1. L0 stale:           hash(strip(L1)) != hashes.original
#                          → original changed outside the skill; spec is stale.
#                            Recommend re-annotate. (exit code 10)
#   2. L1 anomalous:       hash(L1) != hashes.annotated
#                          → annotated code was edited directly (shouldn't
#                            happen). Hard warn. (exit code 11)
#   3. Annotate template   current annotate template hash != stored
#      changed:            annotateTemplateHash → L1/specs use the old
#                            annotate template. (exit code 12)
#   4. Pseudocode template current pseudocode template hash != stored
#      changed:            pseudocodeTemplateHash → L2 uses the old pseudocode
#                            template. (exit code 13)
#   5. Provisional note:   non-empty `provisional` list → completeness note
#                            (NOT a drift failure; printed to stderr, does not
#                            change exit code). (no exit code)
#
# Exit codes:
#   0  no drift (provisional notes, if any, are still printed to stderr)
#   10 L0 stale
#   11 L1 anomalous
#   12 annotate template changed
#   13 pseudocode template changed
#   20 combination (multiple drifts); details printed
#   2  usage / missing data
#
# Env-var invocation (preferred):
#   PCA_L1=<path> \
#     PCA_ORIG_HASH=<sha> PCA_L1_HASH=<sha> \
#     PCA_ANNOTATE_TPL_STORED=<sha> PCA_ANNOTATE_TPL_CURRENT=<sha> \
#     PCA_PSEUDO_TPL_STORED=<sha> PCA_PSEUDO_TPL_CURRENT=<sha> \
#     PCA_L1_FILE=<l1path-for-strip> PCA_EXT=<ext> PCA_MARKER=<marker> \
#     PCA_PROVISIONAL=<comma-separated fn names, or empty> \
#     scripts/check-drift.sh
# JSON-arg invocation (legacy): pass one entry JSON as $1; the script extracts
#   annotated, hashes.original, hashes.annotated, annotateTemplateHash,
#   pseudocodeTemplateHash, provisional. Template-current hashes and marker
#   still come from PCA_ANNOTATE_TPL_CURRENT / PCA_PSEUDO_TPL_CURRENT /
#   PCA_MARKER env vars.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${PCA_L1:-}" ]; then
	l1="$PCA_L1"
	orig_hash="${PCA_ORIG_HASH:-}"
	l1_hash_stored="${PCA_L1_HASH:-}"
	anno_tpl_stored="${PCA_ANNOTATE_TPL_STORED:-}"
	anno_tpl_current="${PCA_ANNOTATE_TPL_CURRENT:-}"
	pseudo_tpl_stored="${PCA_PSEUDO_TPL_STORED:-}"
	pseudo_tpl_current="${PCA_PSEUDO_TPL_CURRENT:-}"
	l1_file_for_strip="${PCA_L1_FILE:-$l1}"
	ext="${PCA_EXT:-}"
	marker="${PCA_MARKER:-@pca}"
	provisional="${PCA_PROVISIONAL:-}"
	[ -n "$ext" ] && : "$ext"
else
	if [ "$#" -lt 1 ]; then
		echo "usage: $0 <manifest-entry-json>  OR  env vars (PCA_L1, PCA_ORIG_HASH, ...)" >&2
		exit 2
	fi
	entry="$1"
	l1=$(printf '%s' "$entry" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const e=JSON.parse(s);process.stdout.write(e.annotated||"")})')
	orig_hash=$(printf '%s' "$entry" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const e=JSON.parse(s);process.stdout.write(e.hashes?.original||"")})')
	l1_hash_stored=$(printf '%s' "$entry" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const e=JSON.parse(s);process.stdout.write(e.hashes?.annotated||"")})')
	anno_tpl_stored=$(printf '%s' "$entry" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const e=JSON.parse(s);process.stdout.write(e.annotateTemplateHash||"")})')
	pseudo_tpl_stored=$(printf '%s' "$entry" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const e=JSON.parse(s);process.stdout.write(e.pseudocodeTemplateHash||"")})')
	provisional=$(printf '%s' "$entry" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const e=JSON.parse(s);process.stdout.write(Array.isArray(e.provisional)?e.provisional.join(","):"")})')
	anno_tpl_current="${PCA_ANNOTATE_TPL_CURRENT:-}"
	pseudo_tpl_current="${PCA_PSEUDO_TPL_CURRENT:-}"
	l1_file_for_strip="$l1"
	ext="${PCA_EXT:-}"
	marker="${PCA_MARKER:-@pca}"
fi

code=0
messages=()
notes=()

# 5. Provisional completeness note (not a drift failure)
if [ -n "$provisional" ]; then
	notes+=("PROVISIONAL: these functions have thin (BEHAVIOR-only) specs pending Op1 confirmation: $provisional")
fi

# 1. L0 stale: hash(strip(L1)) vs hashes.original
if [ -f "$l1_file_for_strip" ] && [ -n "$orig_hash" ]; then
	stripped_hash=$(node "$here/strip-comments.js" "$l1_file_for_strip" --marker "$marker" --comment line 2>/dev/null |
		node -e 'let s="";const c=require("node:crypto");process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(c.createHash("sha256").update(s).digest("hex")))')
	stored=$(printf '%s' "$orig_hash" | sed 's/^sha256://')
	if [ -n "$stripped_hash" ] && [ "$stripped_hash" != "$stored" ]; then
		messages+=("L0 STALE: original code changed outside the skill; spec is stale. Recommend re-annotate. (strip(L1)=$stripped_hash, stored=$stored)")
		code=10
	fi
fi

# 2. L1 anomalous: hash(L1) vs hashes.annotated
if [ -f "$l1" ] && [ -n "$l1_hash_stored" ]; then
	l1_hash_now=$(node -e 'const c=require("node:crypto");const f=require("node:fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$l1")
	l1_stored=$(printf '%s' "$l1_hash_stored" | sed 's/^sha256://')
	if [ "$l1_hash_now" != "$l1_stored" ]; then
		messages+=("L1 ANOMALOUS: annotated code was edited directly; this shouldn't happen. (L1 now=$l1_hash_now, stored=$l1_stored)")
		code=$((code == 0 ? 11 : 20))
	fi
fi

# 3. Annotate template changed
if [ -n "$anno_tpl_stored" ] && [ -n "$anno_tpl_current" ] && [ "$anno_tpl_stored" != "$anno_tpl_current" ]; then
	messages+=("ANNOTATE TEMPLATE CHANGED: annotate template changed since annotation; L1/specs use the old template. Re-annotate to refresh. (stored=$anno_tpl_stored, current=$anno_tpl_current)")
	code=$((code == 0 ? 12 : 20))
fi

# 4. Pseudocode template changed
if [ -n "$pseudo_tpl_stored" ] && [ -n "$pseudo_tpl_current" ] && [ "$pseudo_tpl_stored" != "$pseudo_tpl_current" ]; then
	messages+=("PSEUDOCODE TEMPLATE CHANGED: pseudocode template changed since L2 was generated; L2 uses the old template. Re-run pseudocode to refresh. (stored=$pseudo_tpl_stored, current=$pseudo_tpl_current)")
	code=$((code == 0 ? 13 : 20))
fi

# Print provisional notes (always, to stderr — they're informational)
for n in "${notes[@]:-}"; do [ -n "$n" ] && echo "$n" >&2; done

if [ "${#messages[@]}" -gt 0 ]; then
	for m in "${messages[@]}"; do echo "$m" >&2; done
	exit "$code"
fi

echo "no drift"
exit 0
