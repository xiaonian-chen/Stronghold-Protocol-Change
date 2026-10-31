// scripts/20p/resolver.mjs — Node.js module resolve hook for mod-framework & all mod overrides.
// Registered by scripts/20p-loader.mjs via --import flag.
// When a module is imported, checks for a mod-framework/ counterpart first, then each enabled mod's
// overrides directory, and serves the override instead. Original files on disk remain untouched.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HOOK_DIR = path.dirname(fileURLToPath(import.meta.url));
// scripts/20p/ → scripts/ → Stronghold-Protocol/
const ROOT = path.resolve(HOOK_DIR, '..', '..');
// mods root: d:\yjw\Stronghold-Protocol-v0.3.1\mods\
const MODS_DIR = path.resolve(ROOT, '..', 'mods');
// mod-framework folder: d:\yjw\Stronghold-Protocol-v0.3.1\mod-framework\
const MOD_FW = path.resolve(ROOT, '..', 'mod-framework');

const DIR_EXTS = ['.js', '.mjs'];

// Read config to know which mods are enabled
function readConfig() {
  const configPath = path.resolve(ROOT, '..', 'mod-framework', 'config.json');
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

// Find a mod directory by id, searching direct and subdirectory locations
function findModDir(modId) {
  const direct = path.join(MODS_DIR, modId);
  if (existsSync(direct)) return direct;
  const catEntries = readdirSync(MODS_DIR, { withFileTypes: true });
  for (const cat of catEntries) {
    if (!cat.isDirectory()) continue;
    const sub = path.join(MODS_DIR, cat.name, modId);
    if (existsSync(sub)) return sub;
  }
  return null;
}

// Build list of {id, dir, overridesDir} for enabled mods (sorted for deterministic priority)
function getEnabledMods() {
  const config = readConfig();
  const mods = [];
  for (const [id, enabled] of Object.entries(config)) {
    if (enabled === false) continue;
    const dir = findModDir(id);
    if (dir) {
      mods.push({ id, dir, overridesDir: path.join(dir, 'overrides') });
    }
  }
  return mods;
}

const ENABLED_MODS = getEnabledMods();

// Check if a path is under any enabled mod's directory
function getModForPath(absPath) {
  for (const mod of ENABLED_MODS) {
    if (absPath.startsWith(mod.dir)) return mod;
  }
  return null;
}

function tryOverrideDir(overrideDir, absTarget) {
  if (!absTarget.startsWith(ROOT)) return null;
  const rel = path.relative(ROOT, absTarget);
  const baseName = path.basename(overrideDir);
  if (rel.startsWith(baseName)) return null;               // no self-redirect
  const ovPath = path.join(overrideDir, rel);

  // Direct file match
  if (existsSync(ovPath)) {
    const st = statSync(ovPath);
    if (st.isFile()) return pathToFileURL(ovPath).href;
    if (st.isDirectory()) {
      for (const ext of DIR_EXTS) {
        const idx = path.join(ovPath, 'index' + ext);
        if (existsSync(idx) && statSync(idx).isFile()) return pathToFileURL(idx).href;
      }
    }
  }
  // Try extensions
  for (const ext of DIR_EXTS) {
    const p = ovPath + ext;
    if (existsSync(p) && statSync(p).isFile()) return pathToFileURL(p).href;
  }
  return null;
}

// Try all mod overrides for an absolute target path
function tryAllModOverrides(absTarget, excludeModId) {
  for (const mod of ENABLED_MODS) {
    if (mod.id === excludeModId) continue;
    // A-type (mod root like shared/, public/)
    let url = tryOverrideDir(mod.dir, absTarget);
    if (url) return url;
    // B-type overrides (upstream file copies with modifications)
    url = tryOverrideDir(mod.overridesDir, absTarget);
    if (url) return url;
  }
  return null;
}

function tryModFw(absTarget) {
  return tryOverrideDir(MOD_FW, absTarget);
}

function resolveFile(baseDir, specifier) {
  const p = path.resolve(baseDir, specifier);
  if (existsSync(p) && statSync(p).isFile()) return p;
  for (const ext of ['.js', '.mjs', '.json']) {
    const withExt = p + ext;
    if (existsSync(withExt) && statSync(withExt).isFile()) return withExt;
  }
  if (existsSync(p) && statSync(p).isDirectory()) {
    for (const ext of DIR_EXTS) {
      const idx = path.join(p, 'index' + ext);
      if (existsSync(idx) && statSync(idx).isFile()) return idx;
    }
  }
  return null;
}

function isUnderAnyModRoot(absPath) {
  if (absPath.startsWith(ROOT)) return true;
  if (absPath.startsWith(MOD_FW)) return true;
  if (getModForPath(absPath)) return true;
  return false;
}

export async function resolve(specifier, context, nextResolve) {
  const parentURL = context.parentURL;

  // Main module (entry point): specifier is a path from the command line, not an import
  if (!parentURL) {
    let absTarget;
    try { absTarget = fileURLToPath(specifier); } catch { absTarget = path.resolve(specifier); }
    if (absTarget.startsWith(ROOT)) {
      // mod-framework has priority
      const mfwUrl = tryModFw(absTarget);
      if (mfwUrl) return { url: mfwUrl, shortCircuit: true };
      const modUrl = tryAllModOverrides(absTarget);
      if (modUrl) return { url: modUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }

  // Only intercept relative / absolute paths (not bare specifiers like 'fs', 'path', etc.)
  if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('file://')) {
    return nextResolve(specifier, context);
  }

  let parentPath;
  try { parentPath = fileURLToPath(parentURL); } catch { return nextResolve(specifier, context); }
  if (!isUnderAnyModRoot(parentPath)) {
    return nextResolve(specifier, context);
  }

  const targetDir = path.dirname(parentPath);
  const parentMod = getModForPath(parentPath);

  // When parent is from mod-framework or a mod, resolve imports relative to the ORIGINAL
  // upstream directory. This way, override modules can import unmodified siblings.
  let origDir = targetDir;
  if (parentPath.startsWith(MOD_FW)) {
    origDir = path.join(ROOT, path.relative(MOD_FW, targetDir));
  } else if (parentMod) {
    if (parentPath.startsWith(parentMod.overridesDir)) {
      // B-type files map to upstream directory structure
      origDir = path.join(ROOT, path.relative(parentMod.overridesDir, targetDir));
    } else {
      origDir = path.join(ROOT, path.relative(parentMod.dir, targetDir));
    }
  }

  // Resolve relative to the ORIGINAL directory, then check overrides
  const origTarget = resolveFile(origDir, specifier);
  if (origTarget && isUnderAnyModRoot(origTarget)) {
    // Priority order:
    // 1. When parent is from a specific mod, that mod's overrides win (may depend on each other)
    // 2. Otherwise, mod-framework wins (hook injections override upstream first)
    if (parentMod) {
      // Check parent's own mod overrides first
      let url = tryOverrideDir(parentMod.dir, origTarget);
      if (url) return { url, shortCircuit: true };
      url = tryOverrideDir(parentMod.overridesDir, origTarget);
      if (url) return { url, shortCircuit: true };
      // Then other mods
      url = tryAllModOverrides(origTarget, parentMod.id);
      if (url) return { url, shortCircuit: true };
      // Then mod-framework
      url = tryModFw(origTarget);
      if (url) return { url, shortCircuit: true };
    } else {
      // mod-framework first
      const mfwUrl = tryModFw(origTarget);
      if (mfwUrl) return { url: mfwUrl, shortCircuit: true };
      // Then all mod overrides
      const modUrl = tryAllModOverrides(origTarget);
      if (modUrl) return { url: modUrl, shortCircuit: true };
    }
    return { url: pathToFileURL(origTarget).href, shortCircuit: true };
  }

  // For override files importing modules that only exist in that directory
  // (e.g. playerCapacity.js is a new file with no upstream counterpart)
  if (parentPath.startsWith(MOD_FW)) {
    const mfwTarget = resolveFile(targetDir, specifier);
    if (mfwTarget && mfwTarget.startsWith(MOD_FW)) {
      return { url: pathToFileURL(mfwTarget).href, shortCircuit: true };
    }
  }
  if (parentMod) {
    const modTarget = resolveFile(targetDir, specifier);
    if (modTarget && modTarget.startsWith(parentMod.dir)) {
      return { url: pathToFileURL(modTarget).href, shortCircuit: true };
    }
    // For overrides/ files importing A-type mod files,
    // retry resolution from the mod root equivalent directory
    if (parentPath.startsWith(parentMod.overridesDir)) {
      const modRootDir = path.join(parentMod.dir, path.relative(parentMod.overridesDir, targetDir));
      const modRootTarget = resolveFile(modRootDir, specifier);
      if (modRootTarget && modRootTarget.startsWith(parentMod.dir)) {
        return { url: pathToFileURL(modRootTarget).href, shortCircuit: true };
      }
    }
  }

  // Fallback: let Node resolve normally
  return nextResolve(specifier, context);
}