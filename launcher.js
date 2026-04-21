#!/usr/bin/env node
// Launcher for gh-todo.
//
// Node's --experimental-strip-types refuses to process files that live under
// node_modules. This script (plain JS, no types) keeps a copy of gh-todo.ts
// in ~/.config/gh-todo/ — outside of node_modules — then runs it from there.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR     = dirname(fileURLToPath(import.meta.url));
const RUNTIME_DIR = join(homedir(), '.config', 'gh-todo');
const SCRIPT_SRC  = join(PKG_DIR, 'gh-todo.ts');
const SCRIPT_DEST = join(RUNTIME_DIR, 'gh-todo.ts');
const PKG_DEST    = join(RUNTIME_DIR, 'package.json');

if (!existsSync(SCRIPT_SRC)) {
  process.stderr.write('gh-todo: gh-todo.ts missing from package — try reinstalling.\n');
  process.exit(1);
}

// Ensure the runtime dir has a package.json so Node treats the .ts as ESM.
mkdirSync(RUNTIME_DIR, { recursive: true });
if (!existsSync(PKG_DEST)) {
  writeFileSync(PKG_DEST, '{ "type": "module" }\n', 'utf8');
}

// Keep the installed script in sync with the package version.
const src = readFileSync(SCRIPT_SRC, 'utf8');
if (!existsSync(SCRIPT_DEST) || readFileSync(SCRIPT_DEST, 'utf8') !== src) {
  copyFileSync(SCRIPT_SRC, SCRIPT_DEST);
}

const result = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', SCRIPT_DEST, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

process.exit(result.status ?? 1);
