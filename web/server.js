const express = require('express');
const session = require('cookie-session');
const path = require('path');
const crypto = require('crypto');
const { PermissionsBitField } = require('discord.js');
const store = require('../lib/store');

function startDashboard(client) {
  const CLIENT_ID = process.env.CLIENT_ID || client.user.id;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  const REDIRECT_URI = `${BASE_URL}/auth/callback`;

  const app = express();

  // ── Trust Railway's proxy so req.secure / x-forwarded-proto resolve correctly ──
  app.set('trust proxy', 1);

  // ── Force HTTPS + HSTS (defense in depth; Railway's edge already redirects, this covers direct/edge-cache edge cases) ──
  app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    next();
  });

  app.use(express.json());
  app.use(
    session({
      name: 'spamtrap',
      keys: [process.env.SESSION_SECRET || 'spamtrap-secret-' + Date.now()],
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    })
  );

  // ── Static files ──
  // Cache images/assets for a week; keep HTML on no-cache so dashboard
  // updates (and deploys) always take effect without a stale page.
  app.use(
    express.static(path.join(__dirname, 'public'), {
      maxAge: '7d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
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
      const member = guild.members.cache.get(req.session.user.id) || (await guild.members.fetch(req.session.user.id));
      if (guild.ownerId === member.id || member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
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
  app.get('/auth/discord', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;

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
  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const expectedState = req.session.oauthState;
    req.session.oauthState = null; // one-time use regardless of outcome

    if (!code) return res.redirect('/');
    if (!state || !expectedState || state !== expectedState) {
      console.error('[DASHBOARD] OAuth state mismatch - possible CSRF attempt or expired session');
      return res.redirect('/?error=invalid_state');
    }

    try {
      // Exchange code for tokens
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
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
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = await userRes.json();

      // Store in session
      req.session.accessToken = tokens.access_token;
      req.session.user = {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: user.avatar
          ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
          : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.id) % 5}.png`,
      };

      res.redirect('/');
    } catch (err) {
      console.error('[DASHBOARD] OAuth error:', err.message);
      res.redirect('/?error=auth_failed');
    }
  });

  // ── Auth: logout ──
  app.get('/auth/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
  });

  // ── API: current user ──
  app.get('/api/me', (req, res) => {
    if (!req.session.user) return res.json({ loggedIn: false });
    res.json({ loggedIn: true, user: req.session.user });
  });

  // ── API: user's guilds where bot is present ──
  app.get('/api/guilds', async (req, res) => {
    if (!req.session.accessToken) return res.status(401).json({ error: 'Not logged in' });

    try {
      const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${req.session.accessToken}` },
      });
      const userGuilds = await guildsRes.json();

      if (!Array.isArray(userGuilds)) return res.json([]);

      // Filter: user has Manage Server permission AND bot is in the guild
      const botGuildIds = new Set(client.guilds.cache.map((g) => g.id));
      const MANAGE_GUILD = 0x20;

      const filtered = userGuilds
        .filter((g) => (parseInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD && botGuildIds.has(g.id))
        .map((g) => {
          const config = store.getGuild(g.id);
          return {
            id: g.id,
            name: g.name,
            icon: g.icon
              ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
              : null,
            catchCount: config.catchCount || 0,
            action: config.action,
            trapChannels: config.trapChannels.length,
          };
        });

      res.json(filtered);
    } catch (err) {
      console.error('[DASHBOARD] Guilds fetch error:', err.message);
      res.status(500).json({ error: 'Failed to fetch guilds' });
    }
  });

  // ── API: guild stats ──
  app.get('/api/guild/:id/stats', async (req, res) => {
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
  app.get('/api/guild/:id/messages', async (req, res) => {
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
  app.post('/api/guild/:id/messages', async (req, res) => {
    if (!(await requireGuildAccess(req, res, req.params.id))) return;
    const guildId = req.params.id;
    const config = store.getGuild(guildId);
    const { warning, dm, log } = req.body;

    config.customMessages.warning = warning || null;
    config.customMessages.dm = dm || null;
    config.customMessages.log = log || null;
    store.saveGuild(guildId, config);

    res.json({ success: true });
  });

  // ── API: get roles ──
  app.get('/api/guild/:id/roles', async (req, res) => {
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
  app.post('/api/guild/:id/roles', async (req, res) => {
    const guild = await requireGuildAccess(req, res, req.params.id);
    if (!guild) return;
    const config = store.getGuild(req.params.id);
    const { allowedRoles } = req.body;

    if (!Array.isArray(allowedRoles)) return res.status(400).json({ error: 'allowedRoles must be an array' });

    // Only accept role ids that actually exist on this guild.
    const validRoleIds = allowedRoles.filter((id) => typeof id === 'string' && guild.roles.cache.has(id));

    config.allowedRoles = validRoleIds;
    store.saveGuild(req.params.id, config);
    res.json({ success: true });
  });

  // ── API: global overview ──
  app.get('/api/overview', (req, res) => {
    const db = store.readDb();
    res.json({
      totalServers: client.guilds.cache.size,
      totalCatches: db.global.totalCatches || 0,
      configuredServers: Object.values(db.guilds).filter((g) => g.trapChannels.length > 0).length,
    });
  });

  // ── Static pages ──
  app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
  });
  app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
  });

  // ── SPA fallback ──
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── Start ──
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[DASHBOARD] Running at ${BASE_URL}`);
    console.log(`[DASHBOARD] OAuth client_id: ${CLIENT_ID}`);
    console.log(`[DASHBOARD] Redirect URI: ${REDIRECT_URI}`);
  });
}

module.exports = { startDashboard };
