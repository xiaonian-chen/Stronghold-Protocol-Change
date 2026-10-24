// mods/clone/index.js — Clone Mode mod (dual-compatible: 4p upstream & 20p mode).
//
// Clone mode: every player in the same "clone group" runs identical strategy (band).
//   4p mode: all 4 human seats = 1 group → one shared band.
//   20p mode: each pool group (A/B/C/D/O) = 1 clone group → one band per group.
//
// Features:
//   1. Band draft replaced by instant shared-band assignment per clone group.
//   2. Affinity bond selection via bond picker in band draft phase (per-player).
//   3. Boss HP: locked = aliveCount × 6; unlocked = custom 6/12/18...120 multiplier × aliveCount.
//   4. Duck replace max: locked = aliveCount; unlocked = custom 1–20.
//   5. Pool scale: each pool group's operator cards multiplied by 4–8× (locked=4, unlocked=4-8).
//   6. Shop gets +2 bond-favouring chess slots — they always roll chess matching the player's affinity bond.
//   7. Item roll biased towards the player's active bonds.
//
// Activation:
//   SP_CLONE=1 env (4p testing) or room.gameMode === 'clone' (20p UI).
//
// Compatible with:  pure upstream 4p / 20p mod / both simultaneously.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readConfig() {
  const cfgPath = path.join(__dirname, '..', '..', '..', 'mod-framework', 'config.json');
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch { return {}; }
}

const toEnv = (k) => (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);

const PHASE = { BAND_DRAFT: 'BAND_DRAFT', INFO_CHECK: 'INFO_CHECK' };

