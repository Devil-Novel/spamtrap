# Spam Trap – Server Protection Guide

Spam Trap's original feature is the **trap channel**: a channel nobody should post in, where any message results in a soft-ban. Version 4.0 adds seven optional **server protections** that watch ordinary channels. They are independent of the trap channel, **every one of them starts switched off**, and the default action for all of them is **alert only**.

> `/spamtrap disable` turns off **trap channels only**. The protections have their own switches under `/protection`, and vice-versa.

---

## 1. What each protection does (and does not do)

| Feature | Watches for | What it can't do |
|---|---|---|
| `scam` | Links to domains on your **block list**, plus **suspected** fake Nitro gifts and Discord look-alike domains, using local heuristics only | Does not scan attachments, follow redirects, query any external service, or catch every scam. Heuristic matches are reported as *suspected phishing* and can be wrong. |
| `raid` | An unusually large burst of **joins** (needs member events, see §3) | Never bans, kicks or times out anyone for joining; never locks the server down. |
| `mentions` | Too many user/role/everyone mentions by one account across all channels in a rolling window | — |
| `repeats` | The same (or near-identical) text posted repeatedly by one account, across channels. Case, whitespace and invisible characters are ignored. | Only short-lived hashes are kept; message text is never stored. |
| `newcomers` | Links or attachments from members who joined less than N minutes ago | Needs the join time on the message (Discord includes it); members whose join time is unknown are not restricted. |
| `webhooks` | Message floods from one webhook | Only ever deletes messages; never deletes the webhook or punishes a member. |
| `antinuke` | A burst of destructive admin actions by one account: channel/role deletion, kicks, bans, dangerous role grants, dangerous permission additions | Reacts *after* the fact; cannot restore deleted channels/roles; cannot act on accounts whose role is above the bot's. |

### Exemptions
- **Always exempt from everything:** the server owner and Spam Trap itself.
- **Trusted roles** (`/protection trust`) are exempt from all seven protections.
- **Staff** — anyone with Administrator, Manage Server, Manage Messages or Moderate Members — are exempt from the six *message* protections, **but not from anti-nuke**. A compromised admin account is exactly what anti-nuke exists for, so Administrators are deliberately not auto-exempted there.
- **Trusted webhooks** (`/protection webhook`) are not checked at all.
- Other bots' messages are ignored; webhook messages are checked.

---

## 2. Deployment

Nothing changes for existing deployments: the bot boots with the same intents as before, all protections off. Two things to know:

1. **Slash commands** – `/protection` is a new command. The start script already runs `deploy-commands.js`, so it registers on the next deploy (global commands can take up to an hour to appear).
2. **`ENABLE_MEMBER_EVENTS`** – new, optional, defaults to `false`. See §3.

Run the offline tests before deploying: `npm test` (no token needed; nothing connects to Discord).

---

## 3. Intents

| Intent | Needed for | Privileged? |
|---|---|---|
| Guilds, Guild Messages, Guild Moderation | everything (already used) | no |
| Message Content | trap channel + all message protections (already used) | **yes** – must be on in the portal |
| Server Members | **raid protection only** (join events) | **yes** – only requested when `ENABLE_MEMBER_EVENTS=true` |
| Presence | — | **not required, never requested** |

**Enabling member events, in this order:**
1. Discord Developer Portal → your app → **Bot** → *Privileged Gateway Intents* → turn on **Server Members Intent** → **Save Changes**.
2. If the bot is in 100+ servers, Discord must also *approve* that intent (the same review process as Message Content). Wait for the approval email.
3. Set `ENABLE_MEMBER_EVENTS=true` in Railway → Variables, then redeploy.
4. `/protection feature name:raid enabled:true`.

If step 3 happens before step 1, Discord refuses the login. The bot then prints a `[FATAL]` message naming the missing intent and exits (so Railway shows the deploy as failed instead of "Active" while the bot is offline). An invalid or reset token is reported the same way.

The other protections never need the Server Members Intent: the member data they use (roles, permissions, join time) is already included in message and interaction payloads.

---

## 4. Bot permissions

| Permission | Needed for |
|---|---|
| Manage Messages | message action `delete` / `timeout` (deleting the flagged message) |
| Moderate Members | message action `timeout` |
| View Audit Log | anti-nuke (Discord only sends audit-log events to bots that have it) |
| Manage Roles | anti-nuke action `strip_roles` |

`/protection status` lists whatever is missing for your current settings. Two things it cannot see: **channel permission overrides** (e.g. the bot role denied Manage Messages in one channel) and **role hierarchy** (the bot can only time out members, or remove roles, that sit *below* its own highest role). Both can still block an action; the incident log will say so.

---

## 5. Commands (Administrator or server owner only; replies are only visible to you)

```
/protection status                                   features, actions, limits, exemptions, missing permissions, raid state
/protection recent                                   last 20 incidents + total count (no message content)
/protection feature name:<feature> enabled:<bool>    scam | raid | mentions | repeats | newcomers | webhooks | antinuke
/protection limit name:<setting> value:<number>      see table below
/protection action target:messages type:<alert|delete|timeout>
/protection action target:antinuke type:<alert|strip_roles>
/protection trust role:<role> trusted:<bool>         max 50 roles; @everyone is refused
/protection webhook id:<webhook id> trusted:<bool>   max 50; numeric ID only, never a URL or token
/protection domain list:<blockedDomains|allowedDomains> operation:<add|remove> host:<domain>
```

Invalid values are rejected with the allowed range; mismatched action types (`strip_roles` for messages, `delete`/`timeout` for antinuke) are refused.

