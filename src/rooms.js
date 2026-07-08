const crypto = require('crypto');
const logger = require('./logger');
const db = require('./db');
const { calcElo } = require('./auth');

const rooms = new Map();
const socketToRoom = new Map();
const userToSockets = new Map();
const matchmakingQueue = [];
const countdownTimers = new Map();

const MAX_PLAYERS = { chess: 2, connect4: 2, warhex: 2, ludo: 4, jackaroo: 4 };

function maxPlayersFor(gameType) { return MAX_PLAYERS[gameType] || 4; }
function createRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function uniqueRoomCode() {
  let code = createRoomCode();
  while (rooms.has(code)) code = createRoomCode();
  return code;
}
function getUserSockets(username) {
  return [...(userToSockets.get(username) || [])];
}
function rememberSocket(username, socketId) {
  if (!username || !socketId) return;
  const set = userToSockets.get(username) || new Set();
  set.add(socketId);
  userToSockets.set(username, set);
}
function forgetSocket(username, socketId) {
  const set = userToSockets.get(username);
  if (!set) return;
  set.delete(socketId);
  if (!set.size) userToSockets.delete(username);
}

function roomSnapshot(room) {
  return {
    code: room.code,
    name: room.name,
    gameType: room.gameType,
    hostId: room.hostId,
    hostUsername: room.hostUsername,
    isPrivate: room.isPrivate,
    players: room.players,
    spectators: room.spectators || [],
    chat: (room.chat || []).slice(-80),
    gameState: room.gameState || null,
    startedAt: room.startedAt || null,
    status: room.status || 'open',
    matchMode: room.matchMode || 'custom',
    countdownEndsAt: room.countdownEndsAt || null,
    share: {
      code: room.code,
      path: `/join/${room.code}`,
      deepLink: `warhex://join/${room.code}`,
    },
  };
}

async function persistRoom(room) {
  try { await db.saveRoom(roomSnapshot(room)); }
  catch (e) { logger.warn('Failed to persist room', { code: room.code, error: e.message }); }
}

function emitRoom(io, room) {
  io.to(room.code).emit('room:update', roomSnapshot(room));
}

function registerSocket(socket) {
  if (socket.data.username) rememberSocket(socket.data.username, socket.id);
}

async function rebindUserSocket(io, username, socket) {
  rememberSocket(username, socket.id);
  const queued = matchmakingQueue.find(q => q.username === username);
  if (queued) queued.socketId = socket.id;
  for (const room of rooms.values()) {
    let changed = false;
    const player = room.players.find(p => p.username === username);
    if (player) {
      if (player.socketId !== socket.id) {
        if (player.socketId) socketToRoom.delete(player.socketId);
        player.socketId = socket.id;
        if (room.hostUsername === username) room.hostId = socket.id;
        socketToRoom.set(socket.id, room.code);
        socket.join(room.code);
        changed = true;
      }
    }
    const spectator = (room.spectators || []).find(s => s.username === username);
    if (spectator) {
      spectator.socketId = socket.id;
      socket.join(room.code);
      socketToRoom.set(socket.id, room.code);
      changed = true;
    }
    if (changed) {
      await persistRoom(room);
      emitRoom(io, room);
    }
  }
}

function buildRoom({ code, gameType, name, hostSocketId, hostUsername, isPrivate = true, matchMode = 'custom' }) {
  return {
    code,
    name: name || `${gameType} room`,
    gameType: gameType || 'chess',
    hostId: hostSocketId,
    hostUsername,
    isPrivate,
    players: [{ socketId: hostSocketId, username: hostUsername, ready: matchMode === 'random', connected: true }],
    spectators: [],
    chat: [{ sender: 'System', text: `تم إنشاء غرفة ${gameType}`, ts: Date.now() }],
    gameState: null,
    startedAt: null,
    finished: false,
    status: 'open',
    matchMode,
    createdAt: Date.now(),
    countdownEndsAt: null,
  };
}

