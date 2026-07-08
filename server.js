require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const logger = require('./src/logger');
const db = require('./src/db');
const auth = require('./src/auth');
const { getIceServers } = require('./src/turn');
const rooms = require('./src/rooms');
const aiChess = require('./src/ai-chess');

const PORT = process.env.PORT || 3000;
db.initPg();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_ORIGIN || '*', methods: ['GET', 'POST', 'PATCH'] },
  maxHttpBufferSize: 4e6,
  pingInterval: 10000,
  pingTimeout: 5000,
  transports: ['websocket', 'polling'],
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
app.use(compression());
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(morgan('tiny', { stream: { write: m => logger.info(m.trim()) } }));

const authLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: 30,
  message: { error: 'طلبات كثيرة، حاول لاحقًا' },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || '120'),
  message: { error: 'طلبات كثيرة' },
});
app.use('/api/', apiLimiter);
app.use('/api/login', authLimiter);
app.use('/api/register', authLimiter);

function getToken(req) {
  return req.headers.authorization?.replace('Bearer ', '') || req.query.token || null;
}
function requireAuth(req, res, next) {
  const decoded = auth.verifyToken(getToken(req));
  if (!decoded) return res.status(401).json({ error: 'غير مصرح' });
  req.user = decoded.username;
  next();
}
function emitToUser(username, event, payload) {
  rooms.getUserSockets(username).forEach(socketId => io.to(socketId).emit(event, payload));
}
async function emitPresenceToFriends(username) {
  const friends = await db.getFriends(username);
  const me = await db.findUser(username);
  friends.forEach(friend => emitToUser(friend.username, 'social:presence', {
    username,
    online: !!me?.online,
    lastSeen: me?.lastSeen || null,
  }));
}
async function notifyUser(username, notification) {
  emitToUser(username, 'notification:new', notification);
}

app.get('/api/health', (_, res) => res.json({ ok: true, db: db.isPG() ? 'postgresql' : 'json', ts: Date.now() }));
app.get('/api/ice-servers', (req, res) => res.json({ iceServers: getIceServers(req.query.userId || 'guest') }));

