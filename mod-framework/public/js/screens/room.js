// Room screen (同盟等待室) — unified mod-framework version.
// Supports both 20p mode and clone mode with independent toggle buttons.
// Local React state provides fallbacks when the server doesn't broadcast certain fields
// (e.g. clone fields in upstream 4p mode, or clone fields before 20p lobby upgrade).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, DEFAULT_SEATS, MAX_SEATS, MAX_SPECTATORS } from '../../../shared/constants.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyTag, DifficultyIcon, Tooltip, confirmDialog, doctorNo, Modal,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { TestMark } from '../ui/testConsole.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, isModdedRoom } from '../ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating } from '../store.js';
import { difficultyInfo } from './lobby.js';
import { t, tc } from '../../../shared/i18n.js';

// Local lock icon definitions — the upstream components.js ICONS map may not include
// 'lock'/'lockOpen' (they only exist in the 20p mod's copy), so we define them here
// and render via the battle-tested Icon component to avoid Preact/htm SVG namespace issues
// that can arise from inline <svg><path> elements during VDOM reconciliation.
import { h } from '../../vendor/preact.module.js';

const _LOCK_ICONS = {
  lock: { d: 'M18 8h-1V6c0-2.8-2.2-5-5-5S7 3.2 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4z' },
  lockOpen: { d: 'M18 8h-1V6c0-2.8-2.2-5-5-5S7 3.2 7 6h2c0-1.7 1.3-3 3-3s3 1.3 3 3v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4z' },
};
// Tiny local Icon wrapper that only handles lock/lockOpen — uses Preact's h() directly
// (not htm tagged templates) to guarantee correct SVG namespace handling.
function LockIcon({ locked }) {
  const ic = locked ? _LOCK_ICONS.lock : _LOCK_ICONS.lockOpen;
  return h('svg', { class: 'icon', viewBox: '0 0 24 24', width: '1em', height: '1em', 'aria-hidden': 'true' },
    h('path', { d: ic.d }));
}

// Helper: detect if server broadcasts 20p fields (capacity is present in toState)
function has20pServerState(room) {
  return typeof room?.capacity === 'number' && room.capacity >= 4;
}

/**
 * Seats padded to the room's capacity (co-op 4–20, solo 1), each null or a seat record.
 */
