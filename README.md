# Spam Trap

The Discord bot that stops spammers before they spread.

Spam Trap is a free, open-source Discord moderation bot that automatically catches and removes spammers and compromised accounts by monitoring dedicated trap channels. Any non-admin user who sends a message in a trap channel is instantly soft-banned, notified via DM with account recovery steps, and logged for your mod team.

**Website:** [spamtrap.help](https://spamtrap.help)
**Invite:** [Add to your server](https://discord.com/oauth2/authorize?client_id=1523811499766976723&permissions=1099511704597&scope=bot%20applications.commands)
**Support:** [Discord Server](https://discord.gg/WuJMbkNZBJ)

---

## How It Works

1. **Bot joins and creates a trap.** When invited, Spam Trap auto-creates a `spam-trap` channel at the top of your server with a multilingual warning message in 8 languages.

2. **Spam is detected.** Spam bots blast every visible channel. When one posts in the trap channel, the bot catches it instantly. Server owners, administrators, and users with allowed roles are always safe.

3. **The user gets a DM.** The bot sends a message explaining the account may be compromised, with recovery steps: change password, enable 2FA, remove suspicious authorized apps.

4. **The action runs.** Softban (default): ban then immediately unban to purge all messages, allowing the user to rejoin once secure. Or permanent ban. The spam is wiped from the server.

5. **Everything is logged.** An embed is posted in your mod log channel with user info, action taken, message content (optional), and a running catch counter.

---

## Features

- **Instant Protection** — Automatically bans spammers the moment they post in the trap channel. Zero delay, zero manual work.
- **Server Safety** — Stops spam before it spreads. Compromised accounts are caught and notified before they can do damage.
- **Saves Time** — Reduces moderator workload by handling spam automatically so your team can focus on the community.
- **Easy to Use** — Two commands to set up. 12 optional experiments to customize. A web dashboard to manage everything.
- **Multilingual Warnings** — Warning message in 8 languages: English, German, Indonesian, Malay, Portuguese, Russian, Spanish, and Arabic.
- **Account Recovery** — Soft-banned users receive a DM with account recovery steps and can rejoin when their account is secure.
- **Web Dashboard** — View stats, customize messages, manage roles, and configure settings from a branded web dashboard with Discord OAuth login.
- **12 Experiments** — Channel warmer, random renaming, reinvite links, timeout-first, and more. Toggle them on or off anytime.
- **Role-Based Permissions** — Control which roles can manage the bot. Falls back to Ban Members + Manage Server if no roles are set. Server owner always has access.
- **Auto-Channel Creation** — Bot automatically creates the trap channel when joining a new server (requires Manage Channels permission).

---

## Commands

All commands require the configured allowed roles, or Ban Members + Manage Server permissions if no roles are set. The server owner always has access.

### Setup

| Command | Description |
|---|---|
| `/spamtrap channel #channel` | Set the trap channel. Posts a multilingual warning. |
| `/spamtrap log #channel` | Set the mod log channel for action reports. |
| `/spamtrap action [softban/ban/disabled]` | Choose the moderation action. |
| `/spamtrap channels #ch1 #ch2 ...` | Set up to 5 trap channels (requires Many Traps experiment). |
| `/spamtrap disable` | Turn off the trap. Keeps settings for later. |

### Configuration

| Command | Description |
|---|---|
| `/spamtrap toggle` | Enable or disable experiments via dropdown menu. |
| `/spamtrap experiments` | View all experiments and their current status. |
| `/spamtrap status` | View the full current configuration. |
| `/spamtrap stats` | View catch statistics and recent actions. |
| `/spamtrap info` | Show all commands and how to use the bot. |
| `/spamtrap-messages` | Customize warning, DM, and log messages via modal. |

### Role Management

| Command | Description |
|---|---|
| `/spamtrap addrole @role` | Add a role that can manage Spam Trap. (Admin/Owner only) |
| `/spamtrap removerole @role` | Remove a role from managing Spam Trap. (Admin/Owner only) |
| `/spamtrap roles` | View all roles that can manage the bot. |

---

## Experiments

Toggle experiments on or off with `/spamtrap toggle`. Each experiment changes a specific behavior:

| Experiment | Description |
|---|---|
| **Forward Message** | Include the caught spam message content in the log embed. |
| **Reinvite** | Include a server invite link in the DM sent to the caught user. |
| **No DM** | Skip sending a DM to the caught user. |
| **No Warning** | Skip posting the warning message when setting a trap channel. |
| **Channel Warmer** | Periodically send and delete a message in the trap channel to keep it visible in the channel list for spam bots. |
| **Random Channel Name** | Randomly rename the trap channel daily from a curated list of common channel names to make it blend in. |
| **Random Name Chaos** | Randomly rename the trap channel daily using completely random words. Mutually exclusive with Random Channel Name. |
| **Timeout First** | Timeout the user for 5 minutes before banning, giving mods time to review. |
| **Only Recent Delete** | Only delete messages from the last 24 hours instead of purging all messages during softban. |
| **Many Traps** | Allow up to 5 trap channels instead of 1. Required for `/spamtrap channels`. |
| **Ensure Deletion** | After banning, verify the spam message is deleted and force-delete if still present. |
| **Delete Old Trap** | When switching to a new trap channel, delete the previous auto-created one if it's no longer in use. |

---

## Custom Messages

Customize the bot's messages with `/spamtrap-messages`. Three messages can be customized:

- **Warning** — The message posted in the trap channel.
- **DM** — The message sent to caught users.
- **Log** — The description in the log embed.

### Template Variables

Use these placeholders in your custom messages:

| Variable | Replaced with |
|---|---|
| `{{server:name}}` | Server name |
| `{{server:name:linked}}` | Server name with invite link |
| `{{action:text}}` | Action description (e.g. "soft-banned") |
| `{{trap:channel:link}}` | Trap channel link |
| `{{trap:channel:mention}}` | Trap channel mention (#channel) |
| `{{user:mention}}` | Caught user mention |
| `{{user:id}}` | Caught user ID |
| `{{reinvite:link}}` | Server invite link |
| `{{trap:moderation-count}}` | Total catch count |

---

## Web Dashboard

The web dashboard provides a browser-based interface for managing Spam Trap across all your servers.

**Features:**
- View total servers, active traps, and global catch count
- Per-server stats with recent actions timeline
- Customize warning, DM, and log messages
- View and manage allowed roles (add/remove from dropdown)
- View current configuration and active experiments
- Discord OAuth2 login (username, avatar, server list only)
- Sessions expire after 7 days

**URL:** Your Railway deployment URL (e.g. `https://spamtrap.help`)

---

## Bot Embeds

| Embed | Color | Trigger |
|---|---|---|
| **Spam Trap Status** | `#f47521` (orange) | `/spamtrap status` |
| **Spam Trap Experiments** | `#060a10` (dark) | `/spamtrap experiments` |
| **Spam Trap Stats** | `#f47521` (orange) | `/spamtrap stats` |
| **Spam Trap catch** | `#e83535` (red) | When a user is caught |
| **Spam Trap Roles** | `#f47521` (orange) | `/spamtrap roles` |
| **Spam Trap Info** | `#f47521` (orange) | `/spamtrap info` |

All embeds use custom application emojis:
`<:Done:>` `<:InstantProtection:>` `<:Experiments:>` `<:WebDashboard:>` `<:ServerSafety:>` `<:EasytoUse:>` `<:SavesTime:>` `<:MultilingualWarnings:>` `<:AccountRecovery:>` `<:Discord:>`

---

## Custom Application Emojis

| Emoji | ID | Used for |
|---|---|---|
| Done | `1523817641653829774` | Confirmations, experiment ON indicator |
| InstantProtection | `1524000022830518272` | Trap channel, catch, status, errors |
| Experiments | `1524000040828539011` | Experiment toggle, experiments embed |
| WebDashboard | `1524000030556426354` | Stats, log channel |
| ServerSafety | `1524000037166645331` | Roles, admin warnings |
| EasytoUse | `1524000034079768716` | Info command |
| SavesTime | `1524000035577135114` | Disabled action log |
| MultilingualWarnings | `1524000032771149824` | (Reserved) |
| AccountRecovery | `1524000028689961060` | (Reserved) |
| Discord | `1524000021198930031` | (Reserved) |
| LinkedIn | `1524148005081583796` | Website nav |
| GamingHub | `1524147951071658114` | Website nav |

---

## Trap Flow (What Happens When Someone Posts)

```
Message in trap channel
    │
    ├── Is it a bot? → Skip
    ├── Is it the server owner? → Skip + log warning
    ├── Is it an admin? → Skip + log warning
    │
    ├── Delete the message
    ├── Send DM to user (unless No DM is on)
    │     └── Account recovery steps + server name + action taken
    ├── Execute action:
    │     ├── softban: Ban → wait 3s → Unban (purges messages, user can rejoin)
    │     ├── ban: Permanent ban (purges messages)
    │     └── disabled: Log only, no action
    ├── Log to mod channel (embed with user info, action, catch count)
    ├── Increment catch counter (server + global)
    └── If Ensure Deletion is on: verify message is deleted
```

---

## Permissions

### Required Bot Permissions

| Permission | Why |
|---|---|
| Ban Members | Banning and soft-banning caught users |
| Manage Channels | Auto-creating the trap channel on join |
| Manage Messages | Deleting spam messages |
| Moderate Members | Timeout functionality (Timeout First experiment) |
| View Channels | Reading messages in the trap channel |
| Send Messages | Posting warnings and log embeds |
| Create Instant Invite | Reinvite experiment |
| Read Message History | Ensuring message deletion |
| Manage Roles | (Optional) Role hierarchy checks |

**Invite URL with all permissions:**
```
https://discord.com/oauth2/authorize?client_id=1523811499766976723&permissions=1099511704597&scope=bot%20applications.commands
```

### Required Intents

- Guilds
- Guild Messages
- Message Content
- Guild Members
- Guild Moderation

### User Permissions

- **No roles configured:** Ban Members + Manage Server required
- **Roles configured:** Only users with an allowed role can use commands
- **Server owner:** Always has full access
- **Role management (addrole/removerole):** Server owner or Administrator only

---

## Deployment

### Prerequisites

- Node.js 18+
- A Discord bot token
- A GitHub repository

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` or `DISCORD_TOKEN` | Yes | Discord bot token |
| `CLIENT_ID` | Yes (for dashboard) | Application client ID |
| `CLIENT_SECRET` | Yes (for dashboard) | OAuth2 client secret |
| `BASE_URL` | Yes (for dashboard) | Your Railway URL |
| `SESSION_SECRET` | Recommended | Express session secret |
| `GUILD_ID` | No | For testing: register commands to one server only |

### Deploy to Railway

1. Push to GitHub
2. Create a new project on [Railway](https://railway.app) from your GitHub repo
3. Add environment variables in the Variables tab
4. Add a Volume mounted at `/data` for persistent storage
5. Railway auto-deploys on every push

### Register Commands

Before first use or after editing `commands.js`:

```bash
npm install
npm run deploy-commands
```

Without `GUILD_ID`: commands register globally (up to 1 hour to appear).
With `GUILD_ID`: commands appear instantly on that server only.

---

## Project Structure

```
spam-trap-bot/
├── index.js              # Main bot: client, events, slash commands, guildCreate
├── commands.js           # Slash command definitions
├── deploy-commands.js    # Manual command registration script
├── lib/
│   ├── store.js          # JSON database (guild config, logs, stats)
│   └── messages.js       # Default messages (warning, DM, log) + template engine
├── web/
│   ├── server.js         # Express dashboard: OAuth2, API routes
│   └── public/
│       ├── index.html    # Landing page + dashboard SPA
│       ├── privacy.html  # Privacy Policy
│       ├── terms.html    # Terms of Service
│       └── *.png         # Branded images (badges, logo, backgrounds)
├── data/
│   └── db.json           # Persistent database (auto-created)
├── package.json
├── Dockerfile
├── railway.json
├── Procfile
└── .env.example
```

---

## Languages Supported

The default warning message is displayed in 8 languages:

1. English
2. German (Deutsch)
3. Indonesian (Bahasa Indonesia)
4. Malay (Bahasa Melayu)
5. Portuguese - Brazil (Português)
6. Russian (Русский)
7. Spanish (Español)
8. Arabic (العربية)

---

## Links

- **Website:** https://spamtrap.help
- **Invite Bot:** https://discord.com/oauth2/authorize?client_id=1523811499766976723&permissions=1099511704597&scope=bot%20applications.commands
- **Discord Server:** https://discord.gg/WuJMbkNZBJ
- **GitHub:** https://github.com/aimanmoustafa/spamtrap
- **Privacy Policy:** https://spamtrap.help/privacy
- **Terms of Service:** https://spamtrap.help/terms
- **Contact:** aimanmoustafaa@gmail.com
- **LinkedIn:** https://www.linkedin.com/in/aimanmoustafa/

---

## License

Spam Trap is a personal project by [Aiman Moustafa](https://www.linkedin.com/in/aimanmoustafa/). All rights reserved.
