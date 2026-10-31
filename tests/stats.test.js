// Stats core (stats.js): category mapping with allow-rule exclusion, per-day
// bucketing, pruning, cross-poll de-dup, the lifetime-YouTube no-drop rule,
// the zapped-selector store, and update-reminder visibility. Pure logic, no
// Chrome — same arrangement as popups.test.js.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import '../stats.js';

const S = globalThis.PhilterStats;

// the shipped index: block/redirect id ranges per ruleset (safety = allow
// rules only, so its ranges are empty and it can never count)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BLOCKS = JSON.parse(readFileSync(
  path.join(fileURLToPath(new URL('..', import.meta.url)), 'rulesets/blocks.json'), 'utf8'));

const match = (rulesetId, ruleId, tabId = 7, timeStamp = 1_000) =>
  ({ rule: { ruleId, rulesetId }, tabId, timeStamp });

// ---- category mapping + allow-rule exclusion ----

test('rulesets map to their chip category, easylist+core fold into ads', () => {
  assert.strictEqual(S.classifyMatch(match('easylist', 1), BLOCKS), 'ads');
  assert.strictEqual(S.classifyMatch(match('core', 1), BLOCKS), 'ads');
  assert.strictEqual(S.classifyMatch(match('easyprivacy', 1), BLOCKS), 'trackers');
  assert.strictEqual(S.classifyMatch(match('malware', 1), BLOCKS), 'malware');
  assert.strictEqual(S.classifyMatch(match('cookies', 1), BLOCKS), 'cookies');
  assert.strictEqual(S.classifyMatch(match('annoyances', 1), BLOCKS), 'annoyances');
});

test('allow rules never count: safety is outside every block range', () => {
  assert.deepStrictEqual(BLOCKS.safety.ranges, [], 'safety must ship empty ranges');
  assert.strictEqual(S.classifyMatch(match('safety', 1), BLOCKS), null);
  // allow rules other rulesets might carry sit above the block ranges too
  const fake = { easylist: { ranges: [[1, 100]] } };
  assert.strictEqual(S.classifyMatch(match('easylist', 101), fake), null);
  assert.strictEqual(S.classifyMatch(match('easylist', 1), fake), 'ads');
});

test('unknown rulesetIds (dynamic pause rules) are ignored', () => {
  assert.strictEqual(S.classifyMatch(match('', 1_000_001), BLOCKS), null);
  assert.strictEqual(S.classifyMatch(match('something-else', 5), BLOCKS), null);
  // a match without a tab still classifies (it counts toward the day only)
  assert.strictEqual(S.classifyMatch({ rule: { ruleId: 1, rulesetId: 'easylist' }, timeStamp: 5 }, BLOCKS), 'ads');
});

// ---- per-day bucketing ----

test('dayKey is the local calendar day', () => {
  const d = new Date(2026, 9, 30, 23, 59); // Oct 30 2026 local
  assert.strictEqual(S.dayKey(d.getTime()), '2026-10-30');
  const e = new Date(2026, 0, 2, 0, 5);
  assert.strictEqual(S.dayKey(e.getTime()), '2026-01-02');
});

test('bucketMatches splits one poll into days and tab tallies', () => {
  const midnight = new Date(2026, 9, 30).getTime(); // local Oct 30 2026, 00:00
  const infos = [
    match('easylist', 1, 7, midnight + 1000),
    match('easylist', 2, 7, midnight + 2000),
    match('easyprivacy', 3, 7, midnight + 3000),
    match('malware', 4, 8, midnight + 4000),
    match('easylist', 5, -1, midnight + 5000), // not tied to a tab
    match('safety', 6, 7, midnight + 6000), // allow rule: dropped
  ];
  const { days, tabs } = S.bucketMatches(infos, BLOCKS);
  assert.deepStrictEqual(Object.keys(days), ['2026-10-30']);
  assert.strictEqual(days['2026-10-30'].ads, 3);
  assert.strictEqual(days['2026-10-30'].trackers, 1);
  assert.strictEqual(days['2026-10-30'].malware, 1);
  assert.deepStrictEqual(tabs['7'], { ...S.emptyCounts(), ads: 2, trackers: 1 });
  assert.deepStrictEqual(tabs['8'], { ...S.emptyCounts(), malware: 1 });
  assert.ok(!tabs['-1']); // day counts, no tab tally
});

test('events either side of local midnight land in their own day', () => {
  const midnight = new Date(2026, 9, 30).getTime();
  const { days } = S.bucketMatches([
    match('easylist', 1, 7, midnight - 1),
    match('easylist', 2, 7, midnight + 1),
  ], BLOCKS);
  assert.deepStrictEqual(Object.keys(days).sort(), ['2026-10-29', '2026-10-30']);
});

// ---- pruning ----

test('dayKeysToRemove keeps the newest 400 days', () => {
  const keys = [];
  for (let i = 0; i < 402; i += 1) {
    keys.push(S.dayKey(new Date(2026, 0, 1).getTime() - i * 86_400_000));
  }
  const stale = S.dayKeysToRemove(keys, '2026-01-01', 400);
  assert.strictEqual(stale.length, 1); // 401 days old; 400 exactly still stays
  assert.strictEqual(stale[0], keys[401]);
  assert.ok(!stale.includes('2026-01-01'));
  assert.deepStrictEqual(S.dayKeysToRemove(['2026-01-01'], '2026-01-01', 400), []);
  assert.deepStrictEqual(S.dayKeysToRemove(['stats:all'], '2026-01-01', 400), []); // not a day key at all
});

// ---- cross-poll de-dup ----

