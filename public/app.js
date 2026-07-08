const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const wait = ms => new Promise(r => setTimeout(r, ms));

const state = {
  token: localStorage.getItem('warhex_token') || '',
  user: JSON.parse(localStorage.getItem('warhex_user') || 'null'),
  socket: null,
  data: { friends: [], friendRequests: [], invites: [], notifications: [], missions: [], achievements: [], store: [], gifts: [], purchases: [], history: [], skins: [], rewards: {} },
  room: null,
  selectedGame: 'chess',
  selectedMode: 'online',
  aiDifficulty: 'medium',
  currentScreen: 'play',
  selectedFriend: null,
  privateMessages: [],
  typingTimer: null,
  mmStartedAt: 0,
  mmInterval: null,
  gameMode: null,
  reconnecting: false,
  pendingJoinCode: location.pathname.startsWith('/join/') ? location.pathname.split('/join/')[1]?.toUpperCase() : '',
  mediaRecorder: null,
  recordedChunks: [],
  soundEnabled: true,
};

const GAME_META = {
  chess: { icon: '♟️', title: 'الشطرنج', desc: 'Chess HD + تحليل + AI', style: 'تكتيكي' },
  ludo: { icon: '🎲', title: 'النرد / لودو', desc: 'رمي نرد متحرك وواجهة عصرية', style: 'ملون' },
  jackaroo: { icon: '🃏', title: 'جاكارو', desc: 'طاولة عربية احترافية وبطاقات متحركة', style: 'فخم' },
  warhex: { icon: '⬡', title: 'Warhex', desc: 'معارك تكتيكية على شبكة سداسية', style: 'استراتيجي' },
  connect4: { icon: '🔴', title: 'Connect 4', desc: 'لعب سريع وتنافسي', style: 'كاجوال' },
};
const MODE_META = {
  online: { icon: '🌐', title: 'غرفة أونلاين', desc: 'إنشاء كود ورابط ودعوة أصدقاء' },
  random: { icon: '🎯', title: 'Random Match', desc: 'Queue + Loading + Auto Join' },
  ai: { icon: '🤖', title: 'AI Battle', desc: 'Minimax / Stockfish-ready' },
  local: { icon: '📱', title: 'Local Pass & Play', desc: 'لاعبان على نفس الجهاز' },
};

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toastContainer').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, 3200);
}
function showModal(title, html) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
function formatDate(ts) { try { return new Date(ts).toLocaleString('ar'); } catch { return '-'; } }
function formatShort(ts) { try { return new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }); } catch { return '-'; } }
function copyText(value, label = 'تم النسخ') { navigator.clipboard?.writeText(value).then(() => toast(label, 'success')).catch(() => toast('تعذر النسخ', 'error')); }
function shareLink(url, title = 'Warhex Arena Pro') { if (navigator.share) navigator.share({ title, url }).catch(() => {}); else copyText(url); }
function authHeaders() { return { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }; }

async function api(path, body = null, method = body ? 'POST' : 'GET') {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'خطأ');
  return j;
}

function saveSession(payload) {
  state.token = payload.token;
  state.user = payload.user;
  localStorage.setItem('warhex_token', state.token);
  localStorage.setItem('warhex_user', JSON.stringify(state.user));
}
function clearSession() {
  localStorage.removeItem('warhex_token');
  localStorage.removeItem('warhex_user');
  state.token = '';
  state.user = null;
  state.room = null;
  state.data = { friends: [], friendRequests: [], invites: [], notifications: [], missions: [], achievements: [], store: [], gifts: [], purchases: [], history: [], skins: [], rewards: {} };
}

function runLoading() {
  const steps = ['تهيئة النظام', 'تحميل الواجهة', 'ربط الشبكة', 'جاهز'];
  let v = 0;
  const int = setInterval(() => {
    v += Math.random() * 18 + 5;
    if (v >= 100) { v = 100; clearInterval(int); setTimeout(showAuthOrApp, 350); }
    $('#loadingBar').style.width = `${v}%`;
    $('#loadingPercent').textContent = `${Math.floor(v)}%`;
    $('#loadingStatus').textContent = steps[Math.min(steps.length - 1, Math.floor(v / 25))];
  }, 180);
}

async function showAuthOrApp() {
  $('#loadingScreen').classList.add('hidden');
  if (state.token && state.user) {
    try {
      await api('/api/profile');
      $('#authScreen').classList.add('hidden');
      $('#appShell').classList.remove('hidden');
      connectSocket();
      await loadBootstrap();
      if (state.pendingJoinCode) joinCode(state.pendingJoinCode);
      return;
    } catch {
      clearSession();
    }
  }
  $('#authScreen').classList.remove('hidden');
}

