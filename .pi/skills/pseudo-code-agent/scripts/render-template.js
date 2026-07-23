#!/usr/bin/env node
// render-template.js — render annotation blocks and insert them into L0 to
// form L1. Supports two modes:
//   - "auto"  (per-function): one marked block per discovered function,
//             inserted at each function's start line (from the LLM placement
//             plan). Blocks are delimited by @pca BEGIN FN: <name> / END FN.
//   - "whole" (whole-file):   one block for the entire file, inserted at the
//             top. Delimited by @pca BEGIN ANNOTATION / END ANNOTATION.
//
// Refuses unmapped extensions (strict — no silent fallback).
//
// Input: a JSON object on stdin (or --input <file>) with shape:
//   {
//     "ext": ".ts",
//     "marker": "@pca",
//     "comment": "line",            // "line" | "block" (from config.languages)
//     "l0Path": "src/auth/login.ts", // L0 file to insert into
//     "mode": "auto",               // "auto" | "whole"
//     "functions": [                // required when mode = "auto"
//       { "name": "login", "insertAtLine": 10,
//         "sections": [ { "name": "PURPOSE", "answer": "..." }, ... ] }
//     ],
//     "sections": [ ... ]           // required when mode = "whole"
//   }
// Output: the full L1 (L0 with inserted annotation blocks) on stdout.
//
// Usage:
//   echo '<json>' | scripts/render-template.js
//   scripts/render-template.js --input plan.json
import { readFileSync, writeFileSync } from "node:fs";
import { stdin } from "node:process";
import { parseArgs } from "node:util";

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

const LINE_PREFIX = {
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

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: { input: { type: "string" }, output: { type: "string" } },
		allowPositionals: true,
	});

	let raw;
	if (args.values.input) {
		raw = readFileSync(args.values.input, "utf8");
	} else {
		raw = await readAllStdin();
	}

	let spec;
	try {
		spec = JSON.parse(raw);
	} catch {
		console.error("error: invalid JSON input");
		process.exit(2);
	}

	const {
		ext,
		marker = "@pca",
		comment,
		l0Path,
		mode = "auto",
		functions = [],
		sections = [],
	} = spec;
	if (!ext) {
		console.error("error: missing required field 'ext'");
		process.exit(2);
	}
	if (!comment) {
		console.error("error: missing required field 'comment'");
		process.exit(2);
	}
	if (!l0Path) {
		console.error("error: missing required field 'l0Path'");
		process.exit(2);
	}

	const l0 = readFileSync(l0Path, "utf8");
	let l1;

	if (mode === "whole") {
		const block = renderBlock(
			comment,
			ext,
			marker,
			"ANNOTATION",
			null,
			sections,
		);
		l1 = block + l0;
	} else if (mode === "auto") {
		if (functions.length === 0) {
			console.error(
				"error: mode 'auto' requires a non-empty 'functions' array",
			);
			process.exit(2);
		}
		// Insert per-function blocks. Process in REVERSE order of insertAtLine so
		// earlier insertions don't shift later line numbers.
		const sorted = [...functions].sort(
			(a, b) => (b.insertAtLine ?? 0) - (a.insertAtLine ?? 0),
		);
		const lines = l0.split("\n");
		for (const fn of sorted) {
			const block = renderBlock(
				comment,
				ext,
				marker,
				"FN",
				fn.name,
				fn.sections ?? [],
			);
			const insertAt = Math.max(0, (fn.insertAtLine ?? 1) - 1); // 1-indexed -> 0-indexed
			// Strip the trailing newline before splitting so no empty element is
			// spliced in (which would leave a blank line after strip).
			const blockLines = block.replace(/\n$/, "").split("\n");
			lines.splice(insertAt, 0, ...blockLines);
		}
		l1 = lines.join("\n");
	} else {
		console.error(`error: mode must be 'auto' or 'whole', got '${mode}'`);
		process.exit(2);
	}

	if (args.values.output) {
		writeFileSync(args.values.output, l1);
	} else {
		process.stdout.write(l1);
	}
}

function readAllStdin() {
	return new Promise((resolve, reject) => {
		let data = "";
		stdin.setEncoding("utf8");
		stdin.on("data", (c) => (data += c));
		stdin.on("end", () => resolve(data));
		stdin.on("error", reject);
	});
}

// Render one annotation block. `kind` is "FN" (per-function) or "ANNOTATION"
// (whole-file). `name` is the function name (null for whole-file).
function renderBlock(comment, ext, marker, kind, name, sections) {
	if (comment === "line") {
		if (!LINE_PREFIX[ext]) {
			console.error(
				`error: no line-comment prefix known for extension '${ext}'`,
			);
			process.exit(1);
		}
		return renderLine(LINE_PREFIX[ext], marker, kind, name, sections);
	} else if (comment === "block") {
		if (!BLOCK_DELIMS[ext]) {
			console.error(
				`error: no block-comment delimiters known for extension '${ext}'`,
			);
			process.exit(1);
		}
		return renderBlockComment(BLOCK_DELIMS[ext], marker, kind, name, sections);
	}
	console.error(`error: comment must be 'line' or 'block', got '${comment}'`);
	process.exit(2);
}

function renderLine(prefix, marker, kind, name, sections) {
	const beginLabel =
		kind === "FN" ? `BEGIN FN: ${name ?? ""}` : "BEGIN ANNOTATION";
	const endLabel = kind === "FN" ? "END FN" : "END ANNOTATION";
	const lines = [];
	lines.push(`${prefix} ${marker} ${beginLabel}`);
	for (const s of sections) {
		lines.push(`${prefix} ${marker} ${s.name}:`);
		for (const line of String(s.answer ?? "").split("\n")) {
			lines.push(`${prefix} ${marker}   ${line}`);
		}
	}
	lines.push(`${prefix} ${marker} ${endLabel}`);
	return lines.join("\n") + "\n";
}

function renderBlockComment([start, end], marker, kind, name, sections) {
	const beginLabel =
		kind === "FN" ? `BEGIN FN: ${name ?? ""}` : "BEGIN ANNOTATION";
	const endLabel = kind === "FN" ? "END FN" : "END ANNOTATION";
	const lines = [`${start} ${marker} ${beginLabel}`];
	for (const s of sections) {
		lines.push(`${marker} ${s.name}:`);
		for (const line of String(s.answer ?? "").split("\n")) {
			lines.push(`  ${line}`);
		}
	}
	lines.push(`${marker} ${endLabel}`);
	lines.push(` ${end}`);
	return lines.join("\n") + "\n";
}

main();
