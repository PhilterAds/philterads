#!/usr/bin/env node
// Publishes the store zip of the newest release to the Chrome Web Store and
// Edge Add-ons. Run by .github/workflows/publish-store.yml; no dependencies.
//
// When does a version go out?
//   - The store already has it (published or in review): nothing to do.
//   - Something other than the filter lists changed since the version the
//     Chrome Web Store has: publish now (a real code change or fix).
//   - Only the lists changed: wait for the weekly run (--weekly), which ships
//     whatever is newest. Daily list bumps would otherwise mean a store review
//     every day.
//   - --force: publish the newest version regardless (manual run).
// Each store still reviews every submission before it goes live.
//
// Env (GitHub secrets): CWS_SERVICE_ACCOUNT_KEY (service account JSON),
// CWS_PUBLISHER_ID, CWS_ITEM_ID; EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID.
// Edge is skipped (with a notice) while its secrets are missing.
// --dry-run: decide and print, upload nothing.
// --edge-only: send the newest version to Edge Add-ons only (manual run). The
// normal path reaches Edge only after a Chrome submission; use this when Chrome
// already has the version (or is reviewing it) and Edge does not.

import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const WEEKLY = args.has('--weekly');
const FORCE = args.has('--force');
const EDGE_ONLY = args.has('--edge-only');

const version = JSON.parse(readFileSync('manifest.json', 'utf8')).version;
const zip = `dist/philterads-${version}.zip`;
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const log = (...a) => console.log('store-publish:', ...a);

export function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// True when anything besides rulesets/ and the manifest "version" line changed.
export function codeChangedSince(tag) {
  const files = git('diff', '--name-only', `${tag}..HEAD`).split('\n').filter(Boolean);
  for (const f of files) {
    if (f.startsWith('rulesets/')) continue;
    if (f === 'manifest.json') {
      const lines = git('diff', '-U0', `${tag}..HEAD`, '--', 'manifest.json')
        .split('\n')
        .filter((l) => /^[+-]\s/.test(l) && !/"version"\s*:/.test(l));
      if (lines.length === 0) continue;
    }
    return true;
  }
  return false;
}

