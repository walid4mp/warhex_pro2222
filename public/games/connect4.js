/**
 * connect4.js — Connect 4 game engine.
 * 6×7 grid, gravity drop, first to align 4 wins.
 */

function createConnect4(players) {
  return {
    type: 'connect4',
    players: players.slice(0, 2).map((p, i) => ({ username: p.username, disc: i ? 2 : 1 })),
    playerColors: Object.fromEntries(
      players.slice(0, 2).map((p, i) => [p.username, i ? 'yellow' : 'red'])
    ),
    turn: 1,
    grid: Array.from({ length: 6 }, () => Array(7).fill(0)),
    winner: null,
    winnerUsername: null,
    logs: ['بدأت مباراة Connect 4'],
  };
}

function c4CheckWin(grid, r, c) {
  const v = grid[r][c];
  if (!v) return false;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return dirs.some(([dr, dc]) => {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s, cc = c + dc * s;
      while (grid[rr]?.[cc] === v) { n++; rr += dr * s; cc += dc * s; }
    }
    return n >= 4;
  });
}

function isC4Draw(grid) {
  return grid.every(row => row.every(cell => cell !== 0));
}

function applyConnect4Action(game, action, actor) {
  const player = game.players.find(p => p.username === actor);
  if (!player || player.disc !== game.turn || game.winner) return null;

  const col = action.col;
  if (col < 0 || col > 6) return null;

  let row = -1;
  for (let r = 5; r >= 0; r--) {
    if (game.grid[r][col] === 0) { row = r; break; }
  }
  if (row < 0) return null; // column full

  game.grid[row][col] = player.disc;
  game.logs.unshift(`${actor} لعب عمود ${col + 1}`);

  if (c4CheckWin(game.grid, row, col)) {
    game.winner = player.disc;
    game.winnerUsername = actor;
    game.logs.unshift(`${actor} فاز! أربعة في صف`);
  } else if (isC4Draw(game.grid)) {
    game.winner = 'draw';
    game.logs.unshift('تعادل! امتلأت الرقعة');
  } else {
    game.turn = game.turn === 1 ? 2 : 1;
  }
  return game;
}

function renderConnect4(game, me_, playAction) {
  const current = game.players.find(p => p.disc === game.turn)?.username || '-';
  const myDisc = game.players.find(p => p.username === me_)?.disc;

  let html = `<div class="connect4-wrap">
    <div class="turn">الدور: ${current} ${game.winner ? `• ${game.winner === 'draw' ? 'تعادل' : 'فاز: ' + game.winnerUsername}` : ''}</div>
    <div id="c4" class="connect-grid"></div>
    <div class="log">${game.logs.slice(0, 10).map(x => `<div class="log-item">${x}</div>`).join('')}</div>
  </div>`;

  document.getElementById('gameMount').innerHTML = html;

  const grid = document.getElementById('c4');
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const cell = document.createElement('div');
      cell.className = 'connect-cell';
      cell.innerHTML = `<div class="disc ${game.grid[r][c] === 1 ? 'red' : game.grid[r][c] === 2 ? 'yellow' : ''}"></div>`;
      cell.onclick = () => {
        if (!game.winner && myDisc === game.turn) {
          playAction({ col: c });
        }
      };
      grid.appendChild(cell);
    }
  }
}

if (typeof window !== 'undefined') {
  window.Connect4Engine = { createConnect4, applyConnect4Action, renderConnect4 };
}