export function install(modHook) {
  const cfg = readConfig();

  if (cfg.clone === false) { console.log('[mod:clone] disabled by config'); return; }
  console.log('[mod:clone] installed (dual-compatible: 4p + 20p)');

  // ── Room-level clone config storage (keyed by room code) ────────────
  //   In 4p mode (no 20p lobby), configs come from env/lobby:beforeMatch.
  //   In 20p mode, the lobby stores configs on the Room object directly.

  const roomCloneConfigs = new Map();

  // ── helpers ──────────────────────────────────────────────────────────

  function isCloneActive(match) {
    if (toEnv('SP_CLONE') === '1') return true;
    if (toEnv('SP_CLONE') === '0') return false;
    return !!(match.rules && match.rules.cloneMode);
  }

  function cloneGroupCount(match) {
    return (match._20pActive && match.poolGroups?.length) || 1;
  }

  // ── lobby:roomMessage  — handle clone config messages (4p mode) ─────

  modHook.on('lobby:roomMessage', (session, msg) => {
    // In 4p upstream mode the lobby's handleMessage default case calls this hook.
    // The 20p lobby has its own handlers and never reaches this hook for clone messages.
    const code = session.roomCode;
    if (!code) return undefined; // not in a room yet — let the lobby handle it

    let cfg = roomCloneConfigs.get(code) || { gameMode: 'original', poolScale: 4, poolScaleLocked: true, bossHpMult: 0, bossHpMultLocked: true, duckReplaceMax: 0, duckReplaceMaxLocked: true };
    let changed = false;

    if (msg.t === 'room.setGameMode') {
      cfg.gameMode = msg.mode;
      changed = true;
    } else if (msg.t === 'room.setPoolScale') {
      cfg.poolScale = msg.scale;
      cfg.poolScaleLocked = !msg.locked;
      changed = true;
    } else if (msg.t === 'room.setBossHpMult') {
      cfg.bossHpMult = msg.mult;
      cfg.bossHpMultLocked = !msg.locked;
      changed = true;
    } else if (msg.t === 'room.setDuckReplaceMax') {
      cfg.duckReplaceMax = msg.max;
      cfg.duckReplaceMaxLocked = !msg.locked;
      changed = true;
    } else {
      return undefined; // not a clone message — let the lobby (or another mod) handle it
    }

    if (changed) {
      roomCloneConfigs.set(code, cfg);
      console.log(`[mod:clone] room ${code} config: ${JSON.stringify(cfg)}`);
    }
    return { ok: true };
  });

  // ── lobby:beforeMatch  — inject clone configs from room ──────────────

  modHook.on('lobby:beforeMatch', (opts, room) => {
    // 20p mode: the 20p lobby already injects clone configs into opts.rules — nothing to do here
    if (room && room.gameMode === 'clone') {
      console.log(`[mod:clone] lobby before match — clone ON (20p, poolScale=${opts.rules?.poolScale}, hp=${opts.rules?.bossHpMult || 'locked'}, duck=${opts.rules?.duckReplaceMax || 'locked'})`);
      return;
    }
    // 4p mode: check room-level config first, then env var
    const code = room?.code;
    const cfg = code ? roomCloneConfigs.get(code) : null;
    const useClone = cfg?.gameMode === 'clone' || toEnv('SP_CLONE') === '1';
    if (useClone) {
      if (!opts.rules) opts.rules = {};
      opts.rules.cloneMode = true;
      opts.rules.poolScale = cfg?.gameMode === 'clone' && !cfg.poolScaleLocked ? (cfg.poolScale || 4) : 4;
      opts.rules.bossHpMult = cfg?.gameMode === 'clone' && !cfg.bossHpMultLocked ? (cfg.bossHpMult || 6) : 0;
      opts.rules.duckReplaceMax = cfg?.gameMode === 'clone' && !cfg.duckReplaceMaxLocked ? (cfg.duckReplaceMax || 0) : 0;
      console.log(`[mod:clone] lobby before match — clone ON (4p, seats=${opts.seats?.length || 0}, cfg=${cfg ? JSON.stringify(cfg) : 'env'})`);
    }
    // Clean up room config after match starts
    if (code) roomCloneConfigs.delete(code);
  });

  // ── match:init  — detect clone mode, override band draft, init pool ──

  modHook.on('match:init', (match) => {
    const active = isCloneActive(match);
    match._cloneActive = active;
    match._cloneGroupCount = active ? cloneGroupCount(match) : 1;

    if (!active) return;

    const is20p = !!match._20pActive;
    const seats = match.order?.length || 0;
    console.log(`[mod:clone] match init — ${is20p ? '20p' : '4p'} mode, seats=${seats}, cloneGroups=${match._cloneGroupCount}`);

    // Store configs for later hook use
    match._clonePoolScale = match.rules?.poolScale || 4;
    match._cloneBossHpMult = match.rules?.bossHpMult || 0;
    match._cloneDuckReplaceMax = match.rules?.duckReplaceMax || 0;

    // Store clone config directly on gd so that ctx.gd (including diyGameData
    // views created via Object.create) can always find it via prototype chain.
    if (match.gd) {
      match.gd._cloneCfg = {
        active: true,
        duckReplaceMax: match._cloneDuckReplaceMax,
        bossHpMult: match._cloneBossHpMult || 0,
        is20p: !!match._20pActive,
        matchRef: match,
      };
    }

    overrideEnterBandDraft(match, modHook);

    // Patch publicView to include clone-mode draft properties that the
    // upstream serialiser strips (views.js only copies standard fields).
    const origPublicView = match.publicView.bind(match);
    match.publicView = function _clonePublicView() {
      const v = origPublicView();
      if (v.draft && this.draft) {
        if (this.draft._cloneDraft) v.draft._cloneDraft = true;
        if (this.draft._cloneGroups) v.draft._cloneGroups = this.draft._cloneGroups;
      }
      return v;
    };
  });

  // ── Boss HP  — scale by player count & config ────────────────────────
  // Clone mode replaces the standard per-player share (share = min(4,aliveCount))
  // with its own formula: locked = base × aliveCount × 6, unlocked = base × bossHpMult.
  // ctx.result already has share factored in, so we recompute from ctx.base × ctx.tune directly.

  modHook.on('match:bossHp', (gd, bossId, aliveCount, ctx) => {
    const cfg = gd._cloneCfg;
    if (!cfg?.active) return;

    const mult = cfg.bossHpMult || (aliveCount * 6);
    // Recompute from base without the standard share scaling
    ctx.result = Math.max(1, Math.round(ctx.base * ctx.tune * mult));
    console.log(`[mod:clone] boss "${bossId}" HP → ${ctx.result.toLocaleString()} (×${mult}, alive=${aliveCount})`);
    return ctx.result;
  });

  // ── Duck max  — locked=aliveCount, unlocked=custom 1–20 ──────────────

  modHook.on('match:duckReplace', (ctx, spawns, p, ownerPlayerId) => {
    const cfg = ctx.gd._cloneCfg;
    if (!cfg?.active) return;

    const match = cfg.matchRef;
    const max = cfg.duckReplaceMax;

    if (max && max > 0) {
      if (p.max < max) p.max = max;
    } else {
      const aliveCount = match?.order?.filter((s) => s.alive && !s.left)?.length || 4;
      if (p.max < aliveCount) p.max = aliveCount;
    }
    // Return nothing — let standard duckReplace logic handle the replacement
  });

  // ── Pool scale  — multiply operator cards in each pool group ─────────
  //   Hooked via match:init — we override how pool groups create their pools.
  //   In 20p mode, createPoolGroups handles this. In 4p mode, we fine-tune.

  modHook.on('match:init', (match) => {
    if (!match._cloneActive) return;
    const scale = match._clonePoolScale || 4;

    // In 4p mode, the match.pool is the only pool — enlarge it
    if (!match._20pActive && match.pool) {
      match.pool._cloneScale = scale;
      const origRoll = match.pool.roll.bind(match.pool);
      match.pool.roll = function(rng, opts) {
        // Roll scale times and combine
        const results = [];
        for (let i = 0; i < scale; i++) {
          const r = origRoll(rng, opts);
          if (r) results.push(r);
        }
        return results.length ? results[Math.floor(rng() * results.length)] : null;
      };
      console.log(`[mod:clone] 4p pool scaled ×${scale}`);
    }
  });

  // ── Shop slots  — add bond-favouring slots, reset position counter ───

  modHook.on('match:shopSlots', (player, shopLevel, slots) => {
    const match = player.m;
    if (!match || !match._cloneActive) return;

    player._cloneBondRollIdx = 0;
    player._cloneBaseChess = slots.chess || 0;

    return { chess: player._cloneBaseChess + 2, item: slots.item || 0 };
  });

  // ── Chess slot roll  — force bond chess in the extra 2 slots ────────

  modHook.on('match:rollChessSlot', (player, slot) => {
    const match = player.m;
    if (!match || !match._cloneActive) return;

    const idx = player._cloneBondRollIdx ?? 0;
    player._cloneBondRollIdx = idx + 1;

    const baseChess = player._cloneBaseChess ?? 0;
    if (idx < baseChess) return;

    const bondId = player.affinityBondId;
    if (!bondId || bondId === '__random') return;

    const rollPool = (match._20pActive && typeof player.pool !== 'undefined') ? player.pool : match.pool;
    if (!rollPool) return;

    const filter = (id) => {
      const c = player.gd.chess(id);
      return c && Array.isArray(c.bonds) && c.bonds.includes(bondId);
    };
    var extra = typeof player.diyRollEntries === 'function' ? player.diyRollEntries() : [];
    var newId = rollPool.roll(match.rngShop, { maxTier: player.shop.level, extra: extra, filter: filter });
    if (newId) {
      slot.id = newId;
      slot.basePrice = player.gd.chessPrice(newId);
    }
  });

  // ── Item roll bias  — bias towards active bonds ──────────────────────

  modHook.on('match:rollItemSlot', (player, ctx) => {
    const match = player.m;
    if (!match || !match._cloneActive) return;

    if (!ctx.bias) {
      const bonds = player.bonds || {};
      const activeIds = [];
      for (const [id, st] of Object.entries(bonds)) {
        if (st && st.active) activeIds.push(id);
      }
      if (activeIds.length) ctx.bias = new Set(activeIds);
    }
  });

  // ── Band draft  — informational; logic is in enterBandDraft override ─

  modHook.on('phase:bandDraft:enter', (match) => {
    if (!match._cloneActive) return;
    console.log(`[mod:clone] band draft — cloneGroups=${match._cloneGroupCount}`);
  });

  console.log('[mod:clone] all hooks registered');
}

