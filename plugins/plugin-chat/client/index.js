import { render, h } from '/vendor/preact.module.js';
import htm from '/vendor/htm.module.js';
import { useState, useEffect, useRef } from '/vendor/hooks.module.js';
import { store } from '/js/store.js';

if (window.__sp_chatLoaded) { /* module already loaded via another content set */ }
else { window.__sp_chatLoaded = true;

const html = htm.bind(h);

var styleEl = document.createElement('style');
styleEl.textContent = '\
#sp-chat-root { position:fixed; bottom:calc(.24rem + .56rem + .12rem); left:.24rem; z-index:10000; font-family:system-ui,-apple-system,sans-serif; font-size:13px; }\
#sp-chat-root .pc-toggle { display:flex; align-items:center; gap:6px; padding:8px 14px; border:none; border-radius:20px; background:rgba(0,0,0,0.75); color:#fff; cursor:pointer; font-size:13px; box-shadow:0 2px 8px rgba(0,0,0,0.3); }\
#sp-chat-root .pc-toggle:hover { background:rgba(0,0,0,0.85); }\
#sp-chat-root .pc-badge { display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 4px; border-radius:9px; background:#e74c3c; color:#fff; font-size:11px; font-weight:600; }\
#sp-chat-root .pc-panel { position:absolute; bottom:44px; left:0; width:320px; height:400px; border-radius:12px; background:rgba(20,20,20,0.92); backdrop-filter:blur(8px); display:flex; flex-direction:column; box-shadow:0 4px 24px rgba(0,0,0,0.4); }\
#sp-chat-root .pc-header { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid rgba(255,255,255,0.1); color:#fff; }\
#sp-chat-root .pc-title { font-weight:600; }\
#sp-chat-root .pc-close { padding:2px 6px; border:none; border-radius:4px; background:none; color:rgba(255,255,255,0.6); cursor:pointer; font-size:14px; }\
#sp-chat-root .pc-close:hover { color:#fff; background:rgba(255,255,255,0.1); }\
#sp-chat-root .pc-list { flex:1; overflow-y:auto; padding:8px 12px; display:flex; flex-direction:column; gap:6px; }\
#sp-chat-root .pc-empty { color:rgba(255,255,255,0.35); text-align:center; padding:40px 0; }\
#sp-chat-root .pc-msg { display:flex; flex-direction:column; gap:2px; }\
#sp-chat-root .pc-author { font-size:11px; color:rgba(255,255,255,0.55); }\
#sp-chat-root .pc-mine .pc-author { color:rgba(100,200,255,0.7); }\
#sp-chat-root .pc-text { color:#eee; word-break:break-word; line-height:1.4; white-space:pre-wrap; }\
#sp-chat-root .pc-error { padding:4px 12px; color:#e74c3c; font-size:11px; }\
#sp-chat-root .pc-form { display:flex; gap:6px; padding:8px 12px; border-top:1px solid rgba(255,255,255,0.1); }\
#sp-chat-root .pc-input { flex:1; padding:6px 10px; border:1px solid rgba(255,255,255,0.15); border-radius:8px; background:rgba(255,255,255,0.08); color:#fff; font-size:13px; outline:none; }\
#sp-chat-root .pc-input:focus { border-color:rgba(100,200,255,0.4); }\
#sp-chat-root .pc-send { padding:6px 14px; border:none; border-radius:8px; background:rgba(100,200,255,0.25); color:rgba(100,200,255,0.9); cursor:pointer; font-size:12px; font-weight:600; }\
#sp-chat-root .pc-send:hover { background:rgba(100,200,255,0.4); }\
#sp-chat-root .pc-send:disabled { opacity:0.3; cursor:default; }\
#sp-chat-root .pc-danmaku-btn { padding:2px 8px; border:1px solid rgba(255,255,255,0.2); border-radius:4px; background:none; color:rgba(255,255,255,0.7); cursor:pointer; font-size:11px; }\
#sp-chat-root .pc-danmaku-btn:hover { color:#fff; border-color:rgba(255,255,255,0.4); }\
#sp-chat-root .pc-danmaku-btn.on { color:#65f1ca; border-color:rgba(101,241,202,0.4); }\
.trusted-banner { display:none; }\
';
document.head.appendChild(styleEl);

var danmakuEnabled = true;
try { danmakuEnabled = localStorage.getItem('sp.chat.danmaku.enabled') !== '0'; } catch (e) {}

var danmakuLayer = document.createElement('div');
danmakuLayer.setAttribute('aria-hidden', 'true');
Object.assign(danmakuLayer.style, {
  position: 'fixed', inset: '0', overflow: 'hidden',
  pointerEvents: 'none', zIndex: '120',
});

var danmakuMount = function() {
  if (document.body && !danmakuLayer.parentNode) document.body.appendChild(danmakuLayer);
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', danmakuMount, { once: true });
} else {
  danmakuMount();
}

var danmakuActive = new Map();

function danmakuClear() {
  danmakuActive.forEach(function(item) {
    clearTimeout(item.timer);
    if (item.animation) item.animation.cancel();
    item.el.remove();
  });
  danmakuActive.clear();
}

function danmakuShow(message, mine) {
  if (!danmakuEnabled || document.hidden || !message || typeof message.text !== 'string') return;
  danmakuMount();
  var lanes = innerHeight < 420 ? 3 : 4;
  var busyLanes = new Set();
  danmakuActive.forEach(function(item) { busyLanes.add(item.lane); });
  var lane = 0;
  while (busyLanes.has(lane)) lane++;
  if (lane >= lanes) return;

  var el = document.createElement('span');
  var sender = String(message.name || '\u535a\u58eb').slice(0, 24);
  el.textContent = sender + '\uff1a' + message.text;
  Object.assign(el.style, {
    position: 'absolute',
    left: '100%',
    top: Math.max(78, innerHeight * 0.14) + lane * 30 + 'px',
    whiteSpace: 'nowrap',
    fontSize: innerHeight < 420 ? '14px' : '18px',
    fontWeight: '600',
    lineHeight: '28px',
    color: mine ? '#65f1ca' : '#ffffff',
    textShadow: '0 1px 3px #000, 1px 0 3px #000',
    maxWidth: 'min(680px, 85vw)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
    userSelect: 'none',
  });
  danmakuLayer.appendChild(el);

  var duration = 8000;
  var distance = innerWidth + el.getBoundingClientRect().width + 20;
  var animation = el.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-' + distance + 'px)' }],
    { duration: duration, easing: 'linear' }
  );
  var remove = function() {
    var item = danmakuActive.get(el);
    if (item) { clearTimeout(item.timer); danmakuActive.delete(el); }
    el.remove();
  };
  danmakuActive.set(el, { lane: lane, el: el, animation: animation, timer: setTimeout(remove, duration + 500) });
  animation.onfinish = remove;
}

