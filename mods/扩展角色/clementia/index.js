// mods/clementia/index.js — 克莱门莎角色增强 mod
// Provides optional character kit for Clemengis (char_4231_clemnt):
// - 原版：无特质 + 单阿戈尔盟约 (default)
// - 改版：新特质（全局击杀计数 → 盟约层数）+ 阿戈尔、不屈、迅捷/突袭盟约
//
// Activation: host toggles "克莱门莎改版" in room character panel (room.setCharacters).
// The character toggle is stored as room.characters; match.rules.characters includes 'clementia' when active.
//
// Per-operator mode (原版/改版, 迅捷/突袭) is set in the DIY screen via _flags field on the DiyPick.
// The override shared/diy.js handles augmentDiyRecord based on _flags.
//
// Hooks:
//  - onLoadData   Inject garrison data records (garrison_clementia_kills_a/b) before deep-freeze

import { onLoadData } from '../../../Stronghold-Protocol/server/data.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const garrisonA = {
  garrisonId: 'garrison_clementia_kills_a',
  desc: '<战斗中>克莱门莎在场时，所有友方单位的击杀合并计数；每累计击败3个敌人，克莱门莎所属的盟约各+1层。此特质不授予其他干员，不增加其他干员所属盟约的层数（联防不生效）',
  descRaw: '<战斗中>克莱门莎在场时，所有友方单位的击杀合并计数；每累计击败3个敌人，克莱门莎所属的盟约各+1层。此特质不授予其他干员，不增加其他干员所属盟约的层数（联防不生效）',
  eventType: 'IN_BATTLE',
  eventTypeDesc: '持续叠加',
  eventTypeIcon: 'icon_bond',
  effectType: 'ADD_BOND',
  effectKey: 'clementia_global_kills',
  battleRuneKey: 'env_gbuff_new_with_verify',
  charLevel: 0,
  bb: { check_cnt: 3, bond_add_count: 1 },
  bbStr: { key: 'clementia_global_kills', bond_type: 'bond_self', bond_add_type: 'by_count' },
  owners: [],
};

const garrisonB = {
  garrisonId: 'garrison_clementia_kills_b',
  desc: '<战斗中>克莱门莎在场时，所有友方单位的击杀合并计数；每累计击败3个敌人，克莱门莎所属的盟约各+2层。此特质不授予其他干员，不增加其他干员所属盟约的层数（联防不生效）',
  descRaw: '<战斗中>克莱门莎在场时，所有友方单位的击杀合并计数；每累计击败3个敌人，克莱门莎所属的盟约各+2层。此特质不授予其他干员，不增加其他干员所属盟约的层数（联防不生效）',
  eventType: 'IN_BATTLE',
  eventTypeDesc: '持续叠加',
  eventTypeIcon: 'icon_bond',
  effectType: 'ADD_BOND',
  effectKey: 'clementia_global_kills',
  battleRuneKey: 'env_gbuff_new_with_verify',
  charLevel: 0,
  bb: { check_cnt: 3, bond_add_count: 2 },
  bbStr: { key: 'clementia_global_kills', bond_type: 'bond_self', bond_add_type: 'by_count' },
  owners: [],
};

let _hookRegistered = false;

onLoadData((data) => {
  if (!_hookRegistered) _hookRegistered = true;
  console.log('[mod:clementia] onLoadData callback fired, garrisons exists:', !!data.garrisons);
  if (!data.garrisons) {
    console.log('[mod:clementia] garrisons missing from data');
    return;
  }
  if (data.garrisons.garrison_clementia_kills_a) {
    // Always overwrite to ensure the latest garrison data (desc, descRaw, bb, etc.)
    data.garrisons.garrison_clementia_kills_a = garrisonA;
    data.garrisons.garrison_clementia_kills_b = garrisonB;
    console.log('[mod:clementia] garrison data overwritten with latest');
    return;
  }
  data.garrisons.garrison_clementia_kills_a = garrisonA;
  data.garrisons.garrison_clementia_kills_b = garrisonB;
  console.log('[mod:clementia] garrison data injected into garrisons');
});

export function install(modHook) {
  console.log('[mod:clementia] 克莱门莎 mod 已激活');

  // Generate client-side garrison data file so the UI trait bar can display our garrison
  generateClientGarrisonData();

  // getData() / loadData() already ran before mods were loaded (called by simdata.js top-level await).
  // The onLoadData hook registered above was NOT fired. We must trigger a reload now.
  // Start async reload in the background; it completes well before the first match starts.
  triggerDataReload();
}

function generateClientGarrisonData() {
  try {
    const projectDataDir = resolve(__dirname, '..', '..', '..', 'Stronghold-Protocol', 'data');
    const originalPath = resolve(projectDataDir, 'garrisons.json');
    const backupPath = resolve(projectDataDir, 'garrisons_original.json');

    const curBytes = readFileSync(originalPath);
    const curLen = curBytes.length;

    let base;
    let needBackup = false;
    try {
      const backup = readFileSync(backupPath, 'utf8');
      if (backup.length !== curLen || !backup.trim().startsWith('{')) {
        needBackup = true;
      }
    } catch {
      needBackup = true;
    }
    if (needBackup) {
      writeFileSync(backupPath, curBytes);
      console.log('[mod:clementia] garrisons.json backed up (%d bytes)', curLen);
    }

    base = JSON.parse(readFileSync(backupPath, 'utf8'));

    if (base.garrison_clementia_kills_a) {
      console.log('[mod:clementia] garrison entries already present, updating with latest');
    }
    base.garrison_clementia_kills_a = garrisonA;
    base.garrison_clementia_kills_b = garrisonB;

    const out = JSON.stringify(base);
    writeFileSync(originalPath, out);
    console.log('[mod:clementia] client garrison data written (%d bytes, %d entries)', out.length, Object.keys(base).length);
  } catch (e) {
    console.error('[mod:clementia] client garrison data generation failed:', e.message || e);
  }
}

async function triggerDataReload() {
  try {
    // Step 1: Reset the data.js singleton so next getData() calls loadData() with our hook
    const dataMod = await import('../../../Stronghold-Protocol/server/data.js');
    dataMod.resetData();
    // Re-load: this calls loadData() which fires onLoadData hooks
    dataMod.getData();
    console.log('[mod:clementia] data.js singleton reloaded');

    // Step 2: Also refresh the sim's generatedCache (simdata.js holds its own copy)
    const simMod = await import('../../../Stronghold-Protocol/server/sim/simdata.js');
    await simMod.reloadDataSources();
    console.log('[mod:clementia] simdata.js cache reloaded');
  } catch (e) {
    console.error('[mod:clementia] data reload failed:', e.message || e);
  }
}