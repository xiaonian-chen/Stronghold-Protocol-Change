import { render, h } from '/vendor/preact.module.js';
import htm from '/vendor/htm.module.js';
import { useState, useEffect, useRef, useCallback } from '/vendor/hooks.module.js';
import { store } from '/js/store.js';

if (window.__sp_roomlistLoaded) { /* already loaded */ }
else { window.__sp_roomlistLoaded = true;

const html = htm.bind(h);

var DRAG_KEY = 'sp.plugin.plugin-roomlist.pos';
var savedPos = null;
try { savedPos = JSON.parse(localStorage.getItem(DRAG_KEY)); } catch(e) {}
var defaultLeft = '.24rem';
var defaultBottom = 'calc(.24rem + .56rem + .12rem + 2.6rem)';

const styleEl = document.createElement('style');
styleEl.textContent = '\
#sp-roomlist-root { position:fixed; bottom:' + (savedPos ? savedPos.bottom : defaultBottom) + '; left:' + (savedPos ? savedPos.left : defaultLeft) + '; z-index:9999; font-family:system-ui,-apple-system,sans-serif; font-size:13px; }\
#sp-roomlist-root .rl-toggle { display:flex; align-items:center; gap:6px; padding:6px 12px; border:1px solid rgba(255,255,255,0.12); border-radius:8px; background:rgba(14,18,17,0.88); color:#c3cbc7; cursor:grab; font-size:12px; user-select:none; }\
#sp-roomlist-root .rl-toggle:active { cursor:grabbing; }\
#sp-roomlist-root .rl-toggle:hover { background:rgba(20,24,22,0.92); border-color:rgba(78,216,175,0.25); color:#4ed8af; }\
#sp-roomlist-root .rl-badge { display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:#145443; color:#4ed8af; font-size:10px; font-weight:600; }\
#sp-roomlist-root .rl-panel { position:absolute; bottom:48px; left:0; width:340px; max-height:480px; border-radius:10px; background:rgba(14,18,17,0.95); backdrop-filter:blur(10px); display:flex; flex-direction:column; box-shadow:0 4px 24px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.08); }\
#sp-roomlist-root .rl-header { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.08); }\
#sp-roomlist-root .rl-title { font-size:14px; font-weight:600; color:#f2f2f2; display:flex; align-items:center; gap:6px; }\
#sp-roomlist-root .rl-title .dot { width:6px; height:6px; border-radius:50%; background:#4ed8af; display:inline-block; }\
#sp-roomlist-root .rl-close { padding:2px 8px; border:none; border-radius:4px; background:none; color:rgba(255,255,255,0.5); cursor:pointer; font-size:14px; }\
#sp-roomlist-root .rl-close:hover { color:#fff; background:rgba(255,255,255,0.08); }\
#sp-roomlist-root .rl-body { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:6px; min-height:0; }\
#sp-roomlist-root .rl-empty { color:rgba(255,255,255,0.3); text-align:center; padding:40px 16px; font-size:13px; }\
#sp-roomlist-root .rl-card { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-radius:8px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); cursor:pointer; transition:all .12s; }\
#sp-roomlist-root .rl-card:hover { background:rgba(78,216,175,0.04); border-color:rgba(78,216,175,0.15); }\
#sp-roomlist-root .rl-card--match { opacity:0.6; }\
#sp-roomlist-root .rl-card-left { display:flex; flex-direction:column; gap:2px; min-width:0; }\
#sp-roomlist-root .rl-card-code { font-family:"SF Mono","Fira Code","Consolas",monospace; font-size:14px; font-weight:700; color:#4ed8af; letter-spacing:.03em; }\
#sp-roomlist-root .rl-card-host { font-size:11px; color:#8a948f; }\
#sp-roomlist-root .rl-card-mid { display:flex; align-items:center; gap:6px; flex-shrink:0; }\
#sp-roomlist-root .rl-tag { padding:2px 6px; border-radius:3px; font-size:10px; font-weight:600; }\
#sp-roomlist-root .rl-tag--funny { background:rgba(246,163,41,0.12); color:#f6a329; }\
#sp-roomlist-root .rl-tag--normal { background:rgba(232,90,26,0.12); color:#f29260; }\
#sp-roomlist-root .rl-tag--hard { background:rgba(231,49,24,0.12); color:#e73118; }\
#sp-roomlist-root .rl-tag--abyss { background:rgba(255,0,36,0.12); color:#ff5454; }\
#sp-roomlist-root .rl-tag--mode { background:rgba(159,212,255,0.08); color:#9fd4ff; }\
#sp-roomlist-root .rl-card-players { font-size:12px; color:#c3cbc7; font-weight:600; white-space:nowrap; }\
#sp-roomlist-root .rl-card-right { display:flex; align-items:center; gap:8px; flex-shrink:0; }\
#sp-roomlist-root .rl-status { font-size:10px; padding:2px 6px; border-radius:3px; font-weight:600; }\
#sp-roomlist-root .rl-status--wait { background:rgba(78,216,175,0.08); color:#4ed8af; }\
#sp-roomlist-root .rl-status--match { background:rgba(231,49,24,0.08); color:#e73118; }\
#sp-roomlist-root .rl-join { padding:4px 10px; border:1px solid #2a9e7f; border-radius:5px; background:rgba(42,158,127,0.12); color:#4ed8af; cursor:pointer; font-size:11px; font-weight:600; }\
#sp-roomlist-root .rl-join:hover { background:rgba(42,158,127,0.22); }\
#sp-roomlist-root .rl-join:disabled { opacity:0.35; cursor:default; }\
#sp-roomlist-root .rl-footer { display:flex; align-items:center; justify-content:space-between; padding:8px 12px; border-top:1px solid rgba(255,255,255,0.08); gap:8px; }\
#sp-roomlist-root .rl-quick { padding:5px 12px; border:1px solid rgba(255,198,0,0.25); border-radius:5px; background:rgba(255,198,0,0.08); color:#f2bd3e; cursor:pointer; font-size:11px; font-weight:600; }\
#sp-roomlist-root .rl-quick:hover { background:rgba(255,198,0,0.16); }\
#sp-roomlist-root .rl-quick:disabled { opacity:0.35; cursor:default; }\
#sp-roomlist-root .rl-publish { padding:4px 10px; border:1px solid rgba(255,255,255,0.12); border-radius:5px; background:rgba(255,255,255,0.04); color:#8a948f; cursor:pointer; font-size:10px; }\
#sp-roomlist-root .rl-publish:hover { color:#c3cbc7; border-color:rgba(255,255,255,0.2); }\
#sp-roomlist-root .rl-publish--on { border-color:rgba(78,216,175,0.2); color:#4ed8af; }\
#sp-roomlist-root .rl-refresh { font-size:10px; color:#5d6863; }\
#sp-roomlist-root .rl-extlink { padding:4px 10px; border:1px solid rgba(159,212,255,0.2); border-radius:5px; background:rgba(159,212,255,0.06); color:#9fd4ff; cursor:pointer; font-size:10px; font-weight:600; white-space:nowrap; }\
#sp-roomlist-root .rl-extlink:hover { background:rgba(159,212,255,0.14); }\
';
document.head.appendChild(styleEl);

const POLL_MS = 5000;
const CACHE_KEY = 'sp.plugin.plugin-roomlist.roomcache';
const DIFF_NAMES = { FUNNY: '标准', NORMAL: '险境', HARD: '绝境', ABYSS: '终极' };
const DIFF_TAGS = { FUNNY: 'rl-tag--funny', NORMAL: 'rl-tag--normal', HARD: 'rl-tag--hard', ABYSS: 'rl-tag--abyss' };
// toggle plugin removed; panel always available in rooms

function getRoomInfo(s) {
  const room = s && s.room;
  if (!room || !room.code) return null;
  const me = s && s.me;
  if (!me || !me.playerId) return null;
  return {
    roomCode: room.code,
    playerId: me.playerId,
    isHost: room.hostId === me.playerId,
  };
}

function openStandalone() {
  var w = window.open('/roomlist.html', '_blank', 'width=860,height=640');
  if (!w) { alert('无法打开新窗口，请检查浏览器是否阻止了弹窗。\n\n你也可以直接在浏览器中打开 /roomlist.html 并加入书签。'); }
}

function RoomListPanel({ roomCode, playerId, isHost, onClose }) {
  const [rooms, setRooms] = useState([]);
  const [published, setPublished] = useState(false);
  const [open, setOpen] = useState(false);
  const [roomCount, setRoomCount] = useState(0);

  useEffect(() => {
    let active = true;
    let timer = null;

    async function poll() {
      if (!active) return;
      try {
        const res = await fetch('/x/plugin-roomlist/rooms');
        const data = await res.json();
        if (!active) return;
        if (data && Array.isArray(data.rooms)) {
          setRooms(data.rooms);
          setRoomCount(data.rooms.length);
          try { localStorage.setItem(CACHE_KEY, JSON.stringify(data.rooms)); } catch (e) { /* quota */ }
        }
      } catch (e) { /* ignore */ }
      if (active) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  const togglePublish = useCallback(async () => {
    const next = !published;
    try {
      const res = await fetch('/x/plugin-roomlist/publish?room=' + encodeURIComponent(roomCode) + '&on=' + (next ? '1' : '0'), { method: 'POST' });
      const data = await res.json();
      if (data && data.ok) setPublished(next);
    } catch (e) { /* ignore */ }
  }, [roomCode, published]);

  const handleJoin = useCallback((code) => {
    location.href = '/?room=' + encodeURIComponent(code);
  }, []);

  const quickMatch = useCallback(() => {
    const avail = rooms.filter(r => !r.inMatch && r.code !== roomCode);
    if (!avail.length) return;
    const r = avail[Math.floor(Math.random() * avail.length)];
    location.href = '/?room=' + encodeURIComponent(r.code);
  }, [rooms, roomCode]);

  return html`<div>
    <button class="rl-toggle" onClick=${() => setOpen(!open)} title="房间列表">
      <span>📋</span>
      <span>房间</span>
      ${roomCount > 0 ? html`<span class="rl-badge">${roomCount}</span>` : null}
    </button>
    ${open ? html`<div class="rl-panel">
      <div class="rl-header">
        <span class="rl-title"><span class="dot"></span>房间列表</span>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="rl-extlink" onClick=${openStandalone} title="在浏览器新标签页中打开完整房间列表">↗ 新窗口</button>
          <button class="rl-close" onClick=${() => setOpen(false)}>✕</button>
        </div>
      </div>
      <div class="rl-body">
        ${rooms.length === 0 ? html`<div class="rl-empty">暂无公开房间</div>` : rooms.map(r => html`
          <div class="rl-card${r.inMatch ? ' rl-card--match' : ''}" onClick=${() => handleJoin(r.code)} title=${r.inMatch ? '观战中' : '加入房间'}>
            <div class="rl-card-left">
              <span class="rl-card-code">${r.code}</span>
              <span class="rl-card-host">房主：${r.host}</span>
            </div>
            <div class="rl-card-mid">
              <span class="rl-tag ${DIFF_TAGS[r.difficulty] || DIFF_TAGS.NORMAL}">${DIFF_NAMES[r.difficulty] || r.difficulty}</span>
              <span class="rl-tag rl-tag--mode">${r.mode === 'solo' ? '独立' : '同盟'}</span>
            </div>
            <div class="rl-card-right">
              <span class="rl-card-players">${r.humans}/${r.maxSeats}</span>
              <span class="rl-status ${r.inMatch ? 'rl-status--match' : 'rl-status--wait'}">${r.inMatch ? '战斗中' : '等待中'}</span>
              <button class="rl-join" disabled=${r.code === roomCode} onClick=${(e) => { e.stopPropagation(); handleJoin(r.code); }}>加入</button>
            </div>
          </div>
        `)}
      </div>
      <div class="rl-footer">
        <button class="rl-quick" disabled=${!rooms.some(r => !r.inMatch)} onClick=${quickMatch}>⚡ 快速匹配</button>
        ${isHost ? html`<button class="rl-publish${published ? ' rl-publish--on' : ''}" onClick=${togglePublish}>${published ? '📢 已公开' : '🔒 设为公开'}</button>` : null}
        <span class="rl-refresh">每5秒刷新</span>
      </div>
    </div>` : null}
  </div>`;
}

const rootEl = document.createElement('div');
rootEl.id = 'sp-roomlist-root';
document.body.appendChild(rootEl);

/* drag to move */
var dragState = null;
rootEl.addEventListener('mousedown', function(e) {
  var toggle = e.target.closest('.rl-toggle');
  if (!toggle) return;
  if (e.target.closest('button') && e.target.closest('button') !== toggle) return;
  var rect = rootEl.getBoundingClientRect();
  dragState = {
    startX: e.clientX, startY: e.clientY,
    origLeft: rect.left, origBottom: window.innerHeight - rect.bottom,
  };
});

var didDrag = false;

window.addEventListener('mousemove', function(e) {
  if (!dragState) return;
  var dx = e.clientX - dragState.startX;
  var dy = dragState.startY - e.clientY;
  if (!didDrag && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) didDrag = true;
  if (!didDrag) return;
  var newLeft = Math.max(0, Math.min(window.innerWidth - 80, dragState.origLeft + dx));
  var newBottom = Math.max(0, Math.min(window.innerHeight - 40, dragState.origBottom + dy));
  rootEl.style.left = newLeft + 'px';
  rootEl.style.bottom = newBottom + 'px';
});

window.addEventListener('mouseup', function() {
  if (!dragState) return;
  dragState = null;
  didDrag = false;
  try {
    localStorage.setItem(DRAG_KEY, JSON.stringify({
      left: rootEl.style.left || savedPos?.left || defaultLeft,
      bottom: rootEl.style.bottom || savedPos?.bottom || defaultBottom,
    }));
  } catch(e) {}
});

let currentRoom = null;
let unmount = null;

function mount(info) {
  if (unmount) unmount();
  if (!info) { unmount = null; return; }
  render(html`<${RoomListPanel}
    roomCode=${info.roomCode}
    playerId=${info.playerId}
    isHost=${info.isHost}
  />`, rootEl);
  unmount = () => render(null, rootEl);
}

const initialInfo = getRoomInfo(store.get());
if (initialInfo) { currentRoom = initialInfo.roomCode; mount(initialInfo); }

store.subscribe((s) => {
  const info = getRoomInfo(s);
  const code = info ? info.roomCode : null;
  if (code !== currentRoom) {
    currentRoom = code;
    mount(info);
  }
});

}