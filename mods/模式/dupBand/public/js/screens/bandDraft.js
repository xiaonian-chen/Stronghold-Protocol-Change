// Band draft — BAND_DRAFT "2/2 选择策略" (research 06 §4.2, D1): left = draft order (avatar, name, state:
// … waiting / ⌛ 决策中 / chosen band ✓), current picker highlighted; centre = grid of every band allowed
// for the mode type (icon, name, LP); right =
// detail pane (icon, 初始生命值, name, effect name + rich description) with 跳过 (co-op, once) and 确认选择.
// One countdown (user playtest #4 item 4): every turn has the same clock (Match BAND_TURN_SECONDS, m.public.draft
// turnSeconds) and the step header counts it down — m.public.deadline IS the turn's end, the same number as the
// current picker's row. The highlighted band (the detail pane's) is what a turn that runs out takes: every change of it
// is reported (g.bandFocus) and the server assigns it while it is free, else 「华法琳」, else the first free strategy
// (timeoutBand). It starts on that default, so the tip under the order list always names what a timeout gives.
// Solo, and a co-op match with a single human (the server's soloUntimed: draft.untimed): no clock at all.
// A strategy built around a bond the mode switches off (bands.json bondIds ∩ the mode's inactive bonds — 标准: 潘格尼尼
// 拉特兰, 克莱门莎 阿戈尔, 玛恩纳 卡西米尔; the bot never picks one) reads 本局禁用 on its card and in the detail pane
// (BandOffTag / BandOffNote, DESIGN §21.26, §21.7's look); it stays selectable — information only.
// 本局信息 (GitHub issue #8 item 1, "选策略时没法返回查看禁用的干员和盟约"): 查看禁用盟约与干员 under the order list opens the
// briefing's bond rows, legend and 本局禁用干员 again, read-only (ui/matchInfo.js MatchInfoDialog — the very blocks of the
// briefing). The draft runs on underneath: its status line repeats the current turn and the countdown (draftInfoStatus),
// a turn change (a pick, a skip, a turn that runs out, an AI pick) closes it, the end of the draft unmounts it, and it
// never touches the highlighted band or the buttons.

// [mod:dupBand] 1-line change: taken always empty → all bands remain selectable regardless of teammates' picks.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, MicroLabel, useTicker, secondsLeft } from '../ui/components.js';
import { useGameData, BandIcon, RichText, PlayerAvatar, LpTower, Sprite } from '../ui/gameComponents.js';
import { StepHeader, ExitModal } from '../ui/matchChrome.js';
import { MatchInfoDialog, matchInfoModel } from '../ui/matchInfo.js';
import { actions, act } from '../ui/gameActions.js';
import { normalizeDraft, sortedPlayers } from '../ui/gameLogic.js';
import { useStore } from '../store.js';
import { data } from '../data.js';
import { audio } from '../audio.js';
import { TurnBanner } from '../ui/turnBanner.js';
import { bootArtReady } from '../ui/protocolBoot.js';
import { reducedMotion } from '../ui/device.js';
import { modeOffBonds, bandOffBonds, bandOffLine } from '../ui/gameLogic.js';
import { t, tParts, tName } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export function BandOffTag({ names = [] }) {
  return names.length ? html`<span class="dband__off" title=${bandOffLine(names)}>${t('本局禁用')}</span>` : null;
}

export function BandOffNote({ names = [] }) {
  if (!names.length) return null;
  return html`<p class="draft-detail__off" role="note" aria-label=${bandOffLine(names)}><${Icon} name="info" /><span>${tParts('本局禁用{names}盟约，此策略效果可能无法发挥', { names: names.map((n, i) => html`<span key=${i}>${tParts('【{name}】', { name: html`<s class="draft-detail__offname">${n}</s>` })}</span>`) })}</span></p>`;
}

