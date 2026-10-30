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

import { getData, onLoadData } from '../../../Stronghold-Protocol/server/data.js';
import { DEFAULT_VERSION, versionOfData } from '../../../Stronghold-Protocol/shared/versions.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
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

  // A match host process runs one official version's content set, installed with setData: this mod's reload and
  // client garrison file belong to the server process (the default data set) only.
  if (!runsDefaultDataSet()) {
    console.log('[mod:clementia] version host data set; garrison reload skipped');
    return;
  }

  // Generate client-side garrison data file so the UI trait bar can display our garrison
  generateClientGarrisonData();

  // getData() / loadData() already ran before mods were loaded (called by simdata.js top-level await).
  // The onLoadData hook registered above was NOT fired, so the reload below injects our garrison records. When the
  // loaded data set already carries the latest records (data/garrisons.json is kept up to date), a reload would only
  // re-read every data file and reload the sim cache again: skip it and leave the data set as it is.
  if (garrisonsAlreadyLoaded()) {
    console.log('[mod:clementia] garrison data already loaded; reload skipped');
    return;
  }
  // Start async reload in the background; it completes well before the first match starts.
  triggerDataReload();
}

/** True when this process's data set already holds the latest garrison records (injected or read from data/). */
function garrisonsAlreadyLoaded() {
  try {
    const g = getData().garrisons;
    const same = (a, b) => !!a && JSON.stringify(a) === JSON.stringify(b);
    return same(g?.garrison_clementia_kills_a, garrisonA) && same(g?.garrison_clementia_kills_b, garrisonB);
  } catch {
    return false;
  }
}

/** True in the server process (default data set); false in a match host running another version's data. */
function runsDefaultDataSet() {
  try {
    return versionOfData(getData()) === DEFAULT_VERSION;
  } catch {
    return true;
  }
}

function generateClientGarrisonData() {
  try {
    const projectDir = resolve(__dirname, '..', '..', '..', 'Stronghold-Protocol');
    const projectDataDir = resolve(projectDir, 'data');
    const originalPath = resolve(projectDataDir, 'garrisons.json');
    // The backup belongs outside data/: the server indexes every JSON under data/ as one of the built data files
    // (`/data/<name>.json?v=…`), so a backup kept there is served as a 17th record.
    const backupDir = resolve(projectDir, '.cache', 'clementia');
    const backupPath = resolve(backupDir, 'garrisons_original.json');
    const legacyBackupPath = resolve(projectDataDir, 'garrisons_original.json');
    if (existsSync(legacyBackupPath)) {
      if (!existsSync(backupPath)) {
        mkdirSync(backupDir, { recursive: true });
        renameSync(legacyBackupPath, backupPath);
      } else {
        rmSync(legacyBackupPath, { force: true });
      }
      console.log('[mod:clementia] backup moved out of data/');
    }

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
      mkdirSync(backupDir, { recursive: true });
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
    // Rewriting the file on every start is pointless when it already holds exactly these bytes — and a truncate-then-
    // write races with another process reading data/ while it boots. Leave an up-to-date file untouched.
    if (curBytes.toString('utf8') === out) {
      console.log('[mod:clementia] client garrison data already up to date (%d entries)', Object.keys(base).length);
      return;
    }
    writeFileSync(originalPath, out);
    console.log('[mod:clementia] client garrison data written (%d bytes, %d entries)', out.length, Object.keys(base).length);
  } catch (e) {
    console.error('[mod:clementia] client garrison data generation failed:', e.message || e);
  }
}

async function triggerDataReload() {
  try {
    // Step 0: never replace a match host's version data set with the default one
    if (!runsDefaultDataSet()) return;
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