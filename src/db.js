require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const logger = require('./logger');
const {
  DEFAULT_WALLET,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILE,
  DEFAULT_INVENTORY,
  STORE_ITEMS,
  SKIN_REWARDS,
  MISSION_CATALOG,
  DAILY_REWARDS,
} = require('./catalog');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  rooms: path.join(DATA_DIR, 'rooms.json'),
  matches: path.join(DATA_DIR, 'matches.json'),
  friendships: path.join(DATA_DIR, 'friendships.json'),
  invites: path.join(DATA_DIR, 'invites.json'),
  messages: path.join(DATA_DIR, 'messages.json'),
  notifications: path.join(DATA_DIR, 'notifications.json'),
  purchases: path.join(DATA_DIR, 'purchases.json'),
  gifts: path.join(DATA_DIR, 'gifts.json'),
  reports: path.join(DATA_DIR, 'reports.json'),
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
for (const file of Object.values(FILES)) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
}

let pool = null;
let usePG = false;

function initPg() {
  const cs = process.env.DATABASE_URL;
  if (!cs || cs.includes('user:password@localhost')) {
    logger.info('No valid DATABASE_URL — using JSON file storage');
    return false;
  }
  try {
    pool = new Pool({
      connectionString: cs,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.query('SELECT 1').then(() => {
      usePG = true;
      logger.info('PostgreSQL connected and verified');
    }).catch(err => {
      logger.warn('PG connection failed — falling back to JSON', { error: err.message });
      usePG = false;
      pool = null;
    });
    usePG = true;
    return true;
  } catch (e) {
    logger.warn('PG init error', { error: e.message });
    usePG = false;
    return false;
  }
}

async function pgQ(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    logger.warn('PG query failed, falling back to JSON', { error: err.message });
    usePG = false;
    throw err;
  }
}

function rj(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return []; }
}
function wj(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function nowIso() { return new Date().toISOString(); }
function uid(prefix = 'id') { return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`; }
function todayKey() { return new Date().toISOString().slice(0, 10); }
function weekKey() {
  const d = new Date();
  const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const days = Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - jan1) / 86400000);
  return `${d.getUTCFullYear()}-W${Math.floor(days / 7) + 1}`;
}
function monthKey() { return new Date().toISOString().slice(0, 7); }
function threadKey(a, b) { return [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('__'); }

function mergeDeep(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const [key, value] of Object.entries(patch || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = mergeDeep(out[key] || {}, value);
    else out[key] = value;
  }
  return out;
}

function normalizeUser(user) {
  if (!user) return null;
  const wallet = mergeDeep(DEFAULT_WALLET, user.wallet || {});
  const settings = mergeDeep(DEFAULT_SETTINGS, user.settings || {});
  const inventory = mergeDeep(DEFAULT_INVENTORY, user.inventory || {});
  const profile = mergeDeep(DEFAULT_PROFILE(user.username), user.profile || {});
  const rewardState = mergeDeep({
    loginStreak: 0,
    lastLoginClaim: null,
    claimedCalendarDays: [],
    claimed30Days: [],
    luckyGiftClaimedOn: null,
    birthdayGiftClaimedOn: null,
  }, user.rewardState || {});
  const missions = user.missions || {};
  return {
    ...user,
    avatar: user.avatar || profile.avatar || '♞',
    coins: Number(user.coins ?? wallet.coins ?? 0),
    gems: Number(user.gems ?? wallet.gems ?? 0),
    level: Number(user.level || 1),
    xp: Number(user.xp ?? wallet.xp ?? 0),
    wins: Number(user.wins || 0),
    losses: Number(user.losses || 0),
    draws: Number(user.draws || 0),
    elo: Number(user.elo || 1200),
    wallet,
    settings,
    inventory,
    profile,
    rewardState,
    missions,
    created_at: user.created_at || nowIso(),
    last_login: user.last_login || null,
    online: !!user.online,
    lastSeen: user.lastSeen || user.last_login || null,
  };
}

function syncUserFields(user) {
  const u = normalizeUser(user);
  u.wallet.coins = u.coins;
  u.wallet.gems = u.gems;
  u.wallet.xp = u.xp;
  u.profile.avatar = u.avatar;
  return u;
}

function deriveLevel(xp) {
  return Math.max(1, Math.floor(Number(xp || 0) / 500) + 1);
}

function ensureMissionEntries(user) {
  for (const mission of MISSION_CATALOG) {
    if (!user.missions[mission.code]) {
      user.missions[mission.code] = {
        code: mission.code,
        type: mission.type,
        title: mission.title,
        goal: mission.goal,
        progress: 0,
        claimed: false,
        updatedAt: nowIso(),
        cycleKey: mission.type === 'daily' ? todayKey() : mission.type === 'weekly' ? weekKey() : mission.type === 'monthly' ? monthKey() : 'permanent',
      };
    }
    const entry = user.missions[mission.code];
    const expectedCycle = mission.type === 'daily' ? todayKey() : mission.type === 'weekly' ? weekKey() : mission.type === 'monthly' ? monthKey() : 'permanent';
    if (['daily', 'weekly', 'monthly'].includes(mission.type) && entry.cycleKey !== expectedCycle) {
      entry.progress = 0;
      entry.claimed = false;
      entry.cycleKey = expectedCycle;
      entry.updatedAt = nowIso();
    }
  }
}

function applyRewardsToUser(user, rewards = {}, source = 'reward') {
  const applied = [];
  const walletFields = ['gold', 'coins', 'gems', 'diamonds', 'energy', 'xp', 'seasonPoints'];
  for (const field of walletFields) {
    const delta = Number(rewards[field] || 0);
    if (!delta) continue;
    user.wallet[field] = Number(user.wallet[field] || 0) + delta;
    applied.push(`${field}:${delta}`);
  }
  user.coins = user.wallet.coins;
  user.gems = user.wallet.gems;
  user.xp = user.wallet.xp;
  user.level = deriveLevel(user.xp);
  if (rewards.item) {
    if (!user.inventory.items) user.inventory.items = [];
    if (!user.inventory.items.includes(rewards.item)) user.inventory.items.push(rewards.item);
    applied.push(`item:${rewards.item}`);
  }
  if (rewards.title) {
    if (!user.inventory.skins.titles.includes(rewards.title)) user.inventory.skins.titles.push(rewards.title);
    if (!user.profile.title || user.profile.title === 'Rookie Strategist') user.profile.title = rewards.title;
    applied.push(`title:${rewards.title}`);
  }
  if (rewards.badge) {
    if (!user.inventory.skins.badges.includes(rewards.badge)) user.inventory.skins.badges.push(rewards.badge);
    if (!user.profile.badges.includes(rewards.badge)) user.profile.badges.push(rewards.badge);
    applied.push(`badge:${rewards.badge}`);
  }
  if (rewards.emote) {
    if (!user.inventory.skins.emotes.includes(rewards.emote)) user.inventory.skins.emotes.push(rewards.emote);
    applied.push(`emote:${rewards.emote}`);
  }
  return { user: syncUserFields(user), applied, source };
}

function getUsersJson() { return rj(FILES.users).map(normalizeUser).map(syncUserFields); }
function saveUsersJson(users) { wj(FILES.users, users.map(syncUserFields)); }

async function readUsers() {
  if (usePG && pool) {
    try {
      const r = await pgQ('SELECT * FROM users ORDER BY id ASC', []);
      return r.rows.map(row => syncUserFields(normalizeUser({
        ...row,
        password_hash: row.password_hash,
        profile: row.profile_json || row.profile || {},
        wallet: row.wallet_json || row.wallet || {},
        settings: row.settings_json || row.settings || {},
        inventory: row.inventory_json || row.inventory || {},
        missions: row.missions_json || row.missions || {},
        rewardState: row.reward_state_json || row.reward_state || {},
      })));
    } catch {
      return getUsersJson();
    }
  }
  return getUsersJson();
}

async function writeUsers(users) {
  if (usePG && pool) {
    for (const user of users) await upsertUserPg(user);
    return;
  }
  saveUsersJson(users);
}

async function upsertUserPg(user) {
  const u = syncUserFields(normalizeUser(user));
  return pgQ(`
    INSERT INTO users (
      username, password_hash, avatar, coins, gems, level, xp, wins, losses, draws, elo,
      profile_json, wallet_json, settings_json, inventory_json, missions_json, reward_state_json,
      last_login, created_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,$18,$19
    )
    ON CONFLICT (username) DO UPDATE SET
      password_hash=EXCLUDED.password_hash,
      avatar=EXCLUDED.avatar,
      coins=EXCLUDED.coins,
      gems=EXCLUDED.gems,
      level=EXCLUDED.level,
      xp=EXCLUDED.xp,
      wins=EXCLUDED.wins,
      losses=EXCLUDED.losses,
      draws=EXCLUDED.draws,
      elo=EXCLUDED.elo,
      profile_json=EXCLUDED.profile_json,
      wallet_json=EXCLUDED.wallet_json,
      settings_json=EXCLUDED.settings_json,
      inventory_json=EXCLUDED.inventory_json,
      missions_json=EXCLUDED.missions_json,
      reward_state_json=EXCLUDED.reward_state_json,
      last_login=EXCLUDED.last_login
  `, [
    u.username, u.password_hash || u.password, u.avatar, u.coins, u.gems, u.level, u.xp,
    u.wins, u.losses, u.draws, u.elo,
    JSON.stringify(u.profile), JSON.stringify(u.wallet), JSON.stringify(u.settings),
    JSON.stringify(u.inventory), JSON.stringify(u.missions), JSON.stringify(u.rewardState),
    u.last_login, u.created_at,
  ]);
}

function readCollection(file) { return rj(file); }
async function getCollection(table, file) {
  if (usePG && pool) {
    try {
      const r = await pgQ(`SELECT * FROM ${table} ORDER BY created_at DESC NULLS LAST, id DESC`, []);
      return r.rows;
    } catch {
      return readCollection(file);
    }
  }
  return readCollection(file);
}
async function saveCollection(table, file, rows, mapper = row => row) {
  if (usePG && pool) {
    if (table === 'rooms') return saveRooms(rows);
    if (table === 'friendships') return saveFriendships(rows);
    if (table === 'invites') return saveInvites(rows);
    if (table === 'messages') return saveMessages(rows);
    if (table === 'notifications') return saveNotifications(rows);
    if (table === 'purchases') return savePurchases(rows);
    if (table === 'gifts') return saveGifts(rows);
    if (table === 'reports') return saveReports(rows);
  }
  wj(file, rows.map(mapper));
}

async function saveRooms(rows) {
  for (const room of rows) {
    await pgQ(`INSERT INTO rooms (code, host_username, game_type, status, payload, updated_at)
      VALUES ($1,$2,$3,$4,$5,NOW())
      ON CONFLICT (code) DO UPDATE SET host_username=EXCLUDED.host_username, game_type=EXCLUDED.game_type,
      status=EXCLUDED.status, payload=EXCLUDED.payload, updated_at=NOW()`,
      [room.code, room.players?.[0]?.username || room.hostUsername || null, room.gameType, room.status || 'open', JSON.stringify(room)]);
  }
}
async function saveFriendships(rows) {
  await pgQ('DELETE FROM friendships', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO friendships (id, user_a, user_b, status, requester, favorite_by, blocked_by, payload, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.user_a, row.user_b, row.status, row.requester, JSON.stringify(row.favorite_by || []), JSON.stringify(row.blocked_by || []), JSON.stringify(row), row.created_at || nowIso(), row.updated_at || nowIso()]);
  }
}
async function saveInvites(rows) {
  await pgQ('DELETE FROM invites', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO invites (id, type, from_user, to_user, room_code, game_type, status, expires_at, payload, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.type, row.fromUser, row.toUser, row.roomCode || null, row.gameType || null, row.status, row.expiresAt, JSON.stringify(row), row.createdAt || nowIso()]);
  }
}
async function saveMessages(rows) {
  await pgQ('DELETE FROM private_messages', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO private_messages (id, thread_key, sender, recipient, kind, content, seen_at, payload, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, row.threadKey, row.sender, row.recipient, row.kind, typeof row.content === 'string' ? row.content : JSON.stringify(row.content), row.seenAt || null, JSON.stringify(row), row.createdAt || nowIso()]);
  }
}
async function saveNotifications(rows) {
  await pgQ('DELETE FROM notifications', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO notifications (id, username, type, title, body, is_read, payload, created_at, read_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, row.username, row.type, row.title, row.body, !!row.readAt, JSON.stringify(row), row.createdAt || nowIso(), row.readAt || null]);
  }
}
async function savePurchases(rows) {
  await pgQ('DELETE FROM purchases', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO purchases (id, username, provider, sku, status, amount, currency, payload, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.id, row.username, row.provider, row.sku, row.status, row.amount, row.currency, JSON.stringify(row), row.createdAt || nowIso()]);
  }
}
async function saveGifts(rows) {
  await pgQ('DELETE FROM gifts', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO gifts (id, sender, recipient, gift_type, status, payload, created_at, claimed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.sender, row.recipient, row.giftType, row.status, JSON.stringify(row), row.createdAt || nowIso(), row.claimedAt || null]);
  }
}
async function saveReports(rows) {
  await pgQ('DELETE FROM reports', []);
  for (const row of rows) {
    await pgQ(`INSERT INTO reports (id, reporter, target, reason, payload, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, row.reporter, row.target, row.reason, JSON.stringify(row), row.createdAt || nowIso()]);
  }
}

