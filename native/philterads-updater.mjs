// Chrome native messaging host for one-click updates of the unpacked
// PhilterAds folder. Speaks the native messaging protocol on stdin/stdout
// (4-byte little-endian length prefix + UTF-8 JSON), one request -> one
// response, then exits.
//
//   {cmd:"status"} -> {ok, branch, local, remote, behind, ahead, dirty, version}
//   {cmd:"update"} -> {ok, from, to, files}  |  {ok:false, error}
//
// The repo is always the parent of this native/ directory (resolved from
// import.meta.url, never from the message). The only git commands it runs
// are fetch / status / rev-parse / rev-list / pull --ff-only /
// diff --name-only — it can never push, reset, checkout, clean, stash or
// run npm. Update refuses a dirty tree, a diverged branch or anything not
// on main, so the folder is only ever moved strictly forward.

import { spawn } from 'node:child_process';
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(SCRIPT_DIR, '..'); // parent of native/
const LOG_FILE = path.join(SCRIPT_DIR, 'updater.log');
const LOG_MAX = 200 * 1024; // truncate past this size
const FETCH_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 30_000;

// ------------------------------------------------------------ framing

export function encodeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

// Reads one length-prefixed JSON message from a stream; tolerates the
// message arriving in arbitrarily small chunks.
export function readMessage(stream) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const cleanup = () => {
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
    };
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (len > 16 * 1024 * 1024) {
        cleanup();
        reject(new Error('message too large'));
        return;
      }
      if (buf.length < 4 + len) return;
      cleanup();
      try {
        resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
      } catch (e) {
        reject(new Error(`invalid JSON: ${e.message}`));
      }
    };
    const onEnd = () => {
      cleanup();
      const e = new Error('stdin closed before a full message arrived');
      e.code = 'EOF';
      reject(e);
    };
    const onError = (e) => {
      cleanup();
      reject(e);
    };
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
  });
}

// ------------------------------------------------------------ git

// Runs one git command in `repo` with a timeout; never throws, always
// resolves to {code, out, err} so a reply can always be sent.
export function git(args, repo, timeoutMs = GIT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let p;
    try {
      p = spawn('git', args, { cwd: repo, windowsHide: true });
    } catch (e) {
      resolve({ code: null, out, err: String(e?.message || e) });
      return;
    }
    const timer = setTimeout(() => {
      p.kill();
      resolve({ code: null, out, err: `timeout after ${timeoutMs}ms: git ${args[0]}` });
    }, timeoutMs);
    p.stdout?.on('data', (d) => { out += d; });
    p.stderr?.on('data', (d) => { err += d; });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, out, err: String(e?.message || e) }); // git missing from PATH
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

const gitErr = (what, r) =>
  `git ${what} failed: ${(r.err || r.out || 'unknown error').trim().split('\n').pop()}`;

// Porcelain paths: "XY path", renames as "XY orig -> path", untracked
// directories collapsed to "dir/". `_metadata/` is Chrome's own bookkeeping
// in unpacked extensions and never counts as a local change.
function porcelainPaths(out) {
  return out.split('\n').filter(Boolean).map((line) => {
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.slice(p.lastIndexOf(' -> ') + 4);
    return p.replace(/^"|"$/g, '').trim();
  });
}

function isLocalChange(p) {
  return p !== '' && p !== '_metadata' && p !== '_metadata/' && !p.startsWith('_metadata/');
}

export async function status(repo) {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repo);
  if (branch.code !== 0) return { ok: false, error: gitErr('branch', branch) };

  const fetch = await git(['fetch', 'origin', 'main'], repo, FETCH_TIMEOUT_MS);
  if (fetch.code !== 0) return { ok: false, error: gitErr('fetch', fetch) };

  const local = await git(['rev-parse', 'HEAD'], repo);
  if (local.code !== 0) return { ok: false, error: gitErr('rev-parse', local) };
  const remote = await git(['rev-parse', 'origin/main'], repo);
  if (remote.code !== 0) return { ok: false, error: gitErr('rev-parse', remote) };
  const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...origin/main'], repo);
  if (counts.code !== 0) return { ok: false, error: gitErr('rev-list', counts) };
  const porcelain = await git(['status', '--porcelain'], repo);
  if (porcelain.code !== 0) return { ok: false, error: gitErr('status', porcelain) };

  const [ahead, behind] = counts.out.trim().split(/\s+/).map(Number);
  const dirty = porcelainPaths(porcelain.out).some(isLocalChange);
  let version = null;
  try {
    version = JSON.parse(await readFile(path.join(repo, 'manifest.json'), 'utf8')).version ?? null;
  } catch { /* status must not fail over a missing manifest */ }

  return {
    ok: true,
    branch: branch.out.trim(),
    local: local.out.trim().slice(0, 7),
    remote: remote.out.trim().slice(0, 7),
    behind: behind ?? 0,
    ahead: ahead ?? 0,
    dirty,
    version,
  };
}

export async function update(repo) {
  const st = await status(repo); // also does the fetch update() relies on
  if (!st.ok) return st;
  if (st.dirty) return { ok: false, error: 'local changes' };
  if (st.ahead > 0) return { ok: false, error: 'diverged' };
  if (st.branch !== 'main') return { ok: false, error: 'not on main' };
  if (st.behind === 0) return { ok: true, from: st.local, to: st.local, files: [] };

  const pull = await git(['pull', '--ff-only', 'origin', 'main'], repo);
  if (pull.code !== 0) return { ok: false, error: gitErr('pull', pull) };
  const head = await git(['rev-parse', 'HEAD'], repo);
  if (head.code !== 0) return { ok: false, error: gitErr('rev-parse', head) };
  const to = head.out.trim();
  const diff = await git(['diff', '--name-only', `${st.local}..${to}`], repo);
  if (diff.code !== 0) return { ok: false, error: gitErr('diff', diff) };
  return { ok: true, from: st.local, to: to.slice(0, 7), files: diff.out.split('\n').map((l) => l.trim()).filter(Boolean) };
}

export async function handleRequest(msg, repo = REPO) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return { ok: false, error: 'bad request' };
  if (msg.cmd === 'status') return status(repo);
  if (msg.cmd === 'update') return update(repo);
  return { ok: false, error: `unknown cmd ${typeof msg.cmd === 'string' ? msg.cmd : JSON.stringify(msg.cmd)}` };
}

// ------------------------------------------------------------ logging

async function log(line) {
  try {
    const entry = `${new Date().toISOString()} ${line}\n`;
    const size = await stat(LOG_FILE).then((s) => s.size).catch(() => 0);
    if (size > LOG_MAX) await writeFile(LOG_FILE, entry); // truncate: keep only the new line
    else await appendFile(LOG_FILE, entry);
  } catch { /* logging must never break the reply */ }
}

// ------------------------------------------------------------ main

async function main() {
  let reply;
  try {
    const msg = await readMessage(process.stdin);
    reply = await handleRequest(msg, REPO);
    await log(`${String(msg?.cmd ?? '?')} -> ${reply.ok ? 'ok' : `error: ${reply.error}`}`);
  } catch (e) {
    if (e?.code === 'EOF') return; // Chrome closed the port without asking anything
    reply = { ok: false, error: String(e?.message || e) };
    await log(`error -> ${reply.error}`);
  }
  const buf = encodeMessage(reply);
  await new Promise((resolve) => {
    process.stdout.write(buf, () => resolve()); // flushed before exit
    setTimeout(resolve, 5_000); // belt and braces: never hang Chrome
  });
  process.exit(0);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
