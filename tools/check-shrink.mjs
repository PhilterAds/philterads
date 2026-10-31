// Guard for the weekly list refresh: compares the freshly built per-list
// rule counts (rulesets/blocks.json in the working tree) against the
// committed ones (git show HEAD:...), so a broken download or a parser
// regression can never silently replace a good ruleset. Fails when a
// default-on list loses more than 30% of its rules, or any list ends up
// with 0 rules. Run from the repo root (the workflow does, after
// `npm run build:rules`).

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { LISTS, HAND_RULESETS } from './lib/lists.js';

const run = promisify(execFile);

const current = JSON.parse(await readFile('rulesets/blocks.json', 'utf8'));

let committed = null;
try {
  const { stdout } = await run('git', ['show', 'HEAD:rulesets/blocks.json'], { maxBuffer: 32 * 1024 * 1024 });
  committed = JSON.parse(stdout);
} catch {
  console.log('check-shrink: no committed blocks.json to compare against yet — skipping');
  process.exit(0);
}

const defaultOn = new Set([
  ...HAND_RULESETS.map((h) => h.id),
  ...LISTS.filter((l) => l.defaultOn).map((l) => l.id),
]);

let failed = false;
const summary = [];
for (const [id, entry] of Object.entries(current)) {
  const fresh = entry.total ?? 0;
  const prev = committed[id]?.total;
  summary.push(`${id}: ${prev ?? '?'} -> ${fresh}`);
  if (fresh === 0) {
    console.error(`check-shrink: FAIL ${id} ended up with 0 rules`);
    failed = true;
  }
  if (prev === undefined || prev === 0) continue;
  if (defaultOn.has(id) && fresh < prev * 0.7) {
    console.error(`check-shrink: FAIL default-on list ${id} dropped ${prev} -> ${fresh} (more than 30% lost)`);
    failed = true;
  }
}

if (failed) {
  console.error('check-shrink: refusing to accept the new build; nothing will be committed.');
  process.exit(1);
}
console.log(`check-shrink: ok — ${summary.join(', ')}`);