async function findUser(username) {
  if (!username) return null;
  const users = await readUsers();
  return users.find(u => u.username.toLowerCase() === String(username).toLowerCase()) || null;
}

async function persistUser(updated) {
  const users = await readUsers();
  const idx = users.findIndex(u => u.username.toLowerCase() === updated.username.toLowerCase());
  if (idx >= 0) users[idx] = syncUserFields(updated);
  else users.push(syncUserFields(updated));
  await writeUsers(users);
  return syncUserFields(updated);
}

async function createUser(username, passwordHash) {
  const user = syncUserFields(normalizeUser({
    id: Date.now(),
    username,
    password_hash: passwordHash,
    avatar: '♞',
    coins: DEFAULT_WALLET.coins,
    gems: DEFAULT_WALLET.gems,
    level: 1,
    xp: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    elo: 1200,
    profile: DEFAULT_PROFILE(username),
    wallet: clone(DEFAULT_WALLET),
    settings: clone(DEFAULT_SETTINGS),
    inventory: clone(DEFAULT_INVENTORY),
    missions: {},
    rewardState: {},
    created_at: nowIso(),
  }));
  ensureMissionEntries(user);
  await persistUser(user);
  await addNotification(username, 'welcome', 'أهلاً بك', 'تم إنشاء حسابك وتجهيز الملف الشخصي والمحفظة');
  return user;
}