export function normalizeSeats(room) {
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const requested = Number.isInteger(room?.capacity) ? room.capacity : src.length || DEFAULT_SEATS;
  const cap = room?.mode === 'solo' ? 1 : Math.max(1, Math.min(MAX_SEATS, requested));
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  const modded = isModdedRoom(room);
  const contentReady = !modded || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    contentReady,
    myContent: modded ? (mine?.content || 'loading') : 'ready',
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

export function aiLastOption(room, myId) {
  if (!room || room.mode === 'solo') return null;
  return { on: room.aiPicksLast === true, editable: room.hostId != null && room.hostId === myId };
}

export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

export { copyText };

function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick }) {
  const coop = room.mode !== 'solo';
  if (!seat) {
    const canAdd = coop && facts.isHost;
    return html`<article class="seat seat--empty" style=${`--seat-i:${index}`}>
      <header class="seat__head"><span class="seat__no num">P${index + 1}</span><${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//></header>
      <div class="seat__art seat__art--empty">
        <div class="seat__radar" aria-hidden="true"></div>
        <span class="seat__wait">${t('等待博士加入')}</span>
        <${MicroLabel}>AWAITING DOCTOR<//>
      </div>
      <footer class="seat__foot">
        ${canAdd
          ? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t('添加 AI 队友')}<//>`
          : html`<span class="seat__state t-dim">${t('空位')}</span>`}
      </footer>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  return html`<article class=${`seat brackets${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''} is-${state}`}
      style=${`--seat-i:${index}`}>
    ${consent ? html`<span data-testid="script-consented">${t('已同意')}</span>` : null}
    <header class="seat__head">
      <span class="seat__no num">P${index + 1}</span>
      <${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//>
      ${isHostSeat ? html`<span class="seat__host"><${Icon} name="crown" />${t('创建者')}</span>` : null}
    </header>
    <div class="seat__art">
      <div class="seat__stripes" aria-hidden="true"></div>
      <${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />
      ${seat.isBot ? html`<span class="seat__bot-label"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
    </div>
    <div class="seat__who">
      <span class="seat__name">${seat.name || t('博士')}</span>
      ${isMe ? html`<span class="seat__you">${t('你')}</span>` : null}
    </div>
    <${MicroLabel}>${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}<//>
    ${facts.modded && !seat.isBot ? html`<span class=${`seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
    </span>` : null}
    <footer class="seat__foot">
      <span class=${`seat__state seat__state--${state}`}>
        ${state === 'ready' ? html`<${Icon} name="check" />${t('已就绪')}`
          : state === 'offline' ? html`<${Icon} name="wifiOff" />${t('连接中断')}`
          : state === 'host' ? html`<${Icon} name="crown" />${t('待命中')}`
          : html`<${Icon} name="hourglass" />${t('准备中')}`}
      </span>
      ${seat.isBot && facts.isHost ? html`<${Tooltip} text=${t('移除该 AI 队友')}>
        <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rm${index}`} onClick=${() => onRemoveBot(index)} aria-label=${t('移除 AI 队友')} />
      <//>` : null}
      ${!seat.isBot && !isMe && facts.isHost ? html`<${Tooltip} text=${t('将该博士移出同盟')}>
        <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `kick${index}`} onClick=${() => onKick(index, seat.name, seat.playerId)} aria-label=${t('移出该博士')} />
      <//>` : null}
    </footer>
  </article>`;
}

function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

function InviteBox({ code, name, difficulty }) {
  const copy = async (what) => {
    const invite = t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', { name: name ?? '', difficulty: DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '' });
    const ok = await copyText(what === 'code' ? code : `${inviteLink(code)} ${invite}`);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  return html`<div class="invite brackets">
    <div class="invite__label"><${Icon} name="key" /><span>${t('同盟密钥')}</span><${MicroLabel}>ALLIANCE KEY<//></div>
    <div class="invite__code num selectable" aria-label=${t('同盟密钥 {code}', { code })}>${[...String(code)].map((ch, i) => html`<span key=${i}>${ch}</span>`)}</div>
    <div class="invite__btns">
      <${Button} size="sm" icon="copy" onClick=${() => copy('code')}>${t('复制密钥')}<//>
      <${Button} size="sm" icon="link" onClick=${() => copy('link')}>${t('复制链接')}<//>
    </div>
  </div>`;
}

function DifficultyPicker({ room, isHost, busy, onPick }) {
  if (!isHost) {
    return html`<div class="dpick dpick--ro">
      <${DifficultyTag} difficulty=${room.difficulty} size="lg" code=${difficultyInfo(room.mode, room.difficulty).code} />
      <span class="t-dim">${t('由创建者选择')}</span>
    </div>`;
  }
  return html`<div class="dpick" role="radiogroup" aria-label=${t('模拟难度')}>
    ${DIFFICULTIES.map((d) => html`<button key=${d} type="button" role="radio" aria-checked=${room.difficulty === d ? 'true' : 'false'}
        class=${`dpick__opt${room.difficulty === d ? ' is-active' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`}
        disabled=${!!busy} onClick=${() => room.difficulty !== d && onPick(d)}>
      <${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d].replace('模拟', ''))}
    </button>`)}
  </div>`;
}

function AiLastToggle({ option, busy, onToggle }) {
  if (!option) return null;
  return html`<div class="ailast">
    <${Tooltip} text=${t('策略与机变轮选时，所有博士先于 AI 队友选择')}>
      <button type="button" role="switch" aria-checked=${option.on ? 'true' : 'false'}
          class=${`dpick__opt ailast__opt${option.on ? ' is-active' : ''}`} disabled=${!option.editable || !!busy}
          onClick=${() => option.editable && onToggle(!option.on)}>
        <${Icon} name="check" class=${option.on ? 'is-on' : ''} />${t('AI 队友最后选择')}
      </button>
    <//>
    ${option.editable ? null : html`<span class="t-dim">${t('由创建者设置')}</span>`}
  </div>`;
}

// ===== Mod Registry & Dynamic Config Components =====

function useModRegistry() {
  const [reg, setReg] = useState(null);
  useEffect(() => {
    fetch('/api/mods/registry')
      .then(r => r.json())
      .then(setReg)
      .catch(() => setReg({ playstyles: [], gamemodes: [] }));
  }, []);
  return reg;
}

// Generic config picker — renders select/lock or toggle based on manifest config definition.
// room must include local state fallbacks (via augRoom) for non-20p server modes.
function ConfigSelect({ configKey, configDef, room, facts, busy, onChange, hideLabel }) {
  const value = room[configKey] ?? configDef.default;
  const isToggle = configDef.type === 'toggle';
  const opts = configDef.options || [];
  const hasLock = configDef.locked !== undefined;
  const locked = hasLock ? (room[configKey + 'Locked'] !== false) : false;
  const label = hideLabel ? null : t(configDef.label);

  if (!facts.isHost) {
    return html`<div class="clone-controls__item${hideLabel ? ' clone-controls__item--compact' : ''}">
      ${label ? html`<span class="clone-controls__label">${label}</span>` : null}
      <b class="num">${isToggle ? (value ? t('开启') : t('关闭')) : (locked && configDef.lockedLabel ? t(configDef.lockedLabel) : String(value))}</b>
    </div>`;
  }

  if (isToggle) {
    return html`<div class="clone-controls__item${hideLabel ? ' clone-controls__item--compact' : ''}">
      ${label ? html`<span class="clone-controls__label">${label}</span>` : null}
      <button type="button" role="switch" aria-checked=${value ? 'true' : 'false'}
          class=${`dpick__opt clone-controls__mode-btn${value ? ' is-active' : ''}`}
          disabled=${!!busy} onClick=${() => onChange(!value)}>
        <${Icon} name="check" class=${value ? 'is-on' : ''} />${value ? t('开启') : t('关闭')}
      </button>
    </div>`;
  }

  const minCapacity = configKey === 'capacity'
    ? Math.max(1, ...(facts.occupied || []).map((s) => s.seat + 1))
    : 0;

  return html`<div class="clone-controls__item${hideLabel ? ' clone-controls__item--compact' : ''}">
    ${label ? html`<span class="clone-controls__label">${label}</span>` : null}
    ${hasLock ? html`<button type="button" class="clone-controls__lock"
      onClick=${() => onChange(value, !locked)}
      title=${locked ? t('解锁调整') : t('锁定为默认')}>
      <${LockIcon} locked=${locked} />
    </button>` : null}
    ${locked ? html`<span class="clone-controls__opt is-active" style="cursor:default">${configDef.lockedLabel ? t(configDef.lockedLabel) : String(value)}</span>`
      : html`<select class="clone-controls__select" value=${value} disabled=${!!busy}
          onChange=${(e) => onChange(Number(e.target.value), hasLock ? locked : undefined)}>
        ${opts.map((n) => html`<option key=${n} value=${n} disabled=${n < minCapacity}>${String(n)}</option>`)}
      </select>`}
  </div>`;
}

// Playstyle panel — renders toggle + configs for each registered playstyle mod.
function PlaystylePanel({ playstyle, room, facts, busy, active, onToggle, onConfigChange }) {
  const configEntries = Object.entries(playstyle.config || {});
  const hasConfigs = configEntries.length > 0;
  const is20p = playstyle.id === '20p';
  const configKeys = configEntries.map(([k]) => k);
  const [selectedConfigKey, setSelectedConfigKey] = useState(configKeys[0] || null);
  // Reset when config list changes (e.g. registry reload)
  useEffect(() => {
    if (!configKeys.includes(selectedConfigKey)) setSelectedConfigKey(configKeys[0] || null);
  }, [playstyle.id, configKeys.join(',')]);

  return html`<section class="clone-controls${active ? ' is-active' : ''}">
    <div class="mod-toggles">
      <span class="mod-toggles__label">${t('可选玩法')}</span>
      <button type="button" role="switch" aria-checked=${active ? 'true' : 'false'}
          class=${`dpick__opt clone-controls__mode-btn${active ? ' is-active' : ''}`}
          disabled=${!facts.isHost || !!busy} onClick=${onToggle}>
        <${Icon} name="check" class=${active ? 'is-on' : ''} />${t(playstyle.displayName)}
      </button>
    </div>
    ${active && hasConfigs ? (
      is20p ? html`<div class="clone-controls__compact">
        <select class="clone-controls__select" value=${selectedConfigKey}
            onChange=${(e) => setSelectedConfigKey(e.target.value)}>
          ${configEntries.map(([key, def]) => html`<option key=${key} value=${key}>${t(def.label)}</option>`)}
        </select>
        ${(selectedConfigKey && playstyle.config[selectedConfigKey]) ? html`<${ConfigSelect}
          key=${selectedConfigKey} configKey=${selectedConfigKey}
          configDef=${playstyle.config[selectedConfigKey]}
          room=${room} facts=${facts} busy=${busy} hideLabel=${true}
          onChange=${(value, locked) => onConfigChange(playstyle.id, selectedConfigKey, playstyle.config[selectedConfigKey], value, locked)} />` : null}
      </div>`
      : html`<div class="">
        ${configEntries.map(([key, def]) => html`<${ConfigSelect} key=${key}
          configKey=${key} configDef=${def} room=${room} facts=${facts} busy=${busy}
          onChange=${(value, locked) => onConfigChange(playstyle.id, key, def, value, locked)} />`)}
      </div>`
    ) : null}
  </section>`;
}

// Gamemode panel — renders dropdown selector + configs for the selected gamemode.
function GamemodePanel({ gamemodes, room, facts, busy, selectedId, onSelect, onConfigChange }) {
  const selMod = gamemodes.find(m => m.id === selectedId);
  const configEntries = selMod ? Object.entries(selMod.config || {}) : [];

  if (!facts.isHost) {
    const display = selMod ? t(selMod.displayName) : t('原版模式');
    return html`<section class="clone-controls${selMod ? ' is-active' : ''}">
      <div class="clone-controls__toggle clone-controls__toggle--ro">
        <span class="clone-controls__label">${t('游戏模式')}</span>
        <b class="clone-controls__mode${selMod ? ' is-clone' : ''}">${display}</b>
        <span class="t-dim">${t('由创建者选择')}</span>
      </div>
      ${configEntries.map(([key, def]) => html`<${ConfigSelect} key=${key}
        configKey=${key} configDef=${def} room=${room} facts=${facts} busy=${busy}
        onChange=${(value, locked) => onConfigChange(selMod.id, key, def, value, locked)} />`)}
    </section>`;
  }

  return html`<section class="clone-controls${selMod ? ' is-active' : ''}">
    <div class="clone-controls__toggle">
      <span class="clone-controls__label">${t('游戏模式')}</span>
      <select class="clone-controls__select" value=${selectedId || 'original'}
          disabled=${!!busy} onChange=${(e) => onSelect(e.target.value)}>
        <option value="original">${t('原版模式')}</option>
        ${gamemodes.map(m => html`<option key=${m.id} value=${m.id}>${t(m.displayName)}</option>`)}
      </select>
    </div>
    ${configEntries.map(([key, def]) => html`<${ConfigSelect} key=${key}
      configKey=${key} configDef=${def} room=${room} facts=${facts} busy=${busy}
      onChange=${(value, locked) => onConfigChange(selMod.id, key, def, value, locked)} />`)}
  </section>`;
}

// Character mod panel — renders multi-select toggles for character kit mods.
function CharacterPanel({ characters, room, facts, busy, activeIds, onToggle }) {
  const anyActive = activeIds.length > 0;

  if (!facts.isHost) {
    if (!characters.length) return null;
    const activeNames = characters.filter(c => activeIds.includes(c.id)).map(c => t(c.displayName));
    return html`<section class="clone-controls${anyActive ? ' is-active' : ''}">
      <div class="clone-controls__toggle clone-controls__toggle--ro">
        <span class="clone-controls__label">${t('角色改动')}</span>
        <b class="clone-controls__mode${anyActive ? ' is-clone' : ''}">${activeNames.length ? activeNames.join('、') : t('无')}</b>
        <span class="t-dim">${t('由创建者选择')}</span>
      </div>
    </section>`;
  }

  return html`<section class="clone-controls${anyActive ? ' is-active' : ''}">
    <div class="mod-toggles">
      <span class="mod-toggles__label">${t('角色改动')}</span>
      ${characters.map(c => html`<button key=${c.id} type="button" role="switch"
          aria-checked=${activeIds.includes(c.id) ? 'true' : 'false'}
          class=${`dpick__opt clone-controls__mode-btn${activeIds.includes(c.id) ? ' is-active' : ''}`}
          disabled=${!!busy} onClick=${() => onToggle(c.id)}>
        <${Icon} name="check" class=${activeIds.includes(c.id) ? 'is-on' : ''} />${t(c.displayName)}
      </button>`)}
    </div>
  </section>`;
}

// ===== Main Room Screen =====

export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => () => { alive.current = false; }, []);

  // ── Dynamic mod state ─────────────────────────────────────────────
  // activePlaystyles: list of currently toggled-on playstyle mod IDs (e.g. ['20p'])
  // selectedGamemode: currently selected gamemode ID, or 'original' for none
  // localConfig: generic local fallback map { configKey: value, configKeyLocked: bool }
  const [activePlaystyles, setActivePlaystyles] = useState([]);
  const [selectedGamemode, setSelectedGamemode] = useState('original');
  const [activeCharacters, setActiveCharacters] = useState([]);
  const [localConfig, setLocalConfig] = useState({});

  // Fetch mod registry from API endpoint
  const reg = useModRegistry();

  // Auto-enable 20p playstyle when the registry is first loaded
  const _auto20p = useRef(false);
  useEffect(() => {
    if (!_auto20p.current && reg?.playstyles?.some(ps => ps.id === '20p')) {
      _auto20p.current = true;
      setActivePlaystyles(prev => prev.includes('20p') ? prev : [...prev, '20p']);
    }
  }, [reg]);

  if (!room) return null;

  // Detect if the 20p lobby is active (broadcasts capacity in toState)
  const _20pServer = has20pServerState(room);

  // Sync active characters from server broadcasts (both vanilla and 20p lobbies)
  const serverCharacters = room.characters || [];
  useEffect(() => {
    if (serverCharacters.length > 0 || activeCharacters.length > 0) {
      if (JSON.stringify(serverCharacters) !== JSON.stringify(activeCharacters)) {
        setActiveCharacters(serverCharacters);
      }
    }
  }, [JSON.stringify(serverCharacters)]);

  // Build augmented room — server values take precedence when available (20p mode),
  // otherwise local state provides field values.
  const augRoom = _20pServer ? room : (() => {
    const merged = { ...room };
    for (const [k, v] of Object.entries(localConfig)) {
      if (room[k] == null) merged[k] = v;
    }
    if (room.gameMode == null) {
      merged.gameMode = selectedGamemode === 'original' ? 'original' : selectedGamemode;
    }
    return merged;
  })();

  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const facts = roomFacts(augRoom, me.playerId);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', () => net.request('room.start', {}));
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  const setAiLast = (on) => run('ailast', () => net.request('room.setAiPicksLast', { on }));

  // ── Generic mod config handler ─────────────────────────────────
  // Sends `room.set{CamelKey}({ paramName: value [, locked] })` and updates local state.
  const handleConfigChange = (modId, configKey, configDef, value, locked) => {
    // capacity is only handled by the 20p lobby; skip server message in non-20p mode
    if (!_20pServer && configKey === 'capacity') {
      setLocalConfig(prev => ({ ...prev, [configKey]: value }));
      return;
    }

    const msgType = 'room.set' + configKey.charAt(0).toUpperCase() + configKey.slice(1);
    const paramName = configDef.param || configKey;
    const body = { [paramName]: value };
    if (locked !== undefined) body.locked = locked;

    run(configKey, () => net.request(msgType, body));

    if (!_20pServer) {
      setLocalConfig(prev => {
        const next = { ...prev, [configKey]: value };
        if (locked !== undefined) next[configKey + 'Locked'] = locked;
        return next;
      });
    }
  };

  // Playstyle toggle — activates/deactivates a playstyle mod
  const handlePlaystyleToggle = (playstyleId) => {
    const active = activePlaystyles.includes(playstyleId);
    if (active) {
      setActivePlaystyles(prev => prev.filter(id => id !== playstyleId));
      // Reset capacity to default when toggling 20p off
      if (playstyleId === '20p') {
        if (_20pServer) run('capacity', () => net.request('room.setCapacity', { capacity: 4 }));
        setLocalConfig(prev => {
          const next = { ...prev, capacity: 4 };
          delete next.bossHitLimit;
          delete next.disableFlying;
          return next;
        });
      }
    } else {
      setActivePlaystyles(prev => [...prev, playstyleId]);
      // Set 20p defaults: capacity=4, bossHitLimit=false, disableFlying=true
      if (playstyleId === '20p' && !_20pServer) {
        setLocalConfig(prev => ({
          ...prev,
          bossHitLimit: false,
          disableFlying: true,
        }));
      }
    }
  };

  // Gamemode selection — switches to a gamemode or back to original
  const handleGamemodeSelect = (mode) => {
    setSelectedGamemode(mode);
    if (mode === 'original') {
      run('gamemode', () => net.request('room.setGameMode', { mode: 'original' }));
      if (!_20pServer) setLocalConfig(prev => ({ ...prev, gameMode: 'original' }));
    } else {
      run('gamemode', () => net.request('room.setGameMode', { mode }));
      if (!_20pServer) setLocalConfig(prev => ({ ...prev, gameMode: mode }));
    }
  };

  // Effective gamemode — syncs server broadcasts (20p mode) with local selection
  const effectiveGamemode = _20pServer
    ? (room.gameMode && room.gameMode !== 'original' ? room.gameMode : 'original')
    : selectedGamemode;

  // Character toggle — activates/deactivates a character mod kit
  const handleCharacterToggle = (characterId) => {
    const next = activeCharacters.includes(characterId)
      ? activeCharacters.filter(id => id !== characterId)
      : [...activeCharacters, characterId];
    setActiveCharacters(next);
    run('characters', () => net.request('room.setCharacters', { characters: next }));
  };

  // Spectator
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code, ...(room.test ? { testAck: true } : {}) }));
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.modded && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  return html`<div class="screen room-screen">
    <header class="topbar">
      <div class="topbar__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <${Button} variant="danger" size="lg" square=${true} icon="exit" loading=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')} />
        <//>
        <div class="room-ping">
          <${PingPill} ms=${conn.ping} online=${online} />
          <${MicroLabel}>${t('当前延迟')}<//>
        </div>
        <${Button} variant="secondary" size="sm" icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')}>${t('统计')}<//>
        <${SettingsButton} class="room-settings" variant="secondary" label=${t('设置')} />
        <${GuideButton} class="room-guide" variant="secondary" label=${t('玩法说明')} />
      </div>
      <div class="topbar__center">
        <${MicroLabel} tone="mint">${coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}<//>
        <h1 class="topbar__title">${coop ? t('同盟模拟') : t('独立模拟')}${room.test ? html` <${TestMark} />` : null}<span class="topbar__sep"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" />
          ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}</h1>
        <${PluginTag} room=${room} myId=${me.playerId} />
      </div>
      <div class="topbar__right">
        ${coop ? html`<${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} />` : html`<div class="solo-note"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <!-- Dynamic mod panels (co-op only) — driven by mod registry -->
    ${coop && reg ? html`
      ${reg.playstyles.map(ps => html`<${PlaystylePanel} key=${ps.id}
        playstyle=${ps} room=${augRoom} facts=${facts} busy=${busy}
        active=${activePlaystyles.includes(ps.id)}
        onToggle=${() => handlePlaystyleToggle(ps.id)}
        onConfigChange=${handleConfigChange} />`)}
      ${reg.gamemodes.length > 0 ? html`<${GamemodePanel}
        gamemodes=${reg.gamemodes} room=${augRoom} facts=${facts} busy=${busy}
        selectedId=${effectiveGamemode}
        onSelect=${handleGamemodeSelect}
        onConfigChange=${handleConfigChange} />` : null}
      ${reg.characters.length > 0 ? html`<${CharacterPanel}
        characters=${reg.characters} room=${augRoom} facts=${facts} busy=${busy}
        activeIds=${activeCharacters}
        onToggle=${handleCharacterToggle} />` : null}
    ` : null}

    <main class=${`seats${coop ? facts.seats.length > 10 ? ' seats--dense' : facts.seats.length > 4 ? ' seats--expanded' : '' : ' seats--solo'}${coop && facts.seats.length === 10 ? ' seats--ten' : ''}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} />`)}
      ${coop ? null : html`<aside class="solo-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />

    <footer class="room-bar">
      <div class="room-bar__left">
        <span class="room-bar__label">${t('模拟难度')}<${MicroLabel}>DIFFICULTY<//></span>
        <div class="room-bar__opts">
          <${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} />
          <${AiLastToggle} option=${aiLastOption(room, me.playerId)} busy=${busy} onToggle=${setAiLast} />
        </div>
      </div>
      <div class="room-bar__center">
        <div class="ready-count" hidden=${!coop}>
          <span class="t-lo">${t('已就绪')}</span>
          <b class="num">${facts.readyHumans}</b><span class="num t-dim">/${facts.humans.length}</span>
          <span class="ready-count__icons" aria-hidden="true">
            ${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}
          </span>
        </div>
        <div class="room-bar__status">${statusLine}</div>
      </div>
      <div class="room-bar__right">
        <${LoadoutButton} from="room" size="lg" class="room-loadout" label=${t('干员调配')} />
        ${facts.isHost
          ? html`<${Tooltip} text=${facts.canStart ? null : !facts.contentReady ? t('仍有博士未载入房间的插件内容') : t('仍有博士未准备就绪')}>
              <${Button} variant="primary" size="xl" icon="play" loading=${busy === 'start'} disabled=${!facts.canStart || !online} onClick=${start}>${t('开始模拟')}<//>
            <//>`
          : facts.spectating
            ? html`<${Button} variant="secondary" size="xl" icon="eye" disabled=${true}>${t('观战中')}<//>`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? t('房间的插件内容载入并通过校验后才能准备') : null}>
              <${Button} variant=${myReady ? 'primary' : 'secondary'} size="xl" icon=${myReady ? 'check' : 'hourglass'} active=${myReady}
              loading=${busy === 'ready'} disabled=${!online || !facts.mine || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady}>${myReady ? t('已就绪') : t('准备就绪')}<//>
            <//>`}
      </div>
    </footer>
  </div>`;
}

// ===== Trusted Notice =====

export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}});
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}