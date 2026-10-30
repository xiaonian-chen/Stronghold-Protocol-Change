// mod-framework/modManager.js — Mod loader and manager.
// Scans the `mods/` directory, reads config, and loads enabled mods.
// Self-initializes at import time via top-level await.
// Each mod is a directory under `mods/` with a manifest.json and an index.js entry point.
//
// manifest.json format:
// {
//   "id": "clone",
//   "name": "Clone Mode",
//   "version": "1.0.0",
//   "description": "Group voting band draft, scaled boss HP, and more",
//   "author": "",
//   "enabled": true
// }
//
// index.js exports:
//   export function install(modHook) { ... }

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import modHook from './modHook.js';

// tools/ CLIs (tools/plugin.mjs check --json, …) import server modules, and modHook.js auto-loads this loader, so a
// tool's stdout would otherwise carry mod chatter — and its `--json` output is parsed by callers. When this process
// was started from a tools/ script, drop the `[mod:…]` / `[modManager] …` lines; everything else still prints.
const _fromCliTool = /[\\/]tools[\\/][^\\/]+\.(mjs|js)$/.test(process.argv[1] ?? '');
if (_fromCliTool) {
  const _log = console.log;
  console.log = (...args) => {
    const first = args[0];
    if (typeof first === 'string' && (first.startsWith('[mod:') || first.startsWith('[modManager]'))) return;
    _log(...args);
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dir = path.dirname(__filename);

let _initialized = false;
let _modsDir = null;
let _globalConfig = {};

const _loaded = [];

function findModsDir() {
  const candidates = [
    path.resolve(process.cwd(), 'mods'),
    path.resolve(__dir, '..', 'mods'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

function loadGlobalConfig() {
  const configPath = path.join(__dir, 'config.json');
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch { /* ignore */ }
  }
  if (!_modsDir) return {};
  const cfgPath = path.join(_modsDir, '..', 'mod-framework', 'config.json');
  if (existsSync(cfgPath)) {
    try {
      return JSON.parse(readFileSync(cfgPath, 'utf-8'));
    } catch { /* ignore */ }
  }
  return {};
}

async function loadMods() {
  if (!_modsDir) return;

  const entries = readdirSync(_modsDir, { withFileTypes: true });
  const candidateDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(_modsDir, entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (existsSync(manifestPath)) {
      candidateDirs.push(dir);
    } else {
      const subs = readdirSync(dir, { withFileTypes: true });
      for (const sub of subs) {
        if (!sub.isDirectory()) continue;
        const subDir = path.join(dir, sub.name);
        const subManifest = path.join(subDir, 'manifest.json');
        if (existsSync(subManifest)) candidateDirs.push(subDir);
      }
    }
  }

  for (const dir of candidateDirs) {
    const manifestPath = path.join(dir, 'manifest.json');
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      continue;
    }

    const modId = manifest.id || path.basename(dir);

    const enabled = _globalConfig[modId] !== undefined
      ? !!_globalConfig[modId]
      : manifest.enabled !== false;

    if (!enabled) {
      console.log(`[modManager] Mod "${manifest.name || modId}" is disabled`);
      continue;
    }

    const indexPath = path.join(dir, 'index.js');
    if (!existsSync(indexPath)) continue;

    try {
      const url = pathToFileURL(indexPath).href;
      const mod = await import(url);
      if (typeof mod.install === 'function') {
        mod.install(modHook);
        _loaded.push({ id: modId, name: manifest.name || modId, dir, manifest });
        console.log(`[modManager] Loaded mod: ${manifest.name || modId}`);
      }
    } catch (e) {
      console.error(`[modManager] Failed to load mod "${modId}":`, e);
    }
  }
}

async function initMods() {
  if (_initialized) return _loaded;
  _initialized = true;
  _modsDir = findModsDir();
  if (!_modsDir) {
    console.log('[modManager] No mods directory found');
    return _loaded;
  }
  _globalConfig = loadGlobalConfig();
  await loadMods();
  return _loaded;
}

export function getLoadedMods() {
  return [..._loaded];
}

export function getModsDir() {
  return _modsDir;
}

export function getModRegistry() {
  const playstyles = [];
  const gamemodes = [];
  const characters = [];
  for (const mod of _loaded) {
    const m = mod.manifest;
    if (!m) continue;
    if (m.type === 'playstyle') {
      playstyles.push({ id: mod.id, name: mod.name, displayName: m.displayName || mod.name, config: m.config || {} });
    } else if (m.type === 'gamemode') {
      gamemodes.push({ id: mod.id, name: mod.name, displayName: m.displayName || mod.name, config: m.config || {} });
    } else if (m.type === 'character') {
      characters.push({ id: mod.id, name: mod.name, displayName: m.displayName || mod.name });
    }
  }
  return { playstyles, gamemodes, characters };
}

const _initPromise = initMods();
export { _initPromise as ready };