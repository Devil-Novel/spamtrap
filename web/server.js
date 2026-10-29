const express = require('express');
const compression = require('compression');
const { serverSessions } = require('./sessions');
const { canManageTrap } = require('../lib/access');
const { validateMessages, usableChannel } = require('./validation');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { PermissionsBitField, ChannelType } = require('discord.js');
const store = require('../lib/store');
const { maybeDeleteOldAutoChannel, purgeOldBotMessages, postWarning, postOrUpdateKickCounter } = require('../lib/trapChannel');

function validateDashboardEnvironment() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || /^(replace_with|any_random|your_)/.test(process.env.SESSION_SECRET)) {
      throw new Error('Set SESSION_SECRET to a random secret of at least 32 characters before deploying');
    }
    if (!process.env.CLIENT_SECRET) throw new Error('CLIENT_SECRET is required for dashboard login');
    const url = new URL(process.env.BASE_URL || '');
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('BASE_URL must be the HTTPS origin of your website');
  }
}

async function discordFetch(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error('Discord request failed (' + response.status + ')'), { status: response.status === 401 ? 401 : 502 });
  return response;
}

function createDashboard(client) {
  validateDashboardEnvironment();
  const CLIENT_ID = process.env.CLIENT_ID || client.user.id;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;
  const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const REDIRECT_URI = `${BASE_URL}/auth/callback`;

  const app = express();
  app.disable('x-powered-by');
  const inlineHashes = [...fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8').matchAll(/<script(?:\s+type="application\/ld\+json")?>([\s\S]*?)<\/script>/g)]
    .map(match => "'sha256-" + crypto.createHash('sha256').update(match[1]).digest('base64') + "'");
  const csp = [
    "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    "script-src 'self' https://www.googletagmanager.com " + inlineHashes.join(' '),
    "script-src-attr 'unsafe-inline'", // Existing accessible controls use inline event attributes.
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: https://cdn.discordapp.com https://*.google-analytics.com https://www.googletagmanager.com",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com",
  ].join('; ');
  app.use((req, res, next) => { res.setHeader('Content-Security-Policy', csp); next(); });
  const queues = new Map();
  const wrap = handler => async (req, res, next) => {
    // Serialize each guild's dashboard mutations across Discord API awaits.
    const key = req.method === 'POST' ? req.params.id : null;
    const previous = key ? queues.get(key) : null;
    let unlock;
    const held = key ? new Promise(resolve => { unlock = resolve; }) : null;
    if (key) queues.set(key, held);
    try { if (previous) await previous; await handler(req, res, next); }
    catch (err) { next(err); }
    finally { if (unlock) unlock(); if (key && queues.get(key) === held) queues.delete(key); }
  };
  const get = (url, handler) => app.get(url, wrap(handler));
  const post = (url, handler) => app.post(url, wrap(handler));

  // ── Trust Railway's proxy so req.secure / x-forwarded-proto resolve correctly ──
  app.set('trust proxy', 1);

  // ── Force HTTPS + HSTS (defense in depth; Railway's edge already redirects, this covers direct/edge-cache edge cases) ──
  app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `${BASE_URL}${req.originalUrl}`);
    }
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    // Additional hardening alongside the Content Security Policy above.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Gzip/brotli every response - the dashboard's index.html is a large
  // single-file page (inline CSS/JS), so compression meaningfully cuts
  // transfer size on every visit.
  app.use(compression());

  app.use(express.json({ limit: '32kb' }));
  const sessions = serverSessions({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    secure: process.env.NODE_ENV === 'production',
  });
  app.locals.close = () => sessions.close();
  app.use(['/auth', '/api'], sessions);
  const rates = new Map();
  app.use(['/api', '/auth'], (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const now = Date.now();
    for (const [key, value] of rates) if (value.until <= now) rates.delete(key);
    const key = req.ip;
    const value = rates.get(key) || { count: 0, until: now + 60000 };
    if (!rates.has(key) && rates.size >= 10000) return res.status(503).json({ error: 'Please try again later' });
    rates.set(key, value);
    if (++value.count > 120) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests; please wait a minute' }); }
    if (req.method === 'POST') {
      if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json' });
      if (req.headers.origin && req.headers.origin !== new URL(BASE_URL).origin) return res.status(403).json({ error: 'Invalid request origin' });
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Expected a JSON object' });
    }
    next();
  });

  // ── Static files ──
  // Cache images/assets for a week; keep HTML on no-cache so dashboard
  // updates (and deploys) always take effect without a stale page.
  app.use(
    express.static(path.join(__dirname, 'public'), {
      maxAge: '1d',
      setHeaders: (res, filePath) => {
        if (/\.(html|css|js)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // ── Guards that a logged-in user actually manages the requested guild ──
  // Prevents any authenticated dashboard user from reading/editing another
  // server's config just by knowing its guild id.
  async function requireGuildAccess(req, res, guildId) {
    if (!req.session.accessToken || !req.session.user) {
      res.status(401).json({ error: 'Not logged in' });
      return null;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      res.status(404).json({ error: 'Server not found' });
      return null;
    }

    try {
      const member = await guild.members.fetch({ user: req.session.user.id, force: true });
      if (canManageTrap(guild, member, store.getGuild(guild.id))) {
        return guild;
      }
    } catch (err) {
      // User isn't a member of this guild, or the fetch failed; fall through to 403.
    }

    res.status(403).json({ error: 'You do not have permission to manage this server' });
    return null;
  }

  // ── Auth: redirect to Discord OAuth2 ──
  // Generates a random `state` value tied to this session so /auth/callback
  // can verify the request actually originated here, not from an attacker
  // replaying/forging a callback (login CSRF).
  get('/auth/discord', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    req.session.oauthStartedAt = Date.now();

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
  });

  // ── Auth: callback from Discord ──
  get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const expectedState = req.session.oauthState;
    req.session.oauthState = null; // one-time use regardless of outcome

    if (!code) return res.redirect('/');
    if (typeof code !== 'string' || typeof state !== 'string' || !expectedState || state !== expectedState || Date.now() - (req.session.oauthStartedAt || 0) > 600000) {
      console.error('[DASHBOARD] OAuth state mismatch - possible CSRF attempt or expired session');
      return res.redirect('/?error=invalid_state');
    }

    try {
      // Exchange code for tokens
      const tokenRes = await discordFetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
        }),
      });
      const tokens = await tokenRes.json();
      if (!tokens.access_token) return res.redirect('/?error=auth_failed');

      // Fetch user info
      const userRes = await discordFetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = await userRes.json();

      if (!/^\d+$/.test(user.id || '') || typeof user.username !== 'string') throw new Error('Invalid Discord user response');
      req.rotateSession();
      req.session.tokenExpiresAt = Date.now() + Math.min(7 * 86400, Number(tokens.expires_in) || 3600) * 1000;
      // Tokens stay on the server; cookies contain only an opaque session ID.
      req.session.accessToken = tokens.access_token;
      req.session.user = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(user.id) >> 22n) % 6n)}.png`,
      };

      res.redirect('/');
    } catch (err) {
      console.error('[DASHBOARD] OAuth error:', err.message);
      res.redirect('/?error=auth_failed');
    }
  });

  // ── Auth: logout ──
  get('/auth/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
  });

  // ── API: current user ──
  get('/api/me', (req, res) => {
    if (!req.session.user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user });
  });

  // ── API: user's guilds where bot is present ──
  get('/api/guilds', async (req, res) => {
    if (!req.session.accessToken) return res.status(401).json({ error: 'Not logged in' });

    try {
      const guildsRes = await discordFetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${req.session.accessToken}` },
      });
      const userGuilds = await guildsRes.json();

      if (!Array.isArray(userGuilds)) throw new Error('Invalid Discord server list');

      // OAuth lists membership; bot REST checks the exact same live policy as commands.
      const filtered = [];
      for (const g of userGuilds) {
        const guild = client.guilds.cache.get(g.id);
        if (!guild) continue;
        try {
          const member = await guild.members.fetch({ user: req.session.user.id, force: true });
          const config = store.getGuild(g.id);
          if (!canManageTrap(guild, member, config)) continue;
          filtered.push({ id: g.id, name: g.name, icon: g.icon ? 'https://cdn.discordapp.com/icons/' + g.id + '/' + g.icon + '.png?size=64' : null,
            catchCount: config.catchCount || 0, action: config.action, trapChannels: config.trapChannels.length });
        } catch (_) { /* No membership/access: omit this guild. */ }
      }

      res.json(filtered);
    } catch (err) {
      console.error('[DASHBOARD] Guilds fetch error:', err.message);
      if (err.status === 401) { req.session = null; return res.status(401).json({ error: 'Session expired; sign in again' }); }
      res.status(502).json({ error: 'Failed to fetch guilds' });
    }
  });

  // ── API: guild stats ──
  get('/api/guild/:id/stats', async (req, res) => {
    const guildId = req.params.id;
    const guild = await requireGuildAccess(req, res, guildId);
    if (!guild) return;

    const config = store.getGuild(guildId);
    const db = store.readDb();

    res.json({
      name: guild?.name || 'Unknown',
      icon: guild?.iconURL({ size: 64 }) || null,
      memberCount: guild?.memberCount || 0,
      catchCount: config.catchCount || 0,
      globalCatches: db.global.totalCatches || 0,
      action: config.action,
      trapChannels: config.trapChannels.map((id) => {
        const ch = guild?.channels.cache.get(id);
        return { id, name: ch?.name || 'unknown' };
      }),
      logChannel: config.logChannel
        ? { id: config.logChannel, name: guild?.channels.cache.get(config.logChannel)?.name || 'unknown' }
        : null,
      experiments: config.experiments,
      setupWarnings: [
        ...(!guild.members.me?.permissions.has(PermissionsBitField.Flags.BanMembers) ? ['Bot needs Ban Members permission.'] : []),
        ...config.trapChannels.filter(id => !usableChannel(guild, id)).map(() => 'A trap channel is missing or the bot cannot access it.'),
        'Place the bot role above members it should moderate. Manage optional protections with /protection in Discord.',
      ],
      allowedRoles: (config.allowedRoles || []).map((id) => {
        const role = guild?.roles.cache.get(id);
        return { id, name: role?.name || 'Unknown' };
      }),
      recentActions: (config.recentActions || []).map((a) => ({
        userId: a.userId,
        action: a.action,
        time: a.timestamp,
      })),
    });
  });

  // ── API: get custom messages ──
  get('/api/guild/:id/messages', async (req, res) => {
    if (!(await requireGuildAccess(req, res, req.params.id))) return;
    const config = store.getGuild(req.params.id);
    const { DEFAULT_WARNING, DEFAULT_DM, DEFAULT_LOG } = require('../lib/messages');
    res.json({
      warning: config.customMessages.warning || '',
      dm: config.customMessages.dm || '',
      log: config.customMessages.log || '',
      defaultWarning: DEFAULT_WARNING,
      defaultDm: DEFAULT_DM,
      defaultLog: DEFAULT_LOG,
    });
  });

  // ── API: save custom messages ──
  post('/api/guild/:id/messages', async (req, res) => {
    if (!(await requireGuildAccess(req, res, req.params.id))) return;
    const guildId = req.params.id;
    const config = store.getGuild(guildId);
    const validationError = validateMessages(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    const { warning, dm, log } = req.body;

    config.customMessages.warning = warning || null;
    config.customMessages.dm = dm || null;
    config.customMessages.log = log || null;
    store.saveGuild(guildId, config);

    res.json({ success: true });
  });

  // ── API: get roles ──
  get('/api/guild/:id/roles', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const config = store.getGuild(req.params.id);

    // Get all server roles for the dropdown
    const serverRoles = guild
      ? guild.roles.cache
          .filter((r) => r.id !== guild.id && !r.managed) // exclude @everyone and bot roles
          .sort((a, b) => b.position - a.position)
          .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }))
      : [];

    const allowedRoles = (config.allowedRoles || []).map((id) => {
      const role = guild?.roles.cache.get(id);
      return { id, name: role?.name || 'Unknown', color: role?.hexColor || '#99aab5' };
    });

    res.json({ allowedRoles, serverRoles });
  });

  // ── API: update roles ──
  post('/api/guild/:id/roles', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const config = store.getGuild(req.params.id);
    const { allowedRoles } = req.body;

    if (!Array.isArray(allowedRoles) || allowedRoles.length > 50 || allowedRoles.some(id => typeof id !== 'string' || id === guild.id || !guild.roles.cache.has(id) || guild.roles.cache.get(id).managed)) return res.status(400).json({ error: 'Choose up to 50 valid server roles; everyone and managed roles cannot be allowed' });

    // Only accept role ids that actually exist on this guild.
    const validRoleIds = allowedRoles.filter((id) => typeof id === 'string' && guild.roles.cache.has(id));

    config.allowedRoles = [...new Set(validRoleIds)];
    store.saveGuild(req.params.id, config);
    res.json({ success: true });
  });

  // ── API: get channels (for the trap channel / log channel editors) ──
  get('/api/guild/:id/channels', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const config = store.getGuild(req.params.id);

    const textChannels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText)
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name }));

    res.json({
      channels: textChannels,
      trapChannels: config.trapChannels || [],
      logChannel: config.logChannel || null,
      manyTraps: !!config.experiments.manyTraps,
    });
  });

  // ── API: set trap channel(s) ──
  // Mirrors /spamtrap channel and /spamtrap channels exactly (same
  // maybeDeleteOldAutoChannel/postWarning/postOrUpdateKickCounter helpers
  // from lib/trapChannel.js), so setting it from the dashboard behaves
  // identically to setting it in Discord.
  post('/api/guild/:id/channels', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const guildId = req.params.id;
    let g = store.getGuild(guildId);
    const { trapChannels } = req.body;

    if (!Array.isArray(trapChannels) || trapChannels.length === 0) {
      return res.status(400).json({ error: 'Pick at least one trap channel' });
    }
    if (trapChannels.length > 1 && !g.experiments.manyTraps) {
      return res.status(400).json({ error: 'Enable the Many Traps experiment first (/spamtrap toggle) to set more than one trap channel' });
    }
    if (trapChannels.length > 5) {
      return res.status(400).json({ error: 'A maximum of 5 trap channels is supported' });
    }

    // Only accept channel ids that actually exist on this guild, and dedupe -
    // same safety /spamtrap channels applies.
    const seen = new Set();
    const validIds = trapChannels.filter((id) => {
      if (!usableChannel(guild, id)) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (validIds.length !== new Set(trapChannels).size || validIds.length === 0) {
      return res.status(400).json({ error: "Choose text channels where the bot can view, send messages and read history" });
    }

    await maybeDeleteOldAutoChannel(guild, g, validIds);
    // Re-read fresh before saving, same reasoning as the slash command: a
    // message catch could have written catchCount/kickCounterMessages to
    // disk during the awaits above.
    const autoTrapChannelId = g.autoTrapChannelId;
    g = store.updateGuild(guildId, (fresh) => {
      fresh.trapChannels = validIds;
      fresh.autoTrapChannelId = autoTrapChannelId;
    });

    const failed = [];
    for (const id of validIds) {
      const channel = guild.channels.cache.get(id);
      // Same cleanup as the /spamtrap channel(s) slash commands - clears out
      // any leftover message from before the warning+counter were merged
      // into one, so setting it from the dashboard doesn't leave a stale
      // message behind either.
      await purgeOldBotMessages(channel);
      const result = await postWarning(channel, guildId, g);
      if (!result.ok) {
        failed.push({ id, name: channel.name });
        continue;
      }
      await postOrUpdateKickCounter(channel, guildId, g, g.catchCount || 0);
    }

    res.json({ success: true, trapChannels: validIds, failed });
  });

  // ── API: create a brand-new trap channel ──
  // Same channel the bot makes for itself on join, but on demand from the
  // dashboard - for servers that deleted theirs, or that would rather not
  // create one by hand in Discord first.
  post('/api/guild/:id/create-channel', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const guildId = req.params.id;
    let g = store.getGuild(guildId);

    const me = guild.members.me;
    if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return res.status(400).json({ error: "I don't have the Manage Channels permission on this server" });
    }

    // Discord caps channel names at 100 characters. Falls back to the exact
    // name the bot uses on join when nothing usable is supplied.
    const raw = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const name = (raw || '\u{1FAA4}│spam-trap').slice(0, 100);

    // Same ceiling as setting an existing channel: five maximum, and only
    // more than one at all when Many Traps is enabled.
    const existing = g.trapChannels || [];
    if (g.experiments.manyTraps && existing.length >= 5) {
      return res.status(400).json({ error: 'A maximum of 5 trap channels is supported' });
    }

    let channel;
    try {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        position: 0,
        reason: 'Spam Trap: trap channel created from the dashboard',
      });
    } catch (err) {
      return res.status(500).json({ error: `Couldn't create the channel: ${err.message}` });
    }

    // With Many Traps on the new channel is added to the list; without it, it
    // replaces whatever was set, matching /spamtrap channel's behaviour.
    const nextIds = g.experiments.manyTraps ? [...existing, channel.id] : [channel.id];
    await maybeDeleteOldAutoChannel(guild, g, nextIds);
    g = store.updateGuild(guildId, (fresh) => {
      fresh.trapChannels = nextIds;
      // Tracked as bot-created so the Delete Old Trap experiment can clean it
      // up later, exactly like the channel made on join.
      fresh.autoTrapChannelId = channel.id;
    });

    // Brand-new channel, so there's nothing to purge - straight to posting.
    const result = await postWarning(channel, guildId, g);
    if (result.ok) {
      await postOrUpdateKickCounter(channel, guildId, g, g.catchCount || 0);
    }

    console.log(`[DASHBOARD] Created trap channel #${channel.name} in ${guild.name}`);
    res.json({
      success: true,
      channel: { id: channel.id, name: channel.name },
      trapChannels: nextIds,
      warningPosted: !!result.ok,
    });
  });

  // ── API: set or clear the log channel ──
  post('/api/guild/:id/log', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const guildId = req.params.id;
    const { logChannel } = req.body;

    if (logChannel !== null && logChannel !== undefined && !usableChannel(guild, logChannel)) {
      return res.status(400).json({ error: 'Choose an accessible text channel, or null to clear it' });
    }

    const config = store.getGuild(guildId);
    config.logChannel = logChannel || null;
    store.saveGuild(guildId, config);
    res.json({ success: true, logChannel: config.logChannel });
  });

  // ── API: global overview ──
  get('/api/overview', (req, res) => {
    const db = store.readDb();
    res.json({
      totalServers: client.guilds.cache.size,
      totalCatches: db.global.totalCatches || 0,
      configuredServers: Object.values(db.guilds).filter((g) => g.trapChannels.length > 0).length,
    });
  });

  // ── Static pages ──
  get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
  });
  get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
  });

  // ── Home ──
  get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  get('/health', (req, res) => {
    try {
      store.healthCheck();
      if (!client.isReady() || client.commandsReady === false) return res.status(503).json({ status: 'unavailable' });
      res.json({ status: 'ok' });
    } catch (_) { res.status(503).json({ status: 'unavailable' }); }
  });

  app.use((err, req, res, next) => {
    console.error('[DASHBOARD] Request failed:', err.message);
    if (res.headersSent) return next(err);
    const status = err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: status === 400 ? 'Invalid JSON request' : status === 413 ? 'Request is too large' : status === 503 ? 'Please try again later' : 'Request failed; please try again' });
  });

  // ── Anything else unmatched: a real 404, not a silent 200 ──
  // The old catch-all (`app.get('*', ...)`) served index.html with an
  // implicit 200 for every unmatched URL, including typos and dead links -
  // bad for SEO (looks like infinite duplicate pages to crawlers) and for
  // any tooling checking link validity. The site has no other client-side
  // routes to preserve (everything real is one of the routes above, or a
  // static file already served by express.static earlier).
  app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  return app;
}

function startDashboard(client) {
  const app = createDashboard(client);
  const server = app.listen(process.env.PORT || 3000, () => console.log('[DASHBOARD] Listening'));
  server.on('close', app.locals.close);
  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  return server;
}

module.exports = { startDashboard, createDashboard, validateDashboardEnvironment };
