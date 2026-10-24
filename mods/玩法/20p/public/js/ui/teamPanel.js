// Left team panel — 20p override: group-based pagination using poolGroupSizes.
// Upstream uses fixed PAGE_SIZE = 8; 20p replaces it with group-per-page so each
// pool group (e.g. [4,4,4] for 12 players) becomes its own page.
//
// Observing, double-click, LP tower, emote bubbles, etc. are unchanged from the
// upstream teamPanel.js — only the pagination block differs.
//
// Import path note: this file lives in mods/玩法/20p/public/js/ui/, so the
// browser resolves '../../../shared/playerCapacity.js' → '/shared/playerCapacity.js'
// which modServer serves from the 20p mod's own shared/ directory.

import { useEffect, useRef, useState, useMemo } from '../../vendor/hooks.module.js';
import { PHASE } from '../../../shared/constants.js';
import { html, Icon, Tooltip } from './components.js';
import { PlayerAvatar, LpTower, GIcon, LocalSprite } from './gameComponents.js';
import { EmoteBubble } from './emotes.js';
import { STATUS_META, sortedPlayers, teamFrameIds } from './gameLogic.js';
import { MissTag, uniteRemaining } from './hud.js';
import { localAsset } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { poolGroupSizes } from '../../../shared/playerCapacity.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const STATUS_SPRITE = { ready: 'icon_ready', deciding: 'icon_waiting', done: 'icon_complete', dead: 'icon_dead' };

export function rowLp(p, pub, self = null, { uniteLocal = null, cap = 10 } = {}) {
  const pubLp = Number.isFinite(p?.lp) ? p.lp : null;
  if ((pub?.phase !== PHASE.COMBAT && pub?.phase !== PHASE.UNITE) || p?.alive === false) return { lp: pubLp, pending: 0, unite: false, left: null };
  const lp = self && Number.isFinite(self.lp) ? self.lp : pubLp;
  const leaker = pub.phase === PHASE.UNITE && Array.isArray(pub.unite?.leakers) && pub.unite.leakers.includes(p.playerId);
  const local = !self && leaker && uniteLocal && typeof uniteLocal === 'object' ? uniteRemaining(uniteLocal[p.playerId] ?? 0, null) : null;
  const rawLeft = pub.phase !== PHASE.UNITE ? null : self ? self.left : local != null ? local : p.uniteLeft;
  const left = Number.isFinite(rawLeft) && rawLeft >= 0 ? Math.trunc(rawLeft) : null;
  if (lp == null) return { lp, pending: 0, unite: false, left };
  const raw = self ? self.pending : local != null ? Math.min(cap, local) : p.pendingLp;
  const pending = Math.min(lp, Math.max(0, Math.trunc(Number(raw) || 0)));
  return { lp, pending, unite: (pending > 0 || left != null) && (self ? !!self.unite : pub.phase === PHASE.UNITE), left };
}

export function teammateFieldShown(watching, player) {
  if (!watching || !player) return false;
  return watching === player.fieldId || watching === `n:${player.playerId}`;
}

export function teammateClickWatches(o = {}) {
  if (o.observe || o.askedRecently) return false;
  if (teammateFieldShown(o.watching, o.player)) return false;
  return !!o.player;
}

export function prepDblClickWatches(o = {}) {
  if (o.phase !== PHASE.PREP || o.self || !o.player || !o.observe) return false;
  if (o.askedRecently || teammateFieldShown(o.watching, o.player)) return false;
  const view = (typeof o.observe.canObserve === 'function' ? o.observe.canObserve(o.player) : null) || {};
  return !!view.fieldId;
}

const AVATAR_CLICK_GAP_MS = 500;

export function rowLpTip(lp, cap = 10) {
  if (!lp || !(lp.pending > 0)) return null;
  if (lp.unite && lp.left != null) return t('目标生命值 {lp}，联防中：漏过的敌人还剩 {left} 个，按现在结算扣除 {pending} 点（每回合至多 {cap} 点）', { lp: lp.lp, left: lp.left, pending: lp.pending, cap });
  return lp.unite ? t('目标生命值 {lp}，联防中，结算时扣除至多 {pending} 点', { lp: lp.lp, pending: lp.pending })
    : t('目标生命值 {lp}，结算时扣除 {pending} 点', { lp: lp.lp, pending: lp.pending });
}

