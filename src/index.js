require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  ActivityType,
} = require('discord.js');

const db = require('./db');
const { EMOJI } = require('./templates');
const { spamtrap, spamtrapMessages } = require('./commands');
const {
  handleSpamtrap,
  handleSpamtrapMessages,
  handleMessagesModal,
  handleTrap,
} = require('./handlers');
const { startScheduler } = require('./experiments');

// ── Validate env ──
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error('DISCORD_TOKEN is required. Set it in your .env or Railway variables.');
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error('CLIENT_ID is required. Set it in your .env or Railway variables.');
  process.exit(1);
}

// ── Create client ──
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// ════════════════════════════════════════════════════════════
//  READY
// ════════════════════════════════════════════════════════════

client.once('ready', async () => {
  console.log(`[BOT] Logged in as ${client.user.tag}`);
  console.log(`[BOT] Serving ${client.guilds.cache.size} servers`);

  // Set presence
  client.user.setActivity('for spam traps', { type: ActivityType.Watching });

  // Register slash commands globally
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), {
      body: [spamtrap.toJSON(), spamtrapMessages.toJSON()],
    });
    console.log('[BOT] Slash commands registered globally.');
  } catch (err) {
    console.error('[BOT] Failed to register commands:', err.message);
  }

  // Start experiment scheduler
  startScheduler(client);
});

// ════════════════════════════════════════════════════════════
//  INTERACTION HANDLER
// ════════════════════════════════════════════════════════════

client.on('interactionCreate', async (interaction) => {
  try {
    // ── Slash commands ──
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'spamtrap') {
        return await handleSpamtrap(interaction);
      }
      if (interaction.commandName === 'spamtrap-messages') {
        return await handleSpamtrapMessages(interaction);
      }
    }

    // ── Modal submits ──
    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'spamtrap_messages_modal') {
        return await handleMessagesModal(interaction);
      }
    }
  } catch (err) {
    console.error('[BOT] Interaction error:', err);
    const reply = { content: `${EMOJI} Something went wrong. Check bot permissions and try again.`, flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
});

// ════════════════════════════════════════════════════════════
//  MESSAGE HANDLER (TRAP)
// ════════════════════════════════════════════════════════════

client.on('messageCreate', (message) => {
  handleTrap(message).catch((err) => {
    console.error('[BOT] Trap handler error:', err);
  });
});

// ════════════════════════════════════════════════════════════
//  GUILD EVENTS
// ════════════════════════════════════════════════════════════

client.on('guildCreate', (guild) => {
  console.log(`[BOT] Joined server: ${guild.name} (${guild.id})`);
  db.ensureGuild(guild.id);
});

client.on('guildDelete', (guild) => {
  console.log(`[BOT] Left server: ${guild.name} (${guild.id})`);
});

// ════════════════════════════════════════════════════════════
//  ERROR HANDLING
// ════════════════════════════════════════════════════════════

client.on('error', (err) => console.error('[CLIENT]', err));
process.on('unhandledRejection', (err) => console.error('[UNHANDLED]', err));
process.on('uncaughtException', (err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});

// ── Initialize database and start ──
db.init();
client.login(TOKEN);