document.addEventListener('visibilitychange', function() { if (document.hidden) danmakuClear(); });
window.addEventListener('resize', danmakuClear);

function danmakuSetEnabled(val) {
  danmakuEnabled = Boolean(val);
  if (!danmakuEnabled) danmakuClear();
  try { localStorage.setItem('sp.chat.danmaku.enabled', danmakuEnabled ? '1' : '0'); } catch (e) {}
}

const POLL_MS = 2000;
const CHAT_LIMITS = Object.freeze({ text: 200, inputUnits: 400 });

function chatTextLength(value) {
  return typeof value === 'string' ? [...value].length : 0;
}

function isChatTextInput(value) {
  if (typeof value !== 'string' || !value.length || value.length > CHAT_LIMITS.inputUnits) return false;
  if (chatTextLength(value) > CHAT_LIMITS.text) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

function normalizeChatText(value) {
  if (!isChatTextInput(value)) return null;
  const text = value.normalize('NFC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n').trim();
  return text && chatTextLength(text) <= CHAT_LIMITS.text ? text : null;
}

function ChatMessage({ msg, myId }) {
  const isMine = msg.playerId === myId;
  const label = msg.spectator
    ? msg.name + ' \u89c2' /* 观 */
    : (msg.seat != null ? msg.name + ' P' + (msg.seat + 1) : msg.name);
  return html`<div class="pc-msg${isMine ? ' pc-mine' : ''}">
    <span class="pc-author">${label}</span>
    <span class="pc-text">${msg.text}</span>
  </div>`;
}

function ChatPanel({ roomCode, playerId, playerName, seat, spectator, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [dmOn, setDmOn] = useState(danmakuEnabled);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const seqRef = useRef(0);
  const lastOpen = useRef(false);
  const msgLenRef = useRef(0);

  useEffect(function() {
    if (open && !lastOpen.current) { setUnread(0); inputRef.current && inputRef.current.focus(); }
    lastOpen.current = open;
  }, [open]);

  useEffect(function() {
    let active = true;
    let timer = null;

    async function poll() {
      if (!active || !roomCode) return;
      try {
        const res = await fetch('/x/plugin-chat/messages?room=' + encodeURIComponent(roomCode) + '&since=' + seqRef.current);
        const data = await res.json();
        if (!active) return;
        if (data && Array.isArray(data.messages) && data.messages.length) {
          setMessages(function(prev) {
            const seen = new Set(prev.map(function(m) { return m.seq; }));
            const fresh = data.messages.filter(function(m) { return !seen.has(m.seq); });
            if (!fresh.length) return prev;
            const next = prev.concat(fresh);
            if (next.length > 200) return next.slice(next.length - 200);
            return next;
          });
          seqRef.current = data.latestSeq;
          if (!open && data.messages.some(function(m) { return m.playerId !== playerId; })) {
            setUnread(function(n) { return n + data.messages.filter(function(m) { return m.playerId !== playerId; }).length; });
          }
        }
      } catch (e) { /* ignore transient fetch failures */ }
      if (active) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    return function() { active = false; clearTimeout(timer); };
  }, [roomCode, playerId, open]);

  useEffect(function() {
    if (messages.length > msgLenRef.current) {
      for (var i = msgLenRef.current; i < messages.length; i++) {
        danmakuShow(messages[i], messages[i].playerId === playerId);
      }
    }
    msgLenRef.current = messages.length;
  }, [messages, playerId]);

  useEffect(function() {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  function handleSend(e) {
    e && e.preventDefault();
    if (sending) return;
    var text = normalizeChatText(input);
    if (!text) return;
    setSending(true);
    setError(null);
    var url = '/x/plugin-chat/send'
      + '?room=' + encodeURIComponent(roomCode)
      + '&playerId=' + encodeURIComponent(playerId)
      + '&name=' + encodeURIComponent(playerName)
      + (seat != null ? '&seat=' + seat : '')
      + '&spectator=' + (spectator ? 'true' : 'false')
      + '&text=' + encodeURIComponent(text);
    fetch(url, { method: 'POST' }).then(function(r) { return r.json(); }).then(function(data) {
      setSending(false);
      if (data && data.ok) { setInput(''); return; }
      if (data && data.error) { setError(data.error); setTimeout(function() { setError(null); }, 3000); }
    }).catch(function() {
      setSending(false);
      setError('network');
      setTimeout(function() { setError(null); }, 3000);
    });
  }

  function handleDmToggle() {
    var next = !dmOn;
    danmakuSetEnabled(next);
    setDmOn(next);
  }

  return html`
    <div class="pc-root">
      <button class="pc-toggle" onClick=${function() { setOpen(function(v) { return !v; }); }}>
        <span class="pc-toggle-label">\u804a\u5929</span>${unread > 0 ? html`<span class="pc-badge">${unread}</span>` : null}
      </button>
      ${open && html`
        <div class="pc-panel">
          <div class="pc-header">
            <span class="pc-title">\u5c40\u5185\u804a\u5929</span>
            <div style="display:flex;align-items:center;gap:6px;">
              <button class="pc-danmaku-btn${dmOn ? ' on' : ''}" onClick=${handleDmToggle} title=${dmOn ? '\u5f39\u5e55\u5f00' : '\u5f39\u5e55\u5173'}>${dmOn ? '\u5f39\u5e55 ON' : '\u5f39\u5e55 OFF'}</button>
              <button class="pc-close" onClick=${onClose || (function() { setOpen(false); })}>\u2715</button>
            </div>
          </div>
          <div class="pc-list" ref=${listRef}>
            ${messages.length === 0 ? html`<div class="pc-empty">\u6682\u65e0\u6d88\u606f</div>` : null}
            ${messages.map(function(m) { return html`<${ChatMessage} key=${m.seq} msg=${m} myId=${playerId} />`; })}
          </div>
          ${error ? html`<div class="pc-error">${error}</div>` : null}
          <form class="pc-form" onSubmit=${handleSend}>
            <input class="pc-input" ref=${inputRef}
              value=${input}
              onInput=${function(e) { setInput(e.target.value); }}
              maxlength=${CHAT_LIMITS.inputUnits}
              placeholder="\u8f93\u5165\u6d88\u606f..."
              disabled=${sending} />
            <button class="pc-send" type="submit" disabled=${sending || !normalizeChatText(input)}>\u53d1\u9001</button>
          </form>
        </div>
      `}
    </div>
  `;
}

function getRoomInfo(s) {
  var room = s && s.room;
  if (!room || !room.code) return null;
  var me = s && s.me;
  if (!me || !me.playerId) return null;
  var seats = Array.isArray(room.seats) ? room.seats : [];
  var mySeat = seats.findIndex(function(x) { return x && x.playerId === me.playerId; });
  var spectators = Array.isArray(room.spectators) ? room.spectators : [];
  var isSpectator = mySeat === -1 && spectators.some(function(x) { return x && x.playerId === me.playerId; });
  return {
    roomCode: room.code,
    playerId: me.playerId,
    playerName: me.name || '',
    seat: mySeat >= 0 ? mySeat : null,
    spectator: isSpectator,
  };
}

var rootEl = document.createElement('div');
rootEl.id = 'sp-chat-root';
document.body.appendChild(rootEl);

var currentRoom = null;
var unmount = null;

function mount(info) {
  if (unmount) unmount();
  if (!info) { unmount = null; return; }
  render(html`<${ChatPanel}
    roomCode=${info.roomCode}
    playerId=${info.playerId}
    playerName=${info.playerName}
    seat=${info.seat}
    spectator=${info.spectator}
  />`, rootEl);
  unmount = function() { render(null, rootEl); };
}

var initialInfo = getRoomInfo(store.get());
if (initialInfo) { currentRoom = initialInfo.roomCode; mount(initialInfo); }

store.subscribe(function(s) {
  var info = getRoomInfo(s);
  var code = info ? info.roomCode : null;
  if (code !== currentRoom) {
    currentRoom = code;
    mount(info);
  }
});

}