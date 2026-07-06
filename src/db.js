const fs = require('fs');
const path = require('path');

// ── Storage path (Railway volumes mount at /data, fallback to ./data) ──
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'spamtrap.json');

let store = { guilds: {}, action_log: [] };

function save() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
  } catch (err) {
    console.error('[DB] Save failed:', err.message);
  }
}

function init() {
  try {
    if (fs.existsSync(DB_PATH)) {
      store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      if (!store.guilds) store.guilds = {};
      if (!store.action_log) store.action_log = [];
    } else {
      save();
    }
    console.log(`[DB] JSON store ready at ${DB_PATH}`);
  } catch (err) {
    console.error('[DB] Init failed, starting fresh:', err.message);
    store = { guilds: {}, action_log: [] };
    save();
  }
}

// ── Guild Settings ──

function defaultGuild(guildId) {
  return {
    guild_id: guildId,
    channel_ids: [],
    log_channel_id: null,
    action: 'softban',
    experiments: {},
    counter: 0,
    warning_message: null,
    dm_message: null,
    log_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function getGuild(guildId) {
  const g = store.guilds[guildId];
  if (!g) return null;
  // Return a copy so callers can't mutate the store accidentally
  return JSON.parse(JSON.stringify(g));
}

function ensureGuild(guildId) {
  if (!store.guilds[guildId]) {
    store.guilds[guildId] = defaultGuild(guildId);
    save();
  }
  return getGuild(guildId);
}

function updateGuild(guildId, fields) {
  ensureGuild(guildId);
  const g = store.guilds[guildId];
  for (const [key, value] of Object.entries(fields)) {
    g[key] = value;
  }
  g.updated_at = new Date().toISOString();
  save();
  return getGuild(guildId);
}

function incrementCounter(guildId) {
  ensureGuild(guildId);
  store.guilds[guildId].counter += 1;
  save();
  return store.guilds[guildId].counter;
}

function getAllGuilds() {
  return Object.values(store.guilds).map((g) => JSON.parse(JSON.stringify(g)));
}

// ── Action Log ──

function logAction(guildId, userId, userTag, actionType, result, detail, messageContent) {
  store.action_log.push({
    guild_id: guildId,
    user_id: userId,
    user_tag: userTag,
    action_type: actionType,
    result,
    detail: detail || null,
    message_content: messageContent || null,
    created_at: new Date().toISOString(),
  });
  // Keep the log from growing forever: cap at 5000 entries
  if (store.action_log.length > 5000) {
    store.action_log = store.action_log.slice(-5000);
  }
  save();
}

function getRecentLogs(guildId, limit = 10) {
  return store.action_log
    .filter((e) => e.guild_id === guildId)
    .slice(-limit)
    .reverse();
}

function getGlobalStats() {
  const guilds = Object.values(store.guilds);
  const total = guilds.reduce((sum, g) => sum + (g.counter || 0), 0);
  return { total, servers: guilds.length };
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
