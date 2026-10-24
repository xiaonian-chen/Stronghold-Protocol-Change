// ui/gameLogic/draft.js — 机变 and band-draft normalisation. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';
import { PHASE } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';


// ---- 机变 / band draft normalisation ----------------------------------------------------------------------

/**
 * Normalise m.public.draft ({order, turn, picks, skips?}) — tolerant of index/playerId turns and
 * object/array picks.
 * @param {any} draft
 * @param {any[]} [players]
 * @returns {{ order: string[], turnPid: string|null, picks: Map<string,string>, skipsLeft: Map<string, number>, done: boolean }}
 */
export function normalizeDraft(draft, players = []) {
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(draft?.order) && draft.order.length ? draft.order.filter((x) => typeof x === 'string') : ids;
  let turnPid = null;
  if (typeof draft?.turn === 'string') turnPid = draft.turn;
  else if (Number.isInteger(draft?.turn) && draft.turn >= 0 && draft.turn < order.length) turnPid = order[draft.turn];
  const picks = new Map();
  const src = draft?.picks;
  if (Array.isArray(src)) {
    src.forEach((v, i) => {
      if (typeof v === 'string' && order[i]) picks.set(order[i], v);
      else if (isObj(v) && typeof v.playerId === 'string' && typeof v.bandId === 'string') picks.set(v.playerId, v.bandId);
    });
  } else if (isObj(src)) {
    for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) picks.set(k, v);
  }
  const skipsLeft = new Map();
  const sk = draft?.skipsLeft ?? draft?.skips;
  if (isObj(sk)) for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v)) skipsLeft.set(k, v);
  const done = order.length > 0 && order.every((pid) => picks.has(pid));
  return { order, turnPid, picks, skipsLeft, done };
}

/**
 * Normalise m.public.sp ({family, cards, turn, picks, order?}).
 * Cards: string ids or objects; picks: {playerId: cardIdx} | [{playerId, idx}] | card.takenBy.
 * @param {any} sp
 * @param {any[]} [players]
 */
export function normalizeSp(sp, players = []) {
  if (!isObj(sp)) return null;
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : ids;
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, 6).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
  });
  const takenBy = new Map(); // idx → playerId
  const pickOf = new Map(); // playerId → idx
  const src = sp.picks;
  const add = (pid, idx) => {
    if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;
    takenBy.set(idx, pid);
    pickOf.set(pid, idx);
  };
  if (Array.isArray(src)) src.forEach((v, i) => { if (isObj(v)) add(v.playerId, v.idx); else if (Number.isInteger(v) && order[i]) add(order[i], v); });
  else if (isObj(src)) for (const [k, v] of Object.entries(src)) add(k, v);
  if (isObj(sp.taken)) for (const [k, v] of Object.entries(sp.taken)) add(v, Number(k));
  for (const c of cards) if (c.takenBy) add(c.takenBy, c.idx);
  for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  let turnPid = null;
  if (typeof sp.turn === 'string') turnPid = sp.turn;
  else if (Number.isInteger(sp.turn) && sp.turn >= 0 && sp.turn < order.length) turnPid = order[sp.turn];
  const groups = normalizeSpGroups(sp, players);
  return {
    family: typeof sp.family === 'string' ? sp.family : null,
    name: typeof sp.name === 'string' && sp.name ? sp.name : null,
    desc: typeof sp.desc === 'string' && sp.desc ? sp.desc : null,
    untimed: !!sp.untimed,
    cards, order, turnPid, pickOf, takenBy, pickedCount: pickOf.size,
    groups,
  };
}

function normalizeSpGroups(sp, players = []) {
  if (!Array.isArray(sp.groups) || sp.groups.length <= 1) return null;
  const playerMap = new Map((Array.isArray(players) ? players : []).filter(isObj).map((p) => [p.playerId, p]));
  return sp.groups.map((g) => {
    const gOrder = Array.isArray(g.order) ? g.order.filter((x) => typeof x === 'string') : [];
    const gCards = (Array.isArray(g.cards) ? g.cards : []).slice(0, 6).map((c, idx) => {
      const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
      return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
    });
    const gTakenBy = new Map();
    const gPickOf = new Map();
    const gSrc = g.picks;
    const gAdd = (pid, idx) => {
      if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= gCards.length) return;
      gTakenBy.set(idx, pid);
      gPickOf.set(pid, idx);
    };
    if (isObj(gSrc)) for (const [k, v] of Object.entries(gSrc)) gAdd(k, v);
    if (isObj(g.taken)) for (const [k, v] of Object.entries(g.taken)) gAdd(v, Number(k));
    for (const c of gCards) if (c.takenBy) gAdd(c.takenBy, c.idx);
    for (const c of gCards) c.takenBy = gTakenBy.get(c.idx) ?? null;
    const gTurnPid = typeof g.turn === 'string' ? g.turn : null;
    const gTurnDeadline = Number.isFinite(g.turnDeadline) ? g.turnDeadline : 0;
    const gTurnSeconds = Number.isFinite(g.turnSeconds) ? g.turnSeconds : 0;
    const gDone = !!g.done;
    const gPlayerNames = gOrder.map((pid) => {
      const p = playerMap.get(pid);
      return { playerId: pid, name: p?.name || pid };
    });
    return {
      id: g.id,
      family: typeof g.family === 'string' ? g.family : null,
      name: typeof g.name === 'string' && g.name ? g.name : null,
      desc: typeof g.desc === 'string' && g.desc ? g.desc : null,
      cards: gCards,
      order: gOrder,
      playerNames: gPlayerNames,
      turnPid: gTurnPid,
      turnDeadline: gTurnDeadline,
      turnSeconds: gTurnSeconds,
      untimed: !!g.untimed,
      done: gDone,
      pickOf: gPickOf,
      takenBy: gTakenBy,
      pickedCount: gPickOf.size,
      totalPlayers: gOrder.length,
    };
  });
}

/** Adapt only the recipient's current PREP choice; never write it into the public draft. */
export function normalizePersonalChoice(pub, priv, myId) {
  const choice = priv?.personalChoice;
  if (pub?.phase !== PHASE.PREP || !priv || priv.playerId !== myId || priv.alive === false
    || !choice || choice.round !== pub.round) return null;
  return {
    ...normalizeSp({ family: 'bounty', name: t('教鞭 · 战术特训'), desc: t('请选择一项战术特训'),
      cards: choice.cards, turn: myId, order: [myId], picks: {} }),
    id: choice.id,
  };
}