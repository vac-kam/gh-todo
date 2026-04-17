# gh-todo

A terminal dashboard for your GitHub work. Shows open PRs awaiting review, PRs others have requested you review, and issues assigned to you — grouped by repo and sorted by date.

## Requirements

- [gh](https://cli.github.com) — GitHub CLI, authenticated with `gh auth login`
- `jq`

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/vac-kam/gh-todo/main/install.sh | bash
```

## Usage

```bash
gh-todo --dir <path>
```

Discovers all GitHub repos recursively within a directory and shows your todo summary.

```bash
gh-todo --repos <owner/repo1,owner/repo2,...>
```

Explicitly specify which repos to query.

```bash
gh-todo --help
```
