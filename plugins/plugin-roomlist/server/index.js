function roomStore() {
  const rooms = new Map();

  function upsert(code, state) {
    const r = rooms.get(code);
    const now = Date.now();
    if (r) {
      r.state = state;
      r.updatedAt = now;
    } else {
      rooms.set(code, { state, createdAt: now, updatedAt: now, published: false });
    }
  }

  function remove(code) {
    rooms.delete(code);
  }

  function publish(code, on) {
    const r = rooms.get(code);
    if (r) { r.published = !!on; r.updatedAt = Date.now(); }
  }

  function list() {
    const out = [];
    for (const [, r] of rooms) {
      if (!r.published) continue;
      const s = r.state;
      const seats = s.seats || [];
      const humans = seats.filter(x => x && !x.isBot && x.connected).length;
      const maxSeats = seats.length;
      const hostSeat = seats.find(x => x && x.playerId === s.hostId);
      out.push({
        code: s.code,
        host: hostSeat ? hostSeat.name : '—',
        difficulty: s.difficulty || 'NORMAL',
        mode: s.mode || 'coop',
        inMatch: !!s.inMatch,
        humans,
        maxSeats,
        spectators: (s.spectators || []).filter(x => x.connected).length,
      });
    }
    return out;
  }

  return { upsert, remove, publish, list };
}

const rooms = roomStore();

export async function activate(api) {
  const update = (ev) => {
    if (ev && ev.room && typeof ev.room.code === 'string') {
      rooms.upsert(ev.room.code, ev.room);
    }
  };

  api.lobby.on('roomCreated', update);
  api.lobby.on('playerJoined', update);
  api.lobby.on('playerLeft', update);
  api.lobby.on('matchStarted', update);

  api.lobby.on('roomClosed', (ev) => {
    if (ev && ev.room && typeof ev.room.code === 'string') {
      rooms.remove(ev.room.code);
    }
  });

  api.http.route('/x/plugin-roomlist/rooms', () => {
    return { rooms: rooms.list() };
  });

  api.http.route('/x/plugin-roomlist/publish', (req) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const code = url.searchParams.get('room');
      const on = url.searchParams.get('on') !== '0' && url.searchParams.get('on') !== 'false';
      if (typeof code !== 'string' || !code.length || code.length > 64) return { error: 'bad_room' };
      rooms.publish(code.toUpperCase(), on);
      return { ok: true, published: on };
    } catch (e) {
      return { error: 'internal', detail: String(e.message).slice(0, 200) };
    }
  });

  api.health.extend({ roomsTracked: rooms.list().length });
}