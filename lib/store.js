const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'db.json');

const DEFAULT_EXPERIMENTS = {
  forwardMessage: false,
  noDm: false,
  noWarning: false,
  channelWarmer: false,
  randomChannelName: false,
  randomNameChaos: false,
  timeoutFirst: false,
  onlyRecentDelete: false,
  manyTraps: false,
  ensureDeletion: false,
  deleteOldTrap: false,
};

const EXPERIMENT_LABELS = {
  forwardMessage: 'Forward Message',
  noDm: 'No DM',
  noWarning: 'No Warning',
  channelWarmer: 'Channel Warmer',
  randomChannelName: 'Random Channel Name',
  randomNameChaos: 'Random Name Chaos',
  timeoutFirst: 'Timeout First',
  onlyRecentDelete: 'Only Recent Delete',
  manyTraps: 'Many Traps',
  ensureDeletion: 'Ensure Deletion',
  deleteOldTrap: 'Delete Old Trap',
};

const EXPERIMENT_DESCRIPTIONS = {
  forwardMessage: 'Attaches the caught message content to the log embed',
  noDm: 'Skips the DM entirely (silent moderation)',
  noWarning: 'Skips pinning the multilingual warning message',
  channelWarmer: 'Posts a daily casual message in the trap channel',
  randomChannelName: 'Renames the trap channel daily from a word list',
  randomNameChaos: 'Renames the trap channel daily with random characters',
  timeoutFirst: 'Times out the user 1 hour before banning',
  onlyRecentDelete: 'Purges only the last 15 minutes of messages instead of 1 hour',
  manyTraps: 'Allows up to 5 trap channels per server',
  ensureDeletion: 'Sweeps the trap channel 2 minutes later for leftover messages',
  deleteOldTrap: 'Deletes the previous auto-created trap channel when you switch to a new one',
};

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ guilds: {}, global: { totalCatches: 0 } }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(data) {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getGuild(guildId) {
  const db = readDb();
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      trapChannels: [],
      autoTrapChannelId: null, // channel id Spam Trap auto-created on join, if any
      kickCounterMessages: {}, // channelId -> messageId of the pinned "Kicks: N" counter
      logChannel: null,
      action: 'softban', // softban | ban | disabled
      experiments: { ...DEFAULT_EXPERIMENTS },
      customMessages: { warning: null, dm: null, log: null },
      allowedRoles: [], // roles that can manage the bot (empty = BanMembers + ManageGuild)
      catchCount: 0,
      recentActions: [],
      lastRename: 0,
      lastWarm: 0,
    };
    writeDb(db);
  }
  return db.guilds[guildId];
}

function saveGuild(guildId, guildData) {
  const db = readDb();
  db.guilds[guildId] = guildData;
  writeDb(db);
}

// Safe alternative to getGuild()+saveGuild() for call sites that do an
// `await` between reading the guild and saving it. saveGuild() overwrites
// the *entire* guild record with whatever in-memory object it's given, so
// if another write (a catch incrementing catchCount, pushRecentAction,
// setKickCounterMessage, etc.) happens on disk during that await, a later
// saveGuild() with the stale pre-await object silently reverts it.
// updateGuild() re-reads fresh right before writing and only applies the
// specific changes `mutatorFn` makes, so it can't clobber an unrelated
// concurrent write. Returns the updated guild object.
function updateGuild(guildId, mutatorFn) {
  const db = readDb();
  const g = db.guilds[guildId];
  if (!g) return null;
  mutatorFn(g);
  writeDb(db);
  return g;
}

function incrementCatch(guildId) {
  const db = readDb();
  const g = db.guilds[guildId];
  g.catchCount = (g.catchCount || 0) + 1;
  db.global.totalCatches = (db.global.totalCatches || 0) + 1;
  writeDb(db);
  return { guildCount: g.catchCount, globalCount: db.global.totalCatches };
}

function pushRecentAction(guildId, action) {
  const db = readDb();
  const g = db.guilds[guildId];
  g.recentActions = g.recentActions || [];
  g.recentActions.unshift(action);
  g.recentActions = g.recentActions.slice(0, 5);
  writeDb(db);
}

function getAllGuildIds() {
  const db = readDb();
  return Object.keys(db.guilds);
}

// Own read-modify-write (like incrementCatch) so this never stomps a
// catchCount increment that happened concurrently via a stale in-memory copy.
function setKickCounterMessage(guildId, channelId, messageId) {
  const db = readDb();
  const g = db.guilds[guildId];
  if (!g) return;
  g.kickCounterMessages = g.kickCounterMessages || {};
  g.kickCounterMessages[channelId] = messageId;
  writeDb(db);
}

module.exports = {
  getGuild,
  saveGuild,
  updateGuild,
  incrementCatch,
  pushRecentAction,
  getAllGuildIds,
  setKickCounterMessage,
  DEFAULT_EXPERIMENTS,
  EXPERIMENT_LABELS,
  EXPERIMENT_DESCRIPTIONS,
  readDb,
  writeDb,
};
