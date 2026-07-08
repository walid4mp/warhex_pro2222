/**
 * ludo.js — Complete Ludo engine with real rules.
 *
 * Rules implemented:
 *  • 4 players, 4 pieces each, 52-square circular track + 6 home-column
 *  • Roll a 6 to bring a piece out of base
 *  • Rolling 6 grants an extra turn
 *  • Rolling three consecutive 6s → forfeit turn (penalty)
 *  • Capture: landing on opponent's piece sends it back to base
 *  • Safe squares: colored start squares + star squares (no capture)
 *  • Home column: pieces travel 52 + 5 = 57 steps to finish
 *  • First player to get all 4 pieces home wins
 *  • Must move if legal; if no legal move, turn passes
 */

const LUDO_COLORS = ['red', 'green', 'yellow', 'blue'];
const LUDO_START = { red: 0, green: 13, yellow: 26, blue: 39 };
const LUDO_SAFE = [0, 8, 13, 21, 26, 34, 39, 47]; // safe squares on main track
const HOME_ENTRY = { red: 51, green: 12, yellow: 25, blue: 38 }; // last track square before home column

function createLudo(players) {
  const used = players.slice(0, 4).map((p, i) => ({
    username: p.username,
    color: LUDO_COLORS[i],
    finished: 0,
  }));
  const pieces = {};
  used.forEach(p => { pieces[p.color] = [-1, -1, -1, -1]; }); // -1 = in base

  return {
    type: 'ludo',
    players: used,
    playerColors: Object.fromEntries(used.map(p => [p.username, p.color])),
    turnIndex: 0,
    dice: null,
    pieces,
    consecutiveSixes: 0,
    winner: null,
    winnerUsername: null,
    logs: ['بدأت مباراة لودو'],
    lastRoll: null,
    mustMove: false,
  };
}

function ludoTrackPos(color, steps) {
  if (steps < 0) return -1;
  if (steps > 57) return -1;
  if (steps <= 51) {
    return (LUDO_START[color] + steps) % 52;
  }
  // Home column: steps 52-57 → home positions 1-6
  return 52 + (steps - 52); // 52..57
}

function isSafeSquare(trackPos) {
  return LUDO_SAFE.includes(trackPos);
}

function ludoLegalMoves(game, color) {
  const roll = game.dice;
  if (!roll) return [];
  return game.pieces[color].map((steps, i) => {
    if (steps === -1) {
      // In base, need a 6 to come out → goes to start square (step 0)
      return roll === 6 ? i : null;
    }
    if (steps === 57) return null; // already home
    if (steps + roll > 57) return null; // overshoot
    return i;
  }).filter(x => x !== null);
}

function applyLudoAction(game, action, actor) {
  const player = game.players[game.turnIndex];
  if (!player || player.username !== actor || game.winner) return null;
  const color = player.color;

  // ── Roll ──
  if (action.kind === 'roll') {
    if (game.dice !== null) return null; // already rolled, must move
    game.dice = 1 + Math.floor(Math.random() * 6);
    game.lastRoll = game.dice;
    game.logs.unshift(`${actor} رمى ${game.dice}`);

    if (game.dice === 6) {
      game.consecutiveSixes++;
      if (game.consecutiveSixes >= 3) {
        game.logs.unshift(`${actor}: ثلاث ستات متتالية! خسر الدور`);
        game.consecutiveSixes = 0;
        nextTurn(game, false);
        return game;
      }
    } else {
      game.consecutiveSixes = 0;
    }

    const legal = ludoLegalMoves(game, color);
    if (legal.length === 0) {
      game.logs.unshift(`${actor}: لا توجد حركة قانونية`);
      nextTurn(game, game.dice === 6 && game.consecutiveSixes > 0);
      return game;
    }
    game.mustMove = true;
    return game;
  }

  // ── Move ──
  if (action.kind === 'move') {
    if (game.dice === null) return null;
    const idx = action.index;
    const legal = ludoLegalMoves(game, color);
    if (!legal.includes(idx)) return null;

    let steps = game.pieces[color][idx];
    const roll = game.dice;

    if (steps === -1) {
      // Coming out of base
      steps = 0;
      game.logs.unshift(`${actor} أخرج القطعة ${idx + 1}`);
    } else {
      steps = steps + roll;
      game.logs.unshift(`${actor} حرّك القطعة ${idx + 1} (${steps}/57)`);
    }

    game.pieces[color][idx] = steps;

    // ── Capture check (only on main track, not safe squares) ──
    let captured = false;
    if (steps <= 51) {
      const pos = ludoTrackPos(color, steps);
      if (!isSafeSquare(pos)) {
        game.players.forEach(op => {
          if (op.color === color) return;
          game.pieces[op.color] = game.pieces[op.color].map((s, pi) => {
            if (s >= 0 && s <= 51 && ludoTrackPos(op.color, s) === pos) {
              captured = true;
              game.logs.unshift(`${actor} أسر قطعة ${op.color} ${pi + 1}!`);
              return -1;
            }
            return s;
          });
        });
      }
    }

    // ── Check win ──
    if (game.pieces[color].every(s => s === 57)) {
      game.winner = color;
      game.winnerUsername = actor;
      game.logs.unshift(`${actor} فاز! وصلت كل القطع للمنزل`);
      return game;
    }

    // ── Extra turn conditions ──
    const extraTurn = roll === 6 || captured || steps === 57;

    game.dice = null;
    game.mustMove = false;

    if (!extraTurn || game.winner) {
      game.consecutiveSixes = 0;
      nextTurn(game, false);
    }
    // If extra turn, same player rolls again
    return game;
  }

  return null;
}

