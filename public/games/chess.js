/**
 * chess.js — Complete chess engine with real rules.
 *
 * Supports: castling, en passant, promotion, check, checkmate, stalemate,
 *           fifty-move rule, threefold repetition, insufficient material.
 *
 * Board representation: 8×8 array, [row][col], row 0 = rank 8 (black side).
 * Piece codes: 'wK','wQ','wR','wB','wN','wP' / 'bK','bQ','bR','bB','bN','bP'
 */

// ──────────────── Constants ────────────────
const PIECE_UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};
const PIECE_NAMES = { K: 'الملك', Q: 'الوزير', R: 'الرخ', B: 'الفيل', N: 'الحصان', P: 'الجندي' };
const VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };

// ──────────────── Board init ────────────────
function createChessBoard() {
  const b = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let c = 0; c < 8; c++) {
    b[0][c] = 'b' + back[c];
    b[1][c] = 'bP';
    b[6][c] = 'wP';
    b[7][c] = 'w' + back[c];
  }
  return b;
}

function createChess(players) {
  const board = createChessBoard();
  return {
    type: 'chess',
    players: players.slice(0, 2).map((p, i) => ({
      username: p.username,
      color: i === 0 ? 'white' : 'black',
    })),
    playerColors: Object.fromEntries(
      players.slice(0, 2).map((p, i) => [p.username, i === 0 ? 'white' : 'black'])
    ),
    board,
    turn: 'white',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,        // {row, col} target square or null
    halfmove: 0,            // for fifty-move rule
    fullmove: 1,
    positionHistory: [],    // for threefold repetition
    promotion: null,        // {from,to,row,col,color} awaiting choice
    winner: null,
    winnerUsername: null,
    logs: ['بدأت مباراة الشطرنج'],
    capturedWhite: [],
    capturedBlack: [],
  };
}

// ──────────────── Helpers ────────────────
function pieceColor(p) { return p ? p[0] : null; }    // 'w' or 'b'
function pieceType(p)  { return p ? p[1] : null; }     // 'K','Q','R','B','N','P'
function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
function boardKey(game) {
  return game.board.map(row => row.map(c => c || '.').join('')).join('') +
    game.turn + JSON.stringify(game.castling) + (game.enPassant ? `${game.enPassant.row}${game.enPassant.col}` : '-');
}

// ──────────────── Pseudo-legal moves ────────────────
function pseudoMoves(board, r, c, game) {
  const p = board[r][c];
  if (!p) return [];
  const color = pieceColor(p);
  const type = pieceType(p);
  const moves = [];

  const add = (nr, nc, special) => {
    if (!inBounds(nr, nc)) return;
    const t = board[nr][nc];
    if (t && pieceColor(t) === color) return;
    moves.push({ from: [r, c], to: [nr, nc], capture: !!t, special });
  };

  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc)) {
        const t = board[nr][nc];
        if (t && pieceColor(t) === color) break;
        moves.push({ from: [r, c], to: [nr, nc], capture: !!t });
        if (t) break;
        nr += dr; nc += dc;
      }
    }
  };

  switch (type) {
    case 'P': {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      // Forward 1
      if (inBounds(r + dir, c) && !board[r + dir][c]) {
        moves.push({ from: [r, c], to: [r + dir, c], capture: false });
        // Forward 2
        if (r === startRow && !board[r + 2 * dir][c]) {
          moves.push({ from: [r, c], to: [r + 2 * dir, c], capture: false, special: 'pawn2' });
        }
      }
      // Captures
      for (const dc of [-1, 1]) {
        const nr = r + dir, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const t = board[nr][nc];
        if (t && pieceColor(t) !== color) {
          moves.push({ from: [r, c], to: [nr, nc], capture: true });
        }
        // En passant
        if (game.enPassant && game.enPassant.row === nr && game.enPassant.col === nc) {
          moves.push({ from: [r, c], to: [nr, nc], capture: true, special: 'enpassant' });
        }
      }
      break;
    }
    case 'N': {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        add(r + dr, c + dc);
      }
      break;
    }
    case 'B': slide([[-1,-1],[-1,1],[1,-1],[1,1]]); break;
    case 'R': slide([[-1,0],[1,0],[0,-1],[0,1]]); break;
    case 'Q': slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); break;
    case 'K': {
      for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        add(r + dr, c + dc);
      }
      // Castling
      const castleKey = color === 'w' ? 'w' : 'b';
      const homeRow = color === 'w' ? 7 : 0;
      if (r === homeRow && c === 4 && !isSquareAttacked(board, homeRow, 4, color === 'w' ? 'b' : 'w')) {
        // King-side
        if (game.castling[castleKey + 'K'] &&
            !board[homeRow][5] && !board[homeRow][6] &&
            board[homeRow][7] === color + 'R' &&
            !isSquareAttacked(board, homeRow, 5, color === 'w' ? 'b' : 'w') &&
            !isSquareAttacked(board, homeRow, 6, color === 'w' ? 'b' : 'w')) {
          moves.push({ from: [r, c], to: [homeRow, 6], capture: false, special: 'castleK' });
        }
        // Queen-side
        if (game.castling[castleKey + 'Q'] &&
            !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3] &&
            board[homeRow][0] === color + 'R' &&
            !isSquareAttacked(board, homeRow, 3, color === 'w' ? 'b' : 'w') &&
            !isSquareAttacked(board, homeRow, 2, color === 'w' ? 'b' : 'w')) {
          moves.push({ from: [r, c], to: [homeRow, 2], capture: false, special: 'castleQ' });
        }
      }
      break;
    }
  }
  return moves;
}

