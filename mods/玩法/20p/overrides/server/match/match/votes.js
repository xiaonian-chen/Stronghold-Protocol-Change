// server/match/match/votes.js — 20p extension (a method container of its own, installed by Match.js): the three
// majority votes of the 20-player mode. Unlike the unanimous setup reroll (setupVote.js), a vote here passes as soon
// as half of the seated humans agree (the proposer counts as one).
//
// 休整期加时 (requestPrepExtend / votePrepExtend): any seated human asks for +30 s or +60 s during PREP; on passing,
// the phase timer is re-armed with the time left plus the extension (a solo/untimed prep refuses it). One extension
// per prep: `_prepExtendRound` remembers the round that already took one.
//
// 联防跳过 (requestUniteSkip / voteUniteSkip): any seated human asks to end the running 联防 at once; on passing,
// every leaker is charged the enemies still standing on the field (the same per-round cap as a settlement, so a skip
// never costs more than playing it out), the field is cleared without paying any kill / bounty / 神秘顾客 coin to the
// helpers, and the phase settles through the ordinary settle() — the synthetic result below carries the survivors
// only, so the helpers gain no funds and no credited kills from it.
//
// 战斗倍速 (requestSpeedUp / voteSpeedUp): any seated human asks during PREP to run the match's animation clock at
// 1× or 2×; on passing, `gameSpeed` is set to base × that factor, so every later COMBAT / 联防 / boss phase runs its
// clock (and its client animation) at that speed. The prep timer and the strategy draft never read gameSpeed, so only
// those three phases change. The factor is a match-long state, not a one-shot: it can be turned back to 1× in a later
// PREP, and this vote is the only way to change it. Like the other two votes, a speed vote is refused while another
// prep vote is open, so at most one of them shows at a time.
//
// A vote that nobody answers cancels itself after VOTE_WINDOW_MS; a rejected one ends at once. All three votes are
// dropped lazily: each carries the round (prep) or the plan (联防) it was opened for, and the views publish it only
// while that still matches, so a stale vote can never be voted on or shown.

import { PHASE, ERR } from '../../../shared/constants.js';
import { OK, fail, FLOW_TICKER_PRIORITY } from './common.js';
import { msg } from '../../../shared/i18n.js';

/** How long an unanswered vote stays open (real ms, × timerScale). */
const VOTE_WINDOW_MS = 20_000;
/** The extensions a prep vote may ask for, in seconds. */
const EXTEND_SECONDS = new Set([30, 60]);
/** The animation-clock factors a 战斗倍速 vote may set: the match's own pace, or twice it. */
export const SPEED_MULS = new Set([1, 2]);
/** The ceiling Match.js puts on gameSpeed (its constructor clamps combatSpeed to it). */
const MAX_GAME_SPEED = 200;

/** The C2S intents of the votes: platform.js dispatches them here, before intents.js sees them. */
export const VOTE_TYPES = new Set(['g.prepExtend', 'g.prepExtendVote', 'g.uniteSkip', 'g.uniteSkipVote', 'g.speedUp', 'g.speedUpVote']);

/** The enemies the skip charges: a placeholder leak per still-standing enemy, so uniteSurvivors reads exactly them. */
const skipLeaks = (playerId, n) => Array.from({ length: n }, () => ({ enemyKey: 'unite-skip', sourcePlayerId: playerId, counted: true }));

export class Match20pVotes {
  /** The platform dispatcher of VOTE_TYPES (its return value is a fail() the platform hands back as-is). */
  _handle20pVote(ps, msg) {
    switch (msg.t) {
      case 'g.prepExtend': return this.requestPrepExtend(ps, msg.seconds);
      case 'g.prepExtendVote': return this.votePrepExtend(ps, msg.voteId, msg.agree);
      case 'g.uniteSkip': return this.requestUniteSkip(ps);
      case 'g.uniteSkipVote': return this.voteUniteSkip(ps, msg.voteId, msg.agree);
      case 'g.speedUp': return this.requestSpeedUp(ps, msg.mul);
      case 'g.speedUpVote': return this.voteSpeedUp(ps, msg.voteId, msg.agree);
      default: return fail(ERR.BAD_MSG);
    }
  }

