// Builds the Chrome Web Store package: dist/philterads-<version>.zip.
//
// Same extension, minus the self-updater: the store updates installs itself,
// so the manifest drops "nativeMessaging" (the popup and background see that
// and hide/skip every update path). Only runtime files go in the zip: no
// tools, tests, site, docs, native helper or node_modules.
//
//   npm run build:store

import { readFileSync, readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = (dir, test) => readdirSync(join(ROOT, dir)).filter(test).map((f) => (dir ? `${dir}/${f}` : f));

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
manifest.permissions = manifest.permissions.filter((p) => p !== 'nativeMessaging');

const entries = [
  ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ...[
    ...files('', (f) => /\.(js|html)$/.test(f)),
    ...files('icons', (f) => f.endsWith('.png')),
    ...files('rulesets', (f) => f.endsWith('.json')),
    ...files('cosmetic', (f) => f.endsWith('.json')),
    ...files('stubs', (f) => f.endsWith('.js')),
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
  ].map((f) => [f, readFileSync(join(ROOT, f))]),
];

// every file the manifest names must be in the zip
const names = new Set(entries.map(([n]) => n));
const wanted = [
  manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...manifest.declarative_net_request.rule_resources.map((r) => r.path),
  ...manifest.content_scripts.flatMap((c) => c.js),
];
const missing = wanted.filter((f) => !names.has(f));
if (missing.length) throw new Error(`build-store: missing from zip: ${missing.join(', ')}`);

// minimal zip writer (deflate, no dependencies)
const local = [], central = [];
let offset = 0;
for (const [name, data] of entries) {
  const nameBuf = Buffer.from(name);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
  head.writeUInt16LE(8, 8); head.writeUInt32LE(0, 10); // deflate; fixed 1980 timestamp keeps builds reproducible
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  local.push(head, nameBuf, packed);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(8, 10); cen.writeUInt32LE(0, 12);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(packed.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
  central.push(cen, nameBuf);
  offset += 30 + nameBuf.length + packed.length;
}
const cenSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cenSize, 12); end.writeUInt32LE(offset, 16);

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist', `philterads-${manifest.version}.zip`);
writeFileSync(out, Buffer.concat([...local, ...central, end]));
const mb = (statSync(out).size / 1048576).toFixed(2);
console.log(`build-store: ${entries.length} files -> dist/philterads-${manifest.version}.zip (${mb} MB), permissions: ${manifest.permissions.join(', ')}`);
