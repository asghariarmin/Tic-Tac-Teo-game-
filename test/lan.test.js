import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createGameServer } from '../server.js';

async function launch(t, options) {
  const server = createGameServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.close();
    server.closeAllConnections();
    return once(server, 'close');
  });
  const api = '/api/rooms';

  async function post(path, body = {}, browserOrigin) {
    const response = await fetch(`${origin}${api}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(browserOrigin && { Origin: browserOrigin }) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }

  async function listen(code, token) {
    const controller = new AbortController();
    const response = await fetch(`${origin}${api}/${code}/events?token=${token}`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /text\/event-stream/);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';

    return {
      close: () => controller.abort(),
      async next() {
        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (frame.startsWith('event: state\ndata: ')) return JSON.parse(frame.slice('event: state\ndata: '.length));
            continue;
          }
          const { value, done } = await reader.read();
          assert.equal(done, false, 'stream ended before a state event');
          buffer += value;
        }
      },
    };
  }

  return { origin, post, listen };
}

test('a hosted HTTPS origin can play through an HTTP proxy', async t => {
  const publicOrigin = 'https://game.example.com';
  const { post, listen } = await launch(t, { publicOrigin });
  assert.equal((await post('', {}, 'https://other.example.com')).status, 403);
  const host = await post('', {}, publicOrigin);
  assert.equal(host.status, 201);
  assert.equal(host.body.lanAddress, null);
  const { code } = host.body.state;
  const guest = await post(`/${code}/join`, {}, publicOrigin);
  assert.equal(guest.status, 201);

  const x = await listen(code, host.body.token);
  await x.next();
  const o = await listen(code, guest.body.token);
  const state = await x.next();
  const move = await post(`/${code}/move`, { token: host.body.token, version: state.version, index: 0 }, publicOrigin);
  assert.equal(move.status, 200);
  assert.equal((await o.next()).version, state.version);
  assert.equal((await o.next()).game.board[0], 'X');
  x.close();
  o.close();
});

test('LAN rooms synchronize moves, reject conflicts, reconnect, rematch, and close', async t => {
  const { origin, post, listen } = await launch(t);
  const page = await fetch(`${origin}/?join=ABC234`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Tic Tac Toe/);

  const { status, body: host } = await post('');
  assert.equal(status, 201);
  assert.equal(host.mark, 'X');
  const { code } = host.state;
  assert.match(code, /^[A-Z2-9]{6}$/);
  const x = await listen(code, host.token);
  const waiting = await x.next();
  assert.deepEqual(waiting.connected, { X: true, O: false });

  const join = await post(`/${code}/join`);
  assert.equal(join.status, 201);
  const guest = join.body;
  assert.equal(guest.mark, 'O');
  assert.equal((await post(`/${code}/join`)).status, 409);
  assert.equal((await x.next()).joined, true);
  let o = await listen(code, guest.token);
  let state = await x.next();
  assert.deepEqual(await o.next(), state);
  assert.deepEqual(state.connected, { X: true, O: true });
  assert.equal(Object.hasOwn(state, 'token'), false);

  const command = (action, player, extra) => post(`/${code}/${action}`, { token: player.token, version: state.version, ...extra });
  assert.equal((await command('move', { token: 'invalid' }, { index: 0 })).status, 403);
  assert.equal((await command('move', guest, { index: 0 })).status, 409);
  assert.equal((await command('rematch', host)).status, 409);

  const raced = await Promise.all([command('move', host, { index: 0 }), command('move', host, { index: 0 })]);
  assert.deepEqual(raced.map(result => result.status).sort(), [200, 409]);
  state = await x.next();
  assert.deepEqual(await o.next(), state);
  assert.equal(state.game.board[0], 'X');
  assert.equal((await command('move', guest, { index: 0 })).status, 409);

  o.close();
  state = await x.next();
  assert.equal(state.connected.O, false);
  assert.equal((await command('move', guest, { index: 3 })).status, 409);
  o = await listen(code, guest.token);
  state = await x.next();
  assert.deepEqual(await o.next(), state);
  assert.equal(state.game.board[0], 'X');
  assert.equal(state.game.turn, 'O');

  for (const [player, index] of [[guest, 3], [host, 1], [guest, 4], [host, 2]]) {
    assert.equal((await command('move', player, { index })).status, 200);
    state = await x.next();
    assert.deepEqual(await o.next(), state);
  }
  assert.deepEqual(state.game.result, { winner: 'X', line: [0, 1, 2] });
  assert.equal((await command('move', guest, { index: 5 })).status, 409);
  assert.equal((await command('rematch', guest)).status, 200);
  state = await x.next();
  assert.deepEqual(await o.next(), state);
  assert.equal(state.round, 2);
  assert.equal(state.game.turn, 'X');
  assert.ok(state.game.board.every(mark => mark === null));
  assert.equal((await command('leave', guest)).status, 200);
  assert.equal((await x.next()).closedBy, 'O');
  assert.equal((await o.next()).closedBy, 'O');
  assert.equal((await post(`/${code}/join`)).status, 410);
});

test('a newer stream takes over a seat without marking it offline', async t => {
  const { post, listen } = await launch(t);
  const { body: host } = await post('');
  const old = await listen(host.state.code, host.token);
  const first = await old.next();
  const replacement = await listen(host.state.code, host.token);
  const state = await replacement.next();
  assert.equal(state.version, first.version + 1);
  assert.equal(state.connected.X, true);
  old.close();
  replacement.close();
});

test('a stale connection pauses the room even if its stream stays open', async t => {
  const { post, listen } = await launch(t, { heartbeatMs: 25, presenceTimeoutMs: 500 });
  const { body: host } = await post('');
  const { code } = host.state;
  const { body: guest } = await post(`/${code}/join`);
  const x = await listen(code, host.token);
  await x.next();
  const o = await listen(code, guest.token);
  assert.deepEqual((await x.next()).connected, { X: true, O: true });
  await o.next();
  const keepHostOnline = setInterval(() => {
    post(`/${code}/heartbeat`, { token: host.token }).catch(() => {});
  }, 50);
  t.after(() => clearInterval(keepHostOnline));

  const paused = await x.next();
  assert.deepEqual(paused.connected, { X: true, O: false });
  const rejoined = await listen(code, guest.token);
  assert.deepEqual((await x.next()).connected, { X: true, O: true });
  rejoined.close();
  o.close();
  x.close();
});