async function safeUser(user) {
  const u = syncUserFields(normalizeUser(user));
  ensureMissionEntries(u);
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    coins: u.coins,
    gems: u.gems,
    level: u.level,
    xp: u.xp,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    elo: u.elo,
    wallet: u.wallet,
    settings: u.settings,
    profile: u.profile,
    inventory: u.inventory,
    rewardState: u.rewardState,
    missions: Object.values(u.missions),
    lastSeen: u.lastSeen,
    online: !!u.online,
  };
}

async function updateUserStats(username, { win, loss, draw, xpGain = 0, eloDelta = 0 }) {
  const user = await findUser(username);
  if (!user) return null;
  if (win) { user.wins += 1; user.wallet.coins += 50; }
  if (loss) user.losses += 1;
  if (draw) { user.draws += 1; user.wallet.coins += 15; }
  user.xp += xpGain;
  user.wallet.xp = user.xp;
  user.level = deriveLevel(user.xp);
  user.elo += eloDelta;
  user.coins = user.wallet.coins;
  user.gems = user.wallet.gems;
  user.last_login = nowIso();
  ensureMissionEntries(user);
  incrementMission(user, 'daily_play_1', 1);
  incrementMission(user, 'monthly_rank_20', 1);
  if (win) {
    incrementMission(user, 'daily_win_1', 1);
    incrementMission(user, 'weekly_win_5', 1);
    incrementMission(user, 'achievement_first_win', 1);
  }
  await persistUser(user);
  if (user.level > (await findUser(username))?.level) {
    await addNotification(username, 'level_up', 'Level Up', `وصلت إلى المستوى ${user.level}`);
  }
  return user;
}

