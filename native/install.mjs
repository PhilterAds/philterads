// One-time setup for the popup's "Check for updates" button: registers the
// native messaging host with Chrome (current user only — HKCU, nothing else).
//
//   npm run install-updater -- [--id <extensionId>]   register / refresh
//   npm run install-updater -- --uninstall            remove the registry key
//
// Writes, all inside native/:
//   philterads-updater.cmd           launcher Chrome runs, with the absolute
//                                  path to this node.exe baked in (Chrome's
//                                  environment may not have node on PATH)
//   com.aialchemist.philterads.json  the host manifest Chrome reads
// and one registry key pointing Chrome at that manifest:
//   HKCU\Software\Google\Chrome\NativeMessagingHosts\com.aialchemist.philterads
//
// Windows only. The extension id defaults to the one Chrome gave this
// unpacked folder on the owner's PC; find the real one on chrome://extensions
// (Developer mode -> PhilterAds card -> ID).

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

const HOST = 'com.aialchemist.philterads';
const DEFAULT_ID = 'effofegpdomabnenjekkpmbihijnnajh';
const REG_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST}`;

const NATIVE_DIR = fileURLToPath(new URL('.', import.meta.url));
const CMD_PATH = path.join(NATIVE_DIR, 'philterads-updater.cmd');
const MANIFEST_PATH = path.join(NATIVE_DIR, `${HOST}.json`);
const UPDATER = path.join(NATIVE_DIR, 'philterads-updater.mjs');

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const dryRun = args.includes('--dry-run'); // write the files, skip the registry
const idFlag = args.indexOf('--id');
const id = idFlag !== -1 && args[idFlag + 1] ? args[idFlag + 1] : DEFAULT_ID;

if (process.platform !== 'win32') {
  console.error('install-updater: Windows only (Chrome on other OSes uses a different host manifest location).');
  process.exit(1);
}
if (!/^([a-p]{32})$/.test(id)) {
  console.error(`install-updater: "${id}" does not look like a Chrome extension id (32 letters a-p).`);
  process.exit(1);
}

if (uninstall) {
  if (dryRun) {
    console.log(`dry-run: would run: reg.exe delete ${REG_KEY} /f`);
  } else {
    try {
      await run('reg.exe', ['delete', REG_KEY, '/f']);
      console.log(`removed registry key ${REG_KEY}`);
    } catch {
      console.log(`registry key ${REG_KEY} was not present (nothing to remove)`);
    }
  }
  console.log(`(left ${CMD_PATH} and ${MANIFEST_PATH} in place; delete native/ generated files at will)`);
  process.exit(0);
}

// The launcher Chrome spawns. Chrome launches .cmd files through cmd.exe, so
// stdin/stdout pipes pass straight through to node.
const cmdContent = `@echo off\r\n"${process.execPath}" "${UPDATER}" %*\r\n`;
await writeFile(CMD_PATH, cmdContent, 'utf8');
console.log(`wrote ${CMD_PATH}`);
console.log(`  runs: "${process.execPath}" "${UPDATER}"`);

const hostManifest = {
  name: HOST,
  description: 'PhilterAds updater: git fetch/pull --ff-only for the unpacked extension folder',
  path: CMD_PATH,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${id}/`],
};
await writeFile(MANIFEST_PATH, JSON.stringify(hostManifest, null, 2) + '\n', 'utf8');
console.log(`wrote ${MANIFEST_PATH}`);
console.log(`  allowed_origins: ${hostManifest.allowed_origins[0]}`);

if (dryRun) {
  console.log(`dry-run: would run: reg.exe add ${REG_KEY} /ve /t REG_SZ /d ${MANIFEST_PATH} /f`);
} else {
  await run('reg.exe', ['add', REG_KEY, '/ve', '/t', 'REG_SZ', '/d', MANIFEST_PATH, '/f']);
  console.log(`registered ${REG_KEY} -> ${MANIFEST_PATH}`);
}

console.log('\nDone. Reload the PhilterAds extension (chrome://extensions) if it was open,');
console.log('then use "Check for updates" in the popup. Requires git on PATH.');
console.log('Undo any time with: npm run install-updater -- --uninstall');
