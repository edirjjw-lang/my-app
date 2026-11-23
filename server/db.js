import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  name TEXT,
  country TEXT,
  season TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  logo TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fixtures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL UNIQUE,
  competition_id INTEGER,
  home_team_id INTEGER NOT NULL,
  away_team_id INTEGER NOT NULL,
  kickoff_utc TEXT NOT NULL,
  status TEXT NOT NULL,
  status_raw TEXT,
  minute INTEGER,
  home_goals INTEGER,
  away_goals INTEGER,
  ht_home_goals INTEGER,
  ht_away_goals INTEGER,
  home_corners INTEGER,
  away_corners INTEGER,
  home_ht_corners INTEGER,
  away_ht_corners INTEGER,
  home_shots INTEGER,
  away_shots INTEGER,
  home_shots_on INTEGER,
  away_shots_on INTEGER,
  home_possession REAL,
  away_possession REAL,
  home_dangerous_attacks INTEGER,
  away_dangerous_attacks INTEGER,
  home_cards INTEGER,
  away_cards INTEGER,
  has_lineups INTEGER DEFAULT 0,
  lineups_json TEXT,
  odds_json TEXT,
  odds_updated_at TEXT,
  stats_updated_at TEXT,
  data_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fixtures_status ON fixtures(status);
CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff ON fixtures(kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_fixtures_home ON fixtures(home_team_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_away ON fixtures(away_team_id);

CREATE TABLE IF NOT EXISTS team_match_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_provider_id TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  opponent_id INTEGER,
  competition_id INTEGER,
  kickoff_utc TEXT NOT NULL,
  is_home INTEGER NOT NULL,
  goals_for INTEGER,
  goals_against INTEGER,
  ht_goals_for INTEGER,
  ht_goals_against INTEGER,
  corners_for INTEGER,
  corners_against INTEGER,
  ht_corners_for INTEGER,
  ht_corners_against INTEGER,
  shots_for INTEGER,
  shots_against INTEGER,
  shots_on_for INTEGER,
  shots_on_against INTEGER,
  possession REAL,
  created_at TEXT NOT NULL,
  UNIQUE(fixture_provider_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_tms_team ON team_match_stats(team_id, kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_tms_competition ON team_match_stats(competition_id, kickoff_utc);

CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fixture_id INTEGER NOT NULL,
  fixture_provider_id TEXT NOT NULL,
  market_group TEXT NOT NULL,
  market_key TEXT NOT NULL,
  market_label TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL,
  probability REAL NOT NULL,
  fair_odds REAL NOT NULL,
  bookmaker_odds REAL,
  edge REAL,
  confidence TEXT NOT NULL,
  confidence_score REAL NOT NULL,
  factors TEXT,
  risks TEXT,
  rationale TEXT,
  entry TEXT NOT NULL DEFAULT 'NO_ENTRY',
  status TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT,
  model_version TEXT,
  is_live INTEGER DEFAULT 0,
  minute INTEGER,
  stake REAL,
  profit REAL,
  settled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(fixture_id, market_key, selection, line)
);
CREATE INDEX IF NOT EXISTS idx_rec_status ON recommendations(status, entry);
CREATE INDEX IF NOT EXISTS idx_rec_fixture ON recommendations(fixture_id);
CREATE INDEX IF NOT EXISTS idx_rec_created ON recommendations(created_at);

CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS provider_health (
  provider TEXT PRIMARY KEY,
  last_success_at TEXT,
  last_error TEXT,
  last_error_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  requests_total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
  fixtures_upserted INTEGER DEFAULT 0,
  stats_upserted INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  fixtures_evaluated INTEGER NOT NULL,
  markets_evaluated INTEGER NOT NULL,
  hit_rate REAL,
  roi REAL,
  profit REAL,
  brier REAL,
  log_loss REAL,
  per_market TEXT,
  calibration TEXT,
  created_at TEXT NOT NULL,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS backtest_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  fixture_provider_id TEXT NOT NULL,
  market_key TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL,
  probability REAL NOT NULL,
  fair_odds REAL NOT NULL,
  odds REAL,
  edge REAL,
  outcome INTEGER,
  kickoff_utc TEXT
);
CREATE INDEX IF NOT EXISTS idx_btp_run ON backtest_predictions(run_id);

CREATE TABLE IF NOT EXISTS app_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  scope TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON app_events(created_at);
`;

let handle = null;

export function getDb() {
  if (handle) return handle;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  handle = new DatabaseSync(config.dbPath);
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA synchronous = NORMAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 5000');
  handle.exec(SCHEMA);
  // Migração leve para bancos criados antes da coluna de estatísticas de cache.
  try {
    handle.exec('ALTER TABLE api_cache ADD COLUMN hits INTEGER NOT NULL DEFAULT 0');
  } catch {
    /* coluna já existe */
  }
  return handle;
}

export function closeDb() {
  if (handle) {
    handle.close();
    handle = null;
  }
}

export const nowIso = () => new Date().toISOString();

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return getDb().prepare(sql).get(...params) ?? null;
}

export function transaction(fn) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

export function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), nowIso()],
  );
}

export function logEvent(level, scope, message) {
  try {
    run('INSERT INTO app_events (level, scope, message, created_at) VALUES (?, ?, ?, ?)', [
      level,
      scope,
      String(message).slice(0, 1000),
      nowIso(),
    ]);
  } catch {
    /* logging must never break a request */
  }
}