async function createRoom(io, socket, { gameType = 'chess', name, isPrivate = true } = {}) {
  if (!socket.data.username) return;
  await leaveQueue(io, socket, { silent: true });
  const existingCode = socketToRoom.get(socket.id);
  if (existingCode) leaveRoom(io, socket, { silent: true });
  const code = uniqueRoomCode();
  const room = buildRoom({ code, gameType, name, hostSocketId: socket.id, hostUsername: socket.data.username, isPrivate, matchMode: 'custom' });
  rooms.set(code, room);
  socket.join(code);
  socketToRoom.set(socket.id, code);
  await persistRoom(room);
  emitRoom(io, room);
  socket.emit('room:created', roomSnapshot(room));
  logger.info('Room created', { code, gameType, host: socket.data.username });
}

async function joinRoom(io, socket, rawCode, options = {}) {
  if (!socket.data.username) return;
  const code = String(rawCode || '').toUpperCase();
  const room = rooms.get(code) || await db.getRoom(code);
  if (!room) return socket.emit('room:error', 'الغرفة غير موجودة');
  if (!rooms.has(code)) rooms.set(code, room);
  const liveRoom = rooms.get(code);
  await leaveQueue(io, socket, { silent: true });

  if (socketToRoom.get(socket.id) && socketToRoom.get(socket.id) !== code) leaveRoom(io, socket, { silent: true });

  const alreadyPlayer = liveRoom.players.some(p => p.username === socket.data.username);
  const alreadySpectator = (liveRoom.spectators || []).some(s => s.username === socket.data.username);
  if (alreadyPlayer || alreadySpectator) {
    socket.join(code);
    socketToRoom.set(socket.id, code);
    emitRoom(io, liveRoom);
    socket.emit('room:joined', roomSnapshot(liveRoom));
    return;
  }

  const full = liveRoom.players.length >= maxPlayersFor(liveRoom.gameType);
  const asSpectator = options.asSpectator || liveRoom.startedAt || full;

  if (asSpectator) {
    liveRoom.spectators = liveRoom.spectators || [];
    liveRoom.spectators.push({ socketId: socket.id, username: socket.data.username, connected: true });
    liveRoom.chat.push({ sender: 'System', text: `${socket.data.username} دخل كمشاهد`, ts: Date.now() });
  } else {
    liveRoom.players.push({ socketId: socket.id, username: socket.data.username, ready: liveRoom.matchMode === 'random', connected: true });
    liveRoom.chat.push({ sender: 'System', text: `${socket.data.username} دخل الغرفة`, ts: Date.now() });
  }

  socket.join(liveRoom.code);
  socketToRoom.set(socket.id, liveRoom.code);
  await persistRoom(liveRoom);
  emitRoom(io, liveRoom);
  socket.emit('room:joined', roomSnapshot(liveRoom));
  logger.info('Player joined room', { code, user: socket.data.username, asSpectator });
}

async function leaveRoom(io, socket, { silent = false } = {}) {
  const code = socketToRoom.get(socket.id);
  if (!code) return;
  const room = rooms.get(code);
  socketToRoom.delete(socket.id);
  socket.leave(code);
  if (!room) return;

  room.players = room.players.filter(p => p.socketId !== socket.id);
  room.spectators = (room.spectators || []).filter(s => s.socketId !== socket.id);

  if (!room.players.length) {
    cancelCountdown(code);
    rooms.delete(code);
    await db.deleteRoom(code);
    logger.info('Room deleted (empty)', { code });
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].socketId;
    room.hostUsername = room.players[0].username;
  }

  room.chat.push({ sender: 'System', text: `${socket.data.username || 'لاعب'} غادر`, ts: Date.now() });

  if (room.status === 'countdown' && room.matchMode === 'random') {
    const opponent = room.players[0];
    cancelCountdown(code);
    if (opponent) {
      const opponentSocket = io.sockets.sockets.get(opponent.socketId);
      if (opponentSocket) {
        socketToRoom.delete(opponent.socketId);
        opponentSocket.leave(code);
        room.players = room.players.filter(p => p.socketId !== opponent.socketId);
        rooms.delete(code);
        await db.deleteRoom(code);
        opponentSocket.emit('matchmaking:restart', { reason: 'غادر الخصم أثناء العد التنازلي' });
        joinQueue(io, opponentSocket, room.gameType, { force: true });
        return;
      }
    }
  }

  if (room.gameState && !room.gameState.winner && room.players.length === 1) handleForfeit(io, room, socket.data.username);
  await persistRoom(room);
  if (!silent) emitRoom(io, room);
}

