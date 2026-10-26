// server/match/match/spDraft.js — 20p override: grouped 机变 draft.
// When poolGroups has multiple groups, each group gets its own 6-card draft
// and independent turn order; otherwise falls through to the upstream enterSpDraft.

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, applyCard, bountyBattles, isMultiRoundBounty, bountyCard, scheduleFor, buildCards, formatCount, FAMILY_NAMES } from '../choices.js';
import { onPickCard } from '../botEmotes.js';
import { weightedPick } from '../waves.js';
import { OK, fail, DELAYS } from './common.js';

const PERSONAL_OFFER_SIZE = 3;

export class MatchSpDraft {
  enterSpDraft() {
    const alive = this.alivePlayers();
    if (!alive.length) { this.beforePrepOffers(); return; }
    const poolGroups = this.poolGroups;
    const useGroups = Array.isArray(poolGroups) && poolGroups.length > 1;
    if (!useGroups) {
      this._enterSingleSpDraft(alive);
      return;
    }
    const draftOpts = {
      stageId: this.stageId,
      bondAvailable: (bondId) => this.bondLive(bondId),
      itemAvailable: (id) => this.itemPool.canGain(id),
    };
    const sch = scheduleFor(this.gd, this.round);
    const fams = Array.isArray(sch.families) && sch.families.length ? sch.families.map((f) => [f.family, f.weight]) : [['supply', 1]];
    let family = weightedPick(this.rngDraft, fams) || 'supply';
    const n = Number.isInteger(sch.cards) && sch.cards > 0 ? Math.min(sch.cards, 6) : formatCount(this.gd);
    const buildOpts = { ...draftOpts, round: this.round };
    const famInfo = this.gd.choices.families && this.gd.choices.families[family];
    const familyName = famInfo && famInfo.name ? famInfo.name : FAMILY_NAMES[family] || family;
    const familyDesc = famInfo && famInfo.desc ? famInfo.desc : '';
    const events = sch.events && Array.isArray(sch.events[family]) ? sch.events[family] : [];
    const eventId = events.length ? events[Math.floor(this.rngDraft() * events.length)] : null;
    const groups = poolGroups.map((pg, gi) => {
      const gAlive = pg.playerIds
        .map((pid) => this.players.get(pid))
        .filter((ps) => ps && ps.alive && !ps.left);
      if (!gAlive.length) return null;
      let gOrder = gAlive.map((p) => p.playerId);
      if (!this.isSolo) this.rngDraft.shuffle(gOrder);
      gOrder = this.humansFirst(gOrder);
      let gFamily = family;
      let cards = buildCards(this.gd, this.rngDraft, gFamily, n, sch, buildOpts);
      if (!cards.length && gFamily !== 'supply') {
        gFamily = 'supply';
        cards = buildCards(this.gd, this.rngDraft, gFamily, n, sch, buildOpts);
      }
      if (!cards.length) return null;
      cards.forEach((c, i) => { c.idx = i; c.family = gFamily; });
      const gFamInfo = this.gd.choices.families && this.gd.choices.families[gFamily];
      return {
        id: pg.id,
        family: gFamily,
        name: gFamInfo && gFamInfo.name ? gFamInfo.name : FAMILY_NAMES[gFamily] || gFamily,
        desc: gFamInfo && gFamInfo.desc ? gFamInfo.desc : '',
        eventId,
        cards,
        order: gOrder,
        idx: 0,
        picks: {},
        taken: {},
        untimed: this.soloUntimed,
        turnDeadline: 0,
        _turnToken: 0,
      };
    }).filter(Boolean);
    if (!groups.length) { this.beforePrepOffers(); return; }
    this.phase = PHASE.SP_DRAFT;
    const allOrder = groups.flatMap((g) => g.order);
    const firstDraft = groups[0];
    this.sp = {
      family: firstDraft.family,
      name: firstDraft.name,
      desc: firstDraft.desc,
      eventId: firstDraft.eventId,
      cards: firstDraft.cards,
      order: allOrder,
      idx: 0,
      picks: {},
      taken: {},
      untimed: this.soloUntimed,
      turnDeadline: 0,
      groups,
    };
    this.setDeadline(0);
    for (const g of groups) this._startGroupTurn(g);
    this.markPublic();
  }

