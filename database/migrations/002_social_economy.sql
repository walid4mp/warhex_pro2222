ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wallet_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS settings_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS inventory_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS missions_json JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reward_state_json JSONB DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS rooms (
  id SERIAL PRIMARY KEY,
  code VARCHAR(8) UNIQUE NOT NULL,
  host_username VARCHAR(32),
  game_type VARCHAR(16) NOT NULL,
  status VARCHAR(16) DEFAULT 'open',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS friendships (
  id VARCHAR(64) PRIMARY KEY,
  user_a VARCHAR(32) NOT NULL,
  user_b VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  requester VARCHAR(32),
  favorite_by JSONB DEFAULT '[]'::jsonb,
  blocked_by JSONB DEFAULT '[]'::jsonb,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invites (
  id VARCHAR(64) PRIMARY KEY,
  type VARCHAR(24) NOT NULL,
  from_user VARCHAR(32) NOT NULL,
  to_user VARCHAR(32) NOT NULL,
  room_code VARCHAR(8),
  game_type VARCHAR(16),
  status VARCHAR(16) NOT NULL,
  expires_at TIMESTAMPTZ,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS private_messages (
  id VARCHAR(64) PRIMARY KEY,
  thread_key VARCHAR(96) NOT NULL,
  sender VARCHAR(32) NOT NULL,
  recipient VARCHAR(32) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  content TEXT,
  seen_at TIMESTAMPTZ,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_private_messages_thread_key ON private_messages(thread_key, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  type VARCHAR(32) NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN DEFAULT FALSE,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_username ON notifications(username, created_at DESC);

CREATE TABLE IF NOT EXISTS purchases (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(32) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  sku VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gifts (
  id VARCHAR(64) PRIMARY KEY,
  sender VARCHAR(32) NOT NULL,
  recipient VARCHAR(32) NOT NULL,
  gift_type VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  claimed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(64) PRIMARY KEY,
  reporter VARCHAR(32) NOT NULL,
  target VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);