function incrementMission(user, code, amount = 1) {
  ensureMissionEntries(user);
  const entry = user.missions[code];
  if (!entry || entry.claimed) return;
  entry.progress = Math.min(entry.goal, Number(entry.progress || 0) + amount);
  entry.updatedAt = nowIso();
}

async function awardMissionProgress(username, code, amount = 1) {
  const user = await findUser(username);
  if (!user) return null;
  incrementMission(user, code, amount);
  await persistUser(user);
  return user;
}

async function updateProfile(username, patch) {
  const user = await findUser(username);
  if (!user) return null;
  user.profile = mergeDeep(user.profile, patch || {});
  if (patch?.avatar) user.avatar = patch.avatar;
  await persistUser(user);
  return safeUser(user);
}

async function updateSettings(username, patch) {
  const user = await findUser(username);
  if (!user) return null;
  user.settings = mergeDeep(user.settings, patch || {});
  await persistUser(user);
  return safeUser(user);
}

async function updateWallet(username, deltas = {}, reason = 'system') {
  const user = await findUser(username);
  if (!user) return null;
  applyRewardsToUser(user, deltas, reason);
  await persistUser(user);
  return safeUser(user);
}

async function getLeaderboard(limit = 20) {
  const users = await readUsers();
  return users.map(u => ({
    username: u.username,
    avatar: u.avatar,
    wins: u.wins || 0,
    losses: u.losses || 0,
    draws: u.draws || 0,
    total_games: (u.wins || 0) + (u.losses || 0) + (u.draws || 0),
    win_rate: (u.wins || 0) + (u.losses || 0) ? Math.round(((u.wins || 0) / Math.max(1, (u.wins || 0) + (u.losses || 0))) * 1000) / 10 : 0,
    level: u.level || 1,
    elo: u.elo || 1200,
    coins: u.coins || 0,
  })).sort((a, b) => (b.elo - a.elo) || (b.wins - a.wins)).slice(0, limit);
}

async function saveMatch(match) {
  const matches = await getCollection('matches', FILES.matches);
  const rec = { id: match.id || uid('match'), ...match, finished_at: match.finished_at || nowIso() };
  const idx = matches.findIndex(m => m.id === rec.id);
  if (idx >= 0) matches[idx] = rec;
  else matches.push(rec);
  await saveCollection('matches', FILES.matches, matches);
  return rec.id;
}

async function getMatchHistory(username, limit = 20) {
  const matches = await getCollection('matches', FILES.matches);
  return matches
    .filter(m => (m.players || []).some(p => String(p.username).toLowerCase() === String(username).toLowerCase()))
    .sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0))
    .slice(0, limit);
}

function friendPair(a, b) {
  const pair = [String(a).toLowerCase(), String(b).toLowerCase()].sort();
  return { user_a: pair[0], user_b: pair[1] };
}

async function getFriendshipRows() {
  const rows = await getCollection('friendships', FILES.friendships);
  return rows.map(r => ({ favorite_by: [], blocked_by: [], ...r }));
}

async function createFriendRequest(fromUser, toUser) {
  const from = await findUser(fromUser);
  const to = await findUser(toUser);
  if (!from || !to) throw new Error('المستخدم غير موجود');
  if (from.username.toLowerCase() === to.username.toLowerCase()) throw new Error('لا يمكنك إضافة نفسك');
  const rows = await getFriendshipRows();
  const pair = friendPair(from.username, to.username);
  const existing = rows.find(r => r.user_a === pair.user_a && r.user_b === pair.user_b);
  if (existing) {
    if (existing.blocked_by?.includes(to.username) || existing.blocked_by?.includes(from.username)) throw new Error('العلاقة محظورة');
    if (existing.status === 'accepted') throw new Error('هو بالفعل ضمن أصدقائك');
    if (existing.status === 'pending') throw new Error('هناك طلب معلق بالفعل');
  }
  const record = {
    id: existing?.id || uid('fr'),
    ...pair,
    requester: from.username,
    target: to.username,
    status: 'pending',
    favorite_by: existing?.favorite_by || [],
    blocked_by: existing?.blocked_by || [],
    created_at: existing?.created_at || nowIso(),
    updated_at: nowIso(),
  };
  const next = rows.filter(r => !(r.user_a === pair.user_a && r.user_b === pair.user_b));
  next.push(record);
  await saveCollection('friendships', FILES.friendships, next);
  await addNotification(to.username, 'friend_request', 'طلب صداقة جديد', `${from.username} أرسل لك طلب صداقة`, { fromUser: from.username, friendshipId: record.id });
  return record;
}