async function handleLogin() {
  try {
    const data = await api('/api/login', { username: $('#loginUser').value.trim(), password: $('#loginPass').value });
    saveSession(data); $('#authScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); connectSocket(); await loadBootstrap();
  } catch (e) { $('#loginError').textContent = e.message; }
}
async function handleRegister() {
  try {
    const data = await api('/api/register', { username: $('#registerUser').value.trim(), password: $('#registerPass').value });
    saveSession(data); $('#authScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); connectSocket(); await loadBootstrap();
  } catch (e) { $('#registerError').textContent = e.message; }
}
function logout() { VoiceChat.stop(); state.socket?.disconnect(); clearSession(); location.href = '/'; }

async function loadBootstrap() {
  const boot = await api('/api/bootstrap');
  state.user = boot.user;
  state.data = { ...state.data, ...boot };
  localStorage.setItem('warhex_user', JSON.stringify(state.user));
  renderAll();
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  state.socket = io({ reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, auth: { token: state.token } });
  const socket = state.socket;
  socket.on('connect', () => { state.reconnecting = false; $('#networkBanner').classList.add('hidden'); socket.emit('session:auth', state.token); VoiceChat.init(socket); });
  socket.io.on('reconnect_attempt', () => { state.reconnecting = true; $('#networkBanner').classList.remove('hidden'); });
  socket.on('session:auth:ok', async () => { if (!state.data.store.length) await loadBootstrap().catch(() => {}); });
  socket.on('session:auth:error', logout);
  socket.on('notification:new', n => { state.data.notifications.unshift(n); renderNotificationsBadge(); toast(n.title || 'إشعار جديد', 'info'); });
  socket.on('social:presence', ({ username, online, lastSeen }) => {
    const f = state.data.friends.find(x => x.username === username); if (f) { f.online = online; f.lastSeen = lastSeen; renderFriends(); }
  });
  socket.on('private:message:new', msg => {
    if (state.selectedFriend && [msg.sender, msg.recipient].includes(state.selectedFriend.username)) state.privateMessages.push(msg);
    const f = state.data.friends.find(x => x.username === msg.sender || x.username === msg.recipient); if (f) f.lastMessageAt = msg.createdAt;
    renderPrivateMessages(); renderFriends(); toast(`رسالة من ${msg.sender}`, 'info');
  });
  socket.on('private:typing', ({ fromUser, typing }) => { if (state.selectedFriend?.username === fromUser) $('#typingIndicator').textContent = typing ? 'يكتب الآن...' : ''; });
  socket.on('private:seen', ({ by }) => { if (state.selectedFriend?.username === by) $('#typingIndicator').textContent = 'تمت المشاهدة'; });
  socket.on('invite:received', inv => { state.data.invites.unshift(inv); renderFriends(); toast(`دعوة من ${inv.fromUser}`, 'success'); });
  socket.on('invite:responded', inv => { toast(`تم ${inv.status === 'accepted' ? 'قبول' : 'رفض'} الدعوة`, inv.status === 'accepted' ? 'success' : 'info'); });
  socket.on('room:created', room => { state.gameMode = 'online'; state.room = room; showRoomShareModal(room); enterGameScreen(); renderCurrentRoom(); });
  socket.on('room:joined', room => { state.gameMode = room.matchMode === 'random' ? 'random' : 'online'; state.room = room; enterGameScreen(); renderCurrentRoom(); });
  socket.on('room:update', room => { state.room = room; renderCurrentRoom(); if (!$('#gameScreen').classList.contains('hidden')) renderMatch(); });
  socket.on('room:error', msg => toast(msg, 'error'));
  socket.on('matchmaking:searching', ({ startedAt }) => { state.mmStartedAt = startedAt || Date.now(); showMatchmaking('البحث عن لاعب...', 'نبحث عن خصم مناسب'); });
  socket.on('matchmaking:found', ({ opponent, countdown, room }) => { state.room = room; showMatchmaking(`تم العثور على ${opponent}`, `بدء المباراة خلال ${countdown} ثوان`); });
  socket.on('matchmaking:ready', ({ room }) => { hideMatchmaking(); state.gameMode = 'random'; state.room = room; enterGameScreen(); if (isHost() && !state.room.gameState) socket.emit('game:start'); });
  socket.on('matchmaking:cancelled', hideMatchmaking);
  socket.on('matchmaking:restart', ({ reason }) => { toast(reason || 'إعادة البحث...', 'info'); showMatchmaking('إعادة البحث', reason || 'تمت إعادة البحث'); });
  socket.on('game:start', ({ gameType, players }) => {
    if (!state.room) state.room = { code: 'LIVE', gameType, players, chat: [] };
    state.room.gameType = gameType; state.room.players = players;
    state.room.gameState = createGame(gameType, players);
    if (isHost()) socket.emit('game:state', state.room.gameState);
    renderMatch();
  });
  socket.on('game:action', payload => {
    if (!state.room?.gameState) return;
    if (isHost() && payload.senderSocketId !== socket.id) {
      const next = applyGameAction(clone(state.room.gameState), payload.action, payload.sender);
      if (next) { state.room.gameState = next; socket.emit('game:state', next); renderMatch(); maybeTriggerAi(); }
    }
  });
  socket.on('game:command', cmd => {
    if (cmd.type === 'draw_offer') toast(`${cmd.from} يطلب تعادلاً`, 'info');
    if (cmd.type === 'draw_response') toast(cmd.accepted ? 'تم قبول التعادل' : 'تم رفض التعادل', cmd.accepted ? 'success' : 'info');
    if (cmd.type === 'resign') toast(`${cmd.by} استسلم`, 'info');
    if (cmd.type === 'replay') toast('إعادة المباراة', 'success');
  });
  socket.on('game:forfeit', ({ winner, loser }) => toast(`${loser} غادر — ${winner} فاز`, 'info'));
  socket.on('game:ended', ({ state: gs }) => { if (state.room) state.room.gameState = gs; renderMatch(); });
  socket.on('ai:move', ({ move }) => {
    if (!move || !state.room?.gameState) return;
    const next = applyGameAction(clone(state.room.gameState), { kind: 'move', from: move.from, to: move.to }, '__AI__');
    if (next) { state.room.gameState = next; renderMatch(); analyzeIfEnded(); }
  });
}

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function isHost() { return !!(state.room && state.socket && state.room.hostId === state.socket.id); }
function me() { return state.user?.username || 'أنت'; }
function activeShareLink(code) { return `${location.origin}/join/${code}`; }
function screen(name) { state.currentScreen = name; $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name)); $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === name)); }

