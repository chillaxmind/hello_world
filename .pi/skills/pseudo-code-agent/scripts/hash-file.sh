#!/usr/bin/env bash
# hash-file.sh — print sha256 of a file's contents (no trailing newline in output).
# Usage: scripts/hash-file.sh <path>
# Exits non-zero if the file does not exist or is not readable.
set -euo pipefail

if [ "$#" -lt 1 ]; then
	echo "usage: $0 <path>" >&2
	exit 2
fi

file="$1"
if [ ! -f "$file" ]; then
	echo "error: not a regular file: $file" >&2
	exit 1
fi

sha256sum "$file" | awk '{print $1}'
