# 4.0.1 — replacement maintenance build

- Shared trap-management authorization across commands and dashboard, including configured allowed roles. Rechecks live membership for dashboard access.
- Server-side, bounded sessions; opaque signed session cookies; enforced expiry and logout revocation; strong production configuration checks.
- OAuth response validation, state lifetime, session ID rotation and request timeouts.
- JSON input/length validation, safe channel-type/permission checks, role restrictions, request rate limits, request-origin checks and async error responses.
- Serialized per-guild dashboard mutations and a working Replace action for single-trap setups.
- Atomic JSON commits and a recoverable rolling backup, with deletion reflected in the backup.
- Persistent, reason-checked softban recovery; truthful action logs and DMs; no rejoin invitation for active permanent bans; concurrent trap-catch guard.
- Message modal authorization recheck, matching message limits and disabled outgoing mentions.
- Dashboard/Discord/storage health endpoint and reproducible Docker installs on Node 22.
- Dependency lockfile updated to compatible patched versions; npm reported zero known vulnerabilities at verification time.
- Compact homepage hero and navigation, accurate feature statistics, corrected enforcement/DM ordering, clearer trap warnings, accessible labels/status messages, improved contrast and mobile command layouts.
- Separate website CSS/JavaScript, versioned asset URLs, a Content Security Policy and corrected privacy wording.
- GitHub push helper no longer force-pushes or replaces an existing remote. Secrets, databases, backups and temporary test files are excluded from Git/build context.

Unchanged scope: optional server protections remain managed with `/protection` in Discord. Deployment is single-instance. No production service was modified while preparing this build.