  // ---- 休整期加时 ---------------------------------------------------------

  requestPrepExtend(ps, seconds) {
    if (this.disposed || this.ended || this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!EXTEND_SECONDS.has(seconds)) return fail(ERR.BAD_MSG, 'unknown extension');
    if (!ps || ps.spectator || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (!(this.deadline > 0)) return fail(ERR.WRONG_PHASE, 'prep is untimed');
    if (this._prepExtendRound === this.round) return fail(ERR.WRONG_PHASE, 'prep already extended this round');
    const cur = this.prepExtendVote;
    if (cur && cur.round === this.round) return fail(ERR.WRONG_PHASE, 'prep extension vote in progress');
    const other = this.speedUpVote;
    if (other && other.round === this.round) return fail(ERR.WRONG_PHASE, 'speed-up vote in progress');
    const voters = this._voteSeats();
    if (!voters.length) return fail(ERR.NOT_IN_ROOM);
    const vote = {
      id: (this._20pVoteSeq = (this._20pVoteSeq || 0) + 1),
      kind: 'prep',
      round: this.round,
      seconds,
      proposerId: ps.playerId,
      voters,
      agreed: new Set([ps.playerId]),
      declined: new Set(),
      endsAt: this.sched.now() + this.scaled(VOTE_WINDOW_MS),
    };
    this.prepExtendVote = vote;
    return this._openVote(vote, () => this._applyPrepExtend(vote));
  }

  votePrepExtend(ps, voteId, agree) {
    const vote = this.prepExtendVote;
    if (this.disposed || this.ended || this.phase !== PHASE.PREP || !vote || vote.round !== this.round) return fail(ERR.WRONG_PHASE);
    return this._vote(ps, vote, voteId, agree, () => this._applyPrepExtend(vote));
  }

  // ---- 战斗倍速 ---------------------------------------------------------

  /**
   * Any seated human asks, during PREP, to run every later COMBAT / 联防 / boss phase at `mul` × the base clock.
   * @param {number} mul 1 (the match's own pace) or 2
   */
  requestSpeedUp(ps, mul) {
    if (this.disposed || this.ended || this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps || ps.spectator || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (!SPEED_MULS.has(mul)) return fail(ERR.BAD_MSG, 'unknown multiplier');
    if ((this._speedMulState || 1) === mul) return fail(ERR.WRONG_PHASE, 'speed already at that multiplier');
    const cur = this.speedUpVote;
    if (cur && cur.round === this.round) return fail(ERR.WRONG_PHASE, 'speed-up vote in progress');
    const other = this.prepExtendVote;
    if (other && other.round === this.round) return fail(ERR.WRONG_PHASE, 'prep extension vote in progress');
    const voters = this._voteSeats();
    if (!voters.length) return fail(ERR.NOT_IN_ROOM);
    const vote = {
      id: (this._20pVoteSeq = (this._20pVoteSeq || 0) + 1),
      kind: 'speed',
      round: this.round,
      mul,
      proposerId: ps.playerId,
      voters,
      agreed: new Set([ps.playerId]),
      declined: new Set(),
      endsAt: this.sched.now() + this.scaled(VOTE_WINDOW_MS),
    };
    this.speedUpVote = vote;
    return this._openVote(vote, () => this._applySpeedUp(vote));
  }

  voteSpeedUp(ps, voteId, agree) {
    const vote = this.speedUpVote;
    if (this.disposed || this.ended || this.phase !== PHASE.PREP || !vote || vote.round !== this.round) return fail(ERR.WRONG_PHASE);
    return this._vote(ps, vote, voteId, agree, () => this._applySpeedUp(vote));
  }

  // ---- 联防跳过 ----------------------------------------------------------

  requestUniteSkip(ps) {
    if (this.disposed || this.ended || this.phase !== PHASE.UNITE || !this.unitePlan) return fail(ERR.WRONG_PHASE);
    if (!ps || ps.spectator || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    const cur = this.uniteSkipVote;
    if (cur && cur.plan === this.unitePlan) return fail(ERR.WRONG_PHASE, 'unite skip vote in progress');
    const voters = this._voteSeats();
    if (!voters.length) return fail(ERR.NOT_IN_ROOM);
    const vote = {
      id: (this._20pVoteSeq = (this._20pVoteSeq || 0) + 1),
      kind: 'unite',
      plan: this.unitePlan,
      proposerId: ps.playerId,
      voters,
      agreed: new Set([ps.playerId]),
      declined: new Set(),
      endsAt: this.sched.now() + this.scaled(VOTE_WINDOW_MS),
    };
    this.uniteSkipVote = vote;
    return this._openVote(vote, () => this._applyUniteSkip(vote));
  }

  voteUniteSkip(ps, voteId, agree) {
    const vote = this.uniteSkipVote;
    if (this.disposed || this.ended || this.phase !== PHASE.UNITE || !vote || vote.plan !== this.unitePlan) return fail(ERR.WRONG_PHASE);
    return this._vote(ps, vote, voteId, agree, () => this._applyUniteSkip(vote));
  }

  // ---- shared vote plumbing ---------------------------------------------

  /** The seats that may vote: every human still in the room and connected (a seat that dropped out cannot answer). */
  _voteSeats() { return this.humans().filter((p) => p.connected).map((p) => p.playerId); }

  /**
   * Arm a freshly proposed vote. The proposer already counts as one agreeing seat, so a room where that is already
   * half passes it at once — there is nothing left to ask. Otherwise it waits VOTE_WINDOW_MS for the others.
   */
  _openVote(vote, onPass) {
    if (vote.agreed.size >= this._voteNeed(vote)) {
      this._endVote(vote);
      return onPass();
    }
    vote.timer = this.later(this.scaled(VOTE_WINDOW_MS), () => this._expireVote(vote));
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /**
   * One seat's answer to an open vote; `onPass` runs once half of the voters agreed (the proposer included).
   * A seat answers once: the proposer is already in `agreed`, and re-sending the same answer would let one client
   * stack votes (the UI hides the buttons for a seat that answered, this is the server-side guard).
   */
  _vote(ps, vote, voteId, agree, onPass) {
    if (vote.id !== voteId) return fail(ERR.BAD_TARGET, 'vote changed');
    if (!ps || ps.spectator || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (!vote.voters.includes(ps.playerId)) return fail(ERR.NOT_IN_ROOM);
    if (agree ? vote.agreed.has(ps.playerId) : vote.declined.has(ps.playerId)) return fail(ERR.BAD_MSG, 'already voted');
    if (!agree) {
      // a single 拒绝 does not kill a 20-seat vote: it only takes that seat out, and the vote ends once it can no longer pass
      vote.declined.add(ps.playerId);
      vote.agreed.delete(ps.playerId);
      if (vote.agreed.size + (vote.voters.length - vote.agreed.size - vote.declined.size) < this._voteNeed(vote)) {
        this._endVote(vote);
        return OK;
      }
      this.markPublic();
      this.flush(true);
      return OK;
    }
    vote.declined.delete(ps.playerId);
    vote.agreed.add(ps.playerId);
    if (vote.agreed.size >= this._voteNeed(vote)) {
      this._endVote(vote);
      return onPass();
    }
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /** Half of the seats (rounded up) — 半数玩家同意即可. */
  _voteNeed(vote) { return Math.max(1, Math.ceil(vote.voters.length / 2)); }

  /** Close a vote without applying it (rejected / expired): its timer is dropped and the views forget it. */
  _endVote(vote) {
    this.cancel(vote.timer);
    vote.timer = null;
    if (this.prepExtendVote === vote) this.prepExtendVote = null;
    if (this.uniteSkipVote === vote) this.uniteSkipVote = null;
    if (this.speedUpVote === vote) this.speedUpVote = null;
    this.markPublic();
    this.flush(true);
  }

  _expireVote(vote) {
    vote.timer = null;
    if (this.prepExtendVote === vote) this.prepExtendVote = null;
    if (this.uniteSkipVote === vote) this.uniteSkipVote = null;
    if (this.speedUpVote === vote) this.speedUpVote = null;
    this.markPublic();
    this.flush(true);
  }

  /** Add the agreed seconds to the prep's deadline: the phase timer is re-armed with the time left plus the extension. */
  _applyPrepExtend(vote) {
    if (this.phase !== PHASE.PREP || this.round !== vote.round) return fail(ERR.WRONG_PHASE);
    const left = this.deadline > 0 ? Math.max(0, this.deadline - this.sched.now()) : 0;
    if (!(left > 0)) return fail(ERR.WRONG_PHASE, 'prep is untimed');
    this._prepExtendRound = this.round;
    // setDeadline scales its seconds again, so it takes the already-real total divided by that scale (phases.js bandTurn)
    this.setDeadline((left + this.scaled(vote.seconds * 1000)) / 1000 / (this.timerScale || 1), () => this.prepDeadline());
    this.tickerText(msg('休整期加时 {secs} 秒', { secs: vote.seconds }), FLOW_TICKER_PRIORITY);
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /**
   * Set the match's animation clock to base × the agreed factor. Every COMBAT / 联防 / boss phase derives its
   * deadline, its client `b.start` speed and its overtime drain from `gameSpeed`, so this paces all three; PREP and
   * the strategy draft read their own timers and are untouched. `_speedBase` is the clock the match started with, kept
   * so a later 1× vote returns to it exactly (and so a test's custom combatSpeed is not multiplied twice).
   */
  _applySpeedUp(vote) {
    if (this.phase !== PHASE.PREP || this.round !== vote.round) return fail(ERR.WRONG_PHASE);
    if ((this._speedMulState || 1) === vote.mul) return fail(ERR.WRONG_PHASE, 'speed already at that multiplier');
    if (!(this._speedBase > 0)) this._speedBase = this.gameSpeed;
    this._speedMulState = vote.mul;
    this.gameSpeed = Math.min(MAX_GAME_SPEED, this._speedBase * vote.mul);
    this.tickerText(vote.mul > 1
      ? msg('战斗倍速 ×{mul}：战斗、联防、boss 阶段动画加速', { mul: vote.mul })
      : msg('战斗倍速恢复 ×1：战斗、联防、boss 阶段动画恢复原速'), FLOW_TICKER_PRIORITY);
    this.markPublic();
    this.flush(true);
    return OK;
  }

  /**
   * End the 联防 at once: the enemies still standing are charged to their owners (capped like a settlement), the field
   * is cleared without a single kill / bounty payout, and settle() closes the phase on the survivors carried below.
   */
  _applyUniteSkip(vote) {
    const plan = this.unitePlan;
    if (this.phase !== PHASE.UNITE || !plan || plan !== vote.plan) return fail(ERR.WRONG_PHASE);
    const counts = new Map();
    for (const lk of plan.leakers) {
      const n = Math.max(0, Math.trunc(Number(this._uniteLeft(lk)) || 0));
      if (n > 0) counts.set(lk.playerId, n);
    }
    // the field stops here: no further kill, bounty or 神秘顾客 payout reaches a helper
    if (this.runner) {
      try { this.runner.stop(); } catch { /* ignore */ }
      this.runner = null;
    }
    this._stopClientCombat();
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    plan.skipRemaining = true;
    const perPlayer = {};
    for (const [pid, n] of counts) perPlayer[pid] = { leaked: skipLeaks(pid, n) };
    // no coins / killed / creditedKills in this result: only the survivors it carries reach the settlement
    const res = { synthetic: false, perPlayer, unspawned: [] };
    // _uniteLeft already counted the leaks that could not re-enter, so the settlement must not add them twice
    const skipPlan = { ...plan, notReentered: new Map() };
    this.tickerText(msg('联防跳过：{names} 的 {n} 个敌人直接结算', {
      names: plan.leakers.filter((lk) => counts.has(lk.playerId)).map((lk) => lk.name).join('、') || '-',
      n: [...counts.values()].reduce((s, n) => s + n, 0),
    }), FLOW_TICKER_PRIORITY);
    this.markPublic();
    this.flush(true);
    this.later(0, () => this.settle(skipPlan, res));
    return OK;
  }
}