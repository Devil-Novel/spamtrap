# SpamTrap Bot

A Discord spam trap bot that catches spam bots and compromised accounts by watching trap channels. Built for one-click Railway deployment.

## How It Works

1. You designate a trap channel (or multiple) using `/spamtrap channel`.
2. The channel sits in your server looking like a normal text channel.
3. Spam bots blast every visible channel and hit the trap.
4. The bot DMs the user (explaining their account may be compromised), removes their messages, and either softbans or bans them.
5. Everything is logged to your chosen log channel.

## Commands

| Command | Description |
|---|---|
| `/spamtrap channel #ch` | Set the trap channel |
| `/spamtrap channels #ch1 #ch2 ...` | Set multiple trap channels (needs Many Traps experiment) |
| `/spamtrap log #ch` | Set the log channel |
| `/spamtrap action type` | Choose softban, ban, or disabled |
| `/spamtrap experiments` | View all experiments and their status |
| `/spamtrap toggle experiment` | Enable or disable an experiment |
| `/spamtrap status` | View current configuration |
| `/spamtrap stats` | View moderation statistics |
| `/spamtrap disable` | Disable the trap (keeps settings) |
| `/spamtrap-messages` | Customize warning, DM, and log messages (modal) |

## Experiments

| Experiment | What It Does |
|---|---|
| Forward Message | Sends the caught message content to the log channel |
| Reinvite | Includes a server invite link in the DM |
| No Warning Msg | Removes the warning post from the trap channel |
| No DM | Skips DMing the caught user |
| Channel Warmer | Posts a daily message to keep the trap looking active |
| Random Channel Name | Renames the trap channel daily from a word list |
| Random Channel Name (Chaos) | Renames with random characters daily |
| Timeout First | Timeouts the user for 1 hour before banning |
| Only Recent Delete | Deletes last 15 minutes of messages instead of 1 hour |
| Many Traps | Allows up to 5 trap channels per server |
| Ensure Deletion | Cleans up leftover messages 2 minutes after moderation |

## Message Variables

Use these in `/spamtrap-messages` to insert dynamic values:

| Variable | Used In | Replaced With |
|---|---|---|
| `{{action:text}}` | Warning, DM, Log | The action taken (ban/softban/disabled) |
| `{{server:name}}` | DM | Server name |
| `{{server:name:linked}}` | DM | Server name linked to discovery page |
| `{{trap:channel:link}}` | DM | Link to the trap channel |
| `{{trap:channel:mention}}` | Log | Mention of the trap channel |
| `{{reinvite:link}}` | DM | Invite link (needs Reinvite experiment) |
| `{{reinvite:block}}` | DM | Full rejoin block with invite |
| `{{user:mention}}` | Log | User mention |
| `{{user:id}}` | Log | Raw user ID |
| `{{trap:moderation-count}}` | Log | Total server catch count |

## Deploy to Railway

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a new application.
3. Go to **Bot** tab, click **Reset Token**, and copy the token.
4. Enable these **Privileged Gateway Intents**: Message Content, Server Members.
5. Copy the **Application ID** from the General Information tab.

### 2. Deploy on Railway

1. Push this repo to GitHub.
2. Go to [Railway](https://railway.com) and create a new project from your GitHub repo.
3. Add these environment variables in Railway:
   - `DISCORD_TOKEN` = your bot token
   - `CLIENT_ID` = your application ID
4. Add a **Volume** mounted at `/data` for persistent storage.
5. Deploy.

### 3. Invite the Bot

Use this URL (replace `YOUR_CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1374892659782&scope=bot%20applications.commands
```

This grants: Ban Members, Manage Channels, Manage Messages, Send Messages, Create Instant Invite, Moderate Members, Read Message History.

### 4. Configure

1. Run `/spamtrap channel #your-trap-channel` in your server.
2. Run `/spamtrap log #your-log-channel`.
3. Done. The bot is watching.

## Required Bot Permissions

- Ban Members
- Manage Messages
- Send Messages
- Read Message History
- Create Instant Invite (for Reinvite experiment)
- Manage Channels (for Random Channel Name experiments)
- Moderate Members (for Timeout First experiment)

## Tips

- Place the trap channel near the top of your channel list.
- Give it a normal-sounding name (not something obvious like "trap" or "spamtrap").
- Enable Random Channel Name to avoid blacklist bots.
- Keep the bot role above all member roles.
- Use a dedicated log channel so moderators see every action.
- Consider including a reinvite link in the DM for legitimate members.

## Local Development

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN and CLIENT_ID
npm install
npm run dev
```
