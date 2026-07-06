const Database = require('better-sqlite3');
const path = require('path');

// ── Storage path (Railway volumes mount at /data, fallback to ./data) ──
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'spamtrap.sqlite');

let db;

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id          TEXT PRIMARY KEY,
      channel_ids       TEXT DEFAULT '[]',
      log_channel_id    TEXT,
      action            TEXT DEFAULT 'softban',
      experiments       TEXT DEFAULT '{}',
      counter           INTEGER DEFAULT 0,
      warning_message   TEXT,
      dm_message        TEXT,
      log_message       TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS action_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id          TEXT NOT NULL,
      user_id           TEXT NOT NULL,
      user_tag          TEXT NOT NULL,
      action_type       TEXT NOT NULL,
      result            TEXT NOT NULL,
      detail            TEXT,
      message_content   TEXT,
      created_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_action_log_guild ON action_log(guild_id);
    CREATE INDEX IF NOT EXISTS idx_action_log_created ON action_log(created_at);
  `);

  console.log(`[DB] SQLite ready at ${DB_PATH}`);
  return db;
}

// ── Guild Settings ──

function getGuild(guildId) {
  const row = db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
  if (!row) return null;
  row.channel_ids = JSON.parse(row.channel_ids || '[]');
  row.experiments = JSON.parse(row.experiments || '{}');
  return row;
}

function ensureGuild(guildId) {
  const existing = getGuild(guildId);
  if (existing) return existing;
  db.prepare('INSERT INTO guilds (guild_id) VALUES (?)').run(guildId);
  return getGuild(guildId);
}

function updateGuild(guildId, fields) {
  const guild = ensureGuild(guildId);
  const updates = [];
  const values = [];

  for (const [key, value] of Object.entries(fields)) {
    if (key === 'channel_ids' || key === 'experiments') {
      updates.push(`${key} = ?`);
      values.push(JSON.stringify(value));
    } else {
      updates.push(`${key} = ?`);
      values.push(value);
    }
  }

  updates.push("updated_at = datetime('now')");
  values.push(guildId);

  db.prepare(`UPDATE guilds SET ${updates.join(', ')} WHERE guild_id = ?`).run(...values);
  return getGuild(guildId);
}

function incrementCounter(guildId) {
  ensureGuild(guildId);
  db.prepare('UPDATE guilds SET counter = counter + 1 WHERE guild_id = ?').run(guildId);
  return db.prepare('SELECT counter FROM guilds WHERE guild_id = ?').get(guildId).counter;
}

function getAllGuilds() {
  const rows = db.prepare('SELECT * FROM guilds').all();
  return rows.map((row) => {
    row.channel_ids = JSON.parse(row.channel_ids || '[]');
    row.experiments = JSON.parse(row.experiments || '{}');
    return row;
  });
}

// ── Action Log ──

function logAction(guildId, userId, userTag, actionType, result, detail, messageContent) {
  db.prepare(
    `INSERT INTO action_log (guild_id, user_id, user_tag, action_type, result, detail, message_content)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(guildId, userId, userTag, actionType, result, detail || null, messageContent || null);
}

function getRecentLogs(guildId, limit = 10) {
  return db.prepare(
    'SELECT * FROM action_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(guildId, limit);
}

function getGlobalStats() {
  const total = db.prepare('SELECT COALESCE(SUM(counter), 0) AS total FROM guilds').get().total;
  const servers = db.prepare('SELECT COUNT(*) AS count FROM guilds').get().count;
  return { total, servers };
}

module.exports = {
  init,
  getGuild,
  ensureGuild,
  updateGuild,
  incrementCounter,
  getAllGuilds,
  logAction,
  getRecentLogs,
  getGlobalStats,
};
