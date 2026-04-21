#!/usr/bin/env -S node --experimental-strip-types --no-warnings

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────

interface SectionConfig {
  title: string;
  /** ANSI colour code, e.g. "91" = red, "92" = green, "95" = magenta */
  color?: string;
  /**
   * gh subcommand to run per repo.  Use {me} as a placeholder for the
   * authenticated user's login, e.g. "pr list --author {me}"
   */
  command: string;
  /** Show the PR author next to the number (default false) */
  showAuthor?: boolean;
  /** Only include PRs that have no reviewer assigned (default false) */
  noReviewer?: boolean;
  /** Exclude items whose author is the authenticated user (default false) */
  excludeSelf?: boolean;
}

interface PrItem {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  reviewDecision: string;
  reviewRequests: unknown[];
  author: { login: string };
  repo: string;
}

interface IssueItem {
  number: number;
  title: string;
  url: string;
  createdAt: string;
  labels: { name: string }[];
  repo: string;
}

// ── Colors ─────────────────────────────────────────────────────────────────

const BOLD   = '\x1b[1m';
const RESET  = '\x1b[0m';
const DIM_I  = '\x1b[90;3m'; // dim + italic, used for URLs
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const CYAN_B = '\x1b[1;96m'; // bold bright cyan, used for repo headers

// ── Config paths ───────────────────────────────────────────────────────────

const CONFIG_DIR  = join(homedir(), '.config', 'gh-todo');
const CONFIG_PATH = join(CONFIG_DIR, 'config.jsonc');

// ── Default config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG_JSONC = `[
  // Your open PRs that have no reviewer assigned yet
  {
    "title": "Your PRs with no reviewer assigned",
    "color": "91",
    "command": "pr list --author {me}",
    "noReviewer": true
  },

  // PRs where someone has requested your review
  {
    "title": "PRs due for your review",
    "color": "92",
    "command": "pr list --search \\"review-requested:{me}\\"",
    "showAuthor": true,
    "excludeSelf": true
  },

  // Open issues currently assigned to you
  {
    "title": "Issues assigned to you",
    "color": "95",
    "command": "issue list --assignee {me}"
  }
]
`;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip JS-style comments and trailing commas so the string parses as JSON. */
function parseJsonc(src: string): unknown {
  const stripped = src
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped);
}

/** Run a command synchronously; return trimmed stdout or null on failure. */
function exec(cmd: string, args: string[]): string | null {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

/** Run a gh command and return parsed JSON output, or null on failure. */
function ghJson<T>(args: string[]): T | null {
  const env = { ...process.env, GH_PAGER: 'cat' };
  const r = spawnSync('gh', args, { encoding: 'utf8', env });
  if (r.error || r.status !== 0) return null;
  try { return JSON.parse(r.stdout) as T; } catch { return null; }
}

/**
 * Tokenise a shell-like string into an argument array.
 * Handles double- and single-quoted spans; does not expand variables.
 */
function tokenize(cmd: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let q: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (q) {
      if (ch === q) q = null; else cur += ch;
    } else if (ch === '"' || ch === "'") {
      q = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (cur) { tokens.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

// ── Repo discovery ─────────────────────────────────────────────────────────

function findReposInDir(dir: string): string[] {
  const repos = new Set<string>();

  function walk(d: string): void {
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }

    if (entries.includes('.git')) {
      const remote = exec('git', ['-C', d, 'remote', 'get-url', 'origin']);
      if (remote?.includes('github.com')) {
        const slug = remote
          .replace(/.*github\.com[/:]/, '')
          .replace(/\.git$/, '')
          .replace(/\/$/, '');
        if (slug) repos.add(slug);
      }
      return; // don't recurse into repos
    }

    for (const e of entries) {
      if (e.startsWith('.')) continue;
      const full = join(d, e);
      try { if (statSync(full).isDirectory()) walk(full); } catch { /* skip */ }
    }
  }

  walk(dir);
  return [...repos].sort();
}

function validateRepos(repos: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const env = { ...process.env, GH_PAGER: 'cat' };
  for (const repo of repos) {
    const r = spawnSync('gh', ['repo', 'view', repo, '--json', 'name'], { encoding: 'utf8', env });
    (r.status === 0 ? valid : invalid).push(repo);
  }
  return { valid, invalid };
}

// ── Display ────────────────────────────────────────────────────────────────

function printSection(title: string, color: string): void {
  const line = '─'.repeat(title.length);
  process.stdout.write(`\n${BOLD}\x1b[${color}m${title}\n${line}${RESET}\n`);
}

function groupByRepo<T extends { repo: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const bucket = map.get(item.repo) ?? [];
    bucket.push(item);
    map.set(item.repo, bucket);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

function printPrItems(items: PrItem[], showAuthor: boolean): void {
  for (const [repo, repoItems] of groupByRepo(items)) {
    process.stdout.write(`\n${CYAN_B}${repo}${RESET}\n\n`);
    const sorted = [...repoItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const pr of sorted) {
      const date   = pr.createdAt.slice(0, 10);
      const rd     = pr.reviewDecision
        ? `  ${pr.reviewDecision.toLowerCase().replace(/_/g, ' ')}`
        : '';
      const author = showAuthor ? `  by ${pr.author.login}` : '';
      process.stdout.write(
        `  ${BLUE}${date}${RESET}  ${YELLOW}#${pr.number}${author}${rd}${RESET}  ${BOLD}${pr.title}${RESET}\n` +
        `  ${DIM_I}${pr.url}${RESET}\n`,
      );
    }
  }
}

