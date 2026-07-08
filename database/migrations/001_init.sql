-- ═══════════════════════════════════════════════════════════
--  Migration 001: Initial schema — users, matches, match_players
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(32) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    avatar        VARCHAR(8)  DEFAULT '♞',
    coins         INTEGER     DEFAULT 127150,
    gems          INTEGER     DEFAULT 10255,
    level         INTEGER     DEFAULT 1,
    xp            INTEGER     DEFAULT 0,
    wins          INTEGER     DEFAULT 0,
    losses        INTEGER     DEFAULT 0,
    draws         INTEGER     DEFAULT 0,
    elo           INTEGER     DEFAULT 1200,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS matches (
    id             SERIAL PRIMARY KEY,
    game_type      VARCHAR(16) NOT NULL,
    room_code      VARCHAR(8),
    players        JSONB NOT NULL,
    winner         VARCHAR(32),
    state_snapshot JSONB,
    duration_sec   INTEGER,
    started_at     TIMESTAMPTZ DEFAULT NOW(),
    finished_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_players (
    id          SERIAL PRIMARY KEY,
    match_id    INTEGER REFERENCES matches(id) ON DELETE CASCADE,
    username    VARCHAR(32) NOT NULL,
    color       VARCHAR(16),
    result      VARCHAR(8) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_players_username ON match_players(username);
CREATE INDEX IF NOT EXISTS idx_matches_game_type ON matches(game_type);

CREATE OR REPLACE VIEW leaderboard AS
SELECT username, wins, losses, draws,
    (wins + losses + draws) AS total_games,
    ROUND(wins::numeric / NULLIF(wins + losses, 0) * 100, 1) AS win_rate,
    level, xp, elo, coins, gems
FROM users ORDER BY elo DESC, wins DESC;