// ── enterBandDraft override ────────────────────────────────────────
//   Clone mode: all human players vote simultaneously. After voting, the
//   most-voted strategy per clone group wins (ties → random). Timeout
//   assigns 「阿米娅」. Once every human has voted, the draft ends at once.
//   Players who already voted can change their vote by selecting another
//   strategy and clicking 「改票」before everyone has voted.
//
//   A default affinity bond is assigned to each player (changeable in-game
//   via g.setAffinityBond).

const OK = Object.freeze({ ok: true });
const fail = (error, detail) => (detail ? { error, detail } : { error });

const BAND_TURN_SECONDS = 50;
const CLONE_DEFAULT_BAND = 'band_amiya';

function overrideEnterBandDraft(match, modHook) {
  const is20p = !!match._20pActive;
  const poolGroups = match.poolGroups;

  const origHandle = match._handle.bind(match);

  match.enterBandDraft = function _cloneEnterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;

    modHook.emit('phase:bandDraft:enter', this);
    this.phase = PHASE.BAND_DRAFT;

    const bandIds = this.gd.bandIds();
    if (!bandIds.length) return;
    const rng = (max) => Math.floor(this.rngDraft() * max);

    const order = this.order.map((p) => p.playerId);
    const groups = (is20p && poolGroups?.length)
      ? poolGroups.map((g) => ({ id: g.id, playerIds: g.playerIds.slice() }))
      : [{ id: '__all', playerIds: order.slice() }];

    this.draft = {
      order,
      picks: {},
      groups: [],
      _cloneDraft: true,
      _cloneGroups: groups.map((g) => ({ id: g.id, playerIds: g.playerIds })),
      focus: new Map(),
    };

    // AI seats auto-vote
    // TEMP: force all bots to vote 鸭爵 for testing clone duck fix
    for (const ps of this.order) {
      if (ps.isBot && ps.alive && !ps.left) {
        this.draft.picks[ps.playerId] = 'band_ducklord';
        // this.draft.picks[ps.playerId] = bandIds[rng(bandIds.length)];
      }
    }

    // Set countdown; timeout → assign 阿米娅 to human non-voters
    const humanCount = this.order.filter((p) => !p.isBot && p.alive && !p.left).length;
    if (humanCount > 0) {
      this.setDeadline(BAND_TURN_SECONDS, () => {
        if (this.phase !== PHASE.BAND_DRAFT) return;
        for (const ps of this.order) {
          if (!ps.alive || ps.left || ps.isBot) continue;
          if (!this.draft.picks[ps.playerId]) {
            this.draft.picks[ps.playerId] = CLONE_DEFAULT_BAND;
            console.log(`[mod:clone] timeout: ${ps.playerName || ps.playerId} → 阿米娅`);
          }
        }
        this.markPublic();
        this.later(0, () => this.finishBandDraft(true));
      });
    } else {
      this.setDeadline(0);
    }

    this.markPublic();

    // If every seat already has a vote (all bots), finish at once
    if (this.order.every((p) => !p.alive || p.left || !!this.draft.picks[p.playerId])) {
      this.later(0, () => this.finishBandDraft(false));
    }

    console.log(`[mod:clone] band draft voting — ${is20p ? '20p' : '4p'}, groups=${groups.length}, humans=${humanCount}`);
  };

  // Override _handle: intercept g.band (clone-mode voting) and g.setAffinityBond (in-game bond selector)
  match._handle = function _cloneHandle(ps, msg) {
    if (msg.t === 'g.band' && this.phase === PHASE.BAND_DRAFT && this._cloneActive) {
      if (!this.draft) return fail('WRONG_PHASE');
      const bandId = msg.bandId;
      if (!bandId || !this.gd.bandAllowed(bandId)) return fail('BAD_TARGET');

      const already = !!this.draft.picks[ps.playerId];
      this.draft.picks[ps.playerId] = bandId;
      this.draft.focus?.set(ps.playerId, bandId);
      this.markPublic();

      console.log(`[mod:clone] vote: ${ps.playerName || ps.playerId} → ${bandId}${already ? ' (改票)' : ''}`);

      // All human seats voted → finish at once
      if (this.order.every((p) => !p.alive || p.left || !!this.draft.picks[p.playerId])) {
        this.later(0, () => this.finishBandDraft(false));
      }
      return OK;
    }

    // In-game affinity bond selection — player chooses which bond to favour in clone shop slots
    if (msg.t === 'g.setAffinityBond' && this._cloneActive) {
      const bondId = msg.bondId;
      if (!bondId) return OK;

      if (bondId === '__random') {
        ps.affinityBondId = '__random';
        this.markPrivate(ps);
        return OK;
      }

      if (!this.gd.bond(bondId)) return OK;

      if (this.gd.modeInactiveBonds && this.gd.modeInactiveBonds.has(bondId)) return OK;

      ps.affinityBondId = bondId;
      this.markPrivate(ps);
      return OK;
    }

    return origHandle.call(this, ps, msg);
  };

  // finishBandDraft: tally votes per clone group, assign winning band (ties → random)
  match.finishBandDraft = function _cloneFinishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;

    const bandIds = this.gd.bandIds();
    const rng = (max) => Math.floor(this.rngDraft() * max);

    // Build group-level vote tallies
    const groups = (is20p && poolGroups?.length)
      ? poolGroups.map((g) => ({ id: g.id, playerIds: g.playerIds.slice() }))
      : [{ id: '__all', playerIds: this.order.map((p) => p.playerId) }];

    const groupBands = {};
    for (const g of groups) {
      const tally = {};
      for (const pid of g.playerIds) {
        const v = this.draft?.picks[pid];
        if (v) tally[v] = (tally[v] || 0) + 1;
      }
      // Find the band(s) with the most votes; ties → random among tied
      let bestC = -1;
      const tied = [];
      for (const [bid, c] of Object.entries(tally)) {
        if (c > bestC) { bestC = c; tied.length = 0; tied.push(bid); }
        else if (c === bestC) { tied.push(bid); }
      }
      groupBands[g.id] = tied.length > 1 ? tied[rng(tied.length)]
        : tied.length === 1 ? tied[0]
        : CLONE_DEFAULT_BAND;
    }

    // Apply winning band to every group member + default affinity bond
    for (const ps of this.order) {
      if (!ps.alive || ps.left) continue;
      const g = groups.find((g) => g.playerIds.includes(ps.playerId));
      const bandId = groupBands[(g || groups[0]).id];
      if (!bandId) continue;

      this.draft.picks[ps.playerId] = bandId;
      ps.bandId = bandId;
      ps.lp = this.gd.startLp(bandId, this.players.size);

      // Default affinity bond from band — changeable in-game via g.setAffinityBond
      if (!ps.affinityBondId) {
        const bids = this.gd.bandBondIds(bandId);
        if (bids && bids.length) ps.affinityBondId = '__random';
      }

      this.markPrivate(ps);
    }

    this.markPublic();
    console.log(`[mod:clone] band draft done — groups: ${JSON.stringify(groupBands)}`);
    void timeout;
    this.enterBattleCheck();
  };
}