async function googleToken(keyJson) {
  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token: ${res.status} ${body.error || ''} ${body.error_description || ''}`);
  return body.access_token;
}

async function call(url, opts, what) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 500)}`);
  return { res, body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (EDGE_ONLY) {
    const { EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID } = process.env;
    if (!EDGE_CLIENT_ID || !EDGE_API_KEY || !EDGE_PRODUCT_ID) { log('Edge secrets are not set; nothing to do.'); return; }
    if (!existsSync(zip)) throw new Error(`${zip} not found (run npm run build:store first)`);
    if (DRY) { log(`dry run: would send ${version} to Edge only.`); return; }
    await publishEdge(readFileSync(zip));
    return;
  }
  const { CWS_SERVICE_ACCOUNT_KEY, CWS_PUBLISHER_ID, CWS_ITEM_ID } = process.env;
  if (!CWS_SERVICE_ACCOUNT_KEY || !CWS_PUBLISHER_ID || !CWS_ITEM_ID) {
    log('Chrome Web Store secrets are not set; nothing to do.');
    return;
  }
  const token = await googleToken(CWS_SERVICE_ACCOUNT_KEY);
  const auth = { authorization: `Bearer ${token}` };
  const item = `https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_ITEM_ID}`;
  const upload = `https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_ITEM_ID}`;

  const { body: status } = await call(`${item}:fetchStatus`, { headers: auth }, 'fetchStatus');
  const crx = (s) => s?.distributionChannels?.[0]?.crxVersion;
  const published = crx(status.publishedItemRevisionStatus);
  const submitted = crx(status.submittedItemRevisionStatus);
  log(`repo ${version}; store published ${published || '-'} (${status.publishedItemRevisionStatus?.state || '-'}), submitted ${submitted || '-'} (${status.submittedItemRevisionStatus?.state || '-'})`);
  if (status.takenDown || status.warned) log('WARNING: the item is warned or taken down; check the dashboard.');

  const storeHas = [published, submitted].filter(Boolean).sort(cmpVersion).pop();
  if (storeHas && cmpVersion(version, storeHas) <= 0) {
    log(`the store already has ${storeHas}; nothing to publish.`);
    return;
  }
  if (submitted) {
    log(`${submitted} is still in review; not stacking another submission on top.`);
    return;
  }
  if (!FORCE && !WEEKLY) {
    const base = published ? `v${published}` : null;
    if (base && git('tag', '--list', base) && !codeChangedSince(base)) {
      log(`only filter lists changed since ${base}; leaving it for the weekly run.`);
      return;
    }
  }
  if (!existsSync(zip)) throw new Error(`${zip} not found (run npm run build:store first)`);
  if (DRY) { log(`dry run: would publish ${version} to Chrome${process.env.EDGE_API_KEY ? ' and Edge' : ''}.`); return; }

  // Chrome Web Store: upload, wait for processing, submit for review.
  const data = readFileSync(zip);
  let { body: up } = await call(`${upload}:upload`, { method: 'POST', headers: { ...auth, 'content-type': 'application/zip' }, body: data }, 'CWS upload');
  for (let i = 0; up.uploadState === 'IN_PROGRESS' && i < 30; i++) {
    await sleep(5000);
    const { body: s } = await call(`${item}:fetchStatus`, { headers: auth }, 'fetchStatus');
    up = { uploadState: s.lastAsyncUploadState };
  }
  if (up.uploadState !== 'SUCCEEDED') throw new Error(`CWS upload state ${up.uploadState}: ${JSON.stringify(up).slice(0, 500)}`);
  const { body: pub } = await call(`${item}:publish`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' }, 'CWS publish');
  log(`Chrome Web Store: ${version} submitted (${pub.state || JSON.stringify(pub).slice(0, 200)}).`);

  await publishEdge(data);
}

async function publishEdge(data) {
  const { EDGE_CLIENT_ID, EDGE_API_KEY, EDGE_PRODUCT_ID } = process.env;
  if (!EDGE_CLIENT_ID || !EDGE_API_KEY || !EDGE_PRODUCT_ID) {
    log('Edge secrets are not set; skipping Edge Add-ons.');
    return;
  }
  const base = `https://api.addons.microsoftedge.microsoft.com/v1/products/${EDGE_PRODUCT_ID}/submissions`;
  const h = { authorization: `ApiKey ${EDGE_API_KEY}`, 'x-clientid': EDGE_CLIENT_ID };
  const poll = async (url, what) => {
    for (let i = 0; i < 60; i++) {
      const { body } = await call(url, { headers: h }, what);
      if (body.status !== 'InProgress') return body;
      await sleep(5000);
    }
    throw new Error(`${what}: still in progress after 5 minutes`);
  };
  try {
    const { res } = await call(`${base}/draft/package`, { method: 'POST', headers: { ...h, 'content-type': 'application/zip' }, body: data }, 'Edge upload');
    const upOp = await poll(`${base}/draft/package/operations/${res.headers.get('location')}`, 'Edge upload status');
    if (upOp.status !== 'Succeeded') throw new Error(`Edge upload ${upOp.status}: ${upOp.message || ''} ${JSON.stringify(upOp.errors || '')}`);
    const { res: r2 } = await call(base, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ notes: `PhilterAds ${version}: automated release from GitHub (github.com/PhilterAds/philterads/releases/tag/v${version}).` }) }, 'Edge publish');
    const pubOp = await poll(`${base}/operations/${r2.headers.get('location')}`, 'Edge publish status');
    if (pubOp.status !== 'Succeeded') throw new Error(`Edge publish ${pubOp.status}: ${pubOp.message || ''} ${JSON.stringify(pubOp.errors || '')}`);
    log(`Edge Add-ons: ${version} submitted.`);
  } catch (e) {
    // Chrome already went out; report Edge loudly but do not undo anything.
    console.log(`::error::Edge Add-ons publish failed: ${e.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || import.meta.url.endsWith(process.argv[1])) {
  main().catch((e) => { console.log(`::error::${e.message}`); process.exit(1); });
}
