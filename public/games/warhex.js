/**
 * warhex.js — Warhex hex-grid strategy game.
 * Hex board (axial coordinates), soldiers + commander.
 * Win by capturing enemy commander or reaching the center with your commander.
 */
const ROW_SIZES = [4, 5, 6, 7, 6, 5, 4];

function createWarhex(players) {
  const cells = [];
  ROW_SIZES.forEach((size, row) => {
    const start = -Math.floor(size / 2);
    for (let i = 0; i < size; i++) {
      const q = start + i, r = row - 3;
      cells.push({ id: `${q},${r}`, q, r, row, isCenter: q === 0 && r === 0 });
    }
  });

  const pieces = {
    '-1,-3': { side: 'red', type: 'soldier' },
    '0,-3':  { side: 'red', type: 'soldier' },
    '1,-3':  { side: 'red', type: 'soldier' },
    '2,-3':  { side: 'red', type: 'soldier' },
    '-2,-2': { side: 'red', type: 'soldier' },
    '0,-2':  { side: 'red', type: 'commander' },
    '2,-2':  { side: 'red', type: 'soldier' },
    '-2,2':  { side: 'blue', type: 'soldier' },
    '0,2':   { side: 'blue', type: 'commander' },
    '2,2':   { side: 'blue', type: 'soldier' },
    '-1,3':  { side: 'blue', type: 'soldier' },
    '0,3':   { side: 'blue', type: 'soldier' },
    '1,3':   { side: 'blue', type: 'soldier' },
    '-3,3':  { side: 'blue', type: 'soldier' },
  };

  return {
    type: 'warhex',
    players: players.slice(0, 2).map((p, i) => ({ username: p.username, side: i === 0 ? 'blue' : 'red' })),
    playerColors: Object.fromEntries(
      players.slice(0, 2).map((p, i) => [p.username, i === 0 ? 'blue' : 'red'])
    ),
    cells,
    pieces,
    turn: 'blue',
    winner: null,
    winnerUsername: null,
    logs: ['بدأت مباراة Warhex'],
  };
}

function warNeighbors(cell, cells) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  return dirs.map(([dq, dr]) => `${cell.q + dq},${cell.r + dr}`)
    .filter(id => cells.some(c => c.id === id));
}

function warMoves(game, cellId) {
  const piece = game.pieces[cellId];
  if (!piece) return [];
  const cell = game.cells.find(c => c.id === cellId);
  return warNeighbors(cell, game.cells).filter(id =>
    !game.pieces[id] || game.pieces[id].side !== piece.side
  );
}

function applyWarhexAction(game, action, actor) {
  const color = game.playerColors[actor];
  if (!color || game.turn !== color || game.winner) return null;
  const moving = game.pieces[action.from];
  if (!moving || moving.side !== color) return null;
  if (!warMoves(game, action.from).includes(action.to)) return null;

  const target = game.pieces[action.to];

  if (target?.type === 'commander') {
    delete game.pieces[action.to];
    game.pieces[action.to] = moving;
    delete game.pieces[action.from];
    game.winner = color;
    game.winnerUsername = actor;
    game.logs.unshift(`${actor} أسر القائد! فاز`);
    return game;
  }

  if (target) {
    delete game.pieces[action.to];
    game.logs.unshift(`${actor} أسر قطعة`);
  } else {
    game.logs.unshift(`${actor} تحرك ${action.from} ← ${action.to}`);
  }

  game.pieces[action.to] = moving;
  delete game.pieces[action.from];

  if (game.pieces[action.to].type === 'commander' && action.to === '0,0') {
    game.winner = color;
    game.winnerUsername = actor;
    game.logs.unshift(`${actor} وصل القائد للقلب! فاز`);
    return game;
  }

  game.turn = game.turn === 'blue' ? 'red' : 'blue';
  return game;
}

function renderWarhex(game, me_, playAction) {
  const myColor = game.playerColors[me_];
  const turnUser = Object.entries(game.playerColors).find(([, c]) => c === game.turn)?.[0] || game.turn;
  const sel = window._warSel || null;
  const valid = sel ? warMoves(game, sel) : [];

  let html = `<div class="warhex-wrap">
    <div class="turn">الدور: ${turnUser} ${game.winner ? `• فاز: ${game.winnerUsername}` : ''}</div>
    <div id="warBoard" class="board"></div>
    <div class="log">${game.logs.slice(0, 10).map(x => `<div class="log-item">${x}</div>`).join('')}</div>
  </div>`;

  document.getElementById('gameMount').innerHTML = html;

  const board = document.getElementById('warBoard');
  ROW_SIZES.forEach((size, row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'board-row';
    game.cells.filter(c => c.row === row).forEach(cell => {
      const piece = game.pieces[cell.id];
      const hex = document.createElement('div');
      hex.className = 'hex' +
        (cell.id === sel ? ' sel' : '') +
        (valid.includes(cell.id) ? ' move' : '') +
        (cell.isCenter ? ' center' : '');
      hex.innerHTML = `<div class="cell-id">${cell.id}</div>${piece
        ? `<div class="piece ${piece.side}${piece.type === 'commander' ? ' commander' : ''}">${piece.type === 'commander' ? '♛' : '✦'}</div>`
        : ''}`;
      hex.onclick = () => {
        if (game.winner) return;
        if (sel && valid.includes(cell.id)) {
          playAction({ from: sel, to: cell.id });
          window._warSel = null;
          return;
        }
        if (piece && piece.side === myColor && game.turn === myColor) {
          window._warSel = cell.id;
          renderWarhex(game, me_, playAction);
        } else {
          window._warSel = null;
          renderWarhex(game, me_, playAction);
        }
      };
      rowEl.appendChild(hex);
    });
    board.appendChild(rowEl);
  });
}

if (typeof window !== 'undefined') {
  window.WarhexEngine = { createWarhex, applyWarhexAction, warMoves, renderWarhex };
}