async function respondFriendRequest(id, username, action) {
  const rows = await getFriendshipRows();
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0) throw new Error('الطلب غير موجود');
  const row = rows[idx];
  if (![row.user_a, row.user_b, row.target?.toLowerCase()].includes(String(username).toLowerCase())) throw new Error('غير مصرح');
  row.status = action === 'accept' ? 'accepted' : 'rejected';
  row.updated_at = nowIso();
  rows[idx] = row;
  await saveCollection('friendships', FILES.friendships, rows);
  const other = row.requester;
  await addNotification(other, 'friend_request_response', action === 'accept' ? 'تم قبول الطلب' : 'تم رفض الطلب', `${username} ${action === 'accept' ? 'قبل' : 'رفض'} طلب الصداقة`, { by: username });
  return row;
}

async function getFriends(username) {
  const rows = await getFriendshipRows();
  const meLower = String(username).toLowerCase();
  const users = await readUsers();
  return rows.filter(r => r.status === 'accepted' && (r.user_a === meLower || r.user_b === meLower)).map(r => {
    const otherName = r.user_a === meLower ? r.user_b : r.user_a;
    const user = users.find(u => u.username.toLowerCase() === otherName);
    return user ? {
      username: user.username,
      avatar: user.avatar,
      elo: user.elo,
      level: user.level,
      online: !!user.online,
      lastSeen: user.lastSeen,
      favorite: r.favorite_by?.includes(username),
      blocked: r.blocked_by?.includes(username),
    } : null;
  }).filter(Boolean);
}

async function toggleFavoriteFriend(username, friendName) {
  const rows = await getFriendshipRows();
  const pair = friendPair(username, friendName);
  const idx = rows.findIndex(r => r.user_a === pair.user_a && r.user_b === pair.user_b && r.status === 'accepted');
  if (idx < 0) throw new Error('الصديق غير موجود');
  const fav = new Set(rows[idx].favorite_by || []);
  if (fav.has(username)) fav.delete(username); else fav.add(username);
  rows[idx].favorite_by = [...fav];
  rows[idx].updated_at = nowIso();
  await saveCollection('friendships', FILES.friendships, rows);
  return rows[idx];
}

async function blockUser(username, target) {
  const rows = await getFriendshipRows();
  const pair = friendPair(username, target);
  let row = rows.find(r => r.user_a === pair.user_a && r.user_b === pair.user_b);
  if (!row) {
    row = { id: uid('fr'), ...pair, requester: username, target, status: 'blocked', favorite_by: [], blocked_by: [username], created_at: nowIso(), updated_at: nowIso() };
    rows.push(row);
  } else {
    const blocked = new Set(row.blocked_by || []);
    blocked.add(username);
    row.blocked_by = [...blocked];
    row.status = row.status === 'accepted' ? 'accepted' : 'blocked';
    row.updated_at = nowIso();
  }
  await saveCollection('friendships', FILES.friendships, rows);
  await addNotification(target, 'blocked', 'تم حظرك', `${username} قام بحظرك`, { by: username });
  return row;
}

async function unblockUser(username, target) {
  const rows = await getFriendshipRows();
  const pair = friendPair(username, target);
  const row = rows.find(r => r.user_a === pair.user_a && r.user_b === pair.user_b);
  if (!row) return null;
  row.blocked_by = (row.blocked_by || []).filter(x => x !== username);
  if (!row.blocked_by.length && row.status === 'blocked') row.status = 'rejected';
  row.updated_at = nowIso();
  await saveCollection('friendships', FILES.friendships, rows);
  return row;
}

async function reportUser(reporter, target, reason) {
  const rows = await getCollection('reports', FILES.reports);
  const rec = { id: uid('rep'), reporter, target, reason, createdAt: nowIso() };
  rows.push(rec);
  await saveCollection('reports', FILES.reports, rows);
  return rec;
}

async function savePrivateMessage(sender, recipient, kind, content) {
  const messages = await getCollection('messages', FILES.messages);
  const rec = {
    id: uid('msg'),
    threadKey: threadKey(sender, recipient),
    sender,
    recipient,
    kind,
    content,
    createdAt: nowIso(),
    seenAt: null,
  };
  messages.push(rec);
  await saveCollection('messages', FILES.messages, messages);
  await awardMissionProgress(sender, 'daily_social_1', 1);
  await addNotification(recipient, 'private_message', 'رسالة خاصة جديدة', `${sender} أرسل لك ${kind === 'voice' ? 'رسالة صوتية' : 'رسالة'}`, { fromUser: sender, kind });
  return rec;
}