function nextTurn(game, samePlayer) {
  if (!samePlayer) {
    game.turnIndex = (game.turnIndex + 1) % game.players.length;
  }
  game.dice = null;
  game.mustMove = false;
}

// ──────────────── Render ────────────────
function renderLudo(game, me_, playAction) {
  const player = game.players[game.turnIndex];
  const myColor = game.playerColors[me_];
  const isMyTurn = player?.username === me_;
  const legal = isMyTurn && game.dice !== null ? ludoLegalMoves(game, myColor) : [];

  // Build track visualization (52 squares in a ring)
  const track = Array.from({ length: 52 }, (_, i) => {
    const tokens = [];
    Object.entries(game.pieces).forEach(([color, list]) => {
      list.forEach((steps, idx) => {
        if (steps >= 0 && steps <= 51 && ludoTrackPos(color, steps) === i) {
          tokens.push({ color, idx });
        }
      });
    });
    return { pos: i, tokens, safe: isSafeSquare(i) };
  });

  // Home columns (6 per color)
  const homeColumns = {};
  LUDO_COLORS.forEach(color => {
    homeColumns[color] = [];
    game.pieces[color].forEach((steps, idx) => {
      if (steps >= 52 && steps <= 57) {
        homeColumns[color].push({ idx, step: steps });
      }
    });
  });

  let html = `<div class="ludo-wrap">
    <div class="turn">الدور: ${player?.username || '-'} ${game.dice ? `• النرد: ${game.dice}` : ''} ${game.winner ? `• فاز: ${game.winnerUsername}` : ''}</div>`;

  // Dice area
  html += '<div class="ludo-dice-area">';
  if (isMyTurn && game.dice === null && !game.winner) {
    html += `<button id="ludoRollBtn" class="dice-btn">🎲 ارمِ النرد</button>`;
  } else if (game.dice !== null) {
    html += `<div class="dice-show">🎲 ${game.dice}</div>`;
  }
  html += '</div>';

  // Players info with pieces
  html += '<div class="ludo-players">';
  game.players.forEach(p => {
    const isCurrent = p.username === player?.username;
    html += `<div class="ludo-player-card ${isCurrent ? 'current' : ''}">
      <div class="player-header">
        <span class="color-dot ${p.color}"></span>
        <b>${p.username}</b>
        ${isCurrent ? '👑' : ''}
      </div>
      <div class="pieces-grid">`;
    game.pieces[p.color].forEach((steps, i) => {
      const status = steps === -1 ? 'البيت' : steps === 57 ? '🏁' : steps > 51 ? `منزل ${steps - 51}/6` : `مسار ${steps}`;
      const canMove = isMyTurn && p.username === me_ && legal.includes(i);
      html += `<div class="piece-token ${p.color} ${canMove ? 'movable' : ''}" ${canMove ? `onclick="ludoMove(${i})"` : ''}>
        <span class="piece-num">${i + 1}</span>
        <small>${status}</small>
      </div>`;
    });
    html += '</div></div>';
  });
  html += '</div>';

  // Track strip
  html += '<div class="track-strip">';
  track.forEach(t => {
    let cellClass = 'track-cell' + (t.safe ? ' safe' : '');
    let tokensHtml = t.tokens.map(t => `<span class="token ${t.color}"></span>`).join('');
    html += `<div class="${cellClass}">${t.pos}<div class="tokens">${tokensHtml}</div></div>`;
  });
  html += '</div>';

  // Home columns
  html += '<div class="home-columns">';
  LUDO_COLORS.forEach(color => {
    if (homeColumns[color].length === 0 && !game.players.find(p => p.color === color)) return;
    html += `<div class="home-col ${color}"><small>${color}</small>`;
    for (let h = 52; h <= 57; h++) {
      const pieces = homeColumns[color].filter(p => p.step === h);
      html += `<div class="home-cell ${h === 57 ? 'finish' : ''}">${pieces.map(p => `<span class="token ${color}"></span>`).join('')}</div>`;
    }
    html += '</div>';
  });
  html += '</div>';

  // Log
  html += `<div class="log">${game.logs.slice(0, 12).map(x => `<div class="log-item">${x}</div>`).join('')}</div>`;
  html += '</div>';

  document.getElementById('gameMount').innerHTML = html;

  const rollBtn = document.getElementById('ludoRollBtn');
  if (rollBtn) rollBtn.onclick = () => playAction({ kind: 'roll' });
  window.ludoMove = (idx) => playAction({ kind: 'move', index: idx });
}

if (typeof window !== 'undefined') {
  window.LudoEngine = { createLudo, applyLudoAction, ludoLegalMoves, renderLudo };
}
if (typeof module !== 'undefined') module.exports = { createLudo, applyLudoAction, ludoLegalMoves };
