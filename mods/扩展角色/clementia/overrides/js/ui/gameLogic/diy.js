// public/js/ui/gameLogic/diy.js — clementia-mod override: fix diyRecordFor cache key to include _flags
// so that switching between 原版/改版/迅捷/突袭 does not return a stale cached record.

import { diyRecordOf } from '../../../../shared/diy.js';
import { isObj } from './shared.js';

export function diyPicks(priv) {
  return isObj(priv) && isObj(priv.diy) ? priv.diy : {};
}

export function ownDiyPick(priv, chess) {
  if (!isObj(chess) || !chess.isDiy) return null;
  const slot = typeof chess.diyFor === 'string' ? chess.diyFor : chess.baseId || chess.chessId;
  const p = diyPicks(priv)[slot];
  if (!isObj(p) || typeof p.charId !== 'string') return null;
  const pot = isObj(priv?.ops) && isObj(priv.ops[p.charId]) ? priv.ops[p.charId].potential : null;
  return Number.isInteger(pot) && pot >= 1 && pot < 6 ? { ...p, potential: pot } : p;
}

const CACHE = new WeakMap();

export function diyRecordFor(chess, pick, data) {
  if (!isObj(chess) || !chess.isDiy) return null;
  if (chess.diyFor) return chess;
  if (!isObj(pick) || !isObj(data?.backups)) return null;
  let m = CACHE.get(data.backups);
  if (!m) { m = new Map(); CACHE.set(data.backups, m); }
  const pot = Number.isInteger(pick.potential) ? pick.potential : null;
  const flags = Number.isInteger(pick._flags) ? pick._flags : 0;
  const key = `${chess.chessId}|${pick.charId}|${pick.skillIndex ?? ''}|${pick.uniEquipId ?? ''}|${pot ?? ''}|f${flags}`;
  if (m.has(key)) return m.get(key);
  let rec;
  try { rec = diyRecordOf(chess, pick, data, { potential: pot }); } catch { rec = null; }
  m.set(key, rec);
  return rec;
}

export function ownDiyRecord(chess, priv, data) {
  const pick = ownDiyPick(priv, chess);
  return pick ? diyRecordFor(chess, pick, data) : null;
}

export function cardDiy(chess, { priv = null, unit = null, data = null } = {}) {
  if (!isObj(chess) || !chess.isDiy) return null;
  if (unit) return isObj(unit.diy) ? diyRecordFor(chess, unitPick(unit), data) : null;
  return ownDiyRecord(chess, priv, data);
}

export function unitPick(unit) {
  if (!isObj(unit) || !isObj(unit.diy)) return null;
  return Number.isInteger(unit.potential) ? { ...unit.diy, potential: unit.potential } : unit.diy;
}

export function diyGetter(getChess, priv, data) {
  return (id) => {
    const c = getChess(id);
    return ownDiyRecord(c, typeof priv === 'function' ? priv() : priv, typeof data === 'function' ? data() : data) || c;
  };
}

export function pickGetter(getChess, pick, data) {
  return (id) => {
    const c = getChess(id);
    return (isObj(pick) && c && c.isDiy ? diyRecordFor(c, pick, data) : null) || c;
  };
}

export const isDiyRecord = (rec) => isObj(rec) && typeof rec.diyFor === 'string';

export function diyBannedPieces(priv, getChess, data) {
  const ids = Array.isArray(priv?.diyBanned) ? priv.diyBanned.filter((id) => typeof id === 'string') : [];
  return ids.map((slotId) => {
    const slot = getChess(slotId);
    return { slotId, charId: (slot && typeof slot.charId === 'string' ? slot.charId : slotId), name: (slot && typeof slot.name === 'string' ? slot.name : slotId) };
  });
}