app.post('/api/register', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (username.length < 3 || username.length > 32) return res.status(400).json({ error: 'الاسم لازم 3-32 حرف' });
    if (password.length < 4) return res.status(400).json({ error: 'كلمة المرور قصيرة جدًا' });
    if (await db.findUser(username)) return res.status(409).json({ error: 'الاسم مستخدم بالفعل' });
    const user = await db.createUser(username, auth.hashPassword(password));
    const token = auth.signToken(username);
    const refreshToken = auth.signRefreshToken(username);
    res.json({ token, refreshToken, user: await db.safeUser(user) });
  } catch (e) {
    logger.error('Register error', { error: e.message });
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const user = await db.findUser(username);
    if (!user || !auth.checkPassword(password, user.password_hash || user.password)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }
    const token = auth.signToken(username);
    const refreshToken = auth.signRefreshToken(username);
    res.json({ token, refreshToken, user: await db.safeUser(user) });
  } catch (e) {
    logger.error('Login error', { error: e.message });
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

app.post('/api/refresh', (req, res) => {
  const username = auth.verifyRefreshToken(req.body.refreshToken);
  if (!username) return res.status(401).json({ error: 'refresh token غير صالح' });
  res.json({ token: auth.signToken(username) });
});

app.get('/api/bootstrap', requireAuth, async (req, res) => {
  try { res.json(await db.getBootstrap(req.user)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/profile', requireAuth, async (req, res) => res.json({ user: await db.safeUser(await db.findUser(req.user)) }));
app.patch('/api/profile', requireAuth, async (req, res) => res.json({ user: await db.updateProfile(req.user, req.body || {}) }));
app.patch('/api/settings', requireAuth, async (req, res) => res.json({ user: await db.updateSettings(req.user, req.body || {}) }));

app.get('/api/leaderboard', async (_, res) => res.json({ leaderboard: await db.getLeaderboard(20) }));
app.get('/api/history/:username', async (req, res) => res.json({ history: await db.getMatchHistory(req.params.username, 20) }));
app.get('/api/friends/:username', async (req, res) => res.json({ friends: await db.getFriends(req.params.username) }));
app.get('/api/achievements/:username', async (req, res) => res.json({ achievements: await db.getAchievements(req.params.username) }));
app.get('/api/store', requireAuth, async (req, res) => res.json({ items: await db.getStoreCatalog(), purchases: await db.getPurchaseHistory(req.user) }));
app.get('/api/gifts', requireAuth, async (req, res) => res.json({ gifts: await db.getGiftHistory(req.user) }));
app.get('/api/missions', requireAuth, async (req, res) => res.json({ missions: await db.getUserMissions(req.user) }));
app.get('/api/notifications', requireAuth, async (req, res) => res.json({ notifications: await db.getNotifications(req.user) }));
app.get('/api/private/:friendName', requireAuth, async (req, res) => res.json({ messages: await db.getPrivateThread(req.user, req.params.friendName) }));
app.get('/api/room/:code', requireAuth, async (req, res) => {
  const room = await db.getRoom(req.params.code);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  res.json({ room });
});

app.post('/api/friends/request', requireAuth, async (req, res) => {
  try {
    const request = await db.createFriendRequest(req.user, String(req.body.friendName || '').trim());
    const notification = await db.addNotification(request.target, 'friend_request', 'طلب صداقة جديد', `${req.user} أرسل لك طلب صداقة`, { friendshipId: request.id, fromUser: req.user });
    await notifyUser(request.target, notification);
    res.json({ ok: true, request });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/friends/respond', requireAuth, async (req, res) => {
  try {
    const row = await db.respondFriendRequest(req.body.id, req.user, req.body.action);
    res.json({ ok: true, request: row });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/friends/favorite', requireAuth, async (req, res) => {
  try { res.json({ ok: true, relation: await db.toggleFavoriteFriend(req.user, req.body.friendName) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/friends/block', requireAuth, async (req, res) => {
  try { res.json({ ok: true, relation: await db.blockUser(req.user, req.body.target) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/friends/unblock', requireAuth, async (req, res) => {
  try { res.json({ ok: true, relation: await db.unblockUser(req.user, req.body.target) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/report', requireAuth, async (req, res) => {
  try { res.json({ ok: true, report: await db.reportUser(req.user, req.body.target, req.body.reason || 'No reason') }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/private/seen', requireAuth, async (req, res) => {
  await db.markThreadSeen(req.user, req.body.withUser);
  emitToUser(req.body.withUser, 'private:seen', { by: req.user });
  res.json({ ok: true });
});

app.post('/api/store/purchase', requireAuth, async (req, res) => {
  try {
    const purchase = await db.purchaseItem(req.user, req.body.sku, req.body.provider || 'stripe');
    const notification = await db.addNotification(req.user, 'purchase_success', 'تم الشراء بنجاح', purchase.sku, purchase);
    await notifyUser(req.user, notification);
    res.json({ ok: true, purchase, user: await db.safeUser(await db.findUser(req.user)) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/gifts/send', requireAuth, async (req, res) => {
  try {
    const gift = await db.sendGift(req.user, req.body.recipient, req.body.giftType || 'coins', { rewards: req.body.rewards || { coins: 250 } });
    const notification = await db.addNotification(req.body.recipient, 'gift_received', 'وصلتك هدية', `${req.user} أرسل لك هدية`, { giftId: gift.id });
    await notifyUser(req.body.recipient, notification);
    res.json({ ok: true, gift });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/gifts/claim', requireAuth, async (req, res) => {
  try { res.json({ ok: true, gift: await db.claimGift(req.user, req.body.giftId), user: await db.safeUser(await db.findUser(req.user)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/gifts/daily', requireAuth, async (req, res) => {
  try { res.json({ ok: true, gift: await db.createDailyGift(req.user) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/gifts/lucky', requireAuth, async (req, res) => {
  try { res.json({ ok: true, gift: await db.createLuckyGift(req.user) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/gifts/birthday', requireAuth, async (req, res) => {
  try { res.json({ ok: true, gift: await db.createBirthdayGift(req.user) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/missions/claim', requireAuth, async (req, res) => {
  try { res.json({ ok: true, result: await db.claimMission(req.user, req.body.code), user: await db.safeUser(await db.findUser(req.user)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/rewards/daily-login', requireAuth, async (req, res) => {
  try { res.json({ ok: true, result: await db.claimDailyLogin(req.user), user: await db.safeUser(await db.findUser(req.user)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/rewards/calendar/:day/claim', requireAuth, async (req, res) => {
  try { res.json({ ok: true, reward: await db.claimCalendarReward(req.user, req.params.day), user: await db.safeUser(await db.findUser(req.user)) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/notifications/read', requireAuth, async (req, res) => res.json({ ok: true, changed: await db.markNotificationsRead(req.user) }));
app.post('/api/account/delete', requireAuth, async (req, res) => {
  await db.deleteUser(req.user);
  res.json({ ok: true });
});

io.on('connection', socket => {
  logger.info('Socket connected', { id: socket.id });

  socket.on('session:auth', async token => {
    const decoded = auth.verifyToken(token);
    if (!decoded) return socket.emit('session:auth:error', 'توكن غير صالح');
    socket.data.username = decoded.username;
    rooms.registerSocket(socket);
    await db.setPresence(decoded.username, true);
    await rooms.rebindUserSocket(io, decoded.username, socket);
    socket.emit('session:auth:ok', { username: decoded.username, socketId: socket.id });
    emitPresenceToFriends(decoded.username);
  });

  socket.on('room:create', data => rooms.createRoom(io, socket, data));
  socket.on('room:join', data => rooms.joinRoom(io, socket, typeof data === 'string' ? data : data?.code, data || {}));
  socket.on('room:leave', () => rooms.leaveRoom(io, socket));
  socket.on('room:chat', async payload => {
    const text = typeof payload === 'string' ? payload : payload?.text;
    const kind = typeof payload === 'string' ? 'text' : payload?.kind || 'text';
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room || !text) return;
    room.chat.push({ sender: socket.data.username, text: String(text).slice(0, kind === 'voice' ? 500000 : 500), ts: Date.now(), kind });
    await db.saveRoom(room);
    rooms.emitRoom(io, room);
  });
  socket.on('player:ready', async () => {
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room) return;
    const p = room.players.find(x => x.socketId === socket.id);
    if (p) p.ready = !p.ready;
    await db.saveRoom(room);
    rooms.emitRoom(io, room);
  });

  socket.on('game:start', async () => {
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 2) return socket.emit('room:error', 'لازم لاعبين على الأقل');
    room.startedAt = Date.now();
    room.finished = false;
    room.status = 'playing';
    room.gameState = null;
    await db.saveRoom(room);
    rooms.emitRoom(io, room);
    io.to(room.code).emit('game:start', { gameType: room.gameType, players: room.players, room: rooms.roomSnapshot(room) });
  });

  socket.on('game:state', async state => {
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room || room.hostId !== socket.id) return;
    room.gameState = state;
    room.status = state?.winner ? 'finished' : 'playing';
    await db.saveRoom(room);
    rooms.emitRoom(io, room);
    if (state?.winner) {
      await rooms.finishMatch(room);
      io.to(room.code).emit('game:ended', { room: rooms.roomSnapshot(room), state });
    }
  });

  socket.on('game:action', payload => {
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room) return;
    io.to(room.hostId).emit('game:action', { ...payload, senderSocketId: socket.id, sender: socket.data.username });
    socket.to(room.code).emit('game:action', { ...payload, senderSocketId: socket.id, sender: socket.data.username });
  });

  socket.on('game:command', async cmd => {
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room) return;
    if (cmd?.type === 'draw_offer') {
      room.pendingDrawOfferBy = socket.data.username;
      io.to(room.code).emit('game:command', { type: 'draw_offer', from: socket.data.username });
    }
    if (cmd?.type === 'draw_response') {
      if (cmd.accepted) {
        room.gameState = room.gameState || { playerColors: Object.fromEntries(room.players.map((p, i) => [p.username, i === 0 ? 'white' : 'black'])) };
        room.gameState.winner = 'draw';
        room.gameState.logs = ['تم قبول التعادل', ...(room.gameState.logs || [])];
        await rooms.finishMatch(room);
      }
      io.to(room.code).emit('game:command', { type: 'draw_response', by: socket.data.username, accepted: !!cmd.accepted });
    }
    if (cmd?.type === 'resign') {
      room.gameState = room.gameState || { playerColors: Object.fromEntries(room.players.map((p, i) => [p.username, i === 0 ? 'white' : 'black'])) };
      room.gameState.winner = 'resign';
      room.gameState.winnerUsername = room.players.find(p => p.username !== socket.data.username)?.username || null;
      room.gameState.logs = [`${socket.data.username} استسلم`, ...(room.gameState.logs || [])];
      await rooms.finishMatch(room);
      io.to(room.code).emit('game:command', { type: 'resign', by: socket.data.username, winner: room.gameState.winnerUsername });
    }
    if (cmd?.type === 'replay' && room.hostId === socket.id) {
      room.gameState = null;
      room.startedAt = Date.now();
      room.finished = false;
      room.status = 'ready';
      await db.saveRoom(room);
      io.to(room.code).emit('game:command', { type: 'replay' });
      io.to(room.code).emit('game:start', { gameType: room.gameType, players: room.players, room: rooms.roomSnapshot(room) });
    }
  });

  socket.on('ai:move', ({ gameState, difficulty }) => {
    try {
      const move = aiChess.getBestMove(gameState, difficulty || 'medium');
      socket.emit('ai:move', { move });
    } catch (e) {
      logger.error('AI move error', { error: e.message });
      socket.emit('ai:move', { move: null });
    }
  });

  socket.on('matchmaking:join', gameType => rooms.joinQueue(io, socket, gameType));
  socket.on('matchmaking:leave', () => rooms.leaveQueue(io, socket));

  socket.on('invite:friend', async ({ toUsername, gameType, roomCode }) => {
    if (!socket.data.username || !toUsername) return;
    try {
      const invite = await db.createInvite({ type: 'game', fromUser: socket.data.username, toUser: toUsername, roomCode, gameType, payload: { roomCode } });
      emitToUser(toUsername, 'invite:received', invite);
    } catch (e) {
      socket.emit('room:error', e.message);
    }
  });

  socket.on('invite:respond', async ({ inviteId, action }) => {
    if (!socket.data.username) return;
    try {
      const invite = await db.respondInvite(inviteId, socket.data.username, action);
      emitToUser(invite.fromUser, 'invite:responded', invite);
      if (action === 'accept' && invite.roomCode) {
        await rooms.joinRoom(io, socket, invite.roomCode, {});
        socket.emit('invite:auto-join', { roomCode: invite.roomCode });
      }
    } catch (e) { socket.emit('room:error', e.message); }
  });

  socket.on('private:message', async ({ toUser, kind = 'text', content }) => {
    if (!socket.data.username || !toUser || !content) return;
    try {
      const msg = await db.savePrivateMessage(socket.data.username, toUser, kind, content);
      socket.emit('private:message:new', msg);
      emitToUser(toUser, 'private:message:new', msg);
    } catch (e) { socket.emit('room:error', e.message); }
  });
  socket.on('private:typing', ({ toUser, typing }) => emitToUser(toUser, 'private:typing', { fromUser: socket.data.username, typing: !!typing }));
  socket.on('private:seen', async ({ withUser }) => {
    await db.markThreadSeen(socket.data.username, withUser);
    emitToUser(withUser, 'private:seen', { by: socket.data.username });
  });

  socket.on('social:friend_request', async ({ toUser }) => {
    try {
      const request = await db.createFriendRequest(socket.data.username, toUser);
      emitToUser(toUser, 'social:friend_request', { id: request.id, fromUser: socket.data.username });
    } catch (e) { socket.emit('room:error', e.message); }
  });

  socket.on('rtc:signal', ({ to, data }) => { if (to && data) io.to(to).emit('rtc:signal', { from: socket.id, data, sender: socket.data.username }); });
  socket.on('rtc:join', () => {
    const code = rooms.socketToRoom.get(socket.id);
    const room = rooms.rooms.get(code);
    if (!room) return;
    socket.to(room.code).emit('rtc:user-joined', { socketId: socket.id, username: socket.data.username });
  });

  socket.on('disconnect', async () => {
    logger.info('Socket disconnected', { id: socket.id });
    if (socket.data.username) {
      await db.setPresence(socket.data.username, false);
      emitPresenceToFriends(socket.data.username);
    }
    rooms.handleDisconnect(io, socket);
  });
});

setInterval(() => db.expireInvites?.().catch(() => {}), 15000);

app.get('/join/:code', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, path: req.path });
  res.status(500).json({ error: 'خطأ داخلي في الخادم' });
});

server.listen(PORT, () => {
  logger.info(`⚔ Warhex Arena Pro — http://localhost:${PORT}`);
  logger.info(`DB: ${db.isPG() ? 'PostgreSQL' : 'JSON fallback'} | ENV: ${process.env.NODE_ENV || 'development'}`);
});