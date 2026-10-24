// mods/dupBand/index.js — Duplicate Band mod.
// Allows teammates to pick the same strategy (band) that another teammate already picked.
// Compatible with: pure upstream 4p / 20p mod / both simultaneously.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readConfig() {
  const cfgPath = path.join(__dirname, '..', '..', '..', 'mod-framework', 'config.json');
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch { return {}; }
}

export function install(modHook) {
  const cfg = readConfig();
  if (cfg.dupBand === false) {
    console.log('[mod:dupBand] disabled by config');
    return;
  }

  console.log('[mod:dupBand] Duplicate Band mod installed');

  modHook.on('phase:bandDraft:enter', (match) => {
    if (!(match.rules && match.rules.dupBand)) return;
    match.bandTaken = () => false;
    console.log('[mod:dupBand] band draft — duplicates allowed');
  });
}