function printIssueItems(items: IssueItem[]): void {
  for (const [repo, repoItems] of groupByRepo(items)) {
    process.stdout.write(`\n${CYAN_B}${repo}${RESET}\n\n`);
    const sorted = [...repoItems].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const issue of sorted) {
      const date   = issue.createdAt.slice(0, 10);
      const labels = issue.labels.length > 0
        ? `  ${issue.labels.map(l => l.name).join(', ')}`
        : '';
      process.stdout.write(
        `  ${BLUE}${date}${RESET}  ${YELLOW}#${issue.number}${labels}${RESET}  ${BOLD}${issue.title}${RESET}\n` +
        `  ${DIM_I}${issue.url}${RESET}\n`,
      );
    }
  }
}

// ── Section runner ─────────────────────────────────────────────────────────

function runSection(section: SectionConfig, repos: string[], me: string): void {
  const command = section.command.replace(/\{me\}/g, me);
  const tokens  = tokenize(command);
  const isPr    = tokens[0] === 'pr'    && tokens[1] === 'list';
  const isIssue = tokens[0] === 'issue' && tokens[1] === 'list';

  if (!isPr && !isIssue) {
    process.stderr.write(
      `\x1b[1;33mWarning: unrecognised command in "${section.title}": ${section.command}\x1b[0m\n`,
    );
    return;
  }

  const fields = isPr
    ? 'number,title,url,reviewRequests,reviewDecision,createdAt,author'
    : 'number,title,url,labels,createdAt';

  const allItems: (PrItem | IssueItem)[] = [];

  for (const repo of repos) {
    const items = ghJson<(PrItem | IssueItem)[]>([...tokens, '-R', repo, '--json', fields]);
    if (!items) continue;
    for (const item of items) {
      item.repo = repo;
      allItems.push(item);
    }
  }

  let results = allItems;

  if (section.noReviewer && isPr)
    results = results.filter(i => (i as PrItem).reviewRequests?.length === 0);
  if (section.excludeSelf)
    results = results.filter(i => (i as PrItem).author?.login !== me);

  if (isPr) printPrItems(results as PrItem[], section.showAuthor ?? false);
  else      printIssueItems(results as IssueItem[]);
}

// ── Config ─────────────────────────────────────────────────────────────────

function loadConfig(): SectionConfig[] {
  if (!existsSync(CONFIG_PATH)) {
    process.stderr.write(
      `\x1b[1;33mNo config found at ${CONFIG_PATH}\n` +
      `Run \x1b[1mgh-todo --write-default-config\x1b[0;33m to create one.\x1b[0m\n\n`,
    );
    process.exit(1);
  }
  try {
    return parseJsonc(readFileSync(CONFIG_PATH, 'utf8')) as SectionConfig[];
  } catch (e) {
    process.stderr.write(`\x1b[1;91mFailed to parse ${CONFIG_PATH}:\n${e}\x1b[0m\n`);
    process.exit(1);
  }
}

