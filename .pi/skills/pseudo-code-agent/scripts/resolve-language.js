#!/usr/bin/env node
// resolve-language.js — look up a file's { language, comment } mapping from
// pca/config.yaml. STRICT: exits non-zero with a refusal message if the
// extension has no entry (no silent default fallback).
//
// Usage: scripts/resolve-language.js --config <config.yaml> --file <path>
// Prints `language=<lang> comment=<line|block>` on success.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { extname } from "node:path";
import yaml from "js-yaml";

const args = parseArgs({
	args: process.argv.slice(2),
	options: { config: { type: "string" }, file: { type: "string" } },
	allowPositionals: true,
});

if (!args.values.config || !args.values.file) {
	console.error(
		"usage: resolve-language.js --config <config.yaml> --file <path>",
	);
	process.exit(2);
}

const cfg = yaml.load(readFileSync(args.values.config, "utf8"));
const languages = cfg.languages ?? {};
const ext = extname(args.values.file);

if (!(ext in languages)) {
	console.error(
		`REFUSED: no language mapping for extension '${ext}' (file: ${args.values.file}). Add an entry to pca/config.yaml under 'languages' or skip. No silent default fallback.`,
	);
	process.exit(1);
}

const entry = languages[ext];
console.log(`language=${entry.language} comment=${entry.comment}`);
