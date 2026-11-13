import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { newGame, play } from './public/game.js';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const assets = new Map([
  ['/', [new URL('./public/index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/style.css', [new URL('./public/style.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/app.js', [new URL('./public/app.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/game.js', [new URL('./public/game.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/sound.js', [new URL('./public/sound.js', import.meta.url), 'text/javascript; charset=utf-8']],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function lanAddresses() {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !/^(utun|tun|tap|awdl|llw|docker|veth|bridge)/.test(name))
    .flatMap(([, entries]) => entries.filter(entry => entry.family === 'IPv4' && !entry.internal))
    .map(entry => entry.address);
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new RequestError(415, 'Send the request as JSON.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 2048) {
      request.resume();
      throw new RequestError(413, 'The request is too large.');
    }
    chunks.push(chunk);
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError(400, 'The request contains invalid JSON.');
  }
}

function makePlayer() {
  return { token: randomBytes(24).toString('hex'), stream: null, seen: 0 };
}

function snapshot(room) {
  return {
    code: room.code,
    version: room.version,
    game: room.game,
    round: room.round,
    joined: Boolean(room.players.O),
    connected: { X: Boolean(room.players.X.stream), O: Boolean(room.players.O?.stream) },
    closedBy: room.closedBy,
  };
}

function sendState(stream, room) {
  stream.write(`event: state\ndata: ${JSON.stringify(snapshot(room))}\n\n`);
}

function publish(room) {
  room.version += 1;
  for (const player of Object.values(room.players)) {
    if (player?.stream) sendState(player.stream, room);
  }
}

function getPlayer(room, token) {
  const mark = ['X', 'O'].find(mark => room.players[mark]?.token === token && token);
  if (!mark) throw new RequestError(403, 'This browser does not have a seat in the room.');
  return mark;
}

function openStream(response, room, mark) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 1200\n\n');

  if (room.closedBy) {
    sendState(response, room);
    response.end();
    return;
  }

  const player = room.players[mark];
  const previous = player.stream;
  player.stream = response;
  player.seen = Date.now();
  if (previous) previous.end('event: replaced\ndata: {}\n\n');
  response.on('close', () => {
    if (player.stream !== response) return;
    player.stream = null;
    if (!room.closedBy) publish(room);
  });
  publish(room);
}

export function createGameServer({ heartbeatMs = 4000, presenceTimeoutMs = 15000, publicOrigin, onVercel = false } = {}) {
  const rooms = new Map();

  async function handle(request, response) {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

    if (onVercel && url.pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
      response.writeHead(302, { Location: `/index.html${url.search}` });
      response.end();
      return;
    }

    const asset = assets.get(url.pathname);
    if (asset && (request.method === 'GET' || request.method === 'HEAD')) {
      const [filename, contentType] = asset;
      const content = await readFile(filename);
      response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
      response.end(request.method === 'HEAD' ? undefined : content);
      return;
    }

    const allowedOrigin = publicOrigin ?? `${onVercel ? 'https' : 'http'}://${request.headers.host}`;
    if (request.method === 'POST' && request.headers.origin && request.headers.origin !== allowedOrigin) {
      throw new RequestError(403, 'Open the game from the same address as the room host.');
    }

    if (request.method === 'POST' && url.pathname === '/api/rooms') {
      await readJson(request);
      let code;
      do {
        code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
      } while (rooms.has(code));

      const host = makePlayer();
      const room = { code, players: { X: host, O: null }, game: newGame(), round: 1, version: 0, closedBy: null };
      rooms.set(code, room);
      const lanAddress = publicOrigin || onVercel ? null : lanAddresses()[0] ?? null;
      json(response, 201, { mark: 'X', token: host.token, state: snapshot(room), lanAddress });
      return;
    }

    const route = /^\/api\/rooms\/([A-Z2-9]{6})\/(join|events|move|rematch|leave|heartbeat)$/.exec(url.pathname);
    const action = route?.[2];
    if (!action || request.method !== (action === 'events' ? 'GET' : 'POST')) {
      throw new RequestError(404, 'This page could not be found.');
    }

    const room = rooms.get(route[1]);
    if (!room) throw new RequestError(404, 'Room not found. Check the code and try again.');

    if (action === 'events') {
      openStream(response, room, getPlayer(room, url.searchParams.get('token')));
      return;
    }

    const body = await readJson(request);
    if (room.closedBy) throw new RequestError(410, 'This room has closed.');

    if (action === 'join') {
      if (room.players.O) throw new RequestError(409, 'Both seats in this room are taken.');
      const guest = makePlayer();
      room.players.O = guest;
      publish(room);
      json(response, 201, { mark: 'O', token: guest.token, state: snapshot(room), lanAddress: null });
      return;
    }

    const mark = getPlayer(room, body.token);
    if (action === 'heartbeat') {
      room.players[mark].seen = Date.now();
      response.writeHead(204).end();
      return;
    }

    if (action === 'leave') {
      room.closedBy = mark;
      publish(room);
      for (const player of Object.values(room.players)) player?.stream?.end();
      json(response, 200, snapshot(room));
      return;
    }

    if (body.version !== room.version) throw new RequestError(409, 'The board changed. Try again.');
    if (!room.players.X.stream || !room.players.O?.stream) {
      throw new RequestError(409, 'Both players must be connected.');
    }

    if (action === 'move') {
      const next = play(room.game, body.index, mark);
      if (!next) throw new RequestError(409, 'That move is unavailable.');
      room.game = next;
    } else {
      if (!room.game.result) throw new RequestError(409, 'Finish the current round first.');
      room.game = newGame();
      room.round += 1;
    }

    publish(room);
    json(response, 200, snapshot(room));
  }

  const server = createServer((request, response) => {
    handle(request, response).catch(error => {
      if (response.destroyed) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (!(error instanceof RequestError)) console.error(error);
      json(response, error.status ?? 500, { error: error.status ? error.message : 'The server hit an error. Try again.' });
    });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const player of Object.values(room.players)) {
        if (!player?.stream || room.closedBy) continue;
        if (now - player.seen > presenceTimeoutMs) player.stream.destroy();
        else player.stream.write('event: ping\ndata: {}\n\n');
      }
    }
  }, heartbeatMs);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));
  return server;
}

function readPublicOrigin(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password) {
      return url.origin;
    }
  } catch {
    // Report invalid URLs and unsupported URL forms with the same message.
  }
  throw new Error('Set PUBLIC_ORIGIN to the full site origin, for example https://game.example.com.');
}

const onVercel = process.env.VERCEL === '1';
const publicOrigin = readPublicOrigin(onVercel ? undefined : process.env.PUBLIC_ORIGIN);
const server = createGameServer({ publicOrigin, onVercel });
export default server;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (process.env.PIXEL_ARCADE_DESKTOP === '1') {
    process.stdin.once('end', () => process.exit());
    process.stdin.resume();
  }
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try PORT=3001 npm start.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    const activePort = server.address().port;
    console.log(`Tic-Tac-Toe is running\n  Local: http://localhost:${activePort}`);
    if (publicOrigin) console.log(`  Public: ${publicOrigin}`);
    else for (const address of lanAddresses()) console.log(`  LAN:   http://${address}:${activePort}`);
  });
}