  _enterSingleSpDraft(alive) {
    const draft = generateDraft(this.gd, this.rngDraft, this.round, {
      stageId: this.stageId,
      bondAvailable: (bondId) => this.bondLive(bondId),
      itemAvailable: (id) => this.itemPool.canGain(id),
    });
    if (!draft) { this.beforePrepOffers(); return; }
    this.phase = PHASE.SP_DRAFT;
    let order = alive.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    order = this.humansFirst(order);
    const untimed = this.soloUntimed;
    this.sp = { ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0 };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
  }

  _findGroup(playerId) {
    const groups = this.sp?.groups;
    if (!groups) return null;
    return groups.find((g) => g.order.includes(playerId)) || null;
  }

  _startGroupTurn(g) {
    while (g.idx < g.order.length) {
      const ps = this.players.get(g.order[g.idx]);
      if (ps && ps.alive && g.picks[ps.playerId] == null) break;
      g.idx++;
    }
    const available = g.cards.filter((c) => this._groupCardAvailable(g, c)).map((c) => c.idx);
    if (g.idx >= g.order.length || !available.length) {
      g.done = true;
      this._checkGroupsDone();
      return;
    }
    const cur = this.players.get(g.order[g.idx]);
    if (!g.untimed && cur && !cur.botControlled) {
      const token = ++g._turnToken;
      const secs = this.gd.timer('spFirst');
      if (g._turnTimer) this.cancel(g._turnTimer);
      g._turnTimer = this.later(this.scaled(secs * 1000), () => {
        g._turnTimer = null;
        if (this.phase !== PHASE.SP_DRAFT || token !== g._turnToken || !this.sp) return;
        const ps = this.players.get(g.order[g.idx]);
        if (!ps) return;
        const avail = g.cards.filter((c) => this._groupCardAvailable(g, c)).map((c) => c.idx);
        if (!avail.length) { g.done = true; this._checkGroupsDone(); return; }
        this._applyGroupCard(g, ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      g.turnDeadline = this.sched.now() + this.scaled(secs * 1000);
    }
    if (cur && cur.botControlled) this._scheduleGroupBot(g);
    this.markPublic();
  }

  _groupCardAvailable(g, card) {
    return !!card && g.taken[card.idx] == null && (card.kind !== 'item' || this.itemPool.canGain(card.id));
  }

  _checkGroupsDone() {
    const groups = this.sp?.groups;
    if (!groups) return;
    if (groups.every((g) => g.done)) {
      for (const g of groups) { if (g._turnTimer) this.cancel(g._turnTimer); g._turnTimer = null; }
      this.cancel(this._turnTimer);
      this._turnTimer = null;
      this.beforePrepOffers();
    }
  }

  _scheduleGroupBot(g) {
    const token = ++g._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || token !== g._turnToken || !this.sp) return;
      const ps = this.players.get(g.order[g.idx]);
      if (!ps || !ps.botControlled) return;
      const avail = g.cards.filter((c) => this._groupCardAvailable(g, c)).map((c) => c.idx);
      if (!avail.length) return;
      const fallback = () => this._applyGroupCard(g, ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      if (this.bot.decide?.(this, ps, { kind: 'card',
        valid: () => this.phase === PHASE.SP_DRAFT && token === g._turnToken,
        complete: () => g.picks[ps.playerId] != null, fallback })) return;
      fallback();
    });
  }

  _applyGroupCard(g, ps, idx) {
    if (!g || g.picks[ps.playerId] != null || !this._groupCardAvailable(g, g.cards[idx])) return;
    const card = g.cards[idx];
    if (!card) return;
    g.picks[ps.playerId] = idx;
    g.taken[idx] = ps.playerId;
    this.sp.picks[ps.playerId] = idx;
    this.sp.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card);
    if (g._turnTimer) this.cancel(g._turnTimer);
    g._turnTimer = null;
    g.idx++;
    this._startGroupTurn(g);
  }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    if (s.groups) {
      for (const g of s.groups) {
        if (!g.done && g.idx < g.order.length) return g.order[g.idx];
      }
      return null;
    }
    return s.order[s.idx] ?? null;
  }

  spCardAvailable(card) {
    if (!card) return false;
    if (this.sp?.groups) {
      for (const g of this.sp.groups) {
        if (this._groupCardAvailable(g, card)) return true;
      }
      return false;
    }
    return this.sp?.taken[card.idx] == null && (card.kind !== 'item' || this.itemPool.canGain(card.id));
  }

  startSpTurn() {
    const s = this.sp;
    if (!s) return;
    if (s.groups) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    while (s.idx < s.order.length) {
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null) break;
      s.idx++;
    }
    const available = s.cards.filter((c) => this.spCardAvailable(c)).map((c) => c.idx);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    const token = ++this._turnToken;
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = this.isSolo && this.gd.config.version?.rules?.soloTimed ? 150 : first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.filter((c) => this.spCardAvailable(c)).map((c) => c.idx);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  scheduleSpBot() {
    const s = this.sp;
    if (!s) return;
    if (s.groups) {
      for (const g of s.groups) {
        if (g.done || g.idx >= g.order.length) continue;
        const ps = this.players.get(g.order[g.idx]);
        if (ps && ps.botControlled) this._scheduleGroupBot(g);
      }
      return;
    }
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken || !this.sp) return;
      const ps = this.players.get(this.spTurn());
      if (!ps || !ps.botControlled) return;
      const avail = this.sp.cards.filter((c) => this.spCardAvailable(c)).map((c) => c.idx);
      if (!avail.length) return;
      const fallback = () => this._applyCard(ps, this.bot.pickCard(this, ps, this.sp.cards, avail));
      if (this.bot.decide?.(this, ps, { kind: 'card',
        valid: () => this.phase === PHASE.SP_DRAFT && token === this._turnToken,
        complete: () => this.sp?.picks[ps.playerId] != null, fallback })) return;
      fallback();
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const s = this.sp;
    if (s.groups) {
      const g = this._findGroup(ps.playerId);
      if (!g) return fail(ERR.BAD_TARGET);
      if (g.picks[ps.playerId] != null) return fail(ERR.ALREADY);
      if (g.order[g.idx] !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
      if (!Number.isInteger(idx) || idx < 0 || idx >= g.cards.length) return fail(ERR.BAD_TARGET);
      if (!this._groupCardAvailable(g, g.cards[idx])) return fail(ERR.SOLD_OUT);
      this._applyGroupCard(g, ps, idx);
      return OK;
    }
    if (s.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(this.sp.cards[idx])) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || !this.spCardAvailable(s.cards[idx])) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card);
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    this.beforePrepOffers();
  }

  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择');
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训');
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.addBounty(ps, pending.cards[idx])) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? this.bot.pickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) },
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6, exclude = [] } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const pick = (ids, weights = null) => this.itemPool.pick(rng, ids.filter((id) => !exclude.includes(id)), weights);
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    const also = p && Array.isArray(p.also) ? p.also.filter((id) => typeof id === 'string' && this.gd.item(id)) : [];
    const withAlso = (list) => {
      const out = list.slice();
      for (const id of also) if (!out.includes(id)) out.push(id);
      return out;
    };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && this.itemPool.canGain(x[0]));
        for (const id of also) if (!pairs.some((x) => x[0] === id)) pairs.push([id, 1]);
        return pick(pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return pick(withAlso(items));
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return pick(withAlso(list));
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return pick(withAlso(list));
  }

  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null, exclude = [] } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl, exclude });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !this.pool.has(base) || this.pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = this.pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}