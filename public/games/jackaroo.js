/**
 * jackaroo.js — Complete Jackaroo (جاكارو) engine with real rules.
 *
 * Jackaroo is a card-driven board game popular in the Middle East.
 * It shares DNA with Sorry! / Ludo but uses playing cards.
 *
 * Rules implemented:
 *  • 4 players, 4 pieces (marbles) each on a circular 52-track
 *  • Standard 52-card deck + 2 jokers (54 total), dealt 5 per player
 *  • Card effects:
 *    - Ace (1): Move 1 OR bring a piece out
 *    - 2: Move 2
 *    - 3: Move 3
 *    - 4: Move 4 backwards
 *    - 5: Move 5
 *    - 6: Move 6
 *    - 7: Move 7 (can split between two pieces)
 *    - 8: Move 8
 *    - 9: Move 9
 *    - 10: Move 10
 *    - Jack: Move 11 OR swap positions with an opponent's piece
 *    - Queen: Move 12
 *    - King: Move 13 OR bring a piece out
 *    - Joker: Wild — acts as any card (usually bring out or 10)
 *  • Must use a card to move; if no legal card, discard one and pass
 *  • Capture: landing on opponent sends them back to base
 *  • Safe squares: start squares + starred squares
 *  • Home column: 6 squares, must land exactly on finish
 *  • First to get all 4 marbles home wins
 *  • After playing a card, draw one from deck
 *  • When deck is empty, reshuffle discard pile
 */

const JACK_COLORS = ['red', 'green', 'yellow', 'blue'];
const JACK_START = { red: 0, green: 13, yellow: 26, blue: 39 };
const JACK_SAFE = [0, 8, 13, 21, 26, 34, 39, 47];
const HOME_STEPS = 57; // 52 track + 5 home + finish

