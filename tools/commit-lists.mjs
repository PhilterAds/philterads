// Commit step of the weekly list refresh (run by .github/workflows/
// refresh-lists.yml, after build + tests + the shrink guard). If the rebuild
// actually changed rulesets/ or cosmetic/ (a STATS.md-only timestamp bump
// does not count — the build rewrites its "Built" line every run), bumps the
// manifest patch version so the popup's version visibly moves, commits as
// github-actions[bot] and pushes to main. Exits 0 without committing when nothing
// meaningful changed. Run from the repo root.

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const git = (...args) => run('git', args);

const { stdout: statusOut } = await git('status', '--porcelain');
const changedPaths = statusOut.split('\n').filter(Boolean).map((line) => {
  let p = line.slice(3);
  if (p.includes(' -> ')) p = p.slice(p.lastIndexOf(' -> ') + 4); // renames
  return p.replace(/^"|"$/g, '').trim();
});

const meaningful = changedPaths.filter((p) =>
  (p.startsWith('rulesets/') || p.startsWith('cosmetic/')) && p !== 'rulesets/STATS.md');

if (meaningful.length === 0) {
  console.log('commit-lists: no ruleset or cosmetic changes (STATS.md timestamp only) — nothing to commit.');
  process.exit(0);
}
console.log(`commit-lists: changed: ${[...new Set([...meaningful, 'rulesets/STATS.md'])].join(', ')}`);

// Bump the manifest patch version (1.2.0 -> 1.2.1) so the popup shows the
// refresh. Preserve the file's exact shape: 2-space JSON, same ending.
const manifestPath = 'manifest.json';
const raw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw);
const [major, minor, patch] = String(manifest.version).split('.').map(Number);
manifest.version = `${major}.${minor}.${patch + 1}`;
const endsWithNewline = raw.endsWith('\n');
const next = JSON.stringify(manifest, null, 2) + (endsWithNewline ? '\n' : '');
await writeFile(manifestPath, next, 'utf8');
console.log(`commit-lists: manifest version -> ${manifest.version}`);

const date = new Date().toISOString().slice(0, 10); // UTC; the job runs 06:00 UTC Monday
await git('add', 'rulesets', 'cosmetic', manifestPath);
await git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
  'commit', '-m', `lists: refresh ${date}`);
await git('push', 'origin', 'HEAD:main');
const { stdout: headOut } = await git('rev-parse', '--short', 'HEAD');
console.log(`commit-lists: pushed ${headOut.trim()} (${meaningful.length} paths) to main`);
