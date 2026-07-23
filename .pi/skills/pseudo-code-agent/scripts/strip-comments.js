#!/usr/bin/env node
// strip-comments.js — delete exactly the skill's marker-prefixed comments
// from an L1 file, writing the result to an output path (default: stdout).
//
// A comment is removed if and only if it contains the marker (default "@pca").
// Human-authored comments are preserved. Deterministic; no LLM.
//
// Usage:
//   scripts/strip-comments.js <input> [output] [--marker <string>] [--comment line|block]
//
// If --comment is omitted, the script auto-detects line vs block comments by
// extension. Block comments are removed only if the marker appears inside them;
// the entire block (delimiters included) is removed in that case.
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { parseArgs } from "node:util";
import { extname } from "node:path";

const LINE_PREFIXES = {
	".ts": "//",
	".tsx": "//",
	".js": "//",
	".jsx": "//",
	".go": "//",
	".rs": "//",
	".c": "//",
	".cpp": "//",
	".java": "//",
	".py": "#",
	".sh": "#",
	".yaml": "#",
	".yml": "#",
	".toml": "#",
	".sql": "--",
};

const BLOCK_DELIMS = {
	".ts": ["/*", "*/"],
	".tsx": ["/*", "*/"],
	".js": ["/*", "*/"],
	".jsx": ["/*", "*/"],
	".go": ["/*", "*/"],
	".rs": ["/*", "*/"],
	".c": ["/*", "*/"],
	".cpp": ["/*", "*/"],
	".java": ["/*", "*/"],
	".sql": ["/*", "*/"],
	".py": ['"""', '"""'],
};

function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			marker: { type: "string", default: "@pca" },
			comment: { type: "string" },
		},
		allowPositionals: true,
	});
	const input = args.positionals[0];
	if (!input) {
		console.error(
			"usage: strip-comments.js <input> [output] [--marker <s>] [--comment line|block]",
		);
		process.exit(2);
	}
	const output = args.positionals[1];
	const marker = args.values.marker ?? "@pca";
	const ext = extname(input);
	const comment = args.values.comment ?? (BLOCK_DELIMS[ext] ? "block" : "line");

	const src = readFileSync(input, "utf8");
	const out = strip(src, marker, comment, ext);

	if (output) {
		writeFileSync(output, out);
	} else {
		process.stdout.write(out);
	}
}

// Strip marker-prefixed comments. Line comments: drop any line whose comment
// portion contains the marker. Block comments: drop any block whose content
// contains the marker (entire block, delimiters included). Non-comment lines
// and human comments are preserved exactly.
function strip(src, marker, comment, ext) {
	if (comment === "line") return stripLineComments(src, marker, ext);
	return stripBlockComments(src, marker, ext);
}

function linePrefix(ext) {
	return LINE_PREFIXES[ext] ?? "//";
}

// Drop lines that are skill line-comments (comment prefix + marker).
// A line qualifies if, after leading whitespace, it begins with the comment
// prefix AND the remainder (after the prefix) contains the marker. Human
// comments (no marker) and all code lines are kept.
function stripLineComments(src, marker, ext) {
	const prefix = linePrefix(ext);
	const lines = src.split("\n");
	const kept = [];
	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith(prefix)) {
			const after = trimmed.slice(prefix.length);
			if (after.includes(marker)) continue; // drop this skill comment line
		}
		kept.push(line);
	}
	return kept.join("\n");
}

// Drop block comments whose content contains the marker. From a start
// delimiter to the next end delimiter; if the marker appears inside, the
// whole block (delimiters included) is removed. Nested delimiters unsupported.
function stripBlockComments(src, marker, ext) {
	const [start, end] = BLOCK_DELIMS[ext] ?? ["/*", "*/"];
	let out = "";
	let i = 0;
	while (i < src.length) {
		const startIdx = src.indexOf(start, i);
		if (startIdx === -1) {
			out += src.slice(i);
			break;
		}
		out += src.slice(i, startIdx);
		const endIdx = src.indexOf(end, startIdx + start.length);
		if (endIdx === -1) {
			out += src.slice(startIdx);
			break;
		} // unterminated
		const blockContent = src.slice(startIdx, endIdx + end.length);
		if (blockContent.includes(marker)) {
			i = endIdx + end.length;
			if (src[i] === "\n") i += 1;
			else if (src[i] === "\r" && src[i + 1] === "\n") i += 2;
		} else {
			out += blockContent;
			i = endIdx + end.length;
		}
	}
	return out;
}

main();
