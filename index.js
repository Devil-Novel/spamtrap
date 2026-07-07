const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  REST,
  Routes,
} = require('discord.js');
require('dotenv').config();

const store = require('./lib/store');
const { replaceVars, DEFAULT_WARNING, DEFAULT_DM, DEFAULT_LOG } = require('./lib/messages');

const DONE_EMOJI = '<:Done:1523817641653829774>';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel],
});

const RANDOM_WORDS = ['general', 'chat', 'lounge', 'memes', 'gaming', 'talk', 'hangout', 'random'];
function randomWord() {
  return RANDOM_WORDS[Math.floor(Math.random() * RANDOM_WORDS.length)];
}
function randomChaosName() {
  return Math.random().toString(36).slice(2, 8);
}

function hasPermission(interaction) {
  return (
    interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers) &&
    interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function actionText(action) {
  if (action === 'softban') return 'soft-banned (removed + messages purged, can rejoin)';
  if (action === 'ban') return 'permanently banned';
  return 'flagged (no action taken)';
}

// ---------- Embeds ----------

function buildStatusEmbed(guildId, guild) {
  const g = store.getGuild(guildId);
  const experimentsOn = Object.entries(g.experiments)
    .filter(([, v]) => v)
    .map(([k]) => store.EXPERIMENT_LABELS[k])
    .join(', ') || 'None';

  const trapChannels = g.trapChannels.length
    ? g.trapChannels.map((id) => `<#${id}>`).join(', ')
    : 'Not set';

  return new EmbedBuilder()
    .setTitle('🪤 Spam Trap — Status')
    .setColor(0x2b2d31)
    .addFields(
      { name: 'Trap channel(s)', value: trapChannels },
      { name: 'Log channel', value: g.logChannel ? `<#${g.logChannel}>` : 'Not set' },
      { name: 'Action', value: g.action },
      { name: 'Active experiments', value: experimentsOn },
      { name: 'Catch count (this server)', value: String(g.catchCount || 0) },
      {
        name: 'Custom messages',
        value: `Warning: ${g.customMessages.warning ? 'custom' : 'default'} | DM: ${
          g.customMessages.dm ? 'custom' : 'default'
        } | Log: ${g.customMessages.log ? 'custom' : 'default'}`,
      }
    );
}

function buildExperimentsEmbed(guildId) {
  const g = store.getGuild(guildId);
  const embed = new EmbedBuilder().setTitle('🧪 Spam Trap — Experiments').setColor(0x5865f2);
  for (const key of Object.keys(store.DEFAULT_EXPERIMENTS)) {
    embed.addFields({
      name: `${g.experiments[key] ? '🟢' : '⚪'} ${store.EXPERIMENT_LABELS[key]}`,
      value: store.EXPERIMENT_DESCRIPTIONS[key],
    });
  }
  return embed;
}

function buildStatsEmbed(guildId) {
  const db = store.readDb();
  const g = store.getGuild(guildId);
  const recent = (g.recentActions || [])
    .map((a) => `<@${a.userId}> — ${a.action} — <t:${Math.floor(a.timestamp / 1000)}:R>`)
    .join('\n') || 'No recent actions';

  return new EmbedBuilder()
    .setTitle('📊 Spam Trap — Stats')
    .setColor(0x57f287)
    .addFields(
      { name: 'This server', value: `${g.catchCount || 0} caught` },
      { name: 'Global (all servers)', value: `${db.global.totalCatches || 0} caught` },
      { name: 'Last 5 actions', value: recent }
    );
}

// ---------- Core catch flow ----------

async function handleCatch(message, guildConfig) {
  const guildId = message.guild.id;
  const member = message.member;

  // 1) Filter: ignore admins and the owner (log a warning)
  const isOwner = message.guild.ownerId === member.id;
  const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (isOwner || isAdmin) {
    await logToChannel(
      message.guild,
      guildConfig,
      `⚠️ ${isOwner ? 'Server owner' : 'An admin'} <@${member.id}> wrote in the trap channel and was skipped.`
    );
    return;
  }

  // 2) Make sure the bot is able to ban this member
  if (!member.bannable) {
    await logToChannel(
      message.guild,
      guildConfig,
      `❌ Could not action <@${member.id}> — bot's role is not high enough.`
    );
    return;
  }

  const serverName = message.guild.name;
  const trapChannelMention = `<#${message.channel.id}>`;
  const trapChannelLink = `https://discord.com/channels/${guildId}/${message.channel.id}`;
  const act = guildConfig.action; // softban | ban | disabled
  const actText = actionText(act);

  // 3) Send the DM (unless No DM is enabled or action is disabled)
  if (!guildConfig.experiments.noDm && act !== 'disabled') {
    let dmText = guildConfig.customMessages.dm || DEFAULT_DM;
    let reinviteLink = '';
    if (guildConfig.experiments.reinvite) {
      try {
        const invite = await message.channel.createInvite({ maxAge: 7 * 24 * 60 * 60, maxUses: 1, unique: true });
        reinviteLink = `\n\nRejoin link: ${invite.url}`;
      } catch (_) {}
    }
    dmText = replaceVars(dmText, { actionText: actText, serverName, trapChannelLink, trapChannelMention });
    try {
      await member.send(dmText + reinviteLink);
    } catch (_) {
      // user has DMs closed - ignore
    }
  }

  // 4) Delete the message
  if (message.deletable) {
    await message.delete().catch(() => {});
  }

  if (act === 'disabled') {
    await logToChannel(message.guild, guildConfig, `ℹ️ Message from <@${member.id}> caught but action is disabled (log only).`);
    return;
  }

  // 5) Timeout First (optional)
  if (guildConfig.experiments.timeoutFirst) {
    await member.timeout(60 * 60 * 1000, 'Spam Trap: pre-ban timeout').catch(() => {});
  }

  // 6) Ban (also purges their messages)
  const purgeSeconds = guildConfig.experiments.onlyRecentDelete ? 15 * 60 : 60 * 60;
  const caughtUserId = member.id;
  try {
    await message.guild.members.ban(caughtUserId, {
      deleteMessageSeconds: purgeSeconds,
      reason: 'Spam Trap: wrote in trap channel',
    });
  } catch (err) {
    await logToChannel(message.guild, guildConfig, `❌ Failed to ban <@${caughtUserId}>: ${err.message}`);
    return;
  }

  // 7) If action is softban, unban immediately
  if (act === 'softban') {
    await message.guild.members.unban(caughtUserId, 'Spam Trap: softban - allow rejoin').catch(() => {});
  }

  // 8) Log
  const { guildCount, globalCount } = store.incrementCatch(guildId);
  store.pushRecentAction(guildId, { userId: caughtUserId, action: actText, timestamp: Date.now() });

  let logText = guildConfig.customMessages.log || DEFAULT_LOG;
  logText = replaceVars(logText, { actionText: actText, serverName, trapChannelLink, trapChannelMention });

  const logEmbed = new EmbedBuilder()
    .setTitle(`${DONE_EMOJI} Spam Trap catch`)
    .setColor(0xed4245)
    .setDescription(logText)
    .addFields(
      { name: 'User', value: `<@${caughtUserId}> (${caughtUserId})`, inline: true },
      { name: 'Channel', value: trapChannelMention, inline: true },
      { name: 'Result', value: actText, inline: true },
      { name: 'Catch count', value: `Server: ${guildCount} | Global: ${globalCount}` }
    )
    .setTimestamp();

  if (guildConfig.experiments.forwardMessage && message.content) {
    logEmbed.addFields({ name: 'Message content', value: message.content.slice(0, 1000) });
  }

  await logToChannel(message.guild, guildConfig, null, logEmbed);

  // 9) Ensure Deletion - sweep after 2 minutes
  if (guildConfig.experiments.ensureDeletion) {
    setTimeout(async () => {
      try {
        const channel = await message.guild.channels.fetch(message.channel.id).catch(() => null);
        if (!channel) return;
        const messages = await channel.messages.fetch({ limit: 100 });
        const leftover = messages.filter((m) => m.author.id === caughtUserId);
        if (leftover.size) await channel.bulkDelete(leftover, true).catch(() => {});
      } catch (_) {}
    }, 2 * 60 * 1000);
  }
}

async function logToChannel(guild, guildConfig, text, embed) {
  if (!guildConfig.logChannel) return;
  try {
    const channel = await guild.channels.fetch(guildConfig.logChannel);
    if (!channel) return;
    await channel.send({ content: text || undefined, embeds: embed ? [embed] : undefined });
  } catch (_) {}
}

// ---------- Warning message (multilingual) ----------

async function postWarning(channel, guildConfig) {
  if (guildConfig.experiments.noWarning) return;
  const text = guildConfig.customMessages.warning || DEFAULT_WARNING;
  const msg = await channel.send(text);
  await msg.pin().catch(() => {});
}

// ---------- Daily tasks: channel warmer + renaming ----------

async function dailyTick() {
  const guildIds = store.getAllGuildIds();
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  for (const guildId of guildIds) {
    const g = store.getGuild(guildId);
    if (!g.trapChannels.length) continue;

    const primaryChannelId = g.trapChannels[0];
    let channel;
    try {
      channel = await client.channels.fetch(primaryChannelId);
    } catch (_) {
      continue;
    }
    if (!channel) continue;

    // Channel Warmer
    if (g.experiments.channelWarmer && now - (g.lastWarm || 0) > DAY) {
      try {
        const warmMsg = await channel.send('👋');
        setTimeout(() => warmMsg.delete().catch(() => {}), 12 * 60 * 60 * 1000);
      } catch (_) {}
      g.lastWarm = now;
      store.saveGuild(guildId, g);
    }

    // Random Channel Name / Random Name Chaos (mutually exclusive)
    if ((g.experiments.randomChannelName || g.experiments.randomNameChaos) && now - (g.lastRename || 0) > DAY) {
      const newName = g.experiments.randomNameChaos ? randomChaosName() : randomWord();
      try {
        await channel.setName(newName, 'Spam Trap: scheduled rename');
      } catch (_) {}
      g.lastRename = now;
      store.saveGuild(guildId, g);
    }
  }
}

// ---------- Ready ----------

client.once('ready', async () => {
  console.log(`Spam Trap is running as ${client.user.tag}`);

  // Register slash commands
  const { commands } = require('./commands');
  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
      console.log(`Commands registered on guild ${process.env.GUILD_ID} (instant)`);
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('Commands registered globally (may take up to 1 hour to appear)');
    }
  } catch (err) {
    console.error('Failed to register commands:', err.message);
  }

  setInterval(dailyTick, 60 * 60 * 1000);
});

