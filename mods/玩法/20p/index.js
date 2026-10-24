// mods/20p/index.js — 20-player extension mod.
// Gameplay logic (pool groups, custom phase flow, per-group pools) lives in the 20p/ file
// overrides; this mod registers hook callbacks for 20p-specific configurations that don't
// need file-level overrides, and exposes the `_20pActive` flag so other mods (like clone)
// can detect 20p mode and adapt.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readConfig() {
  const cfgPath = path.join(__dirname, '..', '..', '..', 'mod-framework', 'config.json');
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
  } catch {
    return {};
  }
}

export function install(modHook) {
  const cfg = readConfig();

  if (cfg['20p'] === false) {
    console.log('[mod:20p] disabled by config');
    return;
  }

  console.log('[mod:20p] 20-player extension installed');

  // ── Match init ──
  modHook.on('match:init', (match) => {
    match._20pActive = true;
    const seats = match.order?.length || 0;
    const groups = match.poolGroups?.length || 1;
    console.log(`[mod:20p] match init — seats=${seats} poolGroups=${groups}`);

    // Boss hit limit: read from room rules, default enabled (true = cap at 30万 per hit)
    if (match.rules && 'bossHitLimit' in match.rules) {
      match.gd._bossHitLimitEnabled = match.rules.bossHitLimit;
      console.log(`[mod:20p] bossHitLimit = ${match.rules.bossHitLimit}`);
    }
  });

  // ── Boss HP: 20p uses gamedata.js bossPoolShare for scaling ──
  modHook.on('match:bossHp', (gd, bossId, aliveCount, ctx) => {
    // 20p gamedata.js provides bossPoolShare; this hook allows other mods to
    // further adjust HP while in 20p mode
  });

  // ── Shop slots: per-player slots unchanged from upstream ──
  modHook.on('match:shopSlots', (player, shopLevel, slots) => {
    // 20p keeps base shop slot counts per player; pool handles scaling
  });

  // ── Duck replacement: standard per-player duck count ──
  modHook.on('match:duckReplace', (ctx, spawns, p, ownerPlayerId) => {
    // 20p keeps standard duck behavior
  });

  // ── Band draft: 20p phases.js has makeDraftGroups for multi-group draft ──
  modHook.on('phase:bandDraft:enter', (match) => {
    const groups = match.poolGroups?.length || 1;
    console.log(`[mod:20p] band draft — poolGroups=${groups}`);
  });

  // ── Lobby: before match starts ──
  modHook.on('lobby:beforeMatch', ({ room, opts }) => {
    console.log(`[mod:20p] lobby before match — seats=${opts.seats?.length || 0}`);
  });
}