export const CHAT_LIMITS = Object.freeze({ text: 200, inputUnits: 400, history: 200 });

export function chatTextLength(value) {
  return typeof value === 'string' ? [...value].length : 0;
}

export function isChatTextInput(value) {
  if (typeof value !== 'string' || !value.length || value.length > CHAT_LIMITS.inputUnits) return false;
  if (chatTextLength(value) > CHAT_LIMITS.text) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (char.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}

export function normalizeChatText(value) {
  if (!isChatTextInput(value)) return null;
  const text = value.normalize('NFC')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n').trim();
  return text && chatTextLength(text) <= CHAT_LIMITS.text ? text : null;
}

class TokenBucket {
  constructor(ratePerSec, burst, now) {
    this.rate = ratePerSec / 1000;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }

  take(now) {
    const dt = Math.max(0, now - this.at);
    this.at = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
    if (this.tokens >= 1) { this.tokens -= 1; return true; }
    return false;
  }
}

function roomStore() {
  const rooms = new Map();
  const MAX_IDLE_MS = 3600000;

  function prune() {
    const cutoff = Date.now() - MAX_IDLE_MS;
    for (const [code, r] of rooms) if (r.lastAccess < cutoff) rooms.delete(code);
  }

  function get(code) {
    let r = rooms.get(code);
    if (!r) {
      r = {
        seq: 0,
        messages: [],
        players: new Map(),
        roomBucket: new TokenBucket(10, 20, Date.now()),
        lastAccess: Date.now(),
      };
      rooms.set(code, r);
    }
    r.lastAccess = Date.now();
    prune();
    return r;
  }

  return { get };
}

const rooms = roomStore();

export async function activate(api) {
  api.http.route('/x/plugin-chat/send', (req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('room');
      const playerId = url.searchParams.get('playerId');
      const name = url.searchParams.get('name');
      const seatStr = url.searchParams.get('seat');
      const spectatorStr = url.searchParams.get('spectator');
      const rawText = url.searchParams.get('text');

      if (typeof code !== 'string' || !code.length || code.length > 64) return { error: 'bad_room' };
      if (typeof playerId !== 'string' || !playerId.length || playerId.length > 64) return { error: 'bad_player' };
      if (typeof name !== 'string' || !name.length || chatTextLength(name) > 64) return { error: 'bad_name' };

      const seat = seatStr === '' || seatStr === null || seatStr === 'null' ? null : parseInt(seatStr, 10);
      const spectator = spectatorStr === 'true' || spectatorStr === '1';
      if (spectator ? seat !== null : !Number.isInteger(seat) || seat < 0 || seat >= 20) return { error: 'bad_seat' };

      const text = normalizeChatText(rawText);
      if (text === null) return { error: 'bad_text' };

      const r = rooms.get(code);
      const at = Date.now();
      let bucket = r.players.get(playerId);
      if (!bucket) { bucket = new TokenBucket(0.5, 3, at); r.players.set(playerId, bucket); }
      if (!bucket.take(at) || !r.roomBucket.take(at)) return { error: 'rate' };

      const entry = {
        seq: ++r.seq,
        playerId,
        name,
        seat,
        spectator,
        text,
        at,
      };
      r.messages.push(entry);
      if (r.messages.length > CHAT_LIMITS.history) r.messages.shift();
      return { ok: true, seq: r.seq };
    } catch (e) {
      return { error: 'internal', detail: String(e.message).slice(0, 200) };
    }
  });

  api.http.route('/x/plugin-chat/messages', (req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('room');
      const sinceStr = url.searchParams.get('since');

      if (typeof code !== 'string' || !code.length || code.length > 64) return { error: 'bad_room' };

      const r = rooms.get(code);
      const since = parseInt(sinceStr, 10) || 0;

      const fresh = since < r.seq ? r.messages.filter((m) => m.seq > since) : [];
      return { messages: fresh, latestSeq: r.seq };
    } catch (e) {
      return { error: 'internal', detail: String(e.message).slice(0, 200) };
    }
  });

  api.lobby.on('roomClosed', (ev) => {
    if (ev && typeof ev.code === 'string') {
      rooms.get(ev.code).players.clear();
      rooms.get(ev.code).messages.length = 0;
      rooms.get(ev.code).seq = 0;
    }
  });
}