function writeDefaultConfig(): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, DEFAULT_CONFIG_JSONC, 'utf8');
  process.stdout.write(
    `\x1b[1;32mDefault config written to ${CONFIG_PATH}\x1b[0m\n` +
    `Edit it to customise your sections.\n`,
  );
}

// ── Help ───────────────────────────────────────────────────────────────────

const HELP = `\
${BOLD}Description:${RESET}
  Scans GitHub repositories and shows a summary of your open PRs
  awaiting review, PRs others have requested you review, and issues
  assigned to you — sorted by date and grouped by repo.

${BOLD}Usage:${RESET} gh-todo --dir <path> | --repos <repo1,repo2,...>

  Exactly one of --dir or --repos must always be provided.

${BOLD}Options:${RESET}
  --dir <path>              Discover repos recursively in a directory
  --repos <r1,r2,...>       Explicit comma-separated list of owner/repo
  --write-default-config    Write default config to ${CONFIG_PATH}
  -h, --help                Show this help message

${BOLD}Config:${RESET} ${CONFIG_PATH}
  Each section entry supports:
    "title"       Section heading
    "color"       ANSI colour code (e.g. "91" = red, "92" = green)
    "command"     gh subcommand with optional {me} placeholder,
                  e.g. "pr list --author {me}"
    "showAuthor"  Show PR author next to number  (default false)
    "noReviewer"  Only show PRs with no reviewer (default false)
    "excludeSelf" Exclude items you authored     (default false)`;

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  let dir = '';
  let reposArg = '';
  let doWriteConfig = false;

  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '-h':
      case '--help':
        process.stdout.write(HELP + '\n');
        process.exit(0);
        break;
      case '--dir':
        dir = argv[++i] ?? '';
        break;
      case '--repos':
        reposArg = argv[++i] ?? '';
        break;
      case '--write-default-config':
        doWriteConfig = true;
        break;
      default:
        process.stderr.write(`\x1b[1;91mUnknown argument: ${argv[i]}\x1b[0m\n`);
        process.exit(1);
    }
  }

  if (doWriteConfig) {
    writeDefaultConfig();
    process.exit(0);
  }

  const config = loadConfig();

  if ((reposArg && dir) || (!reposArg && !dir)) {
    process.stdout.write(HELP + '\n');
    process.exit(1);
  }

  let repos: string[];

  if (reposArg) {
    repos = reposArg.split(',').map(r => r.trim()).filter(Boolean);
  } else {
    if (!existsSync(dir)) {
      process.stderr.write('\x1b[1;91mDirectory not found :(\x1b[0m\n');
      process.exit(1);
    }
    repos = findReposInDir(dir);
    if (repos.length === 0) {
      process.stderr.write('\x1b[1;91mPassed directory has no repositories :(\x1b[0m\n');
      process.exit(1);
    }
  }

  const { valid, invalid } = validateRepos(repos);

  if (valid.length === 0) {
    process.stderr.write('\x1b[1;91mNone of the provided repositories are valid:\x1b[0m\n');
    for (const r of invalid) process.stderr.write(`\x1b[1;91m  - ${r}\x1b[0m\n`);
    process.exit(1);
  }

  if (invalid.length > 0) {
    process.stderr.write('\x1b[1;33mWarning: the following repos are unavailable and will be skipped:\x1b[0m\n');
    for (const r of invalid) process.stderr.write(`\x1b[1;33m  - ${r}\x1b[0m\n`);
    process.stderr.write('\n');
  }

  const me = exec('gh', ['api', 'user', '--jq', '.login']);
  if (!me) {
    process.stderr.write('\x1b[1;91mFailed to get authenticated user. Are you logged in? (gh auth login)\x1b[0m\n');
    process.exit(1);
  }

  for (const section of config) {
    printSection(section.title, section.color ?? '97');
    runSection(section, valid, me);
  }

  process.stdout.write('\n');
}

main();
