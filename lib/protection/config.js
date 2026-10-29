// Protection configuration: defaults, validation, and persistence.
//
// Everything lives under `guild.protection` inside the existing db.json guild
// record, so it is saved and deleted together with the rest of a server's
// settings (store.deleteGuild on guildDelete wipes it too). Reads never write;
// older records without a `protection` key are simply treated as "all off".
// Writes go through store.updateGuild() so a concurrent catch/dashboard write
// is never clobbered by a stale copy.
const store = require('../store');

const FEATURES = ['scam', 'raid', 'mentions', 'repeats', 'newcomers', 'webhooks', 'antinuke'];
const MESSAGE_ACTIONS = ['alert', 'delete', 'timeout'];
const NUKE_ACTIONS = ['alert', 'strip_roles'];
const LIST_MAX = 50;
const INCIDENTS_MAX = 20;

// name -> { def, min, max, unit } ; "raidFilter" is a 0/1 switch exposed as a limit
const LIMITS = {
  mentionLimit: { def: 8, min: 2, max: 50, unit: 'mentions' },
  repeatLimit: { def: 4, min: 2, max: 20, unit: 'matching messages' },
  messageWindowSeconds: { def: 15, min: 5, max: 300, unit: 'seconds' },
  webhookLimit: { def: 8, min: 2, max: 100, unit: 'messages' },
  joinLimit: { def: 8, min: 2, max: 100, unit: 'joins' },
  joinWindowSeconds: { def: 15, min: 5, max: 300, unit: 'seconds' },
  raidMinutes: { def: 5, min: 1, max: 120, unit: 'minutes' },
  raidFilter: { def: 0, min: 0, max: 1, unit: '0 = off, 1 = filter messages from the raid cohort' },
  newcomerMinutes: { def: 10, min: 1, max: 1440, unit: 'minutes' },
  timeoutMinutes: { def: 10, min: 1, max: 40320, unit: 'minutes (Discord max 28 days)' },
  nukeLimit: { def: 4, min: 2, max: 50, unit: 'administrative actions' },
  nukeWindowSeconds: { def: 20, min: 5, max: 300, unit: 'seconds' },
};

function defaults() {
  const features = {};
  for (const f of FEATURES) features[f] = false;
  const limits = {};
  for (const [k, v] of Object.entries(LIMITS)) limits[k] = v.def;
  return {
    features,
    messageAction: 'alert',
    nukeAction: 'alert',
    limits,
    trustedRoles: [],
    trustedWebhooks: [],
    blockedDomains: [],
    allowedDomains: [],
    incidents: [],
    incidentCount: 0,
  };
}

// Fill in anything missing (new record, or a record written by an older
// version) without touching values that are present. Unknown keys are kept.
function normalize(p) {
  const d = defaults();
  const out = { ...d, ...(p || {}) };
  out.features = { ...d.features, ...((p && p.features) || {}) };
  out.limits = { ...d.limits, ...((p && p.limits) || {}) };
  if (!MESSAGE_ACTIONS.includes(out.messageAction)) out.messageAction = 'alert';
  if (!NUKE_ACTIONS.includes(out.nukeAction)) out.nukeAction = 'alert';
  for (const k of ['trustedRoles', 'trustedWebhooks', 'blockedDomains', 'allowedDomains', 'incidents']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  if (!Number.isInteger(out.incidentCount) || out.incidentCount < 0) out.incidentCount = 0;
  return out;
}

function getProtection(guildId) {
  return normalize(store.getGuild(guildId).protection);
}

function anyFeatureEnabled(cfg) {
  return FEATURES.some((f) => cfg.features[f]);
}

function updateProtection(guildId, mutatorFn) {
  // store.updateGuild() only edits records that already exist (it returns
  // null otherwise); make sure this server has one before mutating it.
  store.getGuild(guildId);
  const updated = store.updateGuild(guildId, (fresh) => {
    fresh.protection = normalize(fresh.protection);
    mutatorFn(fresh.protection);
  });
  return updated ? updated.protection : null;
}

// ---- validation helpers (return { ok, error }) ----------------------------

function validateFeature(name) {
  if (!FEATURES.includes(name)) return { ok: false, error: `Unknown feature "${name}". Choose one of: ${FEATURES.join(', ')}.` };
  return { ok: true };
}

function validateLimit(name, value) {
  const spec = LIMITS[name];
  if (!spec) return { ok: false, error: `Unknown setting "${name}". Choose one of: ${Object.keys(LIMITS).join(', ')}.` };
  if (!Number.isInteger(value)) return { ok: false, error: `${name} must be a whole number.` };
  if (value < spec.min || value > spec.max) {
    return { ok: false, error: `${name} must be between ${spec.min} and ${spec.max} (${spec.unit}).` };
  }
  return { ok: true };
}

function validateAction(target, type) {
  if (target === 'messages') {
    if (!MESSAGE_ACTIONS.includes(type)) {
      return { ok: false, error: `"${type}" is not a message action. Message actions: ${MESSAGE_ACTIONS.join(', ')}. (strip_roles only applies to antinuke.)` };
    }
    return { ok: true };
  }
  if (target === 'antinuke') {
    if (!NUKE_ACTIONS.includes(type)) {
      return { ok: false, error: `"${type}" is not an anti-nuke action. Anti-nuke actions: ${NUKE_ACTIONS.join(', ')}. (delete/timeout only apply to messages.)` };
    }
    return { ok: true };
  }
  return { ok: false, error: 'Target must be "messages" or "antinuke".' };
}

const SNOWFLAKE = /^\d{17,20}$/;
function validateSnowflake(id) {
  return SNOWFLAKE.test(String(id || ''));
}

// Accepts "example.com", "sub.example.com", "https://example.com/path",
// "EXAMPLE.COM." and returns a lowercase bare hostname, or null if invalid.
function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  s = s.replace(/^www\./, '');
  s = s.split(/[/?#]/)[0]; // path/query/fragment
  s = s.split('@').pop(); // userinfo
  s = s.split(':')[0]; // port
  s = s.replace(/\.+$/, ''); // trailing dots
  if (!s || s.length > 253) return null;
  if (s.includes('*')) return null; // wildcards aren't needed: subdomains match automatically
  const labels = s.split('.');
  if (labels.length < 2) return null;
  for (const l of labels) {
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(l)) return null;
  }
  return s;
}

module.exports = {
  FEATURES,
  MESSAGE_ACTIONS,
  NUKE_ACTIONS,
  LIMITS,
  LIST_MAX,
  INCIDENTS_MAX,
  defaults,
  normalize,
  getProtection,
  updateProtection,
  anyFeatureEnabled,
  validateFeature,
  validateLimit,
  validateAction,
  validateSnowflake,
  normalizeDomain,
};