test('dedupeKey identifies a match by timeStamp+ruleset+rule+tab', () => {
  assert.strictEqual(S.dedupeKey(match('easylist', 1, 7, 5)), S.dedupeKey(match('easylist', 1, 7, 5)));
  assert.notStrictEqual(S.dedupeKey(match('easylist', 1, 7, 5)), S.dedupeKey(match('easylist', 1, 8, 5)));
  assert.notStrictEqual(S.dedupeKey(match('easylist', 1, 7, 5)), S.dedupeKey(match('easylist', 2, 7, 5)));
  assert.notStrictEqual(S.dedupeKey(match('easylist', 1, 7, 5)), S.dedupeKey(match('easylist', 1, 7, 6)));
  // the background's poll loop drops keys it has seen:
  const seen = new Map([[S.dedupeKey(match('easylist', 1, 7, 5)), 5]]);
  const replay = match('easylist', 1, 7, 5);
  assert.ok(seen.has(S.dedupeKey(replay))); // an overlapping poll counts it once
});

// ---- lifetime YouTube row: max(existing skipped, per-day sum) ----

test('lifetimeYouTube never drops the pre-existing skipped counter', () => {
  assert.strictEqual(S.lifetimeYouTube(150, { youtubeSkipped: 0 }), 150);
  assert.strictEqual(S.lifetimeYouTube(150, { youtubeSkipped: 200 }), 200);
  assert.strictEqual(S.lifetimeYouTube(0, { youtubeSkipped: 3 }), 3);
  assert.strictEqual(S.lifetimeYouTube(undefined, undefined), 0);
});

// ---- zapped store ----

test('zappedAdd stores per host and dedupes by selector', () => {
  let store = {};
  store = S.zappedAdd(store, 'www.youtube.com', '#ad', 1);
  store = S.zappedAdd(store, 'www.youtube.com', '#ad', 2); // same selector again
  store = S.zappedAdd(store, 'www.youtube.com', '#other', 3);
  assert.deepStrictEqual(store['www.youtube.com'], [{ sel: '#ad', at: 1 }, { sel: '#other', at: 3 }]);
});

test('zappedRemove drops the entry, and empty hosts disappear', () => {
  let store = S.zappedAdd(S.zappedAdd({}, 'a.com', '#x', 1), 'a.com', '#y', 2);
  store = S.zappedRemove(store, 'a.com', '#x');
  assert.deepStrictEqual(store['a.com'], [{ sel: '#y', at: 2 }]);
  store = S.zappedRemove(store, 'a.com', '#y');
  assert.ok(!('a.com' in store));
  const untouched = S.zappedRemove(store, 'a.com', '#gone');
  assert.strictEqual(untouched, store); // no-op returns the same object
});

test('zappedRemoveHosts clears a whole host chain (Clear here)', () => {
  let store = {};
  for (const h of ['www.youtube.com', 'youtube.com', 'other.example']) {
    store = S.zappedAdd(store, h, '#ad', 1);
  }
  store = S.zappedRemoveHosts(store, ['www.youtube.com', 'youtube.com']);
  assert.deepStrictEqual(Object.keys(store), ['other.example']);
  const same = S.zappedRemoveHosts(store, ['nothing.here']);
  assert.strictEqual(same, store);
});

test('zappedCount/zappedTotal feed the chip and the Settings sub-line', () => {
  let store = {};
  store = S.zappedAdd(store, 'www.youtube.com', '#a', 1);
  store = S.zappedAdd(store, 'www.youtube.com', '#b', 2);
  store = S.zappedAdd(store, 'youtube.com', '#c', 3);
  store = S.zappedAdd(store, 'news.example', '#d', 4);
  assert.strictEqual(S.zappedCount(store, ['www.youtube.com', 'youtube.com']), 3);
  assert.strictEqual(S.zappedCount(store, ['elsewhere.example']), 0);
  assert.deepStrictEqual(S.zappedTotal(store), { total: 4, hosts: 3 });
  assert.deepStrictEqual(S.zappedTotal({}), { total: 0, hosts: 0 });
});

test('hostChain walks parents but not through public suffix pairs', () => {
  assert.deepStrictEqual(S.hostChain('www.youtube.com'), ['www.youtube.com', 'youtube.com']);
  assert.deepStrictEqual(S.hostChain('youtube.com'), ['youtube.com']);
  // "co.uk" is a public suffix pair: example.co.uk is the last hop, co.uk is not
  assert.deepStrictEqual(
    S.hostChain('a.b.c.example.co.uk'),
    ['a.b.c.example.co.uk', 'b.c.example.co.uk', 'c.example.co.uk', 'example.co.uk'],
  );
});

// ---- update reminder visibility ----

test('reminderVisible: only a real, undismissed behind-count shows it', () => {
  assert.strictEqual(S.reminderVisible(undefined), false);
  assert.strictEqual(S.reminderVisible({}), false);
  assert.strictEqual(S.reminderVisible({ error: 'host not found' }), false); // helper missing
  assert.strictEqual(S.reminderVisible({ behind: 0, remote: 'abc' }), false);
  assert.strictEqual(S.reminderVisible({ behind: 3 }), false); // no remote to dismiss against
  assert.strictEqual(S.reminderVisible({ behind: 3, remote: 'abc' }), true);
  assert.strictEqual(S.reminderVisible({ behind: 3, remote: 'abc', dismissed: 'abc' }), false); // Later
  assert.strictEqual(S.reminderVisible({ behind: 3, remote: 'def', dismissed: 'abc' }), true); // newer commits
});