export function allowedBands(bands, modeType) {
  const sid = (b) => (Number.isFinite(b.sortId) ? b.sortId : 99);
  return (Array.isArray(bands) ? bands : [])
    .filter((b) => b && (!modeType || !Array.isArray(b.modeTypeList) || b.modeTypeList.includes(modeType)))
    .sort((a, b) => sid(a) - sid(b) || (a.bandId < b.bandId ? -1 : a.bandId > b.bandId ? 1 : 0));
}

export const DEFAULT_TIMEOUT_BAND = 'band_bldsk';

export function timeoutBand(bands, taken, defaultId = DEFAULT_TIMEOUT_BAND) {
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (defaultId && !has(defaultId) && (!list.length || list.some((b) => b.bandId === defaultId))) return defaultId;
  return list.find((b) => !has(b.bandId))?.bandId || defaultId || null;
}

export function teammateBands(picks, myId) {
  const out = new Map();
  for (const [pid, bid] of picks instanceof Map ? picks : []) {
    if (pid === myId || typeof bid !== 'string') continue;
    if (!out.has(bid)) out.set(bid, []);
    out.get(bid).push(pid);
  }
  return out;
}

export function draftSelection(sel, { bands, taken, myPick, myTurn, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (!Array.isArray(bands) || !bands.length) return sel;
  const free = timeoutBand(bands, taken, defaultId) || bands[0].bandId;
  if (!sel) return myPick || free;
  if (!myPick && myTurn && taken.has(sel)) return free;
  return sel;
}

export function autoPickBand(sel, { bands, taken, myPick = null, defaultId = DEFAULT_TIMEOUT_BAND }) {
  if (myPick) return null;
  const list = Array.isArray(bands) ? bands : [];
  const has = (id) => !!(taken && typeof taken.has === 'function' && taken.has(id));
  if (sel && !has(sel) && list.some((b) => b.bandId === sel)) return sel;
  return timeoutBand(list, taken, defaultId);
}

export function draftTip({ timed, turnSeconds = null, autoName = null, selected = true }) {
  const skip = t('联合模拟在选择策略时可以进行一次跳过');
  if (!timed) return t('{skip}；本局不限时', { skip });
  const clock = Number(turnSeconds) > 0 ? t('每位博士有 {n} 秒', { n: Math.round(turnSeconds) }) : t('每位博士限时决策');
  if (!autoName) return t('{skip}；{clock}', { skip, clock });
  return selected ? t('{skip}；{clock}，超时将自动选择当前选中的「{autoName}」', { skip, clock, autoName })
    : t('{skip}；{clock}，超时将自动选择「{autoName}」', { skip, clock, autoName });
}

export function draftClock(pub) {
  const d = pub && typeof pub.draft === 'object' ? pub.draft : null;
  if (!d || d.untimed) return null;
  const deadline = Number(pub.deadline) > 0 ? Number(pub.deadline) : Number(d.turnDeadline) || 0;
  if (!(deadline > 0)) return null;
  return { deadline, total: Number(d.turnSeconds) > 0 ? Number(d.turnSeconds) : null };
}

export function draftInfoStatus({ myPick = null, pickName = null, myTurn, turnName = null, secs = null, waiting = false }) {
  if (myPick) return { text: `${t('已选择「{name}」', { name: pickName || '' })}${waiting ? t('，等待其他博士') : ''}`, secs: null, tone: 'mint' };
  const s = Number.isFinite(secs) ? Math.max(0, Math.round(secs)) : null;
  const tone = s != null && s <= 10 ? 'warn' : 'gold';
  if (myTurn) return { text: t('轮到你决策'), secs: s, tone };
  return { text: turnName ? t('{turnName} 决策中', { turnName }) : t('等待轮到你'), secs: s, tone: s != null ? tone : 'dim' };
}

export function BandDraftScreen() {
  const pub = useStore((s) => s.match.public);
  const priv = useStore((s) => s.match.private);
  const myId = useStore((s) => s.me.playerId);
  const roomSolo = useStore((s) => s.room?.mode === 'solo');
  const gd = useGameData();
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(null);
  const [exit, setExit] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const mode = gd.config?.modes?.[pub?.modeId];
  const offBonds = modeOffBonds(mode);
  const solo = roomSolo || mode?.type === 'SINGLE' || String(pub?.modeId || '').includes('single');
  const bands = useMemo(() => allowedBands(gd.list('bands'), mode?.type || (solo ? 'SINGLE' : 'MULTI')), [gd.ready, mode?.type, solo, data.locale()]);
  const players = sortedPlayers(pub);
  const draft = normalizeDraft(pub?.draft, players);
  const myPick = draft.picks.get(myId) || priv?.bandId || null;
  const myTurn = !myPick && (solo || draft.turnPid === myId);
  const skipsLeft = draft.skipsLeft.has(myId) ? draft.skipsLeft.get(myId) : (skipped ? 0 : 1);
  const canSkip = !solo && myTurn && skipsLeft > 0 && draft.order.filter((pid) => !draft.picks.has(pid)).length > 1;
  // [mod:dupBand] Always allow duplicate bands — every band remains selectable.
  const taken = new Map();
  const pickers = new Map();
  for (const [pid, bid] of draft.picks) {
    const p = players.find((x) => x.playerId === pid);
    if (!pickers.has(bid)) pickers.set(bid, []);
    pickers.get(bid).push(p || { playerId: pid, name: '?' });
  }

  const defaultId = gd.config?.bandDraft?.timeoutBandId || DEFAULT_TIMEOUT_BAND;
  const takenKey = [...taken.keys()].sort().join(',');
  useEffect(() => {
    const next = draftSelection(sel, { bands, taken, myPick, myTurn, defaultId });
    if (next !== sel) setSel(next);
  }, [bands.length, myPick, myTurn, takenKey]);
  const [turnBanner, setTurnBanner] = useState(0);
  useEffect(() => {
    if (!myTurn || solo) return;
    audio.sfx('yourTurn');
    if (bootArtReady() && !reducedMotion()) setTurnBanner((n) => n + 1);
  }, [myTurn]);
  const turnKey = `${draft.turnPid || ''}|${myPick || ''}`;
  useEffect(() => { setInfoOpen(false); }, [turnKey]);

  const clock = solo ? null : draftClock(pub);
  const timed = !solo && !!pub?.draft && !pub.draft.untimed;
  const focusSent = useRef(null);
  useEffect(() => {
    if (!timed || myPick || !sel || focusSent.current === sel || !draft.order.includes(myId)) return;
    focusSent.current = sel;
    act('g.bandFocus', { bandId: sel }, { sfx: false, quiet: true });
  }, [sel, timed, myPick]);

  const autoId = autoPickBand(sel, { bands, taken, myPick, defaultId });
  const autoName = (autoId && gd.band(autoId)?.name) || gd.band(defaultId)?.name || tName('华法琳');

  const band = sel ? gd.band(sel) : null;
  const selTaken = !!band && taken.has(band.bandId);
  const confirm = async () => {
    if (!band || busy || !myTurn || selTaken) return;
    setBusy('pick');
    await actions.band(band.bandId);
    setBusy(null);
  };
  const skip = async () => {
    if (busy || !canSkip) return;
    setBusy('skip');
    if (await actions.bandSkip()) setSkipped(true);
    setBusy(null);
  };
  const turnName = players.find((p) => p.playerId === draft.turnPid)?.name;
  useTicker(clock ? 250 : 0);
  const turnSecs = clock ? secondsLeft(clock.deadline) : null;
  const turnLen = Number(pub?.draft?.turnSeconds) > 0 ? Math.round(pub.draft.turnSeconds) : null;
  const info = infoOpen ? matchInfoModel(pub, { bonds: gd.list('bonds'), chess: gd.chess, mode, priv, diyData: { chess: data.get('chess'), backups: data.get('backups') } }) : null;
  const infoStatus = infoOpen ? draftInfoStatus({ myPick, pickName: myPick ? gd.band(myPick)?.name : null, myTurn, turnName, secs: turnSecs,
    waiting: !solo && !draft.done }) : null;

  return html`<div class="screen draft">
    <div class="brief__bg" aria-hidden="true"></div>
    <${StepHeader} step=${2} of=${2} title=${t('选择策略')} micro="STRATEGY // BAND CHECK" pub=${clock ? { ...pub, deadline: clock.deadline } : { ...pub, deadline: 0 }}
      total=${clock ? clock.total : null} onExit=${() => setExit(true)} />
    <main class="draft__main">
      <aside class="draft-order">
        <h3 class="brief-h"><span>${solo ? t('独立模拟') : t('决策顺序')}</span><${MicroLabel}>${solo ? 'FREE PICK' : 'RANDOM ORDER'}</${MicroLabel}></h3>
        ${(solo ? players.filter((p) => p.playerId === myId) : draft.order.map((pid) => players.find((p) => p.playerId === pid)).filter(Boolean)).map((p, i) => {
          const picked = draft.picks.get(p.playerId) || (p.playerId === myId ? myPick : p.bandId) || null;
          const cur = !picked && (solo || draft.turnPid === p.playerId);
          const pband = picked ? gd.band(picked) : null;
          return html`<div key=${p.playerId} class=${cx('dorder', cur && 'is-cur', picked && 'is-done', p.playerId === myId && 'is-self')}>
            ${!solo ? html`<span class="dorder__idx num">${i + 1}</span>` : null}
            <${PlayerAvatar} player=${p} self=${p.playerId === myId} />
            <div class="dorder__text">
              <b class="dorder__name">${p.name || t('博士')}${p.isBot ? html`<span class="dorder__ai">AI</span>` : null}</b>
              <span class="dorder__state">${picked ? html`<span class="t-mint">${pband?.name || t('已选择')}</span>`
                : cur ? html`<span class="t-gold"><${Icon} name="hourglass" />${t('决策中')}${turnSecs != null ? html`<b class="num dorder__secs">${turnSecs}s</b>` : null}</span>`
                : html`<span class="t-dim"><${Icon} name="dots" />${t('等待中')}</span>`}</span>
            </div>
            <span class="dorder__box">
              ${picked ? html`<${BandIcon} bandId=${picked} size="sm" /><span class="dorder__check"><${Icon} name="check" /></span>`
                : cur && p.playerId === myId ? html`<${Sprite} k="bandChoose/youturn_finger" class="dorder__finger" fallback=${html`<${Icon} name="chevronLeft" />`} />`
                : null}
            </span>
          </div>`;
        })}
        <${Button} variant="secondary" icon="search" block=${true} class="draft-order__info" data-testid="match-info-open"
          aria-haspopup="dialog" onClick=${() => setInfoOpen(true)}>${t('查看禁用盟约与干员')}<//>
        ${!solo ? html`<p class="draft-order__tip" data-testid="draft-tip">${draftTip({ timed, turnSeconds: turnLen, autoName: myPick ? null : autoName, selected: autoId === sel })}</p>` : null}
      </aside>

      <section class="draft-grid" role="listbox" aria-label=${t('策略')}>
        ${bands.map((b) => {
          const who = pickers.get(b.bandId) || [];
          const isTaken = taken.has(b.bandId);
          const offNames = bandOffBonds(b, offBonds).map((id) => gd.bond(id)?.name || id);
          return html`<button key=${b.bandId} type="button" role="option" aria-selected=${sel === b.bandId ? 'true' : 'false'} data-band=${b.bandId}
              aria-disabled=${isTaken ? 'true' : 'false'} title=${isTaken ? t('队友已选') : offNames.length ? bandOffLine(offNames) : undefined}
              class=${cx('dband', sel === b.bandId && 'is-sel', myPick === b.bandId && 'is-mine', isTaken && 'is-taken', offNames.length && 'is-off')} onClick=${() => { setSel(b.bandId); audio.sfx('tab', { volume: 0.5 }); }}>
            <${BandIcon} bandId=${b.bandId} size="lg" />
            <span class="dband__name">${b.name}</span>
            <span class="dband__lp num"><i></i>${b.totalHp}</span>
            <${BandOffTag} names=${offNames} />
            ${who.length ? html`<span class="dband__who">${who.slice(0, 4).map((p) => html`<${PlayerAvatar} key=${p.playerId} player=${p} size="sm" />`)}</span>` : null}
            ${isTaken ? html`<span class="dband__taken">${t('队友已选')}</span>` : null}
          </button>`;
        })}
      </section>

      <aside class="draft-detail brackets">
        ${band ? html`
          <div class="draft-detail__art">
            <${BandIcon} bandId=${band.bandId} size="xl" />
          </div>
          <div class="draft-detail__hp"><span>${t('初始生命值')}</span><${LpTower} value=${band.totalHp} size="lg" /></div>
          <h2 class="draft-detail__name">${band.name}</h2>
          <${BandOffNote} names=${bandOffBonds(band, offBonds).map((id) => gd.bond(id)?.name || id)} />
          <div class="draft-detail__eff">
            <${MicroLabel} tone="mint">EFFECT</${MicroLabel}>
            <b>${band.effectName || ''}</b>
            <${RichText} as="p" text=${band.descRaw || band.desc} class="draft-detail__desc" />
          </div>` : html`<p class="t-dim">${t('选择一个策略查看详情')}</p>`}
        <div class="draft-detail__actions">
          ${myPick ? html`<p class="draft-detail__status t-mint"><${Icon} name="check" />${t('已选择「{name}」', { name: gd.band(myPick)?.name || '' })}${!solo && !draft.done ? t('，等待其他博士') : ''}</p>`
            : selTaken ? html`<p class="draft-detail__status draft-detail__status--taken"><${Icon} name="close" />${t('队友已选，请选择其他策略')}</p>`
            : !myTurn ? html`<p class="draft-detail__status"><${Icon} name="hourglass" />${turnName ? t('{turnName} 正在决策…', { turnName }) : t('等待轮到你')}</p>` : null}
          <div class="draft-detail__btns">
            ${!solo ? html`<${Button} variant="secondary" size="lg" icon="chevrons" disabled=${!canSkip} loading=${busy === 'skip'} onClick=${skip}
              title=${skipsLeft > 0 ? t('跳过本轮，稍后再选') : t('跳过次数已用完')}>${t('跳过')}${skipsLeft > 0 ? '' : t('（已用）')}<//>` : null}
            <${Button} variant="primary" size="lg" icon="check" disabled=${!myTurn || !band || selTaken} loading=${busy === 'pick'} onClick=${confirm}>${selTaken ? t('队友已选') : t('确认选择')}<//>
          </div>
        </div>
      </aside>
    </main>
    <${ExitModal} open=${exit} onClose=${() => setExit(false)} solo=${solo} />
    <${MatchInfoDialog} open=${infoOpen} onClose=${() => setInfoOpen(false)} model=${info}
      status=${infoStatus ? html`<span class=${cx('minfo-dlg__turn', `is-${infoStatus.tone}`)}>
        <${Icon} name=${infoStatus.tone === 'mint' ? 'check' : 'hourglass'} />${infoStatus.text}${infoStatus.secs != null ? html`<b class="num">${infoStatus.secs}s</b>` : null}
      </span>` : null} />
    ${turnBanner ? html`<${TurnBanner} key=${turnBanner} onDone=${() => setTurnBanner(0)} />` : null}
  </div>`;
}