export function TeamPanel({ pub, myId, watching, bubbles, onWatch, compact = false, observe = null, self: selfLive = null, cap = 10, uniteLocal = null, spMarks = null }) {
  const [openPid, setOpenPid] = useState(null);
  const askedAt = useRef(/** @type {{ id: string|null, at: number }} */ ({ id: null, at: 0 }));
  const phaseKey = `${pub?.phase}:${pub?.round}`;
  useEffect(() => { setOpenPid(null); }, [phaseKey, watching, observe?.observing]);
  const players = sortedPlayers(pub);
  if (!players.length) return null;

  // 20p: group-based pagination — each pool group is one page
  const groups = useMemo(() => poolGroupSizes(players.length), [players.length]);
  const totalPages = groups.length;
  const [page, setPage] = useState(0);
  useEffect(() => { setPage((p) => (p >= totalPages ? Math.max(0, totalPages - 1) : p)); }, [totalPages]);

  // map page → player slice from sortedPlayers (sorted by seat)
  let startIdx = 0;
  for (let i = 0; i < page; i++) startIdx += groups[i] || 0;
  const pageSize = groups[page] || 0;
  const pagePlayers = totalPages > 1 ? players.slice(startIdx, startIdx + pageSize) : players;
  const showNav = totalPages > 1;
  const navPrev = () => setPage((p) => (p <= 0 ? totalPages - 1 : p - 1));
  const navNext = () => setPage((p) => (p >= totalPages - 1 ? 0 : p + 1));

  const team = teamFrameIds(pub, myId);
  const frameArt = team.size ? localAsset('ui/battle', 'bg_team_border') : null;
  const askedRecently = (p) => askedAt.current.id === p?.playerId && Date.now() - askedAt.current.at < AVATAR_CLICK_GAP_MS;
  const noteAsked = (p) => { askedAt.current = { id: p.playerId, at: Date.now() }; };
  const click = (p, self) => {
    if (!observe) {
      if (self || teammateClickWatches({ watching, player: p, askedRecently: askedRecently(p) })) {
        if (!self) noteAsked(p);
        onWatch(p);
      }
      return;
    }
    if (self) { if (observe.observing) observe.onBack(); setOpenPid(null); return; }
    const view = observe.canObserve(p) || {};
    if (!view.fieldId) {
      setOpenPid(null);
      if (!askedRecently(p)) { noteAsked(p); onWatch(p); }
      return;
    }
    setOpenPid((cur) => (cur === p.playerId ? null : p.playerId));
  };
  const dblClick = (e, p, self) => {
    if (!prepDblClickWatches({ phase: pub?.phase, self, observe, watching, player: p, askedRecently: askedRecently(p) })) return;
    e.preventDefault();
    setOpenPid(null);
    noteAsked(p);
    onWatch(p);
  };
  return html`<aside class=${cx('team', compact && 'team--compact')} aria-label=${t('同盟成员')}>
    ${showNav ? html`<div class="team__pager" style=${{ pointerEvents: 'auto' }}>
      <button type="button" class="team__pager-btn" style=${{ pointerEvents: 'auto' }} onClick=${navPrev} title=${t('上一组')}>◂</button>
      <span class="team__pager-label">${String.fromCharCode(65 + page)}</span>
      <button type="button" class="team__pager-btn" style=${{ pointerEvents: 'auto' }} onClick=${navNext} title=${t('下一组')}>▸</button>
    </div>` : null}
    ${pagePlayers.map((p) => {
      const self = p.playerId === myId;
      const status = p.alive === false ? 'dead' : p.status;
      const meta = STATUS_META[status] || STATUS_META.acting;
      const watched = teammateFieldShown(watching, p);
      const bubble = bubbles?.get(p.playerId);
      const offline = p.connected === false && !p.isBot;
      const open = !!observe && openPid === p.playerId && !self;
      const back = !!observe && self && observe.observing;
      const title = observe ? (self ? (observe.observing ? t('返回战场') : t('你自己')) : t('查看 {name} 的战场', { name: p.name })) : (self ? t('查看自己的阵地') : t('查看 {name} 的阵地', { name: p.name }));
      const lp = rowLp(p, pub, self ? selfLive : null, { uniteLocal, cap });
      const inTeam = team.has(p.playerId);
      return html`<div key=${p.playerId} class=${cx('team__row', self && 'is-self', inTeam && 'is-team', watched && 'is-watched', p.alive === false && 'is-dead', open && 'is-open')}>
        <button type="button" class="team__btn" onClick=${() => click(p, self)} onDblClick=${(e) => dblClick(e, p, self)} title=${inTeam && !self ? `${title} · ${t('与你在同一战场')}` : title} aria-expanded=${observe && !self ? String(open) : undefined}>
          <${PlayerAvatar} player=${p} self=${self} />
          ${inTeam ? html`<span class=${cx('team__frame', !frameArt && 'team__frame--plain')} style=${frameArt ? `--frame:url("${frameArt}")` : undefined} aria-hidden="true"></span>` : null}
          <span class="team__seat num">P${(p.seat ?? 0) + 1}</span>
          ${p.isBot ? html`<span class="team__ai">AI</span>` : null}
          ${self ? html`<span class="team__you"><${Icon} name="user" /></span>` : null}
          ${spMarks?.get(p.playerId) === 'done' ? html`<span class="team__spmark is-done" title=${t('已完成选择')}><${Icon} name="check" /></span>`
            : spMarks?.get(p.playerId) === 'turn' ? html`<span class="team__spmark is-turn" title=${t('正在决策…')}><i></i><i></i><i></i></span>` : null}
        </button>
        <div class="team__info">
          <span class="team__name">${p.name || t('博士')}</span>
          <div class="team__line">
            <${LpTower} value=${lp.lp} size="sm" tone=${Number.isFinite(lp.lp) && lp.lp - lp.pending <= 5 ? 'danger' : null} pending=${lp.pending}
              tip=${rowLpTip(lp, cap)} />
            ${lp.left != null ? html`<${MissTag} n=${lp.left} name=${self ? null : p.name || t('博士')} />` : null}
            <${Tooltip} text=${offline ? t('连接已断开') : t(meta.text)} placement="right">
              <span class=${cx('team__status', `is-${meta.tone}`, offline && 'is-offline', (offline || STATUS_SPRITE[status]) && localAsset('ui/battle', offline ? 'icon_lost_connect' : STATUS_SPRITE[status]) && 'has-sprite')} aria-label=${t(meta.text)}>
                ${offline ? html`<${LocalSprite} name="icon_lost_connect" fallback=${html`<${Icon} name="wifiOff" />`} />`
                  : STATUS_SPRITE[status] ? html`<${LocalSprite} name=${STATUS_SPRITE[status]} fallback=${html`<${GIcon} name=${meta.glyph} />`} />`
                  : html`<${GIcon} name=${meta.glyph} />`}
              </span>
            <//>
            ${watched && !self ? html`<span class="team__eye" title=${t('正在查看')}><${GIcon} name="eye" /></span>` : null}
          </div>
          ${open ? html`<button type="button" class="btn btn--primary btn--sm team__ob"
            onClick=${() => { setOpenPid(null); onWatch(p); }}><span class="btn__label">${t('前往查看')}</span></button>` : null}
          ${back ? html`<button type="button" class="btn btn--secondary btn--sm team__back"
            onClick=${() => observe.onBack()}><span class="btn__label">${t('返回战场')}</span></button>` : null}
        </div>
        ${bubble ? html`<${EmoteBubble} key=${bubble.seq} id=${bubble.id} class="team__bubble" />` : null}
      </div>`;
    })}
  </aside>`;
}