// The native messaging updater: framing round-trips, the refusal paths
// (dirty tree, diverged branch, not on main) and a real fast-forward — all
// against throwaway git repos in os.tmpdir() with a bare "origin", never
// this repo. The last test spawns the real host binary exactly like Chrome
// would and checks the framed reply, but only ever sends {cmd:"status"}:
// `update` is never pointed at the real repo from tests.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { encodeMessage, readMessage, handleRequest } from '../native/philterads-updater.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// git with a throwaway identity so commits work even without global config
const git = (cwd, ...args) =>
  run('git', ['-c', 'user.name=philterads-test', '-c', 'user.email=test@example.test', ...args], { cwd });
const gitAt = (...args) => run('git', ['-c', 'user.name=philterads-test', '-c', 'user.email=test@example.test', ...args]);
const asUrl = (p) => p.replace(/\\/g, '/'); // local paths as git URLs

// A work repo ("the extension folder") pushed to its own bare origin.
async function makeRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), 'philterads-native-'));
  const origin = path.join(dir, 'origin.git');
  await gitAt('init', '--bare', '-b', 'main', origin);
  const work = path.join(dir, 'work');
  await mkdir(work);
  await git(work, 'init', '-b', 'main');
  await writeFile(path.join(work, 'manifest.json'), JSON.stringify({ version: '9.9.9' }, null, 2) + '\n');
  await git(work, 'add', '-A');
  await git(work, 'commit', '-m', 'init');
  await git(work, 'remote', 'add', 'origin', asUrl(origin));
  await git(work, 'push', '-u', 'origin', 'main');
  return { dir, work, origin, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// A second clone to play "GitHub": commits made here and pushed are what the
// work repo becomes behind by.
async function makeClone(dir, origin, name) {
  const clone = path.join(dir, name);
  await gitAt('clone', asUrl(origin), clone);
  return clone;
}

// ------------------------------------------------------------ framing

test('framing round-trips through arbitrarily small chunks', async () => {
  const msg = { cmd: 'status', note: 'äö—ü' };
  const buf = encodeMessage(msg);
  assert.ok(buf.length > 4);
  assert.strictEqual(buf.readUInt32LE(0), buf.length - 4); // little-endian length prefix
  const stream = new PassThrough();
  const pending = readMessage(stream);
  for (const byte of buf) stream.write(Buffer.of(byte)); // one byte per chunk
  stream.end();
  assert.deepStrictEqual(await pending, msg);
});

test('readMessage rejects absurd frame lengths instead of buffering them', async () => {
  const stream = new PassThrough();
  const pending = assert.rejects(() => readMessage(stream), /too large/);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(100 * 1024 * 1024, 0);
  stream.write(head);
  stream.end();
  await pending;
});

test('unknown and malformed requests get an error reply, not a crash', async () => {
  assert.deepStrictEqual(await handleRequest({ cmd: 'nope' }), { ok: false, error: 'unknown cmd nope' });
  assert.deepStrictEqual(await handleRequest('status-ish'), { ok: false, error: 'bad request' });
  assert.deepStrictEqual(await handleRequest(null), { ok: false, error: 'bad request' });
});

// ------------------------------------------------------------ update paths

test('status sees a new upstream commit; update fast-forwards a clean tree', async () => {
  const repo = await makeRepo();
  try {
    const other = await makeClone(repo.dir, repo.origin, 'other');
    await mkdir(path.join(other, 'rulesets'));
    await writeFile(path.join(other, 'manifest.json'), JSON.stringify({ version: '9.9.10' }, null, 2) + '\n');
    await writeFile(path.join(other, 'rulesets', 'demo.json'), '[]\n');
    await git(other, 'add', '-A');
    await git(other, 'commit', '-m', 'two');
    await git(other, 'push');

    const st = await handleRequest({ cmd: 'status' }, repo.work);
    assert.ok(st.ok, JSON.stringify(st));
    assert.strictEqual(st.branch, 'main');
    assert.strictEqual(st.dirty, false);
    assert.strictEqual(st.ahead, 0);
    assert.strictEqual(st.behind, 1);
    assert.strictEqual(st.version, '9.9.9'); // still the old manifest on disk
    assert.match(st.local, /^[0-9a-f]{7}$/);
    assert.match(st.remote, /^[0-9a-f]{7}$/);
    assert.notStrictEqual(st.remote, st.local);

    const up = await handleRequest({ cmd: 'update' }, repo.work);
    assert.ok(up.ok, JSON.stringify(up));
    assert.strictEqual(up.from, st.local);
    const remoteHead = (await git(other, 'rev-parse', 'HEAD')).stdout.trim();
    assert.strictEqual(up.to, remoteHead.slice(0, 7));
    assert.deepStrictEqual(up.files.sort(), ['manifest.json', 'rulesets/demo.json']);

    const after = await handleRequest({ cmd: 'status' }, repo.work);
    assert.ok(after.ok);
    assert.strictEqual(after.behind, 0);
    assert.strictEqual(after.version, '9.9.10'); // pulled manifest is in place
  } finally {
    await repo.cleanup();
  }
});

test('update refuses a dirty tree; _metadata/ does not count as dirty', async () => {
  const repo = await makeRepo();
  try {
    // untracked file
    await writeFile(path.join(repo.work, 'stray.txt'), 'x');
    let st = await handleRequest({ cmd: 'status' }, repo.work);
    assert.strictEqual(st.dirty, true);
    assert.deepStrictEqual(await handleRequest({ cmd: 'update' }, repo.work), { ok: false, error: 'local changes' });

    // modified tracked file
    await rm(path.join(repo.work, 'stray.txt'));
    await writeFile(path.join(repo.work, 'manifest.json'), JSON.stringify({ version: '9.9.9-dirty' }, null, 2) + '\n');
    st = await handleRequest({ cmd: 'status' }, repo.work);
    assert.strictEqual(st.dirty, true);
    assert.deepStrictEqual(await handleRequest({ cmd: 'update' }, repo.work), { ok: false, error: 'local changes' });

    // restore, then prove Chrome's _metadata/ bookkeeping is ignored
    await git(repo.work, 'checkout', '--', 'manifest.json');
    await mkdir(path.join(repo.work, '_metadata'));
    await writeFile(path.join(repo.work, '_metadata', 'verified_contents.json'), '{}');
    st = await handleRequest({ cmd: 'status' }, repo.work);
    assert.strictEqual(st.dirty, false);
  } finally {
    await repo.cleanup();
  }
});

test('update refuses when the folder has diverged from origin', async () => {
  const repo = await makeRepo();
  try {
    // a local commit that was never pushed...
    await writeFile(path.join(repo.work, 'local.txt'), 'x');
    await git(repo.work, 'add', '-A');
    await git(repo.work, 'commit', '-m', 'local');

    // ...and an upstream commit the folder does not have
    const other = await makeClone(repo.dir, repo.origin, 'other');
    await writeFile(path.join(other, 'upstream.txt'), 'x');
    await git(other, 'add', '-A');
    await git(other, 'commit', '-m', 'upstream');
    await git(other, 'push');

    const st = await handleRequest({ cmd: 'status' }, repo.work);
    assert.ok(st.ok, JSON.stringify(st));
    assert.strictEqual(st.ahead, 1);
    assert.strictEqual(st.behind, 1);
    assert.deepStrictEqual(await handleRequest({ cmd: 'update' }, repo.work), { ok: false, error: 'diverged' });
  } finally {
    await repo.cleanup();
  }
});

test('update refuses when the folder is not on main', async () => {
  const repo = await makeRepo();
  try {
    await git(repo.work, 'checkout', '-b', 'side-branch');
    assert.deepStrictEqual(await handleRequest({ cmd: 'update' }, repo.work), { ok: false, error: 'not on main' });
  } finally {
    await repo.cleanup();
  }
});

// ------------------------------------------------------------ the real binary

test('the real host answers a framed status over stdio (this repo, read-only)', async () => {
  const host = spawn(process.execPath, [path.join(ROOT, 'native', 'philterads-updater.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  host.stderr.on('data', () => {}); // stderr is diagnostics only
  const reply = readMessage(host.stdout);
  host.stdin.write(encodeMessage({ cmd: 'status' }));
  host.stdin.end();
  const watchdog = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('host did not reply within 60s (is github.com reachable?)')), 60_000);
  });
  try {
    const r = await Promise.race([reply, watchdog]);
    assert.strictEqual(r.ok, true, JSON.stringify(r)); // needs origin reachable + credentials cached
    // CI checkouts are detached at a sha; locally the folder is on main.
    const expectedBranch = process.env.CI ? ['main', 'HEAD'] : ['main'];
    assert.ok(expectedBranch.includes(r.branch), `branch ${r.branch}`);
    for (const key of ['local', 'remote', 'behind', 'ahead', 'dirty', 'version']) {
      assert.ok(key in r, `reply missing "${key}"`);
    }
    assert.match(r.local, /^[0-9a-f]{7}$/);
    assert.match(r.version, /^\d+\.\d+\.\d+$/);
    assert.strictEqual(typeof r.dirty, 'boolean'); // true while work is uncommitted, and that is fine
  } finally {
    host.kill();
  }
});