function cancelCountdown(code) {
  const timer = countdownTimers.get(code);
  if (timer) clearTimeout(timer);
  countdownTimers.delete(code);
}

function handleForfeit(io, room, leftUsername) {
  const remaining = room.players[0];
  if (!room.gameState) room.gameState = { playerColors: Object.fromEntries(room.players.map(p => [p.username, p.username === remaining?.username ? 'forfeit_winner' : 'forfeit_loser'])) };
  room.gameState.winner = 'forfeit';
  room.gameState.winnerUsername = remaining?.username || null;
  if (!room.gameState.playerColors) room.gameState.playerColors = {};
  room.gameState.playerColors[leftUsername] = 'forfeit_loser';
  if (remaining) room.gameState.playerColors[remaining.username] = 'forfeit_winner';
  finishMatch(room);
  io.to(room.code).emit('game:forfeit', { winner: remaining?.username, loser: leftUsername });
}

async function finishMatch(room) {
  if (!room.gameState || room.finished) return;
  room.finished = true;
  const gs = room.gameState;
  const winnerUser = gs.winnerUsername || gs.winner;
  const isDraw = gs.winner === 'draw' || !gs.winner;
  const allNames = Object.keys(gs.playerColors || {});
  const playerList = room.players.length > 0 ? room.players : allNames.map(n => ({ username: n }));

  const elos = {};
  for (const p of playerList) {
    const u = await db.findUser(p.username);
    elos[p.username] = u?.elo || 1200;
  }

  const players = [];
  for (const p of playerList) {
    const isWinner = p.username === winnerUser || gs.winner === gs.playerColors?.[p.username];
    const result = isDraw ? 'draw' : isWinner ? 'win' : 'loss';
    players.push({ username: p.username, color: gs.playerColors?.[p.username] || p.color || null, result });
  }

  const eloDeltas = {};
  if (players.length === 2 && !isDraw) {
    const [p1, p2] = players;
    const winner = p1.result === 'win' ? p1 : p2;
    const loser = p1.result === 'loss' ? p1 : p2;
    const newWinnerElo = calcElo(elos[winner.username], elos[loser.username], 1);
    const newLoserElo = calcElo(elos[loser.username], elos[winner.username], 0);
    eloDeltas[winner.username] = newWinnerElo - elos[winner.username];
    eloDeltas[loser.username] = newLoserElo - elos[loser.username];
  }

  const matchId = await db.saveMatch({
    game_type: room.gameType,
    room_code: room.code,
    players,
    winner: winnerUser,
    state_snapshot: gs,
    duration_sec: room.startedAt ? Math.floor((Date.now() - room.startedAt) / 1000) : 0,
    finished_at: new Date().toISOString(),
  });

  for (const p of players) {
    await db.updateUserStats(p.username, {
      win: p.result === 'win',
      loss: p.result === 'loss',
      draw: p.result === 'draw',
      xpGain: p.result === 'win' ? 100 : p.result === 'draw' ? 35 : 10,
      eloDelta: eloDeltas[p.username] || 0,
    });
  }

  await persistRoom(room);
  logger.info('Match saved', { id: matchId, game: room.gameType, winner: winnerUser || 'draw' });
}

function enqueueEntry(socket, gameType) {
  const entry = {
    id: uid('queue'),
    socketId: socket.id,
    username: socket.data.username,
    gameType,
    joinedAt: Date.now(),
  };
  matchmakingQueue.push(entry);
  return entry;
}

function uid(prefix) { return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }

async function startMatchCountdown(io, room, playerA, playerB) {
  room.status = 'countdown';
  room.countdownEndsAt = Date.now() + 4000;
  await persistRoom(room);
  emitRoom(io, room);
  io.to(playerA.socketId).emit('matchmaking:found', { code: room.code, opponent: playerB.username, countdown: 4, room: roomSnapshot(room) });
  io.to(playerB.socketId).emit('matchmaking:found', { code: room.code, opponent: playerA.username, countdown: 4, room: roomSnapshot(room) });

  cancelCountdown(room.code);
  countdownTimers.set(room.code, setTimeout(async () => {
    const liveRoom = rooms.get(room.code);
    if (!liveRoom) return;
    const bothPresent = liveRoom.players.length >= 2 && liveRoom.players.every(p => io.sockets.sockets.has(p.socketId));
    if (!bothPresent) {
      const survivor = liveRoom.players.find(p => io.sockets.sockets.has(p.socketId));
      rooms.delete(room.code);
      await db.deleteRoom(room.code);
      if (survivor) {
        const survivorSocket = io.sockets.sockets.get(survivor.socketId);
        if (survivorSocket) {
          survivorSocket.leave(room.code);
          socketToRoom.delete(survivor.socketId);
          survivorSocket.emit('matchmaking:restart', { reason: 'فقدنا أحد اللاعبين قبل بدء المباراة' });
          joinQueue(io, survivorSocket, liveRoom.gameType, { force: true });
        }
      }
      return;
    }
    liveRoom.status = 'ready';
    liveRoom.countdownEndsAt = null;
    liveRoom.startedAt = Date.now();
    await persistRoom(liveRoom);
    emitRoom(io, liveRoom);
    io.to(liveRoom.code).emit('matchmaking:ready', { code: liveRoom.code, room: roomSnapshot(liveRoom) });
    countdownTimers.delete(liveRoom.code);
  }, 4000));
}

function queueIndexByUsername(username, gameType) {
  return matchmakingQueue.findIndex(q => q.username === username && (!gameType || q.gameType === gameType));
}

async function joinQueue(io, socket, gameType, { force = false } = {}) {
  if (!socket.data.username) return;
  const username = socket.data.username;
  if (!force) {
    if (matchmakingQueue.some(q => q.username === username)) return socket.emit('matchmaking:searching', { alreadyQueued: true, startedAt: Date.now() });
    if (socketToRoom.get(socket.id)) return socket.emit('room:error', 'أنت داخل غرفة بالفعل');
  }
  const sameGameIdx = matchmakingQueue.findIndex(q => q.gameType === gameType && q.username !== username);
  if (sameGameIdx >= 0) {
    const opponent = matchmakingQueue.splice(sameGameIdx, 1)[0];
    const opponentSocket = io.sockets.sockets.get(opponent.socketId);
    if (!opponentSocket) {
      return joinQueue(io, socket, gameType, { force: true });
    }
    const code = uniqueRoomCode();
    const room = {
      ...buildRoom({ code, gameType, name: 'مباراة عشوائية', hostSocketId: socket.id, hostUsername: username, isPrivate: false, matchMode: 'random' }),
      players: [
        { socketId: socket.id, username, ready: true, connected: true },
        { socketId: opponent.socketId, username: opponent.username, ready: true, connected: true },
      ],
      chat: [{ sender: 'System', text: 'تم العثور على مباراة عشوائية', ts: Date.now() }],
    };
    rooms.set(code, room);
    socket.join(code);
    opponentSocket.join(code);
    socketToRoom.set(socket.id, code);
    socketToRoom.set(opponent.socketId, code);
    await persistRoom(room);
    await startMatchCountdown(io, room, room.players[0], room.players[1]);
    logger.info('Matchmaking match created', { code, p1: username, p2: opponent.username });
    return room;
  }
  enqueueEntry(socket, gameType);
  socket.emit('matchmaking:searching', { startedAt: Date.now(), gameType });
  logger.info('Player in matchmaking queue', { user: username, gameType });
}

async function leaveQueue(io, socket, { silent = false } = {}) {
  const idx = matchmakingQueue.findIndex(q => q.socketId === socket.id || q.username === socket.data.username);
  if (idx >= 0) {
    matchmakingQueue.splice(idx, 1);
    if (!silent) io.to(socket.id).emit('matchmaking:cancelled');
    logger.info('Player left queue', { user: socket.data.username });
  }
}

async function handleDisconnect(io, socket) {
  const username = socket.data.username;
  if (username) forgetSocket(username, socket.id);
  await leaveQueue(io, socket, { silent: true });
  await leaveRoom(io, socket, { silent: true });
}

module.exports = {
  rooms,
  socketToRoom,
  matchmakingQueue,
  userToSockets,
  roomSnapshot,
  emitRoom,
  registerSocket,
  rebindUserSocket,
  createRoom,
  joinRoom,
  leaveRoom,
  finishMatch,
  joinQueue,
  leaveQueue,
  handleDisconnect,
  getUserSockets,
};