// ──────────────── Square attack detection ────────────────
function isSquareAttacked(board, r, c, byColor) {
  // Pawn attacks
  const pdir = byColor === 'w' ? 1 : -1; // attacker pawn is below if white
  for (const dc of [-1, 1]) {
    const pr = r + pdir, pc = c + dc;
    if (inBounds(pr, pc) && board[pr][pc] === byColor + 'P') return true;
  }
  // Knight
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === byColor + 'N') return true;
  }
  // King
  for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === byColor + 'K') return true;
  }
  // Sliding: bishop/queen (diagonal)
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const t = board[nr][nc];
      if (t) {
        if (pieceColor(t) === byColor && (pieceType(t) === 'B' || pieceType(t) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  // Sliding: rook/queen (orthogonal)
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const t = board[nr][nc];
      if (t) {
        if (pieceColor(t) === byColor && (pieceType(t) === 'R' || pieceType(t) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === color + 'K') return [r, c];
  return null;
}

function isInCheck(board, color) {
  const k = findKing(board, color);
  if (!k) return false;
  return isSquareAttacked(board, k[0], k[1], color === 'w' ? 'b' : 'w');
}

// ──────────────── Legal moves (filter pseudo-legal) ────────────────
function legalMoves(game, r, c) {
  const p = game.board[r][c];
  if (!p || pieceColor(p) !== game.turn[0]) return [];
  const pm = pseudoMoves(game.board, r, c, game);
  return pm.filter(m => {
    const sim = simulateMove(game.board, m);
    return !isInCheck(sim, pieceColor(p));
  });
}

function simulateMove(board, move) {
  const b = board.map(row => [...row]);
  const [fr, fc] = move.from, [tr, tc] = move.to;
  const p = b[fr][fc];
  b[tr][tc] = p;
  b[fr][fc] = null;
  if (move.special === 'enpassant') {
    b[fr][tc] = null; // remove captured pawn
  }
  if (move.special === 'castleK') {
    b[fr][5] = b[fr][7]; b[fr][7] = null;
  }
  if (move.special === 'castleQ') {
    b[fr][3] = b[fr][0]; b[fr][0] = null;
  }
  return b;
}

function allLegalMoves(game, color) {
  const moves = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = game.board[r][c];
      if (p && pieceColor(p) === color[0]) {
        const savedTurn = game.turn;
        game.turn = color;
        const ms = legalMoves(game, r, c);
        game.turn = savedTurn;
        moves.push(...ms);
      }
    }
  return moves;
}

// ──────────────── Apply action ────────────────
function applyChessAction(game, action, actor) {
  const color = game.playerColors[actor];
  if (!color || game.turn !== color || game.winner) return null;

  // Handle promotion choice
  if (action.kind === 'promote' && game.promotion) {
    const { to, from, piece } = game.promotion;
    const choice = ['Q', 'R', 'B', 'N'].includes(action.piece) ? action.piece : 'Q';
    game.board[to[0]][to[1]] = color[0] + choice;
    game.logs.unshift(`${actor} رقّى الجندي إلى ${PIECE_NAMES[choice]}`);
    game.promotion = null;
    game.halfmove = 0;
    finalizeTurn(game, color);
    checkGameEnd(game);
    return game;
  }

  if (action.kind !== 'move') return null;

  const [fr, fc] = action.from;
  const [tr, tc] = action.to;
  const p = game.board[fr][fc];
  if (!p || pieceColor(p) !== color[0]) return null;

  const legal = legalMoves(game, fr, fc);
  const move = legal.find(m => m.to[0] === tr && m.to[1] === tc);
  if (!move) return null;

  // Check for promotion
  if (pieceType(p) === 'P' && (tr === 0 || tr === 7)) {
    game.promotion = { from: action.from, to: action.to, color };
    // Temporarily move the pawn
    game.board[tr][tc] = p;
    game.board[fr][fc] = null;
    if (move.capture) {
      const cap = color === 'white' ? game.capturedBlack : game.capturedWhite;
      cap.push(game.board[tr][tc]?.[1] || 'P');
    }
    game.logs.unshift(`${actor} حرّك جندي للترقية`);
    return game; // Waiting for promote choice
  }

  // Execute the move
  const captured = game.board[tr][tc];
  game.board[tr][tc] = p;
  game.board[fr][fc] = null;

  if (move.special === 'enpassant') {
    game.board[fr][tc] = null;
    (color === 'white' ? game.capturedBlack : game.capturedWhite).push('P');
  } else if (captured) {
    (color === 'white' ? game.capturedBlack : game.capturedWhite).push(pieceType(captured));
  }

  // Castling rook move
  if (move.special === 'castleK') {
    game.board[fr][5] = game.board[fr][7]; game.board[fr][7] = null;
    game.logs.unshift(`${actor} قلع الملك`);
  } else if (move.special === 'castleQ') {
    game.board[fr][3] = game.board[fr][0]; game.board[fr][0] = null;
    game.logs.unshift(`${actor} قلع الوزير`);
  }

  // Update castling rights
  if (pieceType(p) === 'K') {
    if (color === 'white') { game.castling.wK = false; game.castling.wQ = false; }
    else { game.castling.bK = false; game.castling.bQ = false; }
  }
  if (pieceType(p) === 'R') {
    if (color === 'white') {
      if (fr === 7 && fc === 0) game.castling.wQ = false;
      if (fr === 7 && fc === 7) game.castling.wK = false;
    } else {
      if (fr === 0 && fc === 0) game.castling.bQ = false;
      if (fr === 0 && fc === 7) game.castling.bK = false;
    }
  }
  // Rook captured?
  if (tr === 7 && tc === 0) game.castling.wQ = false;
  if (tr === 7 && tc === 7) game.castling.wK = false;
  if (tr === 0 && tc === 0) game.castling.bQ = false;
  if (tr === 0 && tc === 7) game.castling.bK = false;

  // En passant target
  if (move.special === 'pawn2') {
    const epRow = (fr + tr) / 2;
    game.enPassant = { row: epRow, col: fc };
  } else {
    game.enPassant = null;
  }

  // Half-move clock
  if (pieceType(p) === 'P' || captured) game.halfmove = 0;
  else game.halfmove++;

  // Log
  const fromSq = String.fromCharCode(97 + fc) + (8 - fr);
  const toSq = String.fromCharCode(97 + tc) + (8 - tr);
  game.logs.unshift(`${actor}: ${fromSq}→${toSq}${captured ? ' (أسر)' : ''}`);

  finalizeTurn(game, color);
  checkGameEnd(game);
  return game;
}

function finalizeTurn(game, color) {
  game.turn = color === 'white' ? 'black' : 'white';
  if (color === 'black') game.fullmove++;
  game.positionHistory.push(boardKey(game));
}

function checkGameEnd(game) {
  const moves = allLegalMoves(game, game.turn);
  const inCheck = isInCheck(game.board, game.turn[0]);

  if (moves.length === 0) {
    if (inCheck) {
      const winner = game.turn === 'white' ? 'black' : 'white';
      game.winner = winner;
      game.winnerUsername = Object.entries(game.playerColors).find(([, c]) => c === winner)?.[0];
      game.logs.unshift(`كش ملك! فاز ${game.winnerUsername}`);
    } else {
      game.winner = 'draw';
      game.logs.unshift('تعادل (ستيل ميت)');
    }
    return;
  }

  // Fifty-move rule
  if (game.halfmove >= 100) {
    game.winner = 'draw';
    game.logs.unshift('تعادل (قاعدة الـ50 نقلة)');
    return;
  }

  // Threefold repetition
  const current = boardKey(game);
  const count = game.positionHistory.filter(k => k === current).length;
  if (count >= 3) {
    game.winner = 'draw';
    game.logs.unshift('تعادل (تكرار 3 مرات)');
    return;
  }

  // Insufficient material
  if (isInsufficientMaterial(game.board)) {
    game.winner = 'draw';
    game.logs.unshift('تعادل (مادة غير كافية)');
    return;
  }
}

function isInsufficientMaterial(board) {
  const pieces = { w: [], b: [] };
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && pieceType(p) !== 'K') pieces[pieceColor(p)].push(pieceType(p));
    }
  const w = pieces.w, b = pieces.b;
  // K vs K
  if (w.length === 0 && b.length === 0) return true;
  // K+minor vs K
  if (w.length <= 1 && ['B', 'N'].includes(w[0]) && b.length === 0) return true;
  if (b.length <= 1 && ['B', 'N'].includes(b[0]) && w.length === 0) return true;
  // K+B vs K+B same color
  if (w.length === 1 && b.length === 1 && w[0] === 'B' && b[0] === 'B') return true;
  return false;
}

// ──────────────── Render ────────────────
function renderChess(game, me_, playAction) {
  const myColor = game.playerColors[me_];
  const turnUser = Object.entries(game.playerColors).find(([, c]) => c === game.turn)?.[0] || game.turn;
  const inCheck = isInCheck(game.board, game.turn[0]);
  const checkSquare = inCheck ? findKing(game.board, game.turn[0]) : null;
  let selSq = window._chessSel || null;
  let legal = selSq ? legalMoves(game, selSq[0], selSq[1]) : [];

  const files = ['a','b','c','d','e','f','g','h'];

  let html = `<div class="chess-wrap">
    <div class="turn">الدور: ${turnUser}${inCheck ? ' — كش!' : ''}${game.winner ? ` — ${game.winner === 'draw' ? 'تعادل' : 'فاز: ' + game.winnerUsername}` : ''}</div>`;

  // Promotion picker
  if (game.promotion && game.promotion.color === myColor) {
    html += `<div class="promo-bar">اختر الترقية:
      <button onclick="chessPromote('Q')">♕ وزير</button>
      <button onclick="chessPromote('R')">♖ رخ</button>
      <button onclick="chessPromote('B')">♗ فيل</button>
      <button onclick="chessPromote('N')">♘ حصان</button>
    </div>`;
  }

  // Captured pieces
  html += `<div class="captured-row">
    <span>أسر الأبيض: ${game.capturedWhite.map(p => PIECE_UNICODE['b' + p]).join(' ')}</span>
    <span>أسر الأسود: ${game.capturedBlack.map(p => PIECE_UNICODE['w' + p]).join(' ')}</span>
  </div>`;

  // Board
  html += '<div class="chess-board">';
  const displayRows = myColor === 'black' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const displayCols = myColor === 'black' ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  for (const r of displayRows) {
    for (const c of displayCols) {
      const p = game.board[r][c];
      const isLight = (r + c) % 2 === 0;
      const isSel = selSq && selSq[0] === r && selSq[1] === c;
      const isLegal = legal.some(m => m.to[0] === r && m.to[1] === c);
      const isCheck = checkSquare && checkSquare[0] === r && checkSquare[1] === c;
      let cls = 'sq ' + (isLight ? 'light' : 'dark');
      if (isSel) cls += ' sel';
      if (isLegal) cls += ' legal';
      if (isCheck) cls += ' check-sq';
      const pieceHtml = p ? `<span class="pc ${pieceColor(p)}">${PIECE_UNICODE[p]}</span>` : '';
      html += `<div class="${cls}" data-r="${r}" data-c="${c}">${pieceHtml}${isLegal ? '<div class="dot"></div>' : ''}</div>`;
    }
  }
  html += '</div>';

  // Coordinates
  html += `<div class="chess-coords">${myColor === 'black' ? files.slice().reverse().join(' ') : files.join(' ')}</div>`;

  // Log
  html += `<div class="log">${game.logs.slice(0, 12).map(x => `<div class="log-item">${x}</div>`).join('')}</div>`;
  html += '</div>';

  document.getElementById('gameMount').innerHTML = html;

  // Click handlers
  document.querySelectorAll('.chess-board .sq').forEach(sq => {
    sq.onclick = () => {
      if (game.winner || game.promotion) return;
      const r = +sq.dataset.r, c = +sq.dataset.c;
      const p = game.board[r][c];
      const myTurn = game.turn === myColor;

      if (selSq && legal.some(m => m.to[0] === r && m.to[1] === c)) {
        playAction({ kind: 'move', from: selSq, to: [r, c] });
        window._chessSel = null;
        return;
      }
      if (p && pieceColor(p) === myColor[0] && myTurn) {
        window._chessSel = [r, c];
        renderChess(game, me_, playAction);
      } else {
        window._chessSel = null;
        renderChess(game, me_, playAction);
      }
    };
  });

  window.chessPromote = (piece) => playAction({ kind: 'promote', piece });
}

if (typeof window !== 'undefined') {
  window.ChessEngine = { createChess, applyChessAction, legalMoves, isInCheck, renderChess };
}
if (typeof module !== 'undefined') module.exports = { createChess, applyChessAction, legalMoves, isInCheck };
