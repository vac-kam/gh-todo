#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v gh &>/dev/null; then
  printf '\033[1;33mWarning: gh (GitHub CLI) is required but was not found.\033[0m\n'
  printf '  Install it from https://cli.github.com before using gh-todo.\n\n'
fi

# Prefer user-local writable directories, then fall back to any writable PATH entry
preferred=(
  "$HOME/.local/bin"
  "$HOME/bin"
  "/opt/homebrew/bin"
  "/usr/local/bin"
)

install_dir=""
for dir in "${preferred[@]}"; do
  if [[ ":$PATH:" == *":$dir:"* ]] && [ -w "$dir" ]; then
    install_dir="$dir"
    break
  fi
done

if [ -z "$install_dir" ]; then
  IFS=':' read -ra path_dirs <<< "$PATH"
  for dir in "${path_dirs[@]}"; do
    if [ -w "$dir" ]; then
      install_dir="$dir"
      break
    fi
  done
fi

if [ -z "$install_dir" ]; then
  printf '\033[1;91mCould not find a writable directory in PATH to install to.\033[0m\n'
  exit 1
fi

cp "$SCRIPT_DIR/gh-todo" "$install_dir/gh-todo"
chmod +x "$install_dir/gh-todo"
printf '\033[1;32mgh-todo installed to %s/gh-todo\033[0m\n' "$install_dir"
