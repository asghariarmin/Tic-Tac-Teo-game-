import { chooseMove, newGame, play } from './game.js';
import { playSound, setSoundEnabled, unlockSound } from './sound.js';

const $ = selector => document.querySelector(selector);
const board = $('#board');
const status = $('#status');
const detail = $('#status-detail');
const badge = $('#board-badge');
const particles = $('#particles');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const storageKey = 'pixel-arcade-seat';
const demo = ['X', null, 'O', null, 'X', null, 'O', null, null];
const modeNames = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const panels = Object.fromEntries(['home', 'solo', 'lan', 'match'].map(name => [name, $(`#${name}-panel`)]));

let panel = 'home';
let mode = null;
let difficulty = null;
let game = newGame();
let seat = null;
let room = null;
let stream = null;
let transportReady = false;
let seatLost = false;
let roomPending = false;
let commandPending = false;
let cpuTimer;
let particleTimer;
let streamTimer;

function drawTitle() {
  const glyphs = {
    T: ['1111111', '1111111', '0011100', '0011100', '0011100', '0011100', '0011100'],
    I: ['11111', '11111', '01110', '01110', '01110', '11111', '11111'],
    C: ['011111', '111111', '111000', '111000', '111000', '111111', '011111'],
    A: ['001100', '011110', '110011', '110011', '111111', '110011', '110011'],
    O: ['011110', '111111', '110011', '110011', '110011', '111111', '011110'],
    E: ['111111', '111111', '111000', '111110', '111000', '111111', '111111'],
  };
  const context = $('#title-art').getContext('2d');
  const lines = [['TIC TAC', '#f6f3ff', '#7c70ae', 0], ['TOE', '#56eedb', '#277a7d', 10]];
  for (const [label, color, shadow, top] of lines) {
    let left = 0;
    for (const letter of label) {
      if (letter === ' ') {
        left += 3;
        continue;
      }
      const glyph = glyphs[letter];
      for (const [fill, offset] of [[shadow, 1], [color, 0]]) {
        context.fillStyle = fill;
        glyph.forEach((row, y) => [...row].forEach((pixel, x) => {
          if (pixel === '1') context.fillRect(left + x + offset, top + y + offset, 1, 1);
        }));
      }
      left += glyph[0].length + 1;
    }
  }
}

