// 机变 draft overlay — 20p override with grouped draft UI.
// When sp.groups exists and has >1 group, renders group tabs and per-group card grids.
// Falls through to the standard single-group layout otherwise.

import { useEffect, useState, useRef, useMemo } from '../../vendor/hooks.module.js';
import { html, Icon, TierChip, Countdown, Button } from './components.js';
import { Img, RichText, PlayerAvatar, GIcon } from './gameComponents.js';
import { itemIconUrl, enemyIconUrl, uiUrl } from './assetUrls.js';
import { richTextPlain } from './richText.js';
import { sortedPlayers } from './gameLogic.js';
import { data } from '../data.js';
import { t, tName } from '../../../shared/i18n.js';
import { sentText } from './lang.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const bare = (t) => String(t || '').replace(/\s+/g, '');

export function cardText(card, rich, rawRich = rich) {
  if (card.descRaw) return rich && card.descRaw === rawRich ? rich : card.descRaw;
  if (rich && (!card.desc || bare(richTextPlain(rawRich || rich)) === bare(card.desc))) return rich;
  return card.desc || rich || '';
}

export function resolveSpCard(card, family) {
  const choices = data.get('choices');
  const byEffect = (list, id) => (Array.isArray(list) && id ? list.find((x) => x && x.effectId === id) : null);
  const effectId = card.effectId || (!card.itemId && typeof card.id === 'string' && data.lookup('effects', card.id) ? card.id : null);
  const eff = effectId ? data.lookup('effects', effectId) : null;
  const itemId = card.itemId || (!effectId && typeof card.id === 'string' && data.lookup('items', card.id) ? card.id : null);
  const item = itemId ? data.lookup('items', itemId) : null;
  const rawRich = (itemId && data.lookupRaw('items', itemId)?.descRaw) || (effectId && data.lookupRaw('effects', effectId)?.descRaw) || '';
  const bounty = byEffect(choices?.cards?.bounty, effectId);
  const tactic = byEffect(choices?.cards?.tactic, effectId);
  const m = data.get('assets');
  const kind = card.kind === 'item' || item ? 'item' : card.kind === 'bounty' || bounty || family === 'bounty' ? 'bounty' : 'tactic';
  const enemyKey = card.enemyKey || bounty?.enemyKey || eff?.params?.enemy_id || null;
  const team = card.team ?? tactic?.team ?? (eff?.decoIconId === 'icon_team_buff');
  let icon = null;
  if (item) icon = itemIconUrl(m, item);
  else if (kind === 'bounty' && enemyKey) icon = enemyIconUrl(m, enemyKey);
  else if ((card.tacticKind || tactic?.kind) === 'terrain') icon = uiUrl(m, 'buffIcon/icon_stage_buff');
  else if ((card.tacticKind || tactic?.kind) === 'enemyDebuff') icon = uiUrl(m, 'buffIcon/icon_enemy_debuff');
  else icon = uiUrl(m, `buffIcon/${team ? 'icon_team_buff' : 'icon_player_buff'}`);
  return {
    kind,
    name: tName(card.name) || item?.name || eff?.name || bounty?.name || tactic?.name || t('机变'),
    desc: cardText(card, item?.descRaw || eff?.descRaw || '', rawRich) || item?.desc || eff?.desc || bounty?.desc || tactic?.desc || '',
    tier: Number.isFinite(card.tier) ? card.tier : item?.tier ?? bounty?.tier ?? null,
    icon,
    team: !!team,
    coin: card.coin ?? bounty?.coin ?? eff?.enemyPrice ?? null,
  };
}

export function pickBusy(busyIdx, card, mine) {
  return busyIdx != null && !!card && busyIdx === card.idx && mine == null && !card.takenBy;
}

export function cardPickable(sp, card, { myId, solo, busyIdx = null }) {
  if (!sp || !card) return false;
  const myTurn = solo || sp.turnPid === myId;
  return myTurn && sp.pickOf.get(myId) == null && !card.takenBy && !card.soldOut && busyIdx == null;
}