function renderAll() {
  renderWallet(); renderPlay(); renderFriends(); renderStore(); renderMissions(); renderRewards(); renderProfile(); renderSettings(); renderNotificationsBadge(); renderCurrentRoom(); if (state.selectedFriend) renderPrivateMessages();
}
function renderWallet() {
  $('#userAvatar').textContent = state.user?.avatar || '♞';
  const w = state.user?.wallet || {};
  $('#walletStrip').innerHTML = [['Coins','🪙',w.coins],['Gems','💎',w.gems],['Gold','🏅',w.gold],['Energy','⚡',w.energy],['XP','⭐',state.user?.xp],['SP','🎖️',w.seasonPoints]].map(([k,i,v]) => `<div class="wallet-card"><small>${i} ${k}</small><b>${v ?? 0}</b></div>`).join('');
}
function renderNotificationsBadge() {
  const unread = (state.data.notifications || []).filter(n => !n.readAt).length;
  $('#notifCount').textContent = unread; $('#notifCount').classList.toggle('hidden', !unread);
}
function renderPlay() {
  $('#gameGrid').innerHTML = Object.entries(GAME_META).map(([k,g]) => `<button class="game-card ${state.selectedGame===k?'active':''}" data-game="${k}"><span class="badge">${g.style}</span><h3>${g.icon} ${g.title}</h3><p>${g.desc}</p></button>`).join('');
  $('#modeGrid').innerHTML = Object.entries(MODE_META).map(([k,m]) => `<button class="mode-card ${state.selectedMode===k?'active':''}" data-mode="${k}"><span class="badge">Mode</span><h3>${m.icon} ${m.title}</h3><p>${m.desc}</p></button>`).join('');
  $$('.game-card').forEach(btn => btn.onclick = () => { state.selectedGame = btn.dataset.game; renderPlay(); });
  $$('.mode-card').forEach(btn => btn.onclick = () => { state.selectedMode = btn.dataset.mode; renderPlay(); });
}
function renderCurrentRoom() {
  if (!state.room) { $('#currentRoomPanel').innerHTML = `<div class="panel-head"><h4>لا توجد غرفة حالياً</h4></div><p class="muted">أنشئ غرفة أو انضم أو ابدأ مباراة عشوائية.</p>`; return; }
  const room = state.room;
  $('#currentRoomPanel').innerHTML = `<div class="current-room-card"><div class="panel-head spaced"><h4>${GAME_META[room.gameType]?.title || room.gameType}</h4><span class="room-code">${room.code}</span></div><div>${room.players.map(p=>`<div class="player-row"><div class="player-top"><b>${p.username}</b><span>${p.ready?'✅':'⏳'}</span></div></div>`).join('')}</div><div class="inline-form"><button class="secondary-btn" onclick="window.copyRoomCode()">Copy Code</button><button class="secondary-btn" onclick="window.shareRoomLink()">Share Link</button><button class="secondary-btn" onclick="window.inviteRoomFriend()">Invite Friend</button>${isHost() ? '<button class="primary-btn" onclick="window.startRoomGame()">Start Match</button>' : ''}</div></div>`;
  window.copyRoomCode = () => copyText(room.code, 'تم نسخ الكود');
  window.shareRoomLink = () => shareLink(activeShareLink(room.code), 'Join my room');
  window.inviteRoomFriend = openInviteModal;
  window.startRoomGame = () => state.socket?.emit('game:start');
}
function renderFriends() {
  $('#friendRequestsList').innerHTML = (state.data.friendRequests || []).map(r => `<div class="request-card"><div class="friend-top"><b>${r.fromUser}</b><small>${formatShort(r.createdAt)}</small></div><div class="inline-form"><button class="primary-btn" onclick="window.respondFriend('${r.id}','accept')">قبول</button><button class="secondary-btn danger" onclick="window.respondFriend('${r.id}','reject')">رفض</button></div></div>`).join('') || '<div class="muted">لا توجد طلبات معلقة</div>';
  $('#friendsList').innerHTML = (state.data.friends || []).map(f => `<div class="friend-card"><div class="friend-top"><div><b>${f.avatar || '👤'} ${f.username}</b><div class="muted">${f.online ? 'Online' : 'Last seen ' + (f.lastSeen ? formatShort(f.lastSeen) : '-')}</div></div><span class="dot ${f.online ? '' : 'offline'}"></span></div><div class="inline-form"><button class="secondary-btn" onclick="window.openChatWith('${f.username}')">Chat</button><button class="secondary-btn" onclick="window.toggleFav('${f.username}')">${f.favorite ? '★' : '☆'}</button><button class="secondary-btn" onclick="window.inviteNamedFriend('${f.username}')">Invite</button><button class="secondary-btn danger" onclick="window.blockNamedFriend('${f.username}')">Block</button></div></div>`).join('') || '<div class="muted">أضف أصدقاء لبدء المحادثة والدعوات.</div>';
}
function renderPrivateMessages() {
  $('#chatHeader').textContent = state.selectedFriend ? `الدردشة مع ${state.selectedFriend.username}` : 'الدردشة الخاصة';
  $('#chatMeta').textContent = state.selectedFriend ? `${state.selectedFriend.online ? 'متصل الآن' : 'آخر ظهور ' + (state.selectedFriend.lastSeen ? formatShort(state.selectedFriend.lastSeen) : '-')}` : 'اختر صديقاً لفتح المحادثة';
  $('#privateMessages').innerHTML = !state.selectedFriend ? '<div class="muted">اختر صديقاً من القائمة.</div>' : (state.privateMessages.map(m => `<div class="msg-bubble ${m.sender===me()?'me':''}"><div class="msg-meta"><span>${m.sender}</span><span>${formatShort(m.createdAt)}</span></div>${m.kind==='voice' ? `<audio controls src="${m.content}"></audio>` : `<div>${m.content}</div>`}<small class="muted">${m.seenAt ? 'Seen' : ''}</small></div>`).join('') || '<div class="muted">لا توجد رسائل بعد.</div>');
  $('#privateMessages').scrollTop = $('#privateMessages').scrollHeight;
}
function renderStore() {
  $('#storeList').innerHTML = (state.data.store || []).map(item => `<div class="store-card"><div class="store-top"><div><b>${item.title}</b><div class="muted">${item.category}</div></div><span class="store-price">$${item.price}</span></div><div class="muted">${Object.entries(item.rewards).map(([k,v])=>`${k}: ${v}`).join(' • ')}</div><button class="primary-btn" onclick="window.buySku('${item.sku}')">شراء الآن</button></div>`).join('');
}
function renderMissions() {
  $('#missionsList').innerHTML = (state.data.missions || []).map(m => `<div class="mission-card"><div class="friend-top"><b>${m.title}</b><span>${m.progress || 0}/${m.goal}</span></div><div class="muted">${m.type}</div><div class="inline-form"><small class="muted">${Object.entries(m.rewards).map(([k,v])=>`${k}:${v}`).join(' • ')}</small>${(m.progress >= m.goal && !m.claimed) ? `<button class="primary-btn" onclick="window.claimMission('${m.code}')">Claim</button>` : `<button class="secondary-btn" disabled>${m.claimed ? 'Claimed' : 'In Progress'}</button>`}</div></div>`).join('');
  $('#achievementsList').innerHTML = (state.data.achievements || []).map(a => `<div class="mission-card"><b>${a.icon} ${a.name}</b><div class="muted">${a.desc}</div></div>`).join('') || '<div class="muted">لا توجد إنجازات مفتوحة بعد.</div>';
}
function renderRewards() {
  $('#giftHistory').innerHTML = (state.data.gifts || []).slice(0, 20).map(g => `<div class="gift-card"><div class="friend-top"><b>${g.giftType}</b><span>${g.claimedAt ? 'Claimed' : 'Pending'}</span></div><div class="muted">${g.sender} ➜ ${g.recipient}</div><div class="inline-form">${g.recipient===me() && !g.claimedAt ? `<button class="primary-btn" onclick="window.claimGift('${g.id}')">استلام</button>` : ''}</div></div>`).join('') || '<div class="muted">لا توجد هدايا حتى الآن.</div>';
  $('#calendarRewards').innerHTML = Array.from({ length: 30 }, (_, i) => i + 1).map(day => {
    const claimed = state.user?.rewardState?.claimed30Days?.includes(day);
    return `<div class="day-card ${claimed?'claimed':''}"><b>Day ${day}</b><div class="muted">${claimed ? '✓ Claimed' : 'Coins/Gems'}</div><button class="secondary-btn" ${claimed?'disabled':''} onclick="window.claimCalendar(${day})">${claimed ? 'تم' : 'Claim'}</button></div>`;
  }).join('');
}
function renderProfile() {
  const u = state.user || {}; const p = u.profile || {}; const inv = u.inventory || { skins: {} };
  $('#profilePanel').innerHTML = `<div class="profile-grid"><div class="profile-top"><div><h3>${u.avatar || '♞'} ${u.username}</h3><div class="muted">${p.title || ''}</div></div><button class="secondary-btn" onclick="window.saveProfile()">حفظ الملف</button></div><label>Avatar<input id="profileAvatarInput" value="${u.avatar || '♞'}"></label><label>Cover<input id="profileCoverInput" value="${p.cover || ''}"></label><label>Country<input id="profileCountryInput" value="${p.country || ''}"></label><label>Bio<textarea id="profileBioInput">${p.bio || ''}</textarea></label><div class="stats-grid"><div class="stat-card"><small>Wins</small><b>${u.wins || 0}</b></div><div class="stat-card"><small>Losses</small><b>${u.losses || 0}</b></div><div class="stat-card"><small>ELO</small><b>${u.elo || 1200}</b></div><div class="stat-card"><small>Level</small><b>${u.level || 1}</b></div><div class="stat-card"><small>Coins</small><b>${u.coins || 0}</b></div><div class="stat-card"><small>Gems</small><b>${u.gems || 0}</b></div></div></div>`;
  $('#inventoryPanel').innerHTML = Object.entries(inv.skins || {}).map(([k,v]) => `<div class="inventory-card"><b>${k}</b><div class="muted">${(v || []).join(' • ') || '—'}</div></div>`).join('');
  $('#historyPanel').innerHTML = (state.data.history || []).slice(0, 10).map(m => `<div class="history-card"><b>${GAME_META[m.game_type]?.title || m.game_type}</b><div class="muted">${m.winner ? 'Winner: ' + m.winner : 'Draw'} • ${formatDate(m.finished_at)}</div></div>`).join('');
}
function renderSettings() {
  const s = state.user?.settings || {};
  const tiles = [
    ['language','Language',`<select id="st_language"><option value="ar" ${s.language==='ar'?'selected':''}>Arabic</option><option value="en" ${s.language==='en'?'selected':''}>English</option></select>`],
    ['darkMode','Dark Mode',`<select id="st_darkMode"><option value="true" ${s.darkMode?'selected':''}>On</option><option value="false" ${!s.darkMode?'selected':''}>Off</option></select>`],
    ['notifications','Notifications',`<select id="st_notifications"><option value="true" ${s.notifications?'selected':''}>On</option><option value="false" ${!s.notifications?'selected':''}>Off</option></select>`],
    ['music','Music',`<select id="st_music"><option value="true" ${s.music?'selected':''}>On</option><option value="false" ${!s.music?'selected':''}>Off</option></select>`],
    ['soundEffects','SFX',`<select id="st_soundEffects"><option value="true" ${s.soundEffects?'selected':''}>On</option><option value="false" ${!s.soundEffects?'selected':''}>Off</option></select>`],
    ['voiceChat','Voice Chat',`<select id="st_voiceChat"><option value="true" ${s.voiceChat?'selected':''}>On</option><option value="false" ${!s.voiceChat?'selected':''}>Off</option></select>`],
    ['privacy','Privacy',`<select id="st_privacy"><option value="public" ${s.privacy==='public'?'selected':''}>Public</option><option value="friends" ${s.privacy==='friends'?'selected':''}>Friends</option><option value="private" ${s.privacy==='private'?'selected':''}>Private</option></select>`],
    ['graphics','Graphics',`<select id="st_graphics"><option value="high" ${s.graphics==='high'?'selected':''}>High</option><option value="medium" ${s.graphics==='medium'?'selected':''}>Medium</option><option value="low" ${s.graphics==='low'?'selected':''}>Low</option></select>`],
    ['fps','FPS',`<select id="st_fps"><option value="30" ${String(s.fps)==='30'?'selected':''}>30</option><option value="60" ${String(s.fps)==='60'?'selected':''}>60</option><option value="120" ${String(s.fps)==='120'?'selected':''}>120</option></select>`],
  ];
  $('#settingsPanel').innerHTML = tiles.map(([k,t,ctrl]) => `<div class="setting-tile"><b>${t}</b>${ctrl}</div>`).join('');
}

