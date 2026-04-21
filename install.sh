#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Dependency checks ─────────────────────────────────────────────────────

if ! command -v gh &>/dev/null; then
  printf '\033[1;33mWarning: gh (GitHub CLI) is required but was not found.\033[0m\n'
  printf '  Install it from https://cli.github.com before using gh-todo.\n\n'
fi

if ! command -v node &>/dev/null; then
  printf '\033[1;91mError: node (Node.js >= 22.6.0) is required but was not found.\033[0m\n'
  printf '  Install it from https://nodejs.org\n'
  exit 1
fi

node_major=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$node_major" -lt 22 ]; then
  printf '\033[1;91mError: Node.js 22+ is required (found %s).\033[0m\n' "$(node --version)"
  printf '  --experimental-strip-types is needed to run TypeScript directly.\n'
  printf '  Install a newer version from https://nodejs.org\n'
  exit 1
fi

if ! command -v npm &>/dev/null; then
  printf '\033[1;91mError: npm is required but was not found.\033[0m\n'
  exit 1
fi

# ── Install ───────────────────────────────────────────────────────────────

npm install -g "$SCRIPT_DIR"