export function spTap(armed, idx, pickable) {
  if (!pickable || !Number.isInteger(idx)) return { armed, pick: null };
  if (armed === idx) return { armed: null, pick: idx };
  return { armed: idx, pick: null };
}

export function armedCard(armed, sp, o) {
  if (armed == null || !sp) return null;
  const card = sp.cards.find((c) => c && c.idx === armed);
  return cardPickable(sp, card, o) ? armed : null;
}

export function ChoiceOverlay(props) {
  const { sp, myId, solo, busyIdx = null, onPick } = props;
  const groups = sp?.groups;
  const hasGroups = groups && groups.length > 1;
  const [sel, setSel] = useState(null);
  const [activeGroupIdx, setActiveGroupIdx] = useState(0);
  const groupInitRef = useRef(false);

  const activeGroup = hasGroups ? (groups[activeGroupIdx] || groups[0]) : null;
  const pickSp = hasGroups && activeGroup ? {
    ...sp,
    cards: activeGroup.cards,
    order: activeGroup.order,
    turnPid: activeGroup.turn ?? activeGroup.turnPid,
    pickOf: activeGroup.pickOf instanceof Map ? activeGroup.pickOf : new Map(Object.entries(activeGroup.picks || {}).map(([k, v]) => [k, v])),
    takenBy: activeGroup.takenBy instanceof Map ? activeGroup.takenBy : new Map(),
    pickedCount: activeGroup.pickedCount ?? (activeGroup.pickOf instanceof Map ? activeGroup.pickOf.size : Object.keys(activeGroup.picks || {}).length),
    turnDeadline: activeGroup.turnDeadline || 0,
  } : sp;
  const armed = armedCard(sel, pickSp, { myId, solo, busyIdx });

  useEffect(() => { if (sel != null && armed == null) setSel(null); }, [sel, armed]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSel(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armed]);

  useEffect(() => {
    if (!hasGroups || groupInitRef.current) return;
    const myGroup = groups.find((g) => g.order.includes(myId));
    if (myGroup) {
      const myIdx = groups.indexOf(myGroup);
      if (myIdx >= 0 && myIdx !== activeGroupIdx) setActiveGroupIdx(myIdx);
    }
    groupInitRef.current = true;
  }, [hasGroups, groups, myId]);

  if (!sp) return null;

  const tap = (idx) => {
    const card = pickSp.cards.find((c) => c && c.idx === idx);
    const r = spTap(armed, idx, cardPickable(pickSp, card, { myId, solo, busyIdx }));
    setSel(r.armed);
    if (r.pick != null) onPick(r.pick);
  };

  if (hasGroups) {
    return html`<${GroupedChoiceView} ...${props} sp=${pickSp} groups=${groups} activeGroupIdx=${activeGroupIdx} onSwitchGroup=${(i) => setActiveGroupIdx(i)} armed=${armed} onTap=${tap}
      onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
  }

  return html`<${ChoiceView} ...${props} armed=${armed} onTap=${tap}
    onConfirm=${() => { if (armed != null) tap(armed); }} onDisarm=${() => setSel(null)} />`;
}

export function spMarks(sp, { solo }) {
  const out = new Map();
  if (!sp || solo || !Array.isArray(sp.order)) return out;
  for (const pid of sp.order) {
    if (sp.pickOf.has(pid)) out.set(pid, 'done');
    else if (sp.turnPid === pid) out.set(pid, 'turn');
  }
  return out;
}

export function ChoiceView({ pub, sp, myId, solo, personal = false, busyIdx = null, total = null, armed = null, onTap = () => {}, onConfirm = () => {}, onDisarm = () => {} }) {
  if (!sp) return null;
  const fam = data.get('choices')?.families?.[sp.family] || null;
  const rawFam = data.getRaw('choices')?.families?.[sp.family] || null;
  const players = new Map(sortedPlayers(pub).map((p) => [p.playerId, p]));
  const myTurn = solo || sp.turnPid === myId;
  const mine = sp.pickOf.get(myId);
  const turnName = players.get(sp.turnPid)?.name || t('队友');
  const special = /_s$/.test(String(sp.family || ''));
  const timed = personal ? pub?.deadline > 0 : !solo && !sp.untimed;
  const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
  const armedName = armedCardRec ? resolveSpCard(armedCardRec, sp.family).name : null;
  const onDown = (e) => {
    if (armed == null) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('.spcard, .spov__confirm')) return;
    onDisarm();
  };
  return html`<div class=${cx('spov', armed != null && 'has-armed', personal && 'spov--personal')} role="dialog" aria-label=${personal ? t('教鞭选择') : t('机变阶段')} onPointerDown=${onDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <i class="spov__deco" aria-hidden="true"></i>
          <h2 class=${cx('spov__title', special && 'is-special')}><span class="spov__name">${sentText(sp.name, rawFam?.name, fam?.name) || fam?.name || t('机变')}</span><span class="spov__bar">|</span><span class="spov__desc"><${RichText} text=${sentText(sp.desc, rawFam?.desc, fam?.desc) || fam?.desc || t('选择一项')} /></span></h2>
          <p class="spov__sub">${timed ? (personal ? t('休整期结束时未选择将自动选定') : t('倒计时结束后仍未选定将自动分配')) : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        </div>
        <div class="spov__turn">
          ${personal ? html`<span class="spov__turntxt is-mine">${t('从候选中选择一项战术特训')}</span>`
            : mine != null ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已完成选择')}</span>`
            : myTurn ? html`<span class="spov__turntxt is-mine">${t('当前轮到你决策')}</span>`
            : html`<span class="spov__turntxt is-other"><span class="spov__tw"><b>${turnName}</b><small>${t('正在决策…')}</small></span><${Icon} name="hourglass" /></span>`}
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="spov__confirm" data-testid="sp-confirm"
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>` : null}
          ${timed ? html`<${Countdown} deadline=${pub?.deadline} total=${total ?? undefined} size="md" />` : null}
        </div>
      </header>
      <div class=${cx('spov__grid', sp.cards.length <= 3 && 'spov__grid--3')}>
        ${sp.cards.map((card) => {
          const r = resolveSpCard(card, sp.family);
          const taker = card.takenBy ? players.get(card.takenBy) : null;
          const can = cardPickable(sp, card, { myId, solo, busyIdx });
          const busy = pickBusy(busyIdx, card, mine);
          const isArmed = can && armed === card.idx;
          const takerName = taker ? (card.takenBy === myId ? t('你') : taker.name) : null;
          return html`<button key=${card.idx} type="button" class=${cx('spcard', `spcard--${r.kind}`, (card.takenBy || card.soldOut) && 'is-taken', card.takenBy === myId && 'is-mine', can && 'is-pickable', isArmed && 'is-armed', busy && 'is-busy')}
              aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(isArmed) : undefined} disabled=${!can} onClick=${() => can && onTap(card.idx)}
              aria-label=${isArmed ? t('{name}，已选中，再次点击确认', { name: r.name }) : takerName ? t('{name}，{takerName}已选择', { name: r.name, takerName }) : r.name} title=${`${r.name}\n${richTextPlain(r.desc)}`}>
            <span class="spcard__glow" aria-hidden="true"></span>
            <span class="spcard__head">
              <span class="spcard__icon"><${Img} src=${r.icon} fallback=${html`<${GIcon} name=${r.kind === 'bounty' ? 'target' : 'bolt'} />`} /></span>
              <span class="spcard__title">
                <b class="spcard__name">${r.name}</b>
                ${r.team || (r.kind === 'bounty' && r.coin) ? html`<span class="spcard__tags">
                  ${r.team ? html`<span class="spcard__tag spcard__tag--team">${t('全队获得')}</span>` : null}
                  ${r.kind === 'bounty' && r.coin ? html`<span class="spcard__tag spcard__tag--coin">${t('赏金 {coin}', { coin: r.coin })}</span>` : null}
                </span>` : null}
              </span>
            </span>
            <${RichText} text=${r.desc} class="spcard__desc" />
            ${card.soldOut && !taker ? html`<span class="spcard__busy" role="status">${t('库存不足')}</span>` : null}
            ${r.tier ? html`<${TierChip} tier=${r.tier} size="md" class="spcard__tier" />` : null}
            ${taker ? html`<span class="spcard__taker" title=${t('{name} 已选择', { name: taker.name })}><${PlayerAvatar} player=${taker} size="sm" /></span>` : null}
            ${isArmed ? html`<span class="spcard__confirm" role="status"><span class="spcard__cbox"><${Icon} name="check" /></span><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
            ${busy ? html`<span class="spcard__busy" role="status">${t('选择中')}</span>` : null}
          </button>`;
        })}
      </div>
    </div>
  </div>`;
}

function GroupedChoiceView({ pub, sp, myId, solo, groups, activeGroupIdx, onSwitchGroup, busyIdx = null, total = null, armed = null, onTap = () => {}, onConfirm = () => {}, onDisarm = () => {} }) {
  if (!sp) return null;
  const fam = data.get('choices')?.families?.[sp.family] || null;
  const rawFam = data.getRaw('choices')?.families?.[sp.family] || null;
  const players = new Map(sortedPlayers(pub).map((p) => [p.playerId, p]));
  const myTurn = solo || sp.turnPid === myId;
  const mine = sp.pickOf.get(myId);
  const turnName = players.get(sp.turnPid)?.name || t('队友');
  const special = /_s$/.test(String(sp.family || ''));
  const timed = !solo && !sp.untimed;
  const armedCardRec = armed != null ? sp.cards.find((c) => c && c.idx === armed) : null;
  const armedName = armedCardRec ? resolveSpCard(armedCardRec, sp.family).name : null;
  const onDown = (e) => {
    if (armed == null) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('.spcard, .spov__confirm')) return;
    onDisarm();
  };
  const groupLabels = ['A', 'B', 'C', 'D', 'E'];
  return html`<div class=${cx('spov', armed != null && 'has-armed')} role="dialog" aria-label=${t('机变阶段')} onPointerDown=${onDown}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <i class="spov__deco" aria-hidden="true"></i>
          <h2 class=${cx('spov__title', special && 'is-special')}><span class="spov__name">${sentText(sp.name, rawFam?.name, fam?.name) || fam?.name || t('机变')}</span><span class="spov__bar">|</span><span class="spov__desc"><${RichText} text=${sentText(sp.desc, rawFam?.desc, fam?.desc) || fam?.desc || t('选择一项')} /></span></h2>
          <p class="spov__sub">${timed ? t('倒计时结束后仍未选定将自动分配') : t('选择一项（无时间限制）')}${mine == null && myTurn ? t(' · 点击卡牌选中，再次点击确认') : ''}</p>
        </div>
        <div class="spov__turn">
          ${mine != null ? html`<span class="spov__turntxt is-done"><${Icon} name="check" />${t('已完成选择')}</span>`
            : myTurn ? html`<span class="spov__turntxt is-mine">${t('当前轮到你决策')}</span>`
            : html`<span class="spov__turntxt is-other"><span class="spov__tw"><b>${turnName}</b><small>${t('正在决策…')}</small></span><${Icon} name="hourglass" /></span>`}
          ${armed != null ? html`<${Button} variant="primary" size="lg" icon="check" class="spov__confirm" data-testid="sp-confirm"
              title=${armedName ? t('确认选择「{armedName}」（再次点击卡牌亦可）', { armedName }) : t('确认选择')} onClick=${onConfirm}>${t('确认选择')}<//>` : null}
          ${timed ? html`<${Countdown} deadline=${sp.turnDeadline || pub?.deadline} total=${total ?? undefined} size="md" />` : null}
        </div>
      </header>
      <div class="spov__groups">
        ${groups.map((g, gi) => {
          const label = groupLabels[gi] || `${gi + 1}`;
          const doneCount = g.pickedCount ?? (g.pickOf instanceof Map ? g.pickOf.size : Object.keys(g.picks || {}).length);
          const totalInGroup = g.order.length;
          const isActive = gi === activeGroupIdx;
          return html`<button key=${g.id} type="button" class=${cx('spov__group-btn', isActive && 'is-active', g.done && 'is-done')}
              onClick=${() => onSwitchGroup(gi)} aria-pressed=${String(isActive)}>
            <b>${label}${t('组')}</b> <span class="spov__group-progress">${doneCount}/${totalInGroup}</span>
          </button>`;
        })}
      </div>
      ${(() => {
        const activeGroup = groups[activeGroupIdx];
        if (!activeGroup) return null;
        return html`<div class="spov__group-order">
          ${activeGroup.order.map((pid, i) => {
            const p = players.get(pid);
            const picked = activeGroup.pickOf instanceof Map ? activeGroup.pickOf.has(pid) : activeGroup.picks?.[pid] != null;
            const isTurn = (activeGroup.turn ?? activeGroup.turnPid) === pid;
            return html`${i > 0 ? html`<span class="spov__arrow">⟩⟩⟩</span>` : null}<span key=${pid} class=${cx('spov__player', picked && 'is-done', isTurn && !picked && 'is-turn')}>${p?.name || pid}</span>`;
          })}
        </div>`;
      })()}
      <div class=${cx('spov__grid', sp.cards.length <= 3 && 'spov__grid--3')}>
        ${sp.cards.map((card) => {
          const r = resolveSpCard(card, sp.family);
          const taker = card.takenBy ? players.get(card.takenBy) : null;
          const can = cardPickable(sp, card, { myId, solo, busyIdx });
          const busy = pickBusy(busyIdx, card, mine);
          const isArmed = can && armed === card.idx;
          const takerName = taker ? (card.takenBy === myId ? t('你') : taker.name) : null;
          return html`<button key=${card.idx} type="button" class=${cx('spcard', `spcard--${r.kind}`, (card.takenBy || card.soldOut) && 'is-taken', card.takenBy === myId && 'is-mine', can && 'is-pickable', isArmed && 'is-armed', busy && 'is-busy')}
              aria-busy=${busy ? 'true' : undefined} aria-pressed=${can ? String(isArmed) : undefined} disabled=${!can} onClick=${() => can && onTap(card.idx)}
              aria-label=${isArmed ? t('{name}，已选中，再次点击确认', { name: r.name }) : takerName ? t('{name}，{takerName}已选择', { name: r.name, takerName }) : r.name} title=${`${r.name}\n${richTextPlain(r.desc)}`}>
            <span class="spcard__glow" aria-hidden="true"></span>
            <span class="spcard__head">
              <span class="spcard__icon"><${Img} src=${r.icon} fallback=${html`<${GIcon} name=${r.kind === 'bounty' ? 'target' : 'bolt'} />`} /></span>
              <span class="spcard__title">
                <b class="spcard__name">${r.name}</b>
                ${r.team || (r.kind === 'bounty' && r.coin) ? html`<span class="spcard__tags">
                  ${r.team ? html`<span class="spcard__tag spcard__tag--team">${t('全队获得')}</span>` : null}
                  ${r.kind === 'bounty' && r.coin ? html`<span class="spcard__tag spcard__tag--coin">${t('赏金 {coin}', { coin: r.coin })}</span>` : null}
                </span>` : null}
              </span>
            </span>
            <${RichText} text=${r.desc} class="spcard__desc" />
            ${card.soldOut && !taker ? html`<span class="spcard__busy" role="status">${t('库存不足')}</span>` : null}
            ${r.tier ? html`<${TierChip} tier=${r.tier} size="md" class="spcard__tier" />` : null}
            ${taker ? html`<span class="spcard__taker" title=${t('{name} 已选择', { name: taker.name })}><${PlayerAvatar} player=${taker} size="sm" /></span>` : null}
            ${isArmed ? html`<span class="spcard__confirm" role="status"><span class="spcard__cbox"><${Icon} name="check" /></span><b>${t('确认选择')}</b><small>${t('再次点击')}</small></span>` : null}
            ${busy ? html`<span class="spcard__busy" role="status">${t('选择中')}</span>` : null}
          </button>`;
        })}
      </div>
    </div>
  </div>`;
}