async function buySku(sku) { try { const r = await api('/api/store/purchase', { sku, provider: $('#paymentProviderSelect').value }); state.user = r.user; await loadBootstrap(); toast('تمت عملية الشراء', 'success'); } catch (e) { toast(e.message, 'error'); } }
async function claimMission(code) { try { await api('/api/missions/claim', { code }); await loadBootstrap(); toast('تم استلام الجائزة', 'success'); } catch (e) { toast(e.message, 'error'); } }
async function claimGift(giftId) { try { await api('/api/gifts/claim', { giftId }); await loadBootstrap(); toast('تم استلام الهدية', 'success'); } catch (e) { toast(e.message, 'error'); } }
async function claimCalendar(day) { try { await api(`/api/rewards/calendar/${day}/claim`, {}); await loadBootstrap(); toast('تم استلام مكافأة اليوم', 'success'); } catch (e) { toast(e.message, 'error'); } }
async function saveProfile() { try { state.user = (await api('/api/profile', { avatar: $('#profileAvatarInput').value, cover: $('#profileCoverInput').value, country: $('#profileCountryInput').value, bio: $('#profileBioInput').value }, 'PATCH')).user; localStorage.setItem('warhex_user', JSON.stringify(state.user)); renderAll(); toast('تم حفظ الملف الشخصي', 'success'); } catch (e) { toast(e.message, 'error'); } }
async function saveSettings() {
  try {
    const payload = ['language','darkMode','notifications','music','soundEffects','voiceChat','privacy','graphics','fps'].reduce((acc,k)=>{ let v = $(`#st_${k}`).value; acc[k] = ['darkMode','notifications','music','soundEffects','voiceChat'].includes(k) ? v === 'true' : (k==='fps' ? Number(v) : v); return acc; }, {});
    state.user = (await api('/api/settings', payload, 'PATCH')).user; localStorage.setItem('warhex_user', JSON.stringify(state.user)); renderSettings(); toast('تم حفظ الإعدادات', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function respondFriend(id, action) { try { await api('/api/friends/respond', { id, action }); await loadBootstrap(); } catch (e) { toast(e.message, 'error'); } }
async function addFriendPrompt() { const name = prompt('اسم الصديق'); if (!name) return; try { await api('/api/friends/request', { friendName: name }); toast('تم إرسال الطلب', 'success'); await loadBootstrap(); } catch (e) { toast(e.message, 'error'); } }
async function openChatWith(username) { state.selectedFriend = state.data.friends.find(f => f.username === username) || { username }; state.privateMessages = (await api(`/api/private/${username}`)).messages || []; renderPrivateMessages(); screen('social'); await api('/api/private/seen', { withUser: username }).catch(()=>{}); }
async function toggleFav(username) { try { await api('/api/friends/favorite', { friendName: username }); await loadBootstrap(); } catch (e) { toast(e.message, 'error'); } }
async function blockNamedFriend(username) { if (!confirm(`حظر ${username}؟`)) return; try { await api('/api/friends/block', { target: username }); await loadBootstrap(); } catch (e) { toast(e.message, 'error'); } }
function inviteNamedFriend(username) { if (!state.room?.code) return toast('أنشئ غرفة أولاً', 'error'); state.socket?.emit('invite:friend', { toUsername: username, gameType: state.room.gameType, roomCode: state.room.code }); toast('تم إرسال الدعوة', 'success'); }
function openInviteModal() { if (!state.room) return; showModal('دعوة صديق', (state.data.friends || []).map(f => `<div class="friend-card"><div class="friend-top"><b>${f.username}</b><span class="dot ${f.online?'':'offline'}"></span></div><button class="primary-btn" onclick="window.sendInviteTo('${f.username}')">Invite</button></div>`).join('') || '<div class="muted">لا يوجد أصدقاء.</div>'); window.sendInviteTo = name => { inviteNamedFriend(name); closeModal(); }; }

function joinCode(code) { if (!code) return; state.gameMode = 'online'; state.socket?.emit('room:join', { code }); }
function showRoomShareModal(room) { showModal('تم إنشاء الغرفة', `<div class="current-room-card"><div class="room-code">${room.code}</div><div class="muted">${activeShareLink(room.code)}</div><div class="inline-form"><button class="primary-btn" onclick="window.copyCreatedCode()">Copy Code</button><button class="secondary-btn" onclick="window.copyCreatedLink()">Share Link</button><button class="secondary-btn" onclick="window.inviteCreatedRoom()">Invite Friend</button></div></div>`); window.copyCreatedCode = () => copyText(room.code); window.copyCreatedLink = () => shareLink(activeShareLink(room.code)); window.inviteCreatedRoom = openInviteModal; }

function showMatchmaking(title, status) { $('#matchmakingOverlay').classList.remove('hidden'); $('#mmTitle').textContent = title; $('#mmStatus').textContent = status; clearInterval(state.mmInterval); state.mmInterval = setInterval(() => { const sec = Math.floor((Date.now() - state.mmStartedAt) / 1000); $('#mmTimer').textContent = `${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`; }, 250); }
function hideMatchmaking() { $('#matchmakingOverlay').classList.add('hidden'); clearInterval(state.mmInterval); }

function createGame(type, players) {
  if (type === 'chess') return ChessEngine.createChess(players);
  if (type === 'ludo') return LudoEngine.createLudo(players);
  if (type === 'jackaroo') return JackarooEngine.createJackaroo(players);
  if (type === 'warhex') return WarhexEngine.createWarhex(players);
  if (type === 'connect4') return Connect4Engine.createConnect4(players);
  return null;
}
function applyGameAction(game, action, actor) {
  if (game.type === 'chess') return ChessEngine.applyChessAction(game, action, actor);
  if (game.type === 'ludo') return LudoEngine.applyLudoAction(game, action, actor);
  if (game.type === 'jackaroo') return JackarooEngine.applyJackarooAction(game, action, actor);
  if (game.type === 'warhex') return WarhexEngine.applyWarhexAction(game, action, actor);
  if (game.type === 'connect4') return Connect4Engine.applyConnect4Action(game, action, actor);
  return null;
}
function getMyActor() { if (state.gameMode === 'local') return state.room.gameState.type === 'chess' ? (state.room.gameState.turn === 'white' ? 'لاعب 1' : 'لاعب 2') : state.room.players[state.room.gameState.turnIndex || 0]?.username || 'لاعب'; return me(); }
function getPlayFn() {
  return action => {
    if (!state.room?.gameState) return;
    if (state.gameMode === 'local') { const next = applyGameAction(clone(state.room.gameState), action, getMyActor()); if (next) { state.room.gameState = next; renderMatch(); analyzeIfEnded(); } return; }
    if (state.gameMode === 'ai') { const next = applyGameAction(clone(state.room.gameState), action, me()); if (next) { state.room.gameState = next; renderMatch(); analyzeIfEnded(); maybeTriggerAi(); } return; }
    if (isHost()) { const next = applyGameAction(clone(state.room.gameState), action, me()); if (next) { state.room.gameState = next; state.socket.emit('game:state', next); renderMatch(); } }
    else state.socket.emit('game:action', { action });
  };
}
function maybeTriggerAi() { if (state.gameMode === 'ai' && state.room?.gameState?.type === 'chess' && !state.room.gameState.winner && state.room.gameState.turn === 'black') setTimeout(() => state.socket?.emit('ai:move', { gameState: state.room.gameState, difficulty: state.aiDifficulty }), 500); }

function enterGameScreen() { $('#appShell').classList.add('hidden'); $('#authScreen').classList.add('hidden'); $('#gameScreen').classList.remove('hidden'); renderMatch(); }
function leaveGameScreen() { if (state.gameMode === 'online' || state.gameMode === 'random') state.socket?.emit('room:leave'); state.room = null; state.gameMode = null; $('#gameScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); renderCurrentRoom(); }
function renderMatchPlayers() {
  const room = state.room;
  const players = room?.players || [];
  $('#matchPlayersPanel').innerHTML = `<div class="player-line">${players.map((p, idx) => `<div class="player-row"><div class="player-top"><div><b>${p.username}</b><div class="muted">${idx === 0 ? 'Seat A' : idx === 1 ? 'Seat B' : 'Seat'}</div></div><span class="dot ${p.connected===false?'offline':''}"></span></div><div class="inline-form"><span class="timer-chip ${room?.gameState && ((room.gameState.turn === 'white' && idx===0) || (room.gameState.turn === 'black' && idx===1)) ? 'active':''}">${p.ready?'Ready':'Waiting'}</span></div></div>`).join('')}<div class="player-row"><small class="muted">Spectators: ${(room?.spectators || []).length}</small></div></div>`;
}
function renderRoomWaiting() {
  const room = state.room;
  $('#gameMount').innerHTML = `<div class="panel current-room-card"><h3>${GAME_META[room.gameType]?.icon || ''} ${GAME_META[room.gameType]?.title || room.gameType}</h3><div class="muted">Room ${room.code} • ${room.matchMode}</div><div>${room.players.map(p=>`<div class="player-row"><div class="player-top"><b>${p.username}</b><span>${p.ready?'✅':'⏳'}</span></div></div>`).join('')}</div>${isHost() && room.players.length >= 2 ? '<button class="primary-btn" onclick="window.startRoomGame()">ابدأ المباراة</button>' : '<div class="muted">بانتظار اللاعبين أو بدء المضيف للمباراة</div>'}</div>`;
  window.startRoomGame = () => state.socket?.emit('game:start');
}
function renderMatchChat() {
  const msgs = state.room?.chat || [];
  $('#gvChatMessages').innerHTML = msgs.slice(-30).map(c => `<div class="msg-bubble ${c.sender===me()?'me':''}"><div class="msg-meta"><span>${c.sender}</span><span>${formatShort(c.ts)}</span></div>${c.kind==='voice' ? `<audio controls src="${c.text}"></audio>` : `<div>${c.text}</div>`}</div>`).join('');
  $('#gvChatMessages').scrollTop = $('#gvChatMessages').scrollHeight;
}
function renderMatch() {
  if (!state.room) return;
  $('#matchTitle').textContent = `${GAME_META[state.room.gameType]?.icon || ''} ${GAME_META[state.room.gameType]?.title || state.room.gameType}`;
  $('#matchRoomCode').textContent = state.room.code;
  $('#voiceState').textContent = VoiceChat.isActive() ? 'الصوت مفعل' : 'الصوت غير مفعل';
  renderMatchPlayers(); renderMatchChat();
  if (!state.room.gameState) { renderRoomWaiting(); $('#gvMoveLog').innerHTML = '<div class="muted">لا يوجد سجل بعد</div>'; $('#matchAnalysis').classList.add('hidden'); return; }
  const game = state.room.gameState, fn = getPlayFn();
  if (game.type === 'chess') ChessEngine.renderChess(game, getMyActor(), fn);
  else if (game.type === 'ludo') LudoEngine.renderLudo(game, getMyActor(), fn);
  else if (game.type === 'jackaroo') JackarooEngine.renderJackaroo(game, getMyActor(), fn);
  else if (game.type === 'warhex') WarhexEngine.renderWarhex(game, getMyActor(), fn);
  else if (game.type === 'connect4') Connect4Engine.renderConnect4(game, getMyActor(), fn);
  $('#turnIndicator').textContent = game.winner ? (game.winner === 'draw' ? 'انتهت بتعادل' : `الفائز: ${game.winnerUsername || game.winner}`) : `الدور الحالي: ${game.turn || game.players?.[game.turnIndex || 0]?.username || '-'}`;
  $('#gvMoveLog').innerHTML = (game.logs || []).slice(0, 20).map(x => `<div class="log-item">${x}</div>`).join('');
  analyzeIfEnded();
}
function analyzeIfEnded() {
  const game = state.room?.gameState; if (!game?.winner) { $('#matchAnalysis').classList.add('hidden'); return; }
  const captureA = game.capturedBlack?.length || 0, captureB = game.capturedWhite?.length || 0;
  $('#matchAnalysis').classList.remove('hidden');
  $('#matchAnalysis').innerHTML = `<h4>تحليل المباراة</h4><div class="muted">النتيجة: ${game.winner === 'draw' ? 'تعادل' : game.winnerUsername || game.winner}</div><div class="muted">أحداث مسجلة: ${(game.logs || []).length} • أسر أبيض: ${captureA} • أسر أسود: ${captureB}</div>`;
}

function startSelectedFlow() {
  if (state.selectedMode === 'online') state.socket?.emit('room:create', { gameType: state.selectedGame, name: `${state.selectedGame} room` });
  if (state.selectedMode === 'random') { state.gameMode = 'random'; state.mmStartedAt = Date.now(); state.socket?.emit('matchmaking:join', state.selectedGame); }
  if (state.selectedMode === 'local') {
    state.gameMode = 'local'; const players = [{ username: 'لاعب 1', socketId: 'local1' }, { username: 'لاعب 2', socketId: 'local2' }]; state.room = { code: 'LOCAL', gameType: state.selectedGame, players, gameState: createGame(state.selectedGame, players), chat: [], spectators: [] }; enterGameScreen();
  }
  if (state.selectedMode === 'ai') {
    const type = state.selectedGame === 'chess' ? 'chess' : 'chess'; if (state.selectedGame !== 'chess') toast('AI متاح حالياً للشطرنج', 'info'); state.gameMode = 'ai'; const players = [{ username: me(), socketId: 'self' }, { username: '__AI__', socketId: 'ai' }]; state.room = { code: 'AI', gameType: type, players, gameState: createGame(type, players), chat: [], spectators: [] }; enterGameScreen();
  }
}

async function sendPrivateMessage() {
  if (!state.selectedFriend) return toast('اختر صديقاً أولاً', 'error');
  const text = $('#privateMessageInput').value.trim(); if (!text) return;
  state.socket.emit('private:message', { toUser: state.selectedFriend.username, kind: 'text', content: text }); $('#privateMessageInput').value = '';
}
async function toggleVoiceMessage() {
  if (state.mediaRecorder?.state === 'recording') { state.mediaRecorder.stop(); return; }
  if (!state.selectedFriend) return toast('اختر صديقاً أولاً', 'error');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recordedChunks = []; state.mediaRecorder = new MediaRecorder(stream);
  state.mediaRecorder.ondataavailable = e => state.recordedChunks.push(e.data);
  state.mediaRecorder.onstop = () => {
    const blob = new Blob(state.recordedChunks, { type: 'audio/webm' });
    const fr = new FileReader(); fr.onload = () => { state.socket.emit('private:message', { toUser: state.selectedFriend.username, kind: 'voice', content: fr.result }); toast('تم إرسال الرسالة الصوتية', 'success'); }; fr.readAsDataURL(blob); stream.getTracks().forEach(t => t.stop()); $('#recordVoiceMsgBtn').textContent = '🎙️';
  };
  state.mediaRecorder.start(); $('#recordVoiceMsgBtn').textContent = '⏹️'; setTimeout(() => state.mediaRecorder?.state === 'recording' && state.mediaRecorder.stop(), 10000);
}
function emitTyping() { if (!state.selectedFriend) return; state.socket.emit('private:typing', { toUser: state.selectedFriend.username, typing: true }); clearTimeout(state.typingTimer); state.typingTimer = setTimeout(() => state.socket.emit('private:typing', { toUser: state.selectedFriend.username, typing: false }), 1200); }

async function sendMatchGift() { const op = state.room?.players?.find(p => p.username !== me()); if (!op) return toast('لا يوجد خصم', 'error'); try { await api('/api/gifts/send', { recipient: op.username, giftType: 'match', rewards: { coins: 200, gems: 5 } }); toast('تم إرسال الهدية', 'success'); await loadBootstrap(); } catch (e) { toast(e.message, 'error'); } }
async function addMatchFriend() { const op = state.room?.players?.find(p => p.username !== me()); if (!op) return; try { await api('/api/friends/request', { friendName: op.username }); toast('تم إرسال طلب الصداقة', 'success'); } catch (e) { toast(e.message, 'error'); } }
async function reportMatchPlayer() { const op = state.room?.players?.find(p => p.username !== me()); if (!op) return; const reason = prompt('سبب البلاغ'); if (!reason) return; try { await api('/api/report', { target: op.username, reason }); toast('تم إرسال البلاغ', 'success'); } catch (e) { toast(e.message, 'error'); } }
function showNotifications() { showModal('الإشعارات', (state.data.notifications || []).map(n => `<div class="notif-card"><b>${n.title}</b><div class="muted">${n.body || ''}</div><small class="muted">${formatDate(n.createdAt)}</small></div>`).join('') || '<div class="muted">لا توجد إشعارات</div>'); api('/api/notifications/read', {}).then(loadBootstrap).catch(()=>{}); }

window.buySku = buySku; window.claimMission = claimMission; window.claimGift = claimGift; window.claimCalendar = claimCalendar; window.saveProfile = saveProfile; window.respondFriend = respondFriend; window.openChatWith = openChatWith; window.toggleFav = toggleFav; window.inviteNamedFriend = inviteNamedFriend; window.blockNamedFriend = blockNamedFriend;

$('#closeModalBtn').onclick = closeModal; $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };
$('#loginBtn').onclick = handleLogin; $('#registerBtn').onclick = handleRegister; $('#logoutBtn').onclick = logout;
$$('.auth-tab').forEach(btn => btn.onclick = () => { $$('.auth-tab').forEach(x => x.classList.remove('active')); btn.classList.add('active'); $('#loginPane').classList.toggle('hidden', btn.dataset.authTab !== 'login'); $('#registerPane').classList.toggle('hidden', btn.dataset.authTab !== 'register'); });
$$('.nav-btn').forEach(btn => btn.onclick = () => screen(btn.dataset.screen));
$('#notificationsBtn').onclick = showNotifications; $('#profileQuickBtn').onclick = () => screen('profile'); $('#addFriendBtn').onclick = addFriendPrompt; $('#inviteSelectedFriendBtn').onclick = () => state.selectedFriend && inviteNamedFriend(state.selectedFriend.username);
$('#sendPrivateMessageBtn').onclick = sendPrivateMessage; $('#privateMessageInput').addEventListener('keydown', e => { emitTyping(); if (e.key === 'Enter') sendPrivateMessage(); }); $('#recordVoiceMsgBtn').onclick = toggleVoiceMessage;
$('#saveSettingsBtn').onclick = saveSettings; $('#deleteAccountBtn').onclick = async () => { if (!confirm('سيتم حذف الحساب نهائياً، هل أنت متأكد؟')) return; try { await api('/api/account/delete', {}); toast('تم حذف الحساب', 'success'); logout(); } catch (e) { toast(e.message, 'error'); } }; $('#claimLoginBtn').onclick = async () => { try { await api('/api/rewards/daily-login', {}); await loadBootstrap(); toast('تم استلام المكافأة اليومية', 'success'); } catch (e) { toast(e.message, 'error'); } };
$('#dailyGiftBtn').onclick = async () => { try { await api('/api/gifts/daily', {}); await loadBootstrap(); toast('تم إنشاء هدية يومية', 'success'); } catch (e) { toast(e.message, 'error'); } };
$('#luckyGiftBtn').onclick = async () => { try { await api('/api/gifts/lucky', {}); await loadBootstrap(); toast('Lucky gift created', 'success'); } catch (e) { toast(e.message, 'error'); } };
$('#birthdayGiftBtn').onclick = async () => { try { await api('/api/gifts/birthday', {}); await loadBootstrap(); toast('Birthday gift ready', 'success'); } catch (e) { toast(e.message, 'error'); } };
$('#openCreateRoomBtn').onclick = startSelectedFlow; $('#joinRoomDirectBtn').onclick = () => joinCode($('#joinRoomCodeInput').value.trim().toUpperCase()); $('#mmCancelBtn').onclick = () => { state.socket?.emit('matchmaking:leave'); hideMatchmaking(); };
$('#leaveMatchBtn').onclick = leaveGameScreen; $('#copyMatchLinkBtn').onclick = () => state.room && copyText(activeShareLink(state.room.code)); $('#shareMatchBtn').onclick = () => state.room && shareLink(activeShareLink(state.room.code)); $('#matchInviteBtn').onclick = openInviteModal; $('#matchGiftBtn').onclick = sendMatchGift; $('#matchAddFriendBtn').onclick = addMatchFriend; $('#matchReportBtn').onclick = reportMatchPlayer;
$('#drawOfferBtn').onclick = () => { if (confirm('إرسال عرض تعادل؟')) state.socket?.emit('game:command', { type: 'draw_offer' }); };
$('#resignBtn').onclick = () => { if (confirm('هل تريد الاستسلام؟')) state.socket?.emit('game:command', { type: 'resign' }); };
$('#replayBtn').onclick = () => state.socket?.emit('game:command', { type: 'replay' });
$('#gvChatSend').onclick = () => { const text = $('#gvChatInput').value.trim(); if (!text) return; state.socket?.emit('room:chat', { text, kind: 'text' }); $('#gvChatInput').value = ''; };
$('#gvChatInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#gvChatSend').click(); });
$('#micToggleBtn').onclick = async () => { try { if (VoiceChat.isActive()) { VoiceChat.stop(); } else { await VoiceChat.start(); if (state.room) VoiceChat.syncPeers((state.room.players||[]).map(p => p.socketId)); } renderMatch(); } catch (e) { toast(e.message, 'error'); } };
$('#muteToggleBtn').onclick = () => { VoiceChat.toggleSpeakerMute(); renderMatch(); };
window.addEventListener('online', () => { $('#networkBanner').classList.add('hidden'); state.socket?.connect(); }); window.addEventListener('offline', () => $('#networkBanner').classList.remove('hidden'));

runLoading();