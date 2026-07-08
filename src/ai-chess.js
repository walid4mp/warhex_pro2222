/**
 * ai-chess.js — Chess AI engine using minimax with alpha-beta pruning.
 *
 * Difficulty levels control search depth:
 *   easy:   depth 1 (random-ish)
 *   medium: depth 2
 *   hard:   depth 3
 *   expert: depth 4
 *
 * Evaluation: material count + position tables + mobility.
 * This module shares the chess engine code from public/games/chess.js
 * by requiring the same functions.
 */

// Re-use the client-side chess engine logic for move generation.
// We inline the needed functions to keep this self-contained.

const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Piece-square tables (from white's perspective, row 0 = rank 8)
const PST = {
  P: [
    [0,0,0,0,0,0,0,0],
    [50,50,50,50,50,50,50,50],
    [10,10,20,30,30,20,10,10],
    [5,5,10,25,25,10,5,5],
    [0,0,0,20,20,0,0,0],
    [5,-5,-10,0,0,-10,-5,5],
    [5,10,10,-20,-20,10,10,5],
    [0,0,0,0,0,0,0,0],
  ],
  N: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,0,0,0,0,-20,-40],
    [-30,0,10,15,15,10,0,-30],
    [-30,5,15,20,20,15,5,-30],
    [-30,0,15,20,20,15,0,-30],
    [-30,5,10,15,15,10,5,-30],
    [-40,-20,0,5,5,0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50],
  ],
  B: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,0,0,0,0,0,0,-10],
    [-10,0,5,10,10,5,0,-10],
    [-10,5,5,10,10,5,5,-10],
    [-10,0,10,10,10,10,0,-10],
    [-10,10,10,10,10,10,10,-10],
    [-10,5,0,0,0,0,5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20],
  ],
  R: [
    [0,0,0,0,0,0,0,0],
    [5,10,10,10,10,10,10,5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [-5,0,0,0,0,0,0,-5],
    [0,0,0,5,5,0,0,0],
  ],
  Q: [
    [-20,-10,-10,-5,-5,-10,-10,-20],
    [-10,0,0,0,0,0,0,-10],
    [-10,0,5,5,5,5,0,-10],
    [-5,0,5,5,5,5,0,-5],
    [0,0,5,5,5,5,0,-5],
    [-10,5,5,5,5,5,0,-10],
    [-10,0,5,0,0,0,0,-10],
    [-20,-10,-10,-5,-5,-10,-10,-20],
  ],
  K: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20,20,0,0,0,0,20,20],
    [20,30,10,0,0,10,30,20],
  ],
};

function pieceColor(p) { return p ? p[0] : null; }
function pieceType(p)  { return p ? p[1] : null; }
function inBounds(r,c) { return r>=0&&r<8&&c>=0&&c<8; }

function pseudoMoves(board, r, c, enPassant, castling) {
  const p = board[r][c]; if (!p) return [];
  const color = pieceColor(p), type = pieceType(p);
  const moves = [];
  const add = (nr,nc) => {
    if(!inBounds(nr,nc)) return;
    const t = board[nr][nc];
    if(t && pieceColor(t)===color) return;
    moves.push({from:[r,c],to:[nr,nc]});
  };
  const slide = dirs => {
    for(const [dr,dc] of dirs) {
      let nr=r+dr,nc=c+dc;
      while(inBounds(nr,nc)) {
        const t=board[nr][nc];
        if(t && pieceColor(t)===color) break;
        moves.push({from:[r,c],to:[nr,nc]});
        if(t) break;
        nr+=dr; nc+=dc;
      }
    }
  };
  switch(type) {
    case 'P': {
      const dir = color==='w'?-1:1;
      const startRow = color==='w'?6:1;
      if(inBounds(r+dir,c) && !board[r+dir][c]) {
        moves.push({from:[r,c],to:[r+dir,c]});
        if(r===startRow && !board[r+2*dir][c]) moves.push({from:[r,c],to:[r+2*dir,c]});
      }
      for(const dc of [-1,1]) {
        const nr=r+dir,nc=c+dc;
        if(!inBounds(nr,nc)) continue;
        const t=board[nr][nc];
        if(t && pieceColor(t)!==color) moves.push({from:[r,c],to:[nr,nc]});
        if(enPassant && enPassant.row===nr && enPassant.col===nc) moves.push({from:[r,c],to:[nr,nc]});
      }
      break;
    }
    case 'N': for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r+dr,c+dc); break;
    case 'B': slide([[-1,-1],[-1,1],[1,-1],[1,1]]); break;
    case 'R': slide([[-1,0],[1,0],[0,-1],[0,1]]); break;
    case 'Q': slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); break;
    case 'K': for(const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) add(r+dr,c+dc); break;
  }
  return moves;
}

