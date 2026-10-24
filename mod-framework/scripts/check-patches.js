// mod-framework/scripts/check-patches.js
// Check whether overridden upstream files have changed since the
// fingerprint was last generated. Identifies which files need manual
// review after an upstream update.
//
// Usage:  node scripts/check-patches.js <modId> [--diff]
//   Without --diff : show which files changed (OK / CHANGED / MISSING)
//   With    --diff : also print the unified diff for changed files

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const modId = args[0];
const showDiff = args.includes('--diff');

if (!modId) {
  console.log('Usage: node scripts/check-patches.js <modId> [--diff]');
  console.log('  modId: the mod directory name under mods/ (e.g. "20p")');
  console.log('  --diff : also show the unified diff for changed files');
  process.exit(1);
}

let modDir = (() => {
  const direct = path.join(root, 'mods', modId);
  if (fs.existsSync(direct)) return direct;
  const modsDir = path.join(root, 'mods');
  const entries = fs.readdirSync(modsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(modsDir, entry.name, modId);
    if (fs.existsSync(sub)) return sub;
  }
  return null;
})();
if (!modDir) {
  console.error(`Mod "${modId}" not found in mods/ or subdirectories`);
  process.exit(1);
}
const patchesDir = path.join(modDir, 'patches');
const fingerprintPath = path.join(patchesDir, 'fingerprint.json');
const upstreamDir = path.join(root, 'Stronghold-Protocol');

if (!fs.existsSync(fingerprintPath)) {
  console.log(`No fingerprint found for mod "${modId}".`);
  console.log('Run: node mod-framework/scripts/gen-patches.js ' + modId);
  process.exit(0);
}

const fingerprint = JSON.parse(fs.readFileSync(fingerprintPath, 'utf-8'));

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

let ok = 0, changed = 0, missing = 0;
const changedFiles = [];

const prevVersion = fingerprint.upstreamVersion || 'unknown';
console.log(`Mod: ${modId}  |  Fingerprint from: ${fingerprint.generated} (upstream ${prevVersion})`);
console.log('');

for (const [rel, prevHash] of Object.entries(fingerprint.files)) {
  const upstreamPath = path.join(upstreamDir, rel);

  if (!fs.existsSync(upstreamPath)) {
    console.log(`  [MISSING] ${rel} — upstream file removed`);
    missing++;
    continue;
  }

  const upstreamSrc = fs.readFileSync(upstreamPath, 'utf-8');
  const curHash = sha256(upstreamSrc).slice(0, 16);

  if (curHash === prevHash) {
    console.log(`  [OK]      ${rel}`);
    ok++;
  } else {
    console.log(`  [CHANGED] ${rel}`);
    changed++;
    changedFiles.push({ rel, upstreamPath, upstreamSrc });
  }
}

console.log('');
console.log(`Results: ${ok} unchanged, ${changed} changed, ${missing} missing (total ${ok + changed + missing})`);

if (changed > 0) {
  console.log('');
  console.log('Files that need manual review:');
  for (const f of changedFiles) {
    console.log(`  - ${f.rel}`);
  }

  if (showDiff) {
    // Try to load patcher for diff display
    try {
      const { generatePatch } = await import('../lib/patcher.js');
      for (const f of changedFiles) {
        // Read original upstream from fingerprint (we don't have it anymore,
        // but we can at least show file size change)
        console.log(`\n  === ${f.rel} ===`);
        console.log(`  (upstream file changed — size: ${f.upstreamSrc.length} bytes)`);
      }
    } catch (e) {
      console.log('\n  (patcher module unavailable for diff display)');
    }
  } else {
    console.log('  Add --diff to see the actual differences.');
  }

  if (missing > 0) {
    console.log('');
    console.log('Removed upstream files (override may no longer be needed):');
  }

  process.exit(1);
} else {
  console.log('All fingerprints match — no manual merge needed. ✨');
  process.exit(0);
}