async function getPrivateThread(username, withUser) {
  const messages = await getCollection('messages', FILES.messages);
  const key = threadKey(username, withUser);
  return messages.filter(m => m.threadKey === key).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

async function markThreadSeen(username, withUser) {
  const messages = await getCollection('messages', FILES.messages);
  let changed = false;
  for (const msg of messages) {
    if (msg.threadKey === threadKey(username, withUser) && msg.recipient === username && !msg.seenAt) {
      msg.seenAt = nowIso();
      changed = true;
    }
  }
  if (changed) await saveCollection('messages', FILES.messages, messages);
  return changed;
}

async function addNotification(username, type, title, body, payload = {}) {
  const items = await getCollection('notifications', FILES.notifications);
  const rec = { id: uid('ntf'), username, type, title, body, payload, createdAt: nowIso(), readAt: null };
  items.push(rec);
  await saveCollection('notifications', FILES.notifications, items);
  return rec;
}

async function getNotifications(username) {
  const items = await getCollection('notifications', FILES.notifications);
  return items.filter(n => n.username === username).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 100);
}

async function markNotificationsRead(username) {
  const items = await getCollection('notifications', FILES.notifications);
  let changed = false;
  for (const n of items) {
    if (n.username === username && !n.readAt) {
      n.readAt = nowIso();
      changed = true;
    }
  }
  if (changed) await saveCollection('notifications', FILES.notifications, items);
  return true;
}

async function createInvite({ type = 'game', fromUser, toUser, roomCode = null, gameType = 'chess', payload = {}, expiresSec = 60 }) {
  const rows = await getCollection('invites', FILES.invites);
  const existing = rows.find(inv => inv.type === type && inv.fromUser === fromUser && inv.toUser === toUser && inv.status === 'pending');
  if (existing) throw new Error('توجد دعوة معلقة بالفعل');
  const rec = {
    id: uid('inv'),
    type,
    fromUser,
    toUser,
    roomCode,
    gameType,
    payload,
    status: 'pending',
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + expiresSec * 1000).toISOString(),
  };
  rows.push(rec);
  await saveCollection('invites', FILES.invites, rows);
  await addNotification(toUser, 'invitation', 'دعوة جديدة', `${fromUser} أرسل لك دعوة`, { inviteId: rec.id, roomCode, gameType, type });
  return rec;
}

async function expireInvites() {
  const rows = await getCollection('invites', FILES.invites);
  let changed = false;
  const now = Date.now();
  for (const inv of rows) {
    if (inv.status === 'pending' && new Date(inv.expiresAt).getTime() < now) {
      inv.status = 'expired';
      changed = true;
    }
  }
  if (changed) await saveCollection('invites', FILES.invites, rows);
  return rows;
}

async function getPendingInvites(username) {
  await expireInvites();
  const rows = await getCollection('invites', FILES.invites);
  return rows.filter(inv => inv.toUser === username && inv.status === 'pending');
}

async function respondInvite(id, username, action) {
  const rows = await getCollection('invites', FILES.invites);
  const idx = rows.findIndex(r => r.id === id);
  if (idx < 0) throw new Error('الدعوة غير موجودة');
  const invite = rows[idx];
  if (invite.toUser !== username) throw new Error('غير مصرح');
  if (invite.status !== 'pending') throw new Error('الدعوة غير متاحة');
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    invite.status = 'expired';
    rows[idx] = invite;
    await saveCollection('invites', FILES.invites, rows);
    throw new Error('انتهت صلاحية الدعوة');
  }
  invite.status = action === 'accept' ? 'accepted' : 'rejected';
  invite.respondedAt = nowIso();
  rows[idx] = invite;
  await saveCollection('invites', FILES.invites, rows);
  await addNotification(invite.fromUser, 'invitation_response', action === 'accept' ? 'تم قبول الدعوة' : 'تم رفض الدعوة', `${username} ${action === 'accept' ? 'قبل' : 'رفض'} الدعوة`, { inviteId: id, roomCode: invite.roomCode });
  return invite;
}

async function getStoreCatalog() {
  return STORE_ITEMS;
}

async function purchaseItem(username, sku, provider = 'stripe') {
  const item = STORE_ITEMS.find(x => x.sku === sku);
  if (!item) throw new Error('المنتج غير موجود');
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  const purchase = {
    id: uid('order'),
    username,
    provider,
    sku,
    status: 'success',
    amount: item.price,
    currency: item.currency,
    rewards: item.rewards,
    createdAt: nowIso(),
  };
  applyRewardsToUser(user, item.rewards, `purchase:${sku}`);
  if (item.rewards.item) {
    const bucket = user.inventory.items || (user.inventory.items = []);
    if (!bucket.includes(item.rewards.item)) bucket.push(item.rewards.item);
  }
  await persistUser(user);
  const orders = await getCollection('purchases', FILES.purchases);
  orders.push(purchase);
  await saveCollection('purchases', FILES.purchases, orders);
  await addNotification(username, 'purchase_success', 'تمت عملية الشراء', `${item.title} تمت إضافته إلى حسابك`, { sku, provider });
  return purchase;
}

