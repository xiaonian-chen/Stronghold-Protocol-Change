// mod-framework/scripts/gen-patches.js
// Generate a fingerprint manifest for a mod's overrides/: SHA-256 of each
// upstream file that the mod overrides. When the upstream updates, compare
// fingerprints to instantly identify which files need manual merge.
//
// Usage:  node scripts/gen-patches.js <modId>
// Output: mods/<modId>/patches/fingerprint.json

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

const modId = process.argv[2];
if (!modId) {
  console.log('Usage: node scripts/gen-patches.js <modId>');
  console.log('  modId: the mod directory name under mods/ (e.g. "20p")');
  process.exit(1);
}

const modDir = (() => {
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
const overridesDir = path.join(modDir, 'overrides');
const upstreamDir = path.join(root, 'Stronghold-Protocol');
const patchesDir = path.join(modDir, 'patches');

if (!fs.existsSync(overridesDir)) {
  console.error(`No overrides/ directory found in mods/${modId}/`);
  process.exit(1);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

let upstreamVersion = 'unknown';
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(upstreamDir, 'MANIFEST.json'), 'utf-8'));
  upstreamVersion = manifest.version || 'unknown';
} catch { /* ignore */ }

function* walkDir(dir, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkDir(full, base);
    } else {
      yield full.substring(base.length + 1).replace(/\\/g, '/');
    }
  }
}

const files = {};
let totalFiles = 0;

for (const rel of walkDir(overridesDir)) {
  const upstreamPath = path.join(upstreamDir, rel);
  if (!fs.existsSync(upstreamPath)) {
    console.log(`  [SKIP] ${rel} — no upstream match`);
    continue;
  }

  totalFiles++;
  const upstreamSrc = fs.readFileSync(upstreamPath, 'utf-8');
  const hash = sha256(upstreamSrc).slice(0, 16);
  files[rel] = hash;
  console.log(`  ${rel}  (${hash})`);
}

const fingerprint = {
  mod: modId,
  upstreamVersion,
  generated: new Date().toISOString().slice(0, 10),
  files,
};

fs.mkdirSync(patchesDir, { recursive: true });
fs.writeFileSync(
  path.join(patchesDir, 'fingerprint.json'),
  JSON.stringify(fingerprint, null, 2),
  'utf-8',
);

console.log(`\nFingerprint saved: ${totalFiles} files → ${path.join(patchesDir, 'fingerprint.json')} (${JSON.stringify(fingerprint).length} bytes)`);