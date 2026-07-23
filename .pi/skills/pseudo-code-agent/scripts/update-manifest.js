#!/usr/bin/env node
// update-manifest.js — atomic read-modify-write of pca/manifest.yaml.
//
// Reads the manifest, applies a mutation described as a JSON patch on stdin,
// and rewrites the file in full after the in-memory update (atomic write via
// temp file + rename). Prints the updated manifest as YAML on stdout.
//
// Patch format (JSON on stdin):
//   { "op": "upsertEntry", "entry": { ...full entry fields... } }
//   { "op": "removeEntry", "id": "src/foo.ts" }
//   { "op": "setCapability", "name": "auth", "spec": "...", "members": [...],
//     "memberSpecHashes": { ... } }
//   { "op": "removeCapability", "name": "auth" }
//
// Usage: scripts/update-manifest.js [--manifest <path>] [--input <json-file>]
import {
	readFileSync,
	writeFileSync,
	mkdtempSync,
	renameSync,
	rmSync,
	mkdirSync,
} from "node:fs";
import { stdin } from "node:process";
import process from "node:process";
import { parseArgs } from "node:util";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import yaml from "js-yaml";

async function main() {
	const args = parseArgs({
		args: process.argv.slice(2),
		options: {
			manifest: { type: "string", default: "pca/manifest.yaml" },
			input: { type: "string" },
		},
		allowPositionals: true,
	});
	const manifestPath = args.values.manifest;

	let manifest;
	try {
		manifest = yaml.load(readFileSync(manifestPath, "utf8")) ?? {};
	} catch {
		manifest = {};
	}
	if (!manifest.capabilities) manifest.capabilities = {};
	if (!manifest.entries) manifest.entries = [];

	let raw;
	if (args.values.input) raw = readFileSync(args.values.input, "utf8");
	else raw = await readAllStdin();

	let patch;
	try {
		patch = JSON.parse(raw);
	} catch {
		console.error("error: invalid JSON patch");
		process.exit(2);
	}
	applyPatch(manifest, patch);

	const yamlText = yaml.dump(manifest, {
		lineWidth: -1,
		noRefs: true,
		sortKeys: false,
	});
	atomicWrite(manifestPath, yamlText);
	process.stdout.write(yamlText);
}

function applyPatch(m, patch) {
	switch (patch.op) {
		case "upsertEntry": {
			const e = patch.entry;
			const i = m.entries.findIndex((x) => x.id === e.id);
			const merged = i >= 0 ? { ...m.entries[i], ...e } : e;
			if (i >= 0) m.entries[i] = merged;
			else m.entries.push(merged);
			break;
		}
		case "removeEntry":
			m.entries = m.entries.filter((x) => x.id !== patch.id);
			break;
		case "setCapability":
			m.capabilities[patch.name] = {
				spec: patch.spec,
				members: patch.members ?? [],
				memberSpecHashes: patch.memberSpecHashes ?? {},
			};
			break;
		case "removeCapability":
			delete m.capabilities[patch.name];
			break;
		default:
			console.error(`error: unknown op '${patch.op}'`);
			process.exit(2);
	}
}

function atomicWrite(path, content) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = mkdtempSync(join(tmpdir(), "pca-manifest-"));
	const tmpFile = join(tmp, "manifest.yaml");
	writeFileSync(tmpFile, content);
	try {
		renameSync(tmpFile, path);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
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

main();