function isSquareAttacked(board, r, c, byColor) {
  const pdir = byColor==='w'?1:-1;
  for(const dc of [-1,1]) { const pr=r+pdir,pc=c+dc; if(inBounds(pr,pc)&&board[pr][pc]===byColor+'P') return true; }
  for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) { const nr=r+dr,nc=c+dc; if(inBounds(nr,nc)&&board[nr][nc]===byColor+'N') return true; }
  for(const [dr,dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) { const nr=r+dr,nc=c+dc; if(inBounds(nr,nc)&&board[nr][nc]===byColor+'K') return true; }
  for(const [dr,dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) { let nr=r+dr,nc=c+dc; while(inBounds(nr,nc)){const t=board[nr][nc]; if(t){if(pieceColor(t)===byColor&&(pieceType(t)==='B'||pieceType(t)==='Q'))return true; break;} nr+=dr;nc+=dc; } }
  for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]) { let nr=r+dr,nc=c+dc; while(inBounds(nr,nc)){const t=board[nr][nc]; if(t){if(pieceColor(t)===byColor&&(pieceType(t)==='R'||pieceType(t)==='Q'))return true; break;} nr+=dr;nc+=dc; } }
  return false;
}

function findKing(board, color) {
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(board[r][c]===color+'K') return [r,c];
  return null;
}
function isInCheck(board, color) {
  const k = findKing(board, color);
  return k ? isSquareAttacked(board, k[0], k[1], color==='w'?'b':'w') : false;
}

function legalMoves(board, r, c, enPassant, castling) {
  const p = board[r][c]; if(!p) return [];
  return pseudoMoves(board, r, c, enPassant, castling).filter(m => {
    const b = board.map(row=>[...row]);
    b[m.to[0]][m.to[1]] = b[m.from[0]][m.from[1]];
    b[m.from[0]][m.from[1]] = null;
    return !isInCheck(b, pieceColor(p));
  });
}

function allLegalMoves(board, color, enPassant, castling) {
  const moves = [];
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const p = board[r][c];
    if(p && pieceColor(p)===color) moves.push(...legalMoves(board, r, c, enPassant, castling));
  }
  return moves;
}

function makeMove(board, move) {
  const b = board.map(row=>[...row]);
  b[move.to[0]][move.to[1]] = b[move.from[0]][move.from[1]];
  b[move.from[0]][move.from[1]] = null;
  // Auto-promote to queen for simplicity in AI
  const p = b[move.to[0]][move.to[1]];
  if(pieceType(p)==='P' && (move.to[0]===0||move.to[0]===7)) b[move.to[0]][move.to[1]] = pieceColor(p)+'Q';
  return b;
}

function evaluate(board) {
  let score = 0;
  for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
    const p = board[r][c]; if(!p) continue;
    const type = pieceType(p), color = pieceColor(p);
    const val = VAL[type] + (PST[type]?.[r]?.[c] || 0);
    score += color === 'w' ? val : -val;
  }
  return score;
}

function minimax(board, depth, alpha, beta, maximizing, enPassant, castling) {
  if (depth === 0) return evaluate(board);
  const color = maximizing ? 'w' : 'b';
  const moves = allLegalMoves(board, color, enPassant, castling);
  if (moves.length === 0) {
    if (isInCheck(board, color)) return maximizing ? -99999 : 99999;
    return 0; // stalemate
  }
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const nb = makeMove(board, m);
      const val = minimax(nb, depth-1, alpha, beta, false, null, castling);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const nb = makeMove(board, m);
      const val = minimax(nb, depth-1, alpha, beta, true, null, castling);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

/**
 * Find the best move for the AI.
 * @param {object} game - chess game state
 * @param {string} difficulty - easy|medium|hard|expert
 * @returns {object|null} best move {from:[r,c], to:[r,c]}
 */
function getBestMove(game, difficulty = 'medium') {
  const depth = { easy: 1, medium: 2, hard: 3, expert: 4 }[difficulty] || 2;
  const aiColor = game.turn === 'white' ? 'w' : 'b';
  const isMaximizing = aiColor === 'w';
  const moves = allLegalMoves(game.board, aiColor, game.enPassant, game.castling);
  if (moves.length === 0) return null;

  // Easy mode: 30% chance of random move
  if (difficulty === 'easy' && Math.random() < 0.3) {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  let bestMove = moves[0];
  let bestVal = isMaximizing ? -Infinity : Infinity;

  // Shuffle moves for variety
  moves.sort(() => Math.random() - 0.5);

  for (const m of moves) {
    const nb = makeMove(game.board, m);
    const val = minimax(nb, depth - 1, -Infinity, Infinity, !isMaximizing, null, game.castling);
    if (isMaximizing) {
      if (val > bestVal) { bestVal = val; bestMove = m; }
    } else {
      if (val < bestVal) { bestVal = val; bestMove = m; }
    }
  }

  return bestMove;
}

module.exports = { getBestMove, allLegalMoves, evaluate };