async function getPurchaseHistory(username) {
  const orders = await getCollection('purchases', FILES.purchases);
  return orders.filter(o => o.username === username).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function sendGift(sender, recipient, giftType, payload = {}) {
  const from = await findUser(sender);
  const to = await findUser(recipient);
  if (!from || !to) throw new Error('المستخدم غير موجود');
  const gift = {
    id: uid('gift'),
    sender,
    recipient,
    giftType,
    payload,
    status: 'received',
    createdAt: nowIso(),
    claimedAt: null,
  };
  const rows = await getCollection('gifts', FILES.gifts);
  rows.push(gift);
  await saveCollection('gifts', FILES.gifts, rows);
  await addNotification(recipient, 'gift_received', 'وصلتك هدية', `${sender} أرسل لك هدية من نوع ${giftType}`, { giftId: gift.id });
  return gift;
}

async function claimGift(username, giftId) {
  const rows = await getCollection('gifts', FILES.gifts);
  const gift = rows.find(g => g.id === giftId && g.recipient === username);
  if (!gift) throw new Error('الهدية غير موجودة');
  if (gift.claimedAt) throw new Error('تم استلام الهدية مسبقاً');
  gift.claimedAt = nowIso();
  gift.status = 'claimed';
  const user = await findUser(username);
  applyRewardsToUser(user, gift.payload.rewards || { coins: 250 }, `gift:${gift.giftType}`);
  await persistUser(user);
  await saveCollection('gifts', FILES.gifts, rows);
  return gift;
}

async function createDailyGift(username) {
  return sendGift('System', username, 'daily', { rewards: { coins: 300, energy: 10 } });
}

async function createLuckyGift(username) {
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  if (user.rewardState.luckyGiftClaimedOn === todayKey()) throw new Error('تم الحصول على الهدية المحظوظة اليوم');
  user.rewardState.luckyGiftClaimedOn = todayKey();
  await persistUser(user);
  return sendGift('Lucky Wheel', username, 'lucky', { rewards: { coins: 500 + Math.floor(Math.random() * 1500), gems: 5 + Math.floor(Math.random() * 15) } });
}

async function createBirthdayGift(username) {
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  if (user.rewardState.birthdayGiftClaimedOn === monthKey()) throw new Error('تم استلام هدية الميلاد لهذا الشهر');
  user.rewardState.birthdayGiftClaimedOn = monthKey();
  await persistUser(user);
  return sendGift('Birthday', username, 'birthday', { rewards: { gems: 40, diamonds: 10, item: 'Birthday Crown' } });
}

async function getGiftHistory(username) {
  const rows = await getCollection('gifts', FILES.gifts);
  return rows.filter(g => g.sender === username || g.recipient === username).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function claimDailyLogin(username) {
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  if (user.rewardState.lastLoginClaim === todayKey()) throw new Error('تم استلام مكافأة الدخول اليوم');
  const nextStreak = user.rewardState.lastLoginClaim === new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    ? (user.rewardState.loginStreak || 0) + 1
    : 1;
  user.rewardState.lastLoginClaim = todayKey();
  user.rewardState.loginStreak = nextStreak;
  applyRewardsToUser(user, DAILY_REWARDS.login, 'daily_login');
  const day7 = DAILY_REWARDS.days7[(nextStreak - 1) % 7];
  applyRewardsToUser(user, day7.rewards, '7days');
  await persistUser(user);
  await addNotification(username, 'daily_bonus', 'مكافأة يومية', `تمت إضافة مكافأة اليوم وسلسلة اليوم ${nextStreak}`);
  return { streak: nextStreak, rewards: [DAILY_REWARDS.login, day7.rewards] };
}

async function claimCalendarReward(username, day) {
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  const num = Number(day);
  if (num < 1 || num > 30) throw new Error('يوم غير صالح');
  if (user.rewardState.claimed30Days.includes(num)) throw new Error('تم استلام هذه الجائزة مسبقاً');
  const reward = DAILY_REWARDS.days30.find(d => d.day === num);
  user.rewardState.claimed30Days.push(num);
  applyRewardsToUser(user, reward.rewards, `calendar:${num}`);
  await persistUser(user);
  return reward;
}

async function getUserMissions(username) {
  const user = await findUser(username);
  if (!user) return [];
  ensureMissionEntries(user);
  await persistUser(user);
  return MISSION_CATALOG.map(m => ({ ...m, ...(user.missions[m.code] || {}) }));
}

async function claimMission(username, code) {
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  ensureMissionEntries(user);
  const mission = MISSION_CATALOG.find(m => m.code === code);
  const entry = user.missions[code];
  if (!mission || !entry) throw new Error('المهمة غير موجودة');
  if (entry.claimed) throw new Error('تم استلام الجائزة مسبقاً');
  if (entry.progress < entry.goal) throw new Error('المهمة لم تكتمل بعد');
  entry.claimed = true;
  applyRewardsToUser(user, mission.rewards, `mission:${code}`);
  await persistUser(user);
  await addNotification(username, 'mission_completed', 'تمت مهمة', `${mission.title} — تم منحك الجائزة`, { code });
  return { mission, entry };
}

async function saveRoom(room) {
  const rooms = await getCollection('rooms', FILES.rooms);
  const idx = rooms.findIndex(r => r.code === room.code);
  const next = { ...room, updatedAt: nowIso() };
  if (idx >= 0) rooms[idx] = next; else rooms.push(next);
  await saveCollection('rooms', FILES.rooms, rooms);
  return next;
}

async function getRoom(code) {
  const rooms = await getCollection('rooms', FILES.rooms);
  return rooms.find(r => r.code === String(code).toUpperCase()) || null;
}

async function deleteRoom(code) {
  const rooms = await getCollection('rooms', FILES.rooms);
  const next = rooms.filter(r => r.code !== String(code).toUpperCase());
  await saveCollection('rooms', FILES.rooms, next);
}

async function setPresence(username, online) {
  const user = await findUser(username);
  if (!user) return null;
  user.online = !!online;
  user.lastSeen = online ? null : nowIso();
  user.last_login = nowIso();
  await persistUser(user);
  return user;
}

async function getAchievements(username) {
  const user = await findUser(username);
  if (!user) return [];
  const friends = await getFriends(username);
  const ownedSkins = Object.values(user.inventory?.skins || {}).flat().length;
  const achievements = [
    { id: 'first_win', name: 'أول انتصار', icon: '🏆', desc: 'اربح أول مباراة', unlocked: user.wins >= 1 },
    { id: 'ten_wins', name: 'محارب', icon: '⚔️', desc: 'اربح 10 مباريات', unlocked: user.wins >= 10 },
    { id: 'fifty_wins', name: 'بطل', icon: '👑', desc: 'اربح 50 مباراة', unlocked: user.wins >= 50 },
    { id: 'grandmaster', name: 'أستاذ كبير', icon: '🎖️', desc: 'صل إلى Elo 2000', unlocked: user.elo >= 2000 },
    { id: 'social', name: 'اجتماعي', icon: '🤝', desc: 'كوّن 3 صداقات', unlocked: friends.length >= 3 },
    { id: 'collector', name: 'جامع السكنات', icon: '💎', desc: 'امتلك 10 سكنات', unlocked: ownedSkins >= 10 },
    { id: 'veteran', name: 'مخضرم', icon: '⭐', desc: 'صل إلى المستوى 10', unlocked: user.level >= 10 },
  ];
  return achievements.filter(a => a.unlocked);
}

async function deleteUser(username) {
  const users = (await readUsers()).filter(u => u.username !== username);
  await writeUsers(users);
  for (const file of [FILES.friendships, FILES.invites, FILES.messages, FILES.notifications, FILES.purchases, FILES.gifts, FILES.matches, FILES.rooms, FILES.reports]) {
    const rows = rj(file).filter(row => !JSON.stringify(row).includes(`\"${username}\"`) && !JSON.stringify(row).includes(username));
    wj(file, rows);
  }
  return true;
}

async function getBootstrap(username) {
  const user = await findUser(username);
  if (!user) throw new Error('المستخدم غير موجود');
  ensureMissionEntries(user);
  await persistUser(user);
  return {
    user: await safeUser(user),
    leaderboard: await getLeaderboard(10),
    friends: await getFriends(username),
    friendRequests: (await getFriendshipRows()).filter(r => r.status === 'pending' && r.target === username).map(r => ({ id: r.id, fromUser: r.requester, createdAt: r.created_at })),
    invites: await getPendingInvites(username),
    notifications: await getNotifications(username),
    missions: await getUserMissions(username),
    achievements: await getAchievements(username),
    store: await getStoreCatalog(),
    gifts: await getGiftHistory(username),
    purchases: await getPurchaseHistory(username),
    history: await getMatchHistory(username, 10),
    skins: SKIN_REWARDS,
    rewards: DAILY_REWARDS,
  };
}

module.exports = {
  initPg,
  isPG: () => usePG,
  findUser,
  createUser,
  safeUser,
  persistUser,
  updateUserStats,
  updateProfile,
  updateSettings,
  updateWallet,
  getLeaderboard,
  saveMatch,
  getMatchHistory,
  createFriendRequest,
  respondFriendRequest,
  getFriends,
  toggleFavoriteFriend,
  blockUser,
  unblockUser,
  reportUser,
  savePrivateMessage,
  getPrivateThread,
  markThreadSeen,
  addNotification,
  getNotifications,
  markNotificationsRead,
  createInvite,
  expireInvites,
  getPendingInvites,
  respondInvite,
  getStoreCatalog,
  purchaseItem,
  getPurchaseHistory,
  sendGift,
  claimGift,
  createDailyGift,
  createLuckyGift,
  createBirthdayGift,
  getGiftHistory,
  claimDailyLogin,
  claimCalendarReward,
  getUserMissions,
  claimMission,
  saveRoom,
  getRoom,
  deleteRoom,
  setPresence,
  getAchievements,
  deleteUser,
  getBootstrap,
  awardMissionProgress,
};