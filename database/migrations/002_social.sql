-- ═══════════════════════════════════════════════════════════
--  Migration 002: Social — friends, game_invite, achievements
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS friends (
    id         SERIAL PRIMARY KEY,
    user_a     VARCHAR(32) NOT NULL,
    user_b     VARCHAR(32) NOT NULL,
    status     VARCHAR(16) DEFAULT 'accepted',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_a, user_b)
);

CREATE TABLE IF NOT EXISTS game_invites (
    id         SERIAL PRIMARY KEY,
    from_user  VARCHAR(32) NOT NULL,
    to_user    VARCHAR(32) NOT NULL,
    game_type  VARCHAR(16) NOT NULL,
    room_code  VARCHAR(8),
    status     VARCHAR(16) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_achievements (
    id          SERIAL PRIMARY KEY,
    username    VARCHAR(32) NOT NULL,
    achievement VARCHAR(64) NOT NULL,
    unlocked_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, achievement)
);
