// mod-framework/modHook.js — Mod event hook system.
// A lightweight pub/sub emitter that mods register on and core hook points fire.
// Each event key represents a specific interception point in the game lifecycle.
//
// Events:
//   lobby:beforeMatch     ({ room, opts })                  — before Match is constructed, allows mods to inject opts
//   match:init            (match)                           — after Match constructor finishes
//   phase:bandDraft:enter (matchPhases)                      — before band draft turn starts
//   match:bossHp          (gd, bossId, aliveCount, ctx)     — boss HP calc, ctx = { base, tune, share, result }, return number to override
//   match:duckReplace     (ctx, spawns, p, ownerPlayerId)   — duck replacement, return { ...p, ...override } to override params
//   match:shopSlots       (player, shopLevel, slots)        — shop slot counts, return { chess, item } to override

const _listeners = new Map();

function ensure(event) {
  let arr = _listeners.get(event);
  if (!arr) { arr = []; _listeners.set(event, arr); }
  return arr;
}

const modHook = {
  on(event, fn) {
    if (typeof fn !== 'function') return;
    ensure(event).push(fn);
  },

  off(event, fn) {
    const arr = _listeners.get(event);
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  },

  emit(event, ...args) {
    const arr = _listeners.get(event);
    if (!arr || !arr.length) return [];
    const results = [];
    for (const fn of arr) {
      try { results.push(fn(...args)); } catch (e) { /* mod errors don't crash the game */ }
    }
    return results;
  },

  emitUntil(event, ...args) {
    const arr = _listeners.get(event);
    if (!arr || !arr.length) return undefined;
    for (const fn of arr) {
      try {
        const r = fn(...args);
        if (r !== undefined && r !== null) return r;
      } catch (e) { /* mod errors don't crash the game */ }
    }
    return undefined;
  },

  hasListeners(event) {
    const arr = _listeners.get(event);
    return !!(arr && arr.length);
  },
};

export default modHook;

// Auto-load mods when modHook is first imported.
// Circular import: modManager imports modHook (above), but Node handles this
// since modHook's exports are available before modManager starts loading.
import './modManager.js';