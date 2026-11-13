export const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export function newGame() {
  return { board: Array(9).fill(null), turn: 'X', result: null };
}

export function evaluate(board) {
  const line = WINNING_LINES.find(([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c]);
  if (line) return { winner: board[line[0]], line };
  return board.every(Boolean) ? { winner: null, line: [] } : null;
}

export function play(game, index, player) {
  if (game.result || player !== game.turn || !Number.isInteger(index) || index < 0 || index >= 9 || game.board[index]) {
    return null;
  }

  const board = game.board.slice();
  board[index] = player;
  const result = evaluate(board);
  return { board, result, turn: result ? null : player === 'X' ? 'O' : 'X' };
}

function openCells(board) {
  return board.flatMap((mark, index) => mark ? [] : [index]);
}

function minimax(game, depth) {
  if (game.result) {
    if (game.result.winner === 'O') return 10 - depth;
    if (game.result.winner === 'X') return depth - 10;
    return 0;
  }

  const scores = openCells(game.board).map(index => minimax(play(game, index, game.turn), depth + 1));
  return game.turn === 'O' ? Math.max(...scores) : Math.min(...scores);
}

export function chooseMove(game, difficulty, random = Math.random) {
  if (game.result || game.turn !== 'O') return null;
  const choices = openCells(game.board);

  if (difficulty === 'medium') {
    for (const mark of ['O', 'X']) {
      const candidate = choices.find(index => {
        const board = game.board.slice();
        board[index] = mark;
        return evaluate(board)?.winner === mark;
      });
      if (candidate !== undefined) return candidate;
    }
  }

  if (difficulty === 'hard') {
    let best = -Infinity;
    let choice = null;
    for (const index of choices) {
      const score = minimax(play(game, index, 'O'), 1);
      if (score > best) {
        best = score;
        choice = index;
      }
    }
    return choice;
  }

  return choices[Math.floor(random() * choices.length)];
}
