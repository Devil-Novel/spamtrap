# Replace Spam Trap 4.0.0 with 4.0.1

This ZIP contains the complete bot, dashboard, website assets, configuration examples and tests. It does not contain credentials, node_modules or a database.

## Before replacing files

1. Make a backup of your existing source and `db.json` while the old bot is stopped. Keep your `.env` or Railway Variables. Do not overwrite a real `.env` with `.env.example`.
2. Copy the files inside `spamtrap_pkg` over your bot's source folder. Keep the existing database at the same `DATABASE_PATH`. There is no database reset or manual migration.
3. Use Node.js 22 or newer. The Dockerfile uses Node 22 and installs the exact versions in `package-lock.json`.

## Required deployment settings

Keep the existing `BOT_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET` and `BASE_URL` values for your Discord application. For production:

- `NODE_ENV=production`
- `BASE_URL=https://spamtrap.help` (or the HTTPS origin you actually host; no path)
- `DATABASE_PATH=/data/db.json` with a persistent Railway Volume mounted at `/data`
- `SESSION_SECRET` must be a random secret of at least 32 characters. Generate one locally with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the generated value into Railway Variables or your `.env`. Do not use the example placeholder. Production startup deliberately stops if required dashboard settings are missing or insecure.

Keep the Discord OAuth redirect URI set to `https://spamtrap.help/auth/callback` (substitute your actual origin if different).

Keep `ENABLE_MEMBER_EVENTS=false` unless the Server Members Intent is already enabled for your Discord application. The existing Message Content Intent is still required.

## Start

For Railway: replace the source in your existing repository and redeploy. Keep one replica and the existing volume. The healthcheck is `/health`; it reports unavailable if Discord is disconnected, command registration failed, or storage cannot be read/written. Review deployment logs if health fails. Existing commands are registered once after the bot connects. Do not run two bot processes against the same database.

For a local install:

```sh
npm ci --omit=dev --ignore-scripts
npm start
```

You can run `npm test` before starting. `npm run deploy-commands` remains available for manual registration.

## Verify after deployment

1. Open `/health`; it should return `{"status":"ok"}`. Check `/spamtrap status` and confirm the old trap/log channel IDs survived.
2. Log into the dashboard again. Old sessions are invalidated by the session change, and future restarts also sign dashboard users out. This does not reset bot settings.
3. Open a server's Config tab. Replace the single trap channel if needed; accessible text channels are required. Review bot role hierarchy and channel permission overrides.
4. In a test server, check a softban with a disposable test account. Successful unbans allow rejoining. If an unban fails, the bot reports the failure and keeps a recovery record across restarts, retrying with backoff. Keep Ban Members enabled and review the mod log.
5. Optional protections still use `/protection` in Discord and start with their existing saved settings. `/spamtrap disable` affects trap-channel moderation only.

## Storage and session limits

The JSON schema remains compatible with 4.0.0, with an optional `pendingUnbans` array added per server. Writes use temporary files, fsync and atomic rename. A rolling `.bak` holds the previous valid database and can be restored if the primary is unreadable. Keep independent backups as well. A database error without a valid backup stops processing instead of silently creating empty settings.

This version supports one bot/dashboard process. Sessions are stored in bounded server memory and contain OAuth tokens only on the server; cookies contain an opaque signed ID. Sessions expire after at most seven days or token expiry, whichever comes first. Logout revokes a session. A restart requires signing in again. Multiple replicas require a shared transactional database and session store before enabling them.

## Validation performed

The replacement was checked with the existing protection tests plus added tests covering dashboard permissions, OAuth state, logout replay, server-side session expiry, malformed inputs, channel types, concurrent channel creation, health responses, softban recovery and interrupted database writes. The website was inspected locally at desktop and phone sizes with mock Discord data. Real Discord login, live bans and Railway deployment require verification in your environment; no production credentials were used to build this ZIP.

The original review incorrectly said Docker skipped command registration. The original `index.js` already registered commands on readiness. This replacement retains that behavior, avoids duplicate registration through `npm start`, and exposes registration failure through deployment health.