### Defaults and ranges

| Setting | Default | Range | Meaning |
|---|---|---|---|
| `mentionLimit` | 8 | 2–50 | mentions per sender within the window |
| `repeatLimit` | 4 | 2–20 | identical messages per sender within the window |
| `messageWindowSeconds` | 15 | 5–300 | rolling window for mentions, repeats, webhooks |
| `webhookLimit` | 8 | 2–100 | messages per webhook within the window |
| `joinLimit` | 8 | 2–100 | joins that start raid mode |
| `joinWindowSeconds` | 15 | 5–300 | window for `joinLimit` |
| `raidMinutes` | 5 | 1–120 | how long raid mode lasts |
| `raidFilter` | 0 | 0–1 | 1 = during raid mode, messages from the arrival cohort get the message action (delete at most) |
| `newcomerMinutes` | 10 | 1–1440 | no links/attachments for this long after joining |
| `timeoutMinutes` | 10 | 1–40320 | length of a `timeout` action |
| `nukeLimit` | 4 | 2–50 | destructive admin actions that trigger anti-nuke |
| `nukeWindowSeconds` | 20 | 5–300 | window for `nukeLimit` |

### Actions
- **messages** – `alert` (default): log only. `delete`: delete the message. `timeout`: delete + time out the sender for `timeoutMinutes`. A webhook can't be timed out, so for webhooks `timeout` behaves as `delete`. The raid filter also only deletes. A burst of violations produces **one** timeout, not one per message, and an existing *longer* timeout is never shortened.
- **antinuke** – `alert` (default): log only. `strip_roles`: remove the executor's **dangerous** roles (those granting Administrator, Manage Server/Roles/Channels/Webhooks, Ban or Kick) that the bot is allowed to edit; every other role is left untouched; roles the bot cannot edit (managed, or at/above the bot's role) are listed in the incident. Nobody is ever banned by anti-nuke.

### Domain lists
Entries match the domain **and all its subdomains** (`example.com` matches `a.example.com`, not `notexample.com`). An explicit **block always wins** over an allow entry. Allowed domains skip the heuristics. Official Discord domains are never flagged.

---

## 6. Alerts and incidents
- Alerts go to the **existing moderator log channel** (`/spamtrap log`). No log channel → no alerts, but incidents are still recorded.
- Every alert and reply has mentions disabled; nothing the bot posts can ping anyone.
- At most **6 alerts per minute per server**; beyond that, alerts are suppressed and the next one notes how many were skipped.
- Each incident records: feature, account or webhook ID, channel, reason, timestamp, requested action and the **actual outcome** (including "missing permissions" or "role hierarchy" failures). **Message content is never stored.** The latest 20 are kept per server plus a running count; both are deleted with the rest of the server's data when the bot is removed.
- Discord messages the bot posts in your log channel are ordinary messages: they stay until someone deletes them in Discord.

---

## 7. Limitations (please read)
- Scam detection is heuristic and **will** have false positives and misses. Start in `alert` mode and build your block list from real incidents.
- Anti-nuke sees actions only after Discord logs them. It cannot undo deletions and cannot touch accounts above the bot's role.
- Raid detection cannot run without member events (§3).
- Detection state lives in memory: a restart clears counters and an active raid mode (configuration and incidents persist).
- Channel overrides and role hierarchy can silently prevent enforcement; check `/protection recent` after enabling an action.

---

## 8. Test-server checklist
Use a throwaway server with the bot's role placed **above** a test member's role and **below** an "untouchable" role.

1. `/protection status` – all features off, actions `alert`, no missing permissions listed for alert mode.
2. `/protection feature name:mentions enabled:true`, post 8 mentions from a normal account → alert in the log channel, nothing deleted. Post again immediately → counters were reset, no second alert until a fresh burst.
3. `/protection action target:messages type:delete` → repeat → message deleted, incident outcome "message deleted".
4. `type:timeout` → repeat with a rapid burst → exactly one timeout. Manually time the member out for 1 hour first → incident says the longer timeout was kept.
5. Remove Manage Messages from the bot in one channel only → incident outcome reports missing permissions for that channel.
6. `repeats`: post the same sentence 4× across different channels with varied capitalization → one alert.
7. `scam`: post `https://dlscord-gifts.example` → suspected phishing alert. Add a domain to `blockedDomains` and post it → "block list" incident. Add it to `allowedDomains` too → still blocked (block wins).
8. `newcomers`: with a fresh alt account, post a link within 10 min → flagged; a trusted-role alt → not flagged.
9. `webhooks`: create a test webhook, send 8 messages quickly → alert (delete mode: messages gone, webhook still exists). Trust its ID → no alert.
10. `antinuke` (alert): as a non-owner admin alt, delete 4 test channels within 20 s → alert naming the account. Give the alt a trusted role → no alert. Switch to `strip_roles` and repeat → only the alt's dangerous roles are removed; its color/other roles stay; the incident lists what could not be removed.
11. `raid` (only with `ENABLE_MEMBER_EVENTS=true`): join 8 alts within 15 s → raid alert; confirm none were banned or timed out; with `raidFilter 1` and `delete`, a cohort member's message is deleted; wait `raidMinutes` → it isn't.
12. Kick the bot from the test server → re-invite → `/protection status` shows everything reset.

Passing the offline test suite (`npm test`) shows the logic behaves as specified against mocked Discord objects. It does **not** prove live behaviour: Discord permissions, intents, rate limits and payload shapes must be confirmed on a real test server with the list above.