const cells = demo.map((_, index) => {
  const button = document.createElement('button');
  const icon = document.createElement('span');
  button.className = 'cell';
  button.type = 'button';
  icon.setAttribute('aria-hidden', 'true');
  button.append(icon);
  button.addEventListener('click', () => selectCell(index));
  button.addEventListener('keydown', event => {
    const moves = {
      ArrowLeft: index % 3 > 0 ? index - 1 : index,
      ArrowRight: index % 3 < 2 ? index + 1 : index,
      ArrowUp: index >= 3 ? index - 3 : index,
      ArrowDown: index < 6 ? index + 3 : index,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    cells[moves[event.key]].focus();
  });
  board.append(button);
  return button;
});

function setText(element, value) {
  if (element.textContent !== value) element.textContent = value;
}

function setError(selector, message = '') {
  const element = $(selector);
  setText(element, message);
  element.hidden = !message;
}

function showPanel(name, focus = true) {
  panel = name;
  for (const [key, element] of Object.entries(panels)) element.hidden = key !== name;
  if (focus) panels[name].querySelector(name === 'home' ? 'button' : 'h2').focus();
}

function lanReady() {
  return transportReady && room?.connected.X && room?.connected.O && !room.closedBy;
}

function canPlay() {
  if (panel !== 'match' || game.result) return false;
  if (mode === 'solo') return game.turn === 'X';
  if (mode === 'lan') return lanReady() && !commandPending && game.turn === seat.mark;
  return true;
}

function boardStatus() {
  if (panel !== 'match') return ['Ready to play', 'Choose a mode to start.', 'STANDBY'];
  if (mode === 'lan') {
    if (seatLost) return ['Connection closed', 'Return to the main menu to start another game.', 'CLOSED'];
    if (room.closedBy) return ['Room closed', 'The other player left the room.', 'CLOSED'];
    if (!transportReady) return ['Connecting…', 'The board will resume when the connection returns.', 'PAUSED'];
    if (!room.joined) return ['Waiting for a player', 'Share the room code or invite link.', 'LOBBY'];
    if (!lanReady()) return ['Waiting for your opponent', 'The board will resume when both players reconnect.', 'PAUSED'];
  }

  if (game.result) {
    const winner = game.result.winner;
    if (!winner) return ['It’s a draw!', 'All nine squares are filled.', 'DRAW'];
    let title = `Player ${winner} wins!`;
    if (mode === 'solo') title = winner === 'X' ? 'You win!' : 'Computer wins!';
    if (mode === 'lan') title = winner === seat.mark ? 'You win!' : 'Opponent wins!';
    return [title, `Three in a row for ${winner}.`, 'ROUND OVER', winner];
  }

  const turn = game.turn;
  if (mode === 'solo') return turn === 'X'
    ? ['Your turn', 'Pick an empty square.', 'X TURN', turn]
    : ['Computer’s turn', 'Choosing a move…', 'O TURN', turn];
  if (mode === 'lan') return turn === seat.mark
    ? ['Your turn', `You’re playing as ${turn}.`, `${turn} TURN`, turn]
    : ['Opponent’s turn', `Waiting for ${turn} to move.`, `${turn} TURN`, turn];
  return [`Player ${turn}’s turn`, 'Pick an empty square.', `${turn} TURN`, turn];
}

function stopCelebration() {
  clearTimeout(particleTimer);
  particles.hidden = true;
  particles.replaceChildren();
  status.parentElement.classList.remove('celebrate');
  for (const cell of cells) cell.classList.remove('celebrate');
}

function celebrate(winner) {
  stopCelebration();
  if (reducedMotion.matches) return;
  status.parentElement.classList.add('celebrate');
  for (const index of game.result.line) cells[index].classList.add('celebrate');
  const colors = [winner === 'X' ? '#56eedb' : '#ffcc73', '#bdabff', '#f6f3ff'];
  for (let index = 0; index < 22; index += 1) {
    const particle = document.createElement('i');
    const angle = index / 22 * 2 * Math.PI;
    const distance = 60 + (index % 6) * 24;
    particle.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
    particle.style.setProperty('--dy', `${Math.sin(angle) * distance}px`);
    particle.style.setProperty('--spin', `${90 + (index % 5) * 45}deg`);
    particle.style.setProperty('--size', `${4 + (index % 3) * 2}px`);
    particle.style.setProperty('--particle', colors[index % colors.length]);
    particles.append(particle);
  }
  particles.hidden = false;
  particleTimer = setTimeout(stopCelebration, 675);
}

function render() {
  const inMatch = panel === 'match';
  const visibleBoard = inMatch ? game.board : demo;
  const playable = canPlay();
  const win = inMatch ? game.result?.line ?? [] : [];

  cells.forEach((cell, index) => {
    const mark = visibleBoard[index];
    const order = win.indexOf(index);
    const row = Math.floor(index / 3) + 1;
    const column = index % 3 + 1;
    cell.classList.toggle('demo', !inMatch);
    cell.firstElementChild.className = mark ? `mark mark-${mark.toLowerCase()}` : 'cell-dot';
    cell.tabIndex = inMatch ? 0 : -1;
    cell.setAttribute('aria-disabled', String(!playable || Boolean(mark)));
    cell.setAttribute('aria-label', `Row ${row}, column ${column}, ${mark ?? 'empty'}${order >= 0 ? ', winning square' : ''}`);
    if (order >= 0) {
      cell.dataset.win = mark;
      cell.dataset.order = order;
    } else {
      delete cell.dataset.win;
      delete cell.dataset.order;
    }
  });
  board.setAttribute('aria-label', inMatch ? 'Tic Tac Toe board' : 'Tic Tac Toe preview board');

  const [headline, subline, label, tone = ''] = boardStatus();
  setText(status, headline);
  setText(detail, subline);
  setText(badge, label);
  status.dataset.tone = tone;
  badge.dataset.tone = tone;

  const rematch = $('#rematch');
  rematch.hidden = !inMatch || !game.result || (mode === 'lan' && (room.closedBy || seatLost));
  rematch.disabled = mode === 'lan' && (!lanReady() || commandPending);
  $('#invite').hidden = !inMatch || mode !== 'lan' || seat?.mark !== 'X' || Boolean(room?.joined || room?.closedBy || seatLost);
  $('#leave-match').disabled = mode === 'lan' && commandPending;
}

function updateGame(next, announce = true) {
  const placedMark = announce && next.board.find((mark, index) => mark && !game.board[index]);
  const newWinner = announce && !game.result && next.result?.winner;
  if (!next.result) stopCelebration();
  game = next;
  render();
  if (placedMark) playSound(placedMark);
  if (newWinner) {
    celebrate(newWinner);
    const playerMark = mode === 'lan' ? seat.mark : 'X';
    playSound(mode === 'duo' || newWinner === playerMark ? 'win' : 'loss', placedMark ? 0.16 : 0);
  }
}

function startMatch(nextMode, level = null, focus = true) {
  mode = nextMode;
  difficulty = level;
  setError('#match-error');
  const labels = {
    solo: [`Solo · ${modeNames[level]}`, 'You (X)', 'Computer (O)'],
    duo: ['Two Players', 'Player X', 'Player O'],
    lan: ['Network Play', seat?.mark === 'X' ? 'You (X)' : 'Host (X)', seat?.mark === 'O' ? 'You (O)' : 'Guest (O)'],
  };
  const [title, x, o] = labels[mode];
  setText($('#match-title'), title);
  setText($('#player-x'), x);
  setText($('#player-o'), o);
  setText($('#leave-match'), mode === 'lan' ? '← Leave Room' : '← Main menu');
  showPanel('match', focus);
  updateGame(room?.game ?? newGame(), false);
}

function selectCell(index) {
  if (!canPlay() || game.board[index]) return;
  unlockSound();
  if (mode === 'lan') {
    roomCommand('move', { index });
    return;
  }

  updateGame(play(game, index, game.turn));
  if (mode !== 'solo' || game.result) return;
  cpuTimer = setTimeout(() => {
    updateGame(play(game, chooseMove(game, difficulty), 'O'));
  }, 330);
}

function replaceQuery(key, value) {
  const url = new URL(location.href);
  url.searchParams.delete('join');
  url.searchParams.delete('room');
  if (key) url.searchParams.set(key, value);
  history.replaceState(key === 'room' ? { seat } : null, '', url);
}

function rememberSeat(value) {
  try {
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // The live connection still works when storage is disabled.
  }
}

function readSeat(code) {
  if (history.state?.seat?.code === code) return history.state.seat;
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    return saved?.code === code ? saved : null;
  } catch {
    return null;
  }
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(`/api/rooms${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new Error('Could not reach the host. Check your connection and try again.');
  }
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
  return data;
}

function showLobby() {
  setError('#lobby-error');
  showPanel('lan');
  render();
}

function goHome() {
  clearTimeout(cpuTimer);
  stopCelebration();
  closeStream();
  if (seat) rememberSeat(null);
  seat = null;
  room = null;
  mode = null;
  seatLost = false;
  commandPending = false;
  replaceQuery();
  showPanel('home');
  updateGame(newGame(), false);
}

function inviteLink() {
  const url = new URL('/', location.href);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && seat.lanAddress) url.hostname = seat.lanAddress;
  url.searchParams.set('join', seat.code);
  return url.href;
}

async function enterRoom(code) {
  if (roomPending) return;
  roomPending = true;
  $('#create-room').disabled = true;
  $('#join-room').disabled = true;
  const back = panels.lan.querySelector('[data-action="back"]');
  back.disabled = true;
  setError('#lobby-error');
  try {
    const data = await post(code ? `/${code}/join` : '', {});
    seat = { code: data.state.code, mark: data.mark, token: data.token, lanAddress: data.lanAddress };
    rememberSeat(seat);
    replaceQuery('room', seat.code);
    openRoom(data.state);
  } catch (error) {
    setError('#lobby-error', error.message);
  } finally {
    roomPending = false;
    $('#create-room').disabled = false;
    $('#join-room').disabled = false;
    back.disabled = false;
  }
}

function closeStream() {
  clearTimeout(streamTimer);
  stream?.close();
  stream = null;
  transportReady = false;
}

function receiveState(next, announce = true) {
  if (next.version < room.version) return;
  const sameRound = next.round === room.round;
  room = next;
  if (room.closedBy) {
    closeStream();
    rememberSeat(null);
    setText($('#leave-match'), '← Main menu');
  }
  updateGame(next.game, announce && sameRound && !next.closedBy);
}

function watchStream(connection) {
  clearTimeout(streamTimer);
  streamTimer = setTimeout(() => {
    if (stream === connection) connectStream();
  }, 13500);
}

function connectStream() {
  closeStream();
  render();
  const activeSeat = seat;
  const connection = new EventSource(`/api/rooms/${seat.code}/events?token=${seat.token}`);
  stream = connection;
  watchStream(connection);
  connection.addEventListener('state', event => {
    if (stream !== connection) return;
    watchStream(connection);
    const firstState = !transportReady;
    transportReady = true;
    if (firstState) setError('#match-error');
    receiveState(JSON.parse(event.data), !firstState);
  });
  connection.addEventListener('ping', () => {
    if (stream !== connection) return;
    watchStream(connection);
    post(`/${activeSeat.code}/heartbeat`, { token: activeSeat.token }).catch(() => {});
  });
  connection.addEventListener('replaced', () => {
    if (stream === connection) loseSeat('This seat is open in another tab.');
  });
  connection.onerror = () => {
    if (stream !== connection) return;
    transportReady = false;
    if (connection.readyState === EventSource.CLOSED) loseSeat('This room is no longer available.');
    else render();
  };
}

function loseSeat(message) {
  closeStream();
  rememberSeat(null);
  seatLost = true;
  setText($('#leave-match'), '← Main menu');
  setError('#match-error', message);
  render();
}

function openRoom(state, focus = true) {
  room = state ?? {
    code: seat.code, version: -1, round: 0, game: newGame(), joined: false,
    connected: { X: false, O: false }, closedBy: null,
  };
  setText($('#room-code'), seat.code);
  $('#invite-url').value = inviteLink();
  setText($('#copy-status'), '');
  startMatch('lan', null, focus);
  connectStream();
}

async function roomCommand(action, payload = {}) {
  if (commandPending || seatLost || room.closedBy) return;
  commandPending = true;
  render();
  setError('#match-error');
  try {
    const state = await post(`/${seat.code}/${action}`, { ...payload, token: seat.token, version: room.version });
    if (action === 'leave') goHome();
    else if (!seatLost) receiveState(state);
  } catch (error) {
    if (action === 'leave' && (error.status === 404 || error.status === 410)) goHome();
    else if (error.status === 404 || error.status === 410) loseSeat(error.message);
    else setError('#match-error', error.message);
  } finally {
    commandPending = false;
    render();
  }
}

async function copyInvite() {
  const field = $('#invite-url');
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(field.value);
    else {
      field.select();
      if (!document.execCommand('copy')) throw new Error();
      $('#copy-link').focus();
    }
    setText($('#copy-status'), 'Invite link copied.');
  } catch {
    field.select();
    setText($('#copy-status'), 'Copy the selected link to share it.');
  }
}

const actions = {
  solo: () => { showPanel('solo'); render(); },
  duo: () => startMatch('duo'),
  lan: showLobby,
  back: goHome,
  create: () => enterRoom(),
  leave: () => {
    if (mode === 'lan' && !room.closedBy && !seatLost) roomCommand('leave');
    else goHome();
  },
  rematch: () => {
    if (mode === 'lan') roomCommand('rematch');
    else updateGame(newGame());
    cells[0].focus();
  },
  copy: copyInvite,
};

function menuSound() {
  unlockSound();
  playSound('menu');
}

for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => {
    menuSound();
    actions[button.dataset.action]();
  });
}
for (const button of document.querySelectorAll('[data-level]')) {
  button.addEventListener('click', () => {
    menuSound();
    startMatch('solo', button.dataset.level);
  });
}

$('.brand').addEventListener('click', event => {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  if (!roomPending) {
    menuSound();
    actions.leave();
  }
});

const soundToggle = $('#sound-toggle');
soundToggle.addEventListener('click', () => {
  const enabled = soundToggle.getAttribute('aria-pressed') !== 'true';
  setSoundEnabled(enabled);
  soundToggle.setAttribute('aria-pressed', String(enabled));
  setText(soundToggle, enabled ? 'Sound On' : 'Sound Off');
  if (enabled) menuSound();
});

$('#join-room').addEventListener('click', menuSound);
$('#join-form').addEventListener('submit', event => {
  event.preventDefault();
  const code = $('#room-input').value.trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    setError('#lobby-error', 'Enter the six-character room code.');
    $('#room-input').focus();
    return;
  }
  enterRoom(code);
});

drawTitle();
const query = new URLSearchParams(location.search);
const requestedCode = query.get('join')?.toUpperCase();
const savedCode = query.get('room');
if (requestedCode && /^[A-Z2-9]{6}$/.test(requestedCode)) {
  showLobby();
  $('#room-input').value = requestedCode;
  enterRoom(requestedCode);
} else if (savedCode && (seat = readSeat(savedCode))) {
  openRoom(null, false);
} else {
  render();
}
