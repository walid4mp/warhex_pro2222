const DEFAULT_WALLET = {
  gold: 500,
  coins: 2500,
  gems: 120,
  diamonds: 25,
  energy: 100,
  xp: 0,
  seasonPoints: 0,
};

const DEFAULT_SETTINGS = {
  language: 'ar',
  darkMode: true,
  notifications: true,
  music: true,
  soundEffects: true,
  voiceChat: true,
  privacy: 'friends',
  graphics: 'high',
  fps: 60,
  accountVisibility: 'public',
};

const DEFAULT_PROFILE = username => ({
  avatar: '♞',
  cover: 'Aurora Arena',
  country: 'Unknown',
  bio: `جاهز للتحدي — ${username}`,
  frame: 'Rookie Gold',
  title: 'Rookie Strategist',
  badges: ['Founding Player'],
  backgrounds: ['Royal Hall'],
  musicPacks: ['Default Arena'],
  voicePacks: ['Classic'],
});

const DEFAULT_INVENTORY = {
  skins: {
    chessBoards: ['Classic Marble'],
    chessPieces: ['Royal HD'],
    diceSkins: ['Aurora Dice'],
    frames: ['Rookie Gold'],
    avatars: ['♞'],
    profileThemes: ['Nebula Blue'],
    chatBubble: ['Classic Bubble'],
    emotes: ['🔥', '👏', '😎', '💎'],
    victoryAnimation: ['Golden Burst'],
    entranceAnimation: ['Warp Glow'],
    titles: ['Rookie Strategist'],
    badges: ['Founding Player'],
    backgrounds: ['Royal Hall'],
    musicPacks: ['Default Arena'],
    voicePacks: ['Classic'],
  },
  consumables: {
    dailyGiftTickets: 1,
    luckyGiftTickets: 1,
  },
  favorites: [],
};

const STORE_ITEMS = [
  { sku: 'coins_5k', category: 'Coins', title: '5K Coins', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 4.99, currency: 'USD', rewards: { coins: 5000 } },
  { sku: 'coins_25k', category: 'Coins', title: '25K Coins', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 14.99, currency: 'USD', rewards: { coins: 25000, gems: 100 } },
  { sku: 'gems_250', category: 'Gems', title: '250 Gems', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 9.99, currency: 'USD', rewards: { gems: 250 } },
  { sku: 'gold_10k', category: 'Gold', title: '10K Gold', provider: ['stripe', 'paypal'], price: 5.99, currency: 'USD', rewards: { gold: 10000 } },
  { sku: 'vip_monthly', category: 'VIP', title: 'VIP Monthly', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 7.99, currency: 'USD', rewards: { gems: 150, diamonds: 30, title: 'VIP' } },
  { sku: 'battle_pass_s1', category: 'Battle Pass', title: 'Battle Pass Season 1', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 11.99, currency: 'USD', rewards: { seasonPoints: 250, title: 'Battle Pass Owner' } },
  { sku: 'starter_pack', category: 'Starter Pack', title: 'Starter Pack', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 2.99, currency: 'USD', rewards: { coins: 3000, gems: 60, energy: 25, item: 'Royal Starter Frame' } },
  { sku: 'premium_pack', category: 'Premium Pack', title: 'Premium Pack', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 19.99, currency: 'USD', rewards: { coins: 30000, gems: 450, diamonds: 80, item: 'Legendary Nebula Theme' } },
  { sku: 'bundle_social', category: 'Bundles', title: 'Social Bundle', provider: ['stripe', 'paypal'], price: 8.49, currency: 'USD', rewards: { gems: 120, item: 'Golden Chat Bubble', emote: '🤝' } },
  { sku: 'offer_daily', category: 'Daily Offers', title: 'Daily Flash Offer', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 1.49, currency: 'USD', rewards: { coins: 1500, gems: 25 } },
  { sku: 'offer_weekly', category: 'Weekly Offers', title: 'Weekly Challenger Box', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 6.49, currency: 'USD', rewards: { coins: 8000, gems: 120, item: 'Weekly Challenger Chest' } },
  { sku: 'offer_monthly', category: 'Monthly Offers', title: 'Monthly Empire Crate', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 24.99, currency: 'USD', rewards: { coins: 50000, gems: 600, diamonds: 100 } },
  { sku: 'limited_phoenix', category: 'Limited Offers', title: 'Phoenix Limited Bundle', provider: ['stripe', 'paypal', 'google_play', 'apple_iap'], price: 29.99, currency: 'USD', rewards: { item: 'Phoenix Entrance Animation', gems: 500, diamonds: 100 } },
];

