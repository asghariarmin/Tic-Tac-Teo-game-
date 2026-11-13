import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseMove, evaluate, newGame, play } from '../public/game.js';

function position(moves) {
  return moves.reduce((game, index) => play(game, index, game.turn), newGame());
}

test('detects each winning row, column, and diagonal for both marks', () => {
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  for (const line of lines) {
    for (const winner of ['X', 'O']) {
      const board = newGame().board;
      for (const index of line) board[index] = winner;
      assert.deepEqual(evaluate(board), { winner, line });
    }
  }
});

test('rejects invalid moves and stops after either terminal result', () => {
  const initial = newGame();
  for (const index of [-1, 9, 0.5, '0', null]) assert.equal(play(initial, index, 'X'), null);
  assert.equal(play(initial, 0, 'O'), null);
  const next = play(initial, 0, 'X');
  assert.deepEqual(initial, newGame());
  assert.equal(play(next, 0, 'O'), null);
  const win = position([0, 3, 1, 4, 2]);
  assert.deepEqual(win.result, { winner: 'X', line: [0, 1, 2] });
  assert.equal(play(win, 5, 'O'), null);
  const draw = position([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.deepEqual(draw.result, { winner: null, line: [] });
  assert.equal(draw.turn, null);
  assert.equal(play(draw, 0, 'O'), null);
});

test('Easy samples open cells; Medium wins, blocks, then falls back to random', () => {
  const opening = position([4]);
  assert.equal(chooseMove(opening, 'easy', () => 0), 0);
  assert.equal(chooseMove(opening, 'easy', () => 0.999), 8);
  assert.equal(chooseMove(opening, 'medium', () => 0.999), 8);
  assert.equal(chooseMove(position([0, 3, 1, 4, 8]), 'medium'), 5);
  assert.equal(chooseMove(position([0, 4, 1]), 'medium'), 2);
  assert.equal(chooseMove(newGame(), 'hard'), null);
});

test('Hard cannot lose against any sequence of human moves', () => {
  const outcomes = { O: 0, draw: 0 };
  function explore(game) {
    if (game.result) {
      assert.notEqual(game.result.winner, 'X');
      outcomes[game.result.winner ?? 'draw'] += 1;
    } else if (game.turn === 'O') {
      const next = play(game, chooseMove(game, 'hard'), 'O');
      assert.ok(next);
      explore(next);
    } else {
      game.board.forEach((mark, index) => {
        if (!mark) explore(play(game, index, 'X'));
      });
    }
  }
  explore(newGame());
  assert.ok(outcomes.O > 0 && outcomes.draw > 0);
});