// ---------- messageCreate ----------

client.on('messageCreate', async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    const g = store.getGuild(message.guild.id);
    if (!g.trapChannels.includes(message.channel.id)) return;
    await handleCatch(message, g);
  } catch (err) {
    console.error('messageCreate error:', err);
  }
});

// ---------- interactionCreate ----------

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (!hasPermission(interaction)) {
        return interaction.reply({ content: '❌ You need Ban Members + Manage Server permissions.', ephemeral: true });
      }

      if (interaction.commandName === 'spamtrap-messages') {
        const g = store.getGuild(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('spamtrap-messages-modal').setTitle('Customize Spam Trap Messages');

        const warningInput = new TextInputBuilder()
          .setCustomId('warning')
          .setLabel('Warning message (posted + pinned)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(g.customMessages.warning || '');
        const dmInput = new TextInputBuilder()
          .setCustomId('dm')
          .setLabel('DM message')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(g.customMessages.dm || '');
        const logInput = new TextInputBuilder()
          .setCustomId('log')
          .setLabel('Log message')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(g.customMessages.log || '');

        modal.addComponents(
          new ActionRowBuilder().addComponents(warningInput),
          new ActionRowBuilder().addComponents(dmInput),
          new ActionRowBuilder().addComponents(logInput)
        );
        return interaction.showModal(modal);
      }

      if (interaction.commandName === 'spamtrap') {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        const g = store.getGuild(guildId);

        if (sub === 'channel') {
          const channel = interaction.options.getChannel('channel');
          g.trapChannels = [channel.id];
          store.saveGuild(guildId, g);
          await postWarning(channel, g);
          return interaction.reply(`${DONE_EMOJI} Trap channel set to <#${channel.id}>. Watching now.`);
        }

        if (sub === 'log') {
          const channel = interaction.options.getChannel('channel');
          g.logChannel = channel.id;
          store.saveGuild(guildId, g);
          return interaction.reply(`${DONE_EMOJI} Log channel set to <#${channel.id}>.`);
        }

        if (sub === 'action') {
          const type = interaction.options.getString('type');
          g.action = type;
          store.saveGuild(guildId, g);
          return interaction.reply(`${DONE_EMOJI} Action set to **${type}**.`);
        }

        if (sub === 'channels') {
          if (!g.experiments.manyTraps) {
            return interaction.reply({
              content: '❌ Enable the **Many Traps** experiment first (`/spamtrap toggle`).',
              ephemeral: true,
            });
          }
          const channels = [1, 2, 3, 4, 5]
            .map((n) => interaction.options.getChannel(`channel${n}`))
            .filter(Boolean);
          g.trapChannels = channels.map((c) => c.id);
          store.saveGuild(guildId, g);
          for (const c of channels) await postWarning(c, g);
          return interaction.reply(`${DONE_EMOJI} Trap channels set: ${channels.map((c) => `<#${c.id}>`).join(', ')}`);
        }

        if (sub === 'toggle') {
          const options = Object.keys(store.DEFAULT_EXPERIMENTS).map((key) => ({
            label: store.EXPERIMENT_LABELS[key],
            description: store.EXPERIMENT_DESCRIPTIONS[key].slice(0, 100),
            value: key,
            emoji: g.experiments[key] ? '🟢' : '⚪',
          }));
          const menu = new StringSelectMenuBuilder()
            .setCustomId('toggle-experiment')
            .setPlaceholder('Choose an experiment to toggle')
            .addOptions(options);
          const row = new ActionRowBuilder().addComponents(menu);
          return interaction.reply({ content: 'Select an experiment to enable/disable:', components: [row], ephemeral: true });
        }

        if (sub === 'experiments') {
          return interaction.reply({ embeds: [buildExperimentsEmbed(guildId)] });
        }

        if (sub === 'status') {
          return interaction.reply({ embeds: [buildStatusEmbed(guildId)] });
        }

        if (sub === 'stats') {
          return interaction.reply({ embeds: [buildStatsEmbed(guildId)] });
        }

        if (sub === 'disable') {
          g.trapChannels = [];
          store.saveGuild(guildId, g);
          return interaction.reply(`${DONE_EMOJI} Spam Trap disabled. Other settings were kept — use \`/spamtrap channel\` to re-enable.`);
        }
      }
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'toggle-experiment') {
      const guildId = interaction.guild.id;
      const g = store.getGuild(guildId);
      const key = interaction.values[0];

      const newValue = !g.experiments[key];
      g.experiments[key] = newValue;

      // Random Channel Name / Random Name Chaos are mutually exclusive
      if (key === 'randomChannelName' && newValue) g.experiments.randomNameChaos = false;
      if (key === 'randomNameChaos' && newValue) g.experiments.randomChannelName = false;

      store.saveGuild(guildId, g);
      return interaction.update({
        content: `${DONE_EMOJI} **${store.EXPERIMENT_LABELS[key]}** is now **${newValue ? 'ON' : 'OFF'}**.`,
        components: [],
      });
    }

    if (interaction.isModalSubmit() && interaction.customId === 'spamtrap-messages-modal') {
      const guildId = interaction.guild.id;
      const g = store.getGuild(guildId);
      const warning = interaction.fields.getTextInputValue('warning');
      const dm = interaction.fields.getTextInputValue('dm');
      const log = interaction.fields.getTextInputValue('log');

      g.customMessages.warning = warning || null;
      g.customMessages.dm = dm || null;
      g.customMessages.log = log || null;
      store.saveGuild(guildId, g);

      return interaction.reply({ content: `${DONE_EMOJI} Custom messages saved.`, ephemeral: true });
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ Something went wrong.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(process.env.BOT_TOKEN);
