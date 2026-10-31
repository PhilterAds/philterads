// Cosmetic data files: shape, sane domain keys, no extended-css selectors we
// promised not to ship, and youtube.com stays out of EasyList cosmetics.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTS } from '../tools/lib/lists.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(ROOT, 'cosmetic');

const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const EXTENDED = /:-abp-|:has-text|:xpath|:remove\(|:remove-attr|:remove-class|:style\(|:upward|:nth-ancestor|:matches-attr|:matches-path|:matches-css|:matches-property|:min-text-length|:others\(|:watch-attr|:if\(|:else\(|:shadow\(|\+js\(/;

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('a cosmetic file exists exactly for the lists that have cosmetics', () => {
  const expected = LISTS.filter((l) => l.cosmetic).map((l) => `${l.id}.json`);
  assert.deepStrictEqual(files.sort(), [...new Set(expected)].sort());
  assert.ok(!files.includes('malware.json'), 'malware list has no cosmetics');
});

test('cosmetic files have the documented shape', () => {
  for (const f of files) {
    const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    for (const key of ['generic', 'genericExceptions', 'generichide', 'elemhide']) {
      assert.ok(Array.isArray(data[key]), `${f}: ${key} must be an array`);
    }
    for (const key of ['domains', 'exceptions']) {
      assert.ok(data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]), `${f}: ${key} must be an object`);
      for (const [host, sels] of Object.entries(data[key])) {
        assert.ok(HOST_RE.test(host), `${f}: bad domain key "${host}"`);
        assert.ok(Array.isArray(sels) && sels.length > 0, `${f}: empty selector list for ${host}`);
      }
    }
    for (const key of ['generichide', 'elemhide']) {
      for (const d of data[key]) assert.ok(HOST_RE.test(d), `${f}: bad ${key} domain "${d}"`);
    }
  }
});

test('no extended-css / scriptlet selectors slipped through', () => {
  const offenders = [];
  for (const f of files) {
    const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    const all = [
      ...data.generic, ...data.genericExceptions,
      ...Object.values(data.domains).flat(), ...Object.values(data.exceptions).flat(),
    ];
    for (const sel of all) {
      if (EXTENDED.test(sel) || sel.startsWith('^')) offenders.push(`${f}: ${sel.slice(0, 80)}`);
    }
  }
  assert.deepStrictEqual(offenders, [], offenders.slice(0, 5).join('\n'));
});

test('generic selector lists are deduplicated', () => {
  for (const f of files) {
    const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    assert.strictEqual(new Set(data.generic).size, data.generic.length, `${f}: duplicate generic selectors`);
  }
});

test('every list carries at least the fields cosmetic.js reads', () => {
  // cosmetic.js reads .generic/.genericExceptions/.domains/.exceptions/
  // .generichide/.elemhide; this pins the schema so a build change can't
  // silently break the runtime lookup.
  for (const f of files) {
    const data = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    for (const key of ['generic', 'genericExceptions', 'domains', 'exceptions', 'generichide', 'elemhide']) {
      assert.ok(key in data, `${f}: missing ${key}`);
    }
  }
});