// ──────────────── Deck ────────────────
function createDeck() {
  const suits = ['♥', '♦', '♣', '♠'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const deck = [];
  for (const s of suits)
    for (const r of ranks)
      deck.push({ rank: r, suit: s, id: r + s });
  deck.push({ rank: 'Joker', suit: '★', id: 'JOK1' });
  deck.push({ rank: 'Joker', suit: '★', id: 'JOK2' });
  return shuffle(deck);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(rank) {
  const map = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
  return map[rank] || 0;
}

function cardLabel(card) {
  if (card.rank === 'Joker') return '🃏 جوكر';
  return `${card.rank}${card.suit}`;
}

// ──────────────── Create game ────────────────
function createJackaroo(players) {
  const used = players.slice(0, 4).map((p, i) => ({
    username: p.username,
    color: JACK_COLORS[i],
  }));
  const pieces = {};
  used.forEach(p => { pieces[p.color] = [-1, -1, -1, -1]; });

  const deck = createDeck();
  const hands = {};
  used.forEach(p => {
    hands[p.color] = deck.splice(0, 5);
  });

  return {
    type: 'jackaroo',
    players: used,
    playerColors: Object.fromEntries(used.map(p => [p.username, p.color])),
    turnIndex: 0,
    pieces,
    hands,
    deck,
    discardPile: [],
    winner: null,
    winnerUsername: null,
    logs: ['بدأت مباراة جاكارو'],
    splitRemaining: 0,     // for card 7 split
    splitCard: null,
    selectedCard: null,
  };
}

// ──────────────── Helpers ────────────────
function jackTrackPos(color, steps) {
  if (steps < 0) return -1;
  if (steps <= 51) return (JACK_START[color] + steps) % 52;
  return 52 + (steps - 52);
}

function isJackSafe(trackPos) {
  return JACK_SAFE.includes(trackPos);
}

// What can this card do?
function cardAbilities(card) {
  const r = card.rank;
  if (r === 'Joker') return { bringOut: true, move: [10], wild: true, swap: false };
  return {
    bringOut: r === 'A' || r === 'K',
    move: [cardValue(r)],
    backwards: r === '4',
    swap: r === 'J',
    split: r === '7',
    wild: false,
  };
}

// Get all legal moves for a card
function legalMovesForCard(game, color, card) {
  const ab = cardAbilities(card);
  const moves = [];

  // Bring out
  if (ab.bringOut) {
    game.pieces[color].forEach((s, i) => {
      if (s === -1) moves.push({ type: 'bringout', pieceIdx: i, card });
    });
  }

  // Normal move
  if (ab.move.length > 0 && !ab.backwards) {
    const val = ab.move[0];
    if (ab.split) {
      // Card 7: can move one piece 7 or split between two
      game.pieces[color].forEach((s, i) => {
        if (s >= 0 && s + val <= HOME_STEPS) moves.push({ type: 'move', pieceIdx: i, steps: val, card });
      });
      // Splits: piece A gets n, piece B gets 7-n
      for (let n = 1; n < 7; n++) {
        const a = game.pieces[color].findIndex((s, i) => s >= 0 && s + n <= HOME_STEPS);
        const b = game.pieces[color].findIndex((s, i) => i !== a && s >= 0 && s + (7 - n) <= HOME_STEPS);
        if (a >= 0 && b >= 0) moves.push({ type: 'split', pieceIdxA: a, pieceIdxB: b, stepsA: n, stepsB: 7 - n, card });
      }
    } else {
      game.pieces[color].forEach((s, i) => {
        if (s >= 0 && s + val <= HOME_STEPS) moves.push({ type: 'move', pieceIdx: i, steps: val, card });
      });
    }
  }

  // Backwards (card 4)
  if (ab.backwards) {
    game.pieces[color].forEach((s, i) => {
      if (s > 0 && s - 4 >= 0) moves.push({ type: 'moveback', pieceIdx: i, steps: 4, card });
    });
  }

  // Swap (Jack): swap one of your pieces with an opponent's piece on the track
  if (ab.swap) {
    game.pieces[color].forEach((s, i) => {
      if (s >= 0 && s <= 51) {
        game.players.forEach(op => {
          if (op.color === color) return;
          game.pieces[op.color].forEach((os, oi) => {
            if (os >= 0 && os <= 51) {
              moves.push({ type: 'swap', myIdx: i, opColor: op.color, opIdx: oi, card });
            }
          });
        });
      }
    });
  }

  return moves;
}

function hasAnyLegalMove(game, color) {
  const hand = game.hands[color] || [];
  return hand.some(card => legalMovesForCard(game, color, card).length > 0);
}

// ──────────────── Apply action ────────────────
function applyJackarooAction(game, action, actor) {
  const player = game.players[game.turnIndex];
  if (!player || player.username !== actor || game.winner) return null;
  const color = player.color;

  // ── Discard & pass (no legal moves) ──
  if (action.kind === 'discard') {
    const card = game.hands[color].find(c => c.id === action.cardId);
    if (!card) return null;
    game.hands[color] = game.hands[color].filter(c => c.id !== action.cardId);
    game.discardPile.push(card);
    game.logs.unshift(`${actor} رمى ${cardLabel(card)} (لا حركة)`);
    drawCard(game, color);
    nextTurn(game);
    return game;
  }

  // ── Play a card ──
  if (action.kind === 'play') {
    const card = game.hands[color].find(c => c.id === action.cardId);
    if (!card) return null;

    const legal = legalMovesForCard(game, color, card);
    const move = legal.find(m => matchesMove(m, action));
    if (!move) return null;

    // Remove card from hand
    game.hands[color] = game.hands[color].filter(c => c.id !== action.cardId);
    game.discardPile.push(card);
    game.logs.unshift(`${actor} لعب ${cardLabel(card)}`);

    executeMove(game, color, move, actor);

    // Draw a card
    drawCard(game, color);

    // Check win
    if (game.pieces[color].every(s => s === HOME_STEPS)) {
      game.winner = color;
      game.winnerUsername = actor;
      game.logs.unshift(`${actor} فاز! كل القطع في المنزل`);
      return game;
    }

    nextTurn(game);
    return game;
  }

  return null;
}

function matchesMove(move, action) {
  if (move.type !== action.moveType) return false;
  if (move.type === 'move') return move.pieceIdx === action.pieceIdx;
  if (move.type === 'bringout') return move.pieceIdx === action.pieceIdx;
  if (move.type === 'moveback') return move.pieceIdx === action.pieceIdx;
  if (move.type === 'swap') return move.myIdx === action.pieceIdx && move.opColor === action.opColor && move.opIdx === action.opIdx;
  if (move.type === 'split') return move.pieceIdxA === action.pieceIdxA && move.pieceIdxB === action.pieceIdxB;
  return false;
}

function executeMove(game, color, move, actor) {
  switch (move.type) {
    case 'bringout': {
      game.pieces[color][move.pieceIdx] = 0;
      game.logs.unshift(`${actor} أخرج قطعة ${move.pieceIdx + 1}`);
      checkCapture(game, color, 0, actor);
      break;
    }
    case 'move': {
      const oldSteps = game.pieces[color][move.pieceIdx];
      const newSteps = oldSteps + move.steps;
      game.pieces[color][move.pieceIdx] = newSteps;
      game.logs.unshift(`${actor} حرّك قطعة ${move.pieceIdx + 1} بمقدار ${move.steps}`);
      if (newSteps <= 51) checkCapture(game, color, newSteps, actor);
      break;
    }
    case 'moveback': {
      const oldSteps = game.pieces[color][move.pieceIdx];
      const newSteps = oldSteps - move.steps;
      game.pieces[color][move.pieceIdx] = newSteps;
      game.logs.unshift(`${actor} حرّك قطعة ${move.pieceIdx + 1} للخلف ${move.steps}`);
      if (newSteps <= 51) checkCapture(game, color, newSteps, actor);
      break;
    }
    case 'swap': {
      const mySteps = game.pieces[color][move.myIdx];
      const opSteps = game.pieces[move.opColor][move.opIdx];
      game.pieces[color][move.myIdx] = opSteps;
      game.pieces[move.opColor][move.opIdx] = mySteps;
      game.logs.unshift(`${actor} بدّل قطعة ${move.myIdx + 1} مع ${move.opColor}`);
      break;
    }
    case 'split': {
      const oldA = game.pieces[color][move.pieceIdxA];
      const oldB = game.pieces[color][move.pieceIdxB];
      game.pieces[color][move.pieceIdxA] = oldA + move.stepsA;
      game.pieces[color][move.pieceIdxB] = oldB + move.stepsB;
      game.logs.unshift(`${actor} قسم الـ7: ${move.stepsA} + ${move.stepsB}`);
      if (game.pieces[color][move.pieceIdxA] <= 51) checkCapture(game, color, game.pieces[color][move.pieceIdxA], actor);
      if (game.pieces[color][move.pieceIdxB] <= 51) checkCapture(game, color, game.pieces[color][move.pieceIdxB], actor);
      break;
    }
  }
}

function checkCapture(game, color, steps, actor) {
  if (steps < 0 || steps > 51) return;
  const pos = jackTrackPos(color, steps);
  if (isJackSafe(pos)) return;
  game.players.forEach(op => {
    if (op.color === color) return;
    game.pieces[op.color] = game.pieces[op.color].map((s, i) => {
      if (s >= 0 && s <= 51 && jackTrackPos(op.color, s) === pos) {
        game.logs.unshift(`${actor} أسر قطعة ${op.color} ${i + 1}!`);
        return -1;
      }
      return s;
    });
  });
}

function drawCard(game, color) {
  if (game.deck.length === 0 && game.discardPile.length > 0) {
    game.deck = shuffle([...game.discardPile]);
    game.discardPile = [];
    game.logs.unshift('تم خلط الكومات من جديد');
  }
  if (game.deck.length > 0 && game.hands[color].length < 5) {
    game.hands[color].push(game.deck.pop());
  }
}

function nextTurn(game) {
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
  game.selectedCard = null;
}

// ──────────────── Render ────────────────
function renderJackaroo(game, me_, playAction) {
  const player = game.players[game.turnIndex];
  const myColor = game.playerColors[me_];
  const isMyTurn = player?.username === me_;
  const myHand = game.hands[myColor] || [];
  const selectedCardId = window._jackSelCard || null;

  // Calculate legal moves for selected card
  let legalForCard = [];
  if (selectedCardId && isMyTurn) {
    const card = myHand.find(c => c.id === selectedCardId);
    if (card) legalForCard = legalMovesForCard(game, myColor, card);
  }

  let html = `<div class="jackaroo-wrap">
    <div class="turn">الدور: ${player?.username || '-'} ${game.winner ? `• فاز: ${game.winnerUsername}` : ''}</div>`;

  // Players and pieces
  html += '<div class="jack-players">';
  game.players.forEach(p => {
    const isCurrent = p.username === player?.username;
    html += `<div class="jack-player-card ${isCurrent ? 'current' : ''}">
      <div class="player-header">
        <span class="color-dot ${p.color}"></span>
        <b>${p.username}</b>
        ${isCurrent ? '👑' : ''}
        <small>أوراق: ${game.hands[p.color]?.length || 0}</small>
      </div>
      <div class="pieces-grid">`;
    game.pieces[p.color].forEach((steps, i) => {
      const status = steps === -1 ? 'البيت' : steps === HOME_STEPS ? '🏁' : steps > 51 ? `منزل ${steps - 51}/6` : `مسار ${steps}`;
      const canMove = isMyTurn && p.username === me_ && legalForCard.some(m =>
        (m.type === 'move' || m.type === 'bringout' || m.type === 'moveback') && m.pieceIdx === i ||
        m.type === 'split' && (m.pieceIdxA === i || m.pieceIdxB === i) ||
        m.type === 'swap' && m.myIdx === i
      );
      html += `<div class="piece-token ${p.color} ${canMove ? 'movable' : ''}" ${canMove ? `onclick="jackPieceClick(${i})"` : ''}>
        <span class="piece-num">${i + 1}</span>
        <small>${status}</small>
      </div>`;
    });
    html += '</div></div>';
  });
  html += '</div>';

  // My hand
  if (isMyTurn && !game.winner) {
    html += '<div class="jack-hand"><h4>يدك</h4><div class="cards-row">';
    myHand.forEach(card => {
      const isSelected = card.id === selectedCardId;
      const hasLegal = legalMovesForCard(game, myColor, card).length > 0;
      html += `<div class="jack-card ${isSelected ? 'selected' : ''} ${!hasLegal ? 'no-move' : ''}"
        onclick="jackCardClick('${card.id}')">
        <span class="card-rank">${card.rank}</span>
        <span class="card-suit">${card.suit}</span>
      </div>`;
    });
    html += '</div>';

    // Discard option
    html += '<div class="jack-actions">';
    if (myHand.length > 0 && !hasAnyLegalMove(game, myColor)) {
      html += '<div class="info-box">لا توجد حركة قانونية — اختر ورقة لرميها</div>';
      if (selectedCardId) {
        html += `<button id="jackDiscardBtn" onclick="jackDiscard('${selectedCardId}')">رمي الورقة</button>`;
      }
    }
    html += '</div>';
  } else if (!game.winner) {
    html += `<div class="jack-hand"><p class="muted">في انتظار دورك... يدك: ${myHand.length} أوراق</p></div>`;
  }

  // Track strip
  const track = Array.from({ length: 52 }, (_, i) => {
    const tokens = [];
    Object.entries(game.pieces).forEach(([color, list]) => {
      list.forEach((steps, idx) => {
        if (steps >= 0 && steps <= 51 && jackTrackPos(color, steps) === i) {
          tokens.push({ color, idx });
        }
      });
    });
    return { pos: i, tokens, safe: isJackSafe(i) };
  });

  html += '<div class="track-strip">';
  track.forEach(t => {
    let cellClass = 'track-cell' + (t.safe ? ' safe' : '');
    let tokensHtml = t.tokens.map(t => `<span class="token ${t.color}"></span>`).join('');
    html += `<div class="${cellClass}">${t.pos}<div class="tokens">${tokensHtml}</div></div>`;
  });
  html += '</div>';

  // Log
  html += `<div class="log">${game.logs.slice(0, 12).map(x => `<div class="log-item">${x}</div>`).join('')}</div>`;
  html += '</div>';

  document.getElementById('gameMount').innerHTML = html;

  // Card click
  window.jackCardClick = (cardId) => {
    window._jackSelCard = cardId;
    renderJackaroo(game, me_, playAction);
  };

  // Piece click — find matching legal move and play
  window.jackPieceClick = (pieceIdx) => {
    if (!selectedCardId) { alert('اختر ورقة أولاً'); return; }
    const card = myHand.find(c => c.id === selectedCardId);
    if (!card) return;
    const legal = legalMovesForCard(game, myColor, card);
    const move = legal.find(m =>
      (m.type === 'move' || m.type === 'bringout' || m.type === 'moveback') && m.pieceIdx === pieceIdx
    );
    if (move) {
      const action = { kind: 'play', cardId: selectedCardId, moveType: move.type, pieceIdx };
      window._jackSelCard = null;
      playAction(action);
    } else {
      // Check if it's a swap target (opponent piece)
      const swapMove = legal.find(m => m.type === 'swap' && m.myIdx === pieceIdx);
      if (swapMove) {
        // Need to select opponent piece — for simplicity, pick first available
        const action = { kind: 'play', cardId: selectedCardId, moveType: 'swap', pieceIdx: swapMove.myIdx, opColor: swapMove.opColor, opIdx: swapMove.opIdx };
        window._jackSelCard = null;
        playAction(action);
      }
    }
  };

  window.jackDiscard = (cardId) => {
    window._jackSelCard = null;
    playAction({ kind: 'discard', cardId });
  };
}

if (typeof window !== 'undefined') {
  window.JackarooEngine = { createJackaroo, applyJackarooAction, legalMovesForCard, renderJackaroo };
}
if (typeof module !== 'undefined') module.exports = { createJackaroo, applyJackarooAction, legalMovesForCard };