const SKIN_REWARDS = [
  { code: 'board_neon', type: 'chessBoards', title: 'Neon Crown Board', source: 'purchase' },
  { code: 'piece_obsidian', type: 'chessPieces', title: 'Obsidian HD Pieces', source: 'achievements' },
  { code: 'dice_jelly', type: 'diceSkins', title: 'Jelly Dice', source: 'events' },
  { code: 'frame_arena', type: 'frames', title: 'Arena Master Frame', source: 'missions' },
  { code: 'theme_royal', type: 'profileThemes', title: 'Royal Theme', source: 'daily_rewards' },
  { code: 'emote_crown', type: 'emotes', title: 'Crown Emote', source: 'battle_pass' },
  { code: 'victory_wings', type: 'victoryAnimation', title: 'Wings of Victory', source: 'season' },
  { code: 'entrance_comet', type: 'entranceAnimation', title: 'Comet Entrance', source: 'season' },
  { code: 'badge_founder', type: 'badges', title: 'Founder Badge', source: 'starter' },
  { code: 'music_empire', type: 'musicPacks', title: 'Empire Theme', source: 'purchase' },
];

const MISSION_CATALOG = [
  { code: 'daily_play_1', type: 'daily', title: 'العب مباراة واحدة', goal: 1, rewards: { xp: 50, coins: 250 } },
  { code: 'daily_win_1', type: 'daily', title: 'اربح مباراة', goal: 1, rewards: { xp: 80, gems: 10 } },
  { code: 'daily_social_1', type: 'daily', title: 'أرسل رسالة لصديق', goal: 1, rewards: { xp: 30, coins: 100 } },
  { code: 'weekly_win_5', type: 'weekly', title: '5 انتصارات أسبوعية', goal: 5, rewards: { xp: 400, gems: 50, item: 'Arena Master Frame' } },
  { code: 'weekly_voice_3', type: 'weekly', title: 'استخدم الصوت 3 مرات', goal: 3, rewards: { xp: 200, coins: 1200 } },
  { code: 'monthly_rank_20', type: 'monthly', title: '20 مباراة شهرية', goal: 20, rewards: { xp: 1500, gems: 150, diamonds: 20 } },
  { code: 'achievement_first_win', type: 'achievement', title: 'أول فوز', goal: 1, rewards: { badge: 'First Victory', coins: 500 } },
  { code: 'battle_pass_10', type: 'battle_pass', title: 'أكمل 10 مهام موسمية', goal: 10, rewards: { seasonPoints: 250, item: 'Battle Banner' } },
  { code: 'event_summer', type: 'event', title: 'حدث الصيف: اربح 3 مباريات', goal: 3, rewards: { gems: 40, item: 'Summer Dice' } },
];

const DAILY_REWARDS = {
  login: { coins: 200, energy: 10 },
  days7: [
    { day: 1, rewards: { coins: 150 } },
    { day: 2, rewards: { coins: 200, gems: 5 } },
    { day: 3, rewards: { gold: 300 } },
    { day: 4, rewards: { energy: 15 } },
    { day: 5, rewards: { gems: 10 } },
    { day: 6, rewards: { coins: 500, xp: 100 } },
    { day: 7, rewards: { diamonds: 5, item: 'Weekly Gift Chest' } },
  ],
  days30: Array.from({ length: 30 }, (_, i) => ({
    day: i + 1,
    rewards: i === 29
      ? { diamonds: 20, item: 'Monthly Crown Theme' }
      : { coins: 100 + i * 50, gems: i % 5 === 0 ? 5 : 0 },
  })),
};

module.exports = {
  DEFAULT_WALLET,
  DEFAULT_SETTINGS,
  DEFAULT_PROFILE,
  DEFAULT_INVENTORY,
  STORE_ITEMS,
  SKIN_REWARDS,
  MISSION_CATALOG,
  DAILY_REWARDS,
};