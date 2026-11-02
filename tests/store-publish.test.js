import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { cmpVersion, codeChangedSince } from '../tools/store-publish.mjs';

test('cmpVersion orders dotted versions numerically', () => {
  assert.strictEqual(cmpVersion('1.6.10', '1.6.9'), 1);
  assert.strictEqual(cmpVersion('1.6.4', '1.6.4'), 0);
  assert.strictEqual(cmpVersion('1.6', '1.6.1'), -1);
  assert.strictEqual(cmpVersion('2.0.0', '1.99.99'), 1);
});

test('codeChangedSince sees real changes since an old tag', () => {
  // v1.6.0 -> HEAD changed far more than lists; must count as code.
  const tags = execFileSync('git', ['tag', '--list', 'v1.6.0'], { encoding: 'utf8' }).trim();
  if (!tags) return; // shallow clone without tags
  assert.strictEqual(codeChangedSince('v1.6.0'), true);
});

test('store-publish dry run with no secrets exits cleanly', () => {
  const out = execFileSync(process.execPath, ['tools/store-publish.mjs', '--dry-run'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.match(out, /secrets are not set/);
});

test('store-publish --edge-only with no Edge secrets exits cleanly', () => {
  const out = execFileSync(process.execPath, ['tools/store-publish.mjs', '--edge-only'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.match(out, /Edge secrets are not set/);
});
