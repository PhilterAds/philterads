// manifest.json must reference files that exist and stay in sync with the
// list defaults in tools/lib/lists.js and the ones hardcoded in the
// extension's background.js / cosmetic.js.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTS } from '../tools/lib/lists.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const exists = (p) => existsSync(path.join(ROOT, p));

test('manifest is MV3 with the expected surface', () => {
  assert.strictEqual(manifest.manifest_version, 3);
  assert.ok(manifest.background.service_worker === 'background.js');
  assert.ok(existsSync(path.join(ROOT, manifest.background.service_worker)));
  assert.ok(existsSync(path.join(ROOT, manifest.action.default_popup)));
  assert.deepStrictEqual(manifest.host_permissions, ['<all_urls>']);
});

test('every declared ruleset file exists, ids are unique, defaults match the build', () => {
  const seen = new Set();
  const expected = new Map([
    ['core', true], ['safety', true],
    ...LISTS.map((l) => [l.id, l.defaultOn]),
  ]);
  for (const rr of manifest.declarative_net_request.rule_resources) {
    assert.ok(!seen.has(rr.id), `duplicate ruleset id ${rr.id}`);
    seen.add(rr.id);
    assert.ok(exists(rr.path), `missing ruleset file ${rr.path}`);
    assert.strictEqual(rr.enabled, expected.get(rr.id), `manifest default for ${rr.id} must match the list config`);
  }
  assert.deepStrictEqual([...seen].sort(), [...expected.keys()].sort(), 'manifest rulesets != known lists');
});

test('content scripts, icons and web-accessible resources exist', () => {
  for (const cs of manifest.content_scripts || []) {
    for (const js of cs.js) assert.ok(exists(js), `missing content script ${js}`);
    for (const m of cs.matches) assert.ok(typeof m === 'string');
  }
  for (const size of [16, 32, 48, 128]) {
    assert.ok(exists(manifest.icons[String(size)]), `missing icon ${size}`);
  }
  for (const war of manifest.web_accessible_resources || []) {
    for (const res of war.resources) {
      if (res.includes('*')) {
        // glob entry: the pattern must match at least one committed file
        const [dir, name] = res.split('/');
        const re = new RegExp(`^${name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
        assert.ok(readdirSync(path.join(ROOT, dir)).some((f) => re.test(f)), `WAR glob ${res} matches nothing`);
      } else {
        assert.ok(exists(res), `missing WAR ${res}`);
      }
    }
  }
});

test('the popup and background only reference committed files', () => {
  const popup = readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  for (const m of popup.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1].replace(/^\.\//, '');
    if (!/^[a-z]+:/.test(ref)) assert.ok(exists(ref), `popup references missing file ${ref}`);
  }
  for (const src of ['popup.js', 'popup-stats.js', 'stats.js', 'cosmetic.js', 'zap.js', 'zap-apply.js', 'yt-main.js', 'yt-content.js', 'popups.js', 'stubs/gpt.js']) {
    assert.ok(exists(src), `missing ${src}`);
  }
});

test('permissions cover what the code uses', () => {
  const perms = new Set(manifest.permissions);
  for (const needed of ['declarativeNetRequest', 'scripting', 'storage', 'declarativeNetRequestFeedback']) {
    assert.ok(perms.has(needed), `missing permission ${needed}`);
  }
});
