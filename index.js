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
  MessageFlags,
  REST,
  Routes,
} = require('discord.js');
require('dotenv').config();

const store = require('./lib/store');
const { replaceVars, DEFAULT_WARNING, DEFAULT_DM, DEFAULT_LOG } = require('./lib/messages');

const E = {
  done: '<:Done:1523817641653829774>',
  experiments: '<:Experiments:1524000040828539011>',
  safety: '<:ServerSafety:1524000037166645331>',
  time: '<:SavesTime:1524000035577135114>',
  easy: '<:EasytoUse:1524000034079768716>',
  multilingual: '<:MultilingualWarnings:1524000032771149824>',
  dashboard: '<:WebDashboard:1524000030556426354>',
  recovery: '<:AccountRecovery:1524000028689961060>',
  protection: '<:InstantProtection:1524000022830518272>',
  discord: '<:Discord:1524000021198930031>',
};
const DONE_EMOJI = E.done;

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
  // Server owner always has permission
  if (interaction.guild.ownerId === interaction.user.id) return true;

  // Check allowed roles first (if configured)
  const g = store.getGuild(interaction.guild.id);
  const allowedRoles = g.allowedRoles || [];
  if (allowedRoles.length > 0) {
    return interaction.member.roles.cache.some((r) => allowedRoles.includes(r.id));
  }

  // Fallback: BanMembers + ManageGuild
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
    .setTitle(`Spam Trap Status ${E.protection}`)
    .setColor(0xf47521)
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
      },
      {
        name: 'Allowed roles',
        value: (g.allowedRoles || []).length
          ? (g.allowedRoles || []).map((id) => `<@&${id}>`).join(', ')
          : 'Default (Ban Members + Manage Server)',
      }
    );
}

function buildExperimentsEmbed(guildId) {
  const g = store.getGuild(guildId);
  const embed = new EmbedBuilder().setTitle(`Spam Trap Experiments ${E.experiments}`).setColor(0x060a10);
  for (const key of Object.keys(store.DEFAULT_EXPERIMENTS)) {
    embed.addFields({
      name: `${g.experiments[key] ? E.done : '\u{1FAA4}'} ${store.EXPERIMENT_LABELS[key]}`,
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
    .setTitle(`Spam Trap Stats ${E.dashboard}`)
    .setColor(0xf47521)
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
      `${E.safety} ${isOwner ? 'Server owner' : 'An admin'} <@${member.id}> wrote in the trap channel and was skipped.`
    );
    return;
  }

  // 2) Make sure the bot is able to ban this member
  if (!member.bannable) {
    await logToChannel(
      message.guild,
      guildConfig,
      `${E.protection} Could not action <@${member.id}> — bot's role is not high enough.`
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
    await logToChannel(message.guild, guildConfig, `${E.time} Message from <@${member.id}> caught but action is disabled (log only).`);
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
    await logToChannel(message.guild, guildConfig, `${E.protection} Failed to ban <@${caughtUserId}>: ${err.message}`);
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
    .setTitle(`Spam Trap catch ${E.protection}`)
    .setColor(0xe83535)
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

// Deletes the previously auto-created trap channel when the Delete Old Trap
// experiment is on and the admin is switching to a different channel.
async function maybeDeleteOldAutoChannel(guild, g, newChannelIds) {
  if (!g.experiments.deleteOldTrap) return;
  const oldId = g.autoTrapChannelId;
  if (!oldId) return;
  if (newChannelIds.includes(oldId)) return; // still in use, keep it

  try {
    const oldChannel = guild.channels.cache.get(oldId) || (await guild.channels.fetch(oldId).catch(() => null));
    if (oldChannel) {
      await oldChannel.delete('Spam Trap: replaced by a new trap channel (Delete Old Trap experiment)');
      console.log(`[TRAP] Deleted old auto-created channel ${oldId} in ${guild.name}`);
    }
  } catch (err) {
    console.error(`[TRAP] Failed to delete old auto-created channel in ${guild.name}: ${err.message}`);
  } finally {
    g.autoTrapChannelId = null;
  }
}

// Never throws: a channel with no access to send to would otherwise crash
// whatever command triggered this (e.g. leave a slash command interaction
// hanging with no response). Callers should check `.ok`.
async function postWarning(channel, guildConfig) {
  if (guildConfig.experiments.noWarning) return { ok: true, skipped: true };
  const text = guildConfig.customMessages.warning || DEFAULT_WARNING;
  try {
    await channel.send(text);
    return { ok: true };
  } catch (err) {
    console.error(`[WARNING] Failed to post warning in #${channel.name} (${channel.id}): ${err.message}`);
    return { ok: false, error: err };
  }
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
        const warmMsg = await channel.send('\u{1FAA4}');
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

const { startDashboard } = require('./web/server');

client.once('clientReady', async () => {
  console.log(`Spam Trap is running as ${client.user.tag}`);

  // Start the web dashboard
  startDashboard(client);

  // Register slash commands
  const { commands } = require('./commands');
  const rest = new REST({ version: '10' }).setToken(client.token);
  const clientId = process.env.CLIENT_ID || client.user.id;
  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), { body: commands });
      console.log(`Commands registered on guild ${process.env.GUILD_ID} (instant)`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: commands });
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
        return interaction.reply({ content: `${E.protection} You need Ban Members + Manage Server permissions.`, flags: MessageFlags.Ephemeral });
      }

      if (interaction.commandName === 'spamtrap-messages') {
        const g = store.getGuild(interaction.guild.id);
        const modal = new ModalBuilder().setCustomId('spamtrap-messages-modal').setTitle('Customize Spam Trap Messages');

        const warningInput = new TextInputBuilder()
          .setCustomId('warning')
          .setLabel('Warning message (posted in trap channel)')
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
          await maybeDeleteOldAutoChannel(interaction.guild, g, [channel.id]);
          g.trapChannels = [channel.id];
          store.saveGuild(guildId, g);
          const result = await postWarning(channel, g);
          if (!result.ok) {
            return interaction.reply({
              content: `${E.protection} Trap channel set to <#${channel.id}>, but I couldn't post the warning message there (${result.error.message}). Make sure I have **View Channel** and **Send Messages** permissions in that channel.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          return interaction.reply(`${E.protection} Trap channel set to <#${channel.id}>. Watching now.`);
        }

        if (sub === 'log') {
          const channel = interaction.options.getChannel('channel');
          g.logChannel = channel.id;
          store.saveGuild(guildId, g);
          return interaction.reply(`${E.done} Log channel set to <#${channel.id}>.`);
        }

        if (sub === 'action') {
          const type = interaction.options.getString('type');
          g.action = type;
          store.saveGuild(guildId, g);
          return interaction.reply(`${E.done} Action set to **${type}**.`);
        }

        if (sub === 'channels') {
          if (!g.experiments.manyTraps) {
            return interaction.reply({
              content: `${E.experiments} Enable the **Many Traps** experiment first (\`/spamtrap toggle\`).`,
              flags: MessageFlags.Ephemeral,
            });
          }
          const rawChannels = [1, 2, 3, 4, 5]
            .map((n) => interaction.options.getChannel(`channel${n}`))
            .filter(Boolean);
          const seen = new Set();
          const channels = rawChannels.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
          const newIds = channels.map((c) => c.id);
          await maybeDeleteOldAutoChannel(interaction.guild, g, newIds);
          g.trapChannels = newIds;
          store.saveGuild(guildId, g);
          const failed = [];
          for (const c of channels) {
            const result = await postWarning(c, g);
            if (!result.ok) failed.push(c);
          }
          const dupeNote = rawChannels.length !== channels.length ? ` (duplicates removed)` : '';
          let reply = `${E.protection} Trap channels set: ${channels.map((c) => `<#${c.id}>`).join(', ')}${dupeNote}`;
          if (failed.length) {
            reply += `\n${E.protection} Couldn't post the warning in ${failed.map((c) => `<#${c.id}>`).join(', ')}. Check my **View Channel** / **Send Messages** permissions there.`;
          }
          return interaction.reply({ content: reply, flags: failed.length ? MessageFlags.Ephemeral : undefined });
        }

        if (sub === 'toggle') {
          const options = Object.keys(store.DEFAULT_EXPERIMENTS).map((key) => ({
            label: store.EXPERIMENT_LABELS[key],
            description: store.EXPERIMENT_DESCRIPTIONS[key].slice(0, 100),
            value: key,
            emoji: g.experiments[key] ? E.done : '⚪',
          }));
          const menu = new StringSelectMenuBuilder()
            .setCustomId('toggle-experiment')
            .setPlaceholder('Choose an experiment to toggle')
            .addOptions(options);
          const row = new ActionRowBuilder().addComponents(menu);
          return interaction.reply({ content: 'Select an experiment to enable/disable:', components: [row], flags: MessageFlags.Ephemeral });
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
          return interaction.reply(`${E.done} Spam Trap disabled. Other settings were kept — use \`/spamtrap channel\` to re-enable.`);
        }

        if (sub === 'info') {
          const infoEmbed = new EmbedBuilder()
            .setTitle(`Spam Trap ${E.protection}`)
            .setColor(0xf47521)
            .setDescription('The Discord bot that stops spammers before they spread.\nHere are all available commands:')
            .addFields(
              { name: `${E.protection} /spamtrap channel #channel`, value: 'Set the trap channel. Posts a multilingual warning.', inline: false },
              { name: `${E.done} /spamtrap log #channel`, value: 'Set the mod log channel for action reports.', inline: false },
              { name: `${E.done} /spamtrap action`, value: 'Choose softban, ban, or disabled.', inline: false },
              { name: `${E.experiments} /spamtrap toggle`, value: 'Enable or disable experiments via dropdown.', inline: false },
              { name: `${E.experiments} /spamtrap experiments`, value: 'View all experiments and their status.', inline: false },
              { name: `${E.protection} /spamtrap status`, value: 'View the full current configuration.', inline: false },
              { name: `${E.dashboard} /spamtrap stats`, value: 'View catch statistics and recent actions.', inline: false },
              { name: `${E.protection} /spamtrap channels`, value: 'Set up to 5 trap channels (needs Many Traps).', inline: false },
              { name: `${E.done} /spamtrap-messages`, value: 'Customize warning, DM, and log messages.', inline: false },
              { name: `${E.done} /spamtrap disable`, value: 'Turn off the trap. Keeps settings for later.', inline: false },
              { name: `${E.easy} /spamtrap info`, value: 'Show this help message.', inline: false },
              { name: `${E.safety} /spamtrap addrole @role`, value: 'Add a role that can manage the bot.', inline: false },
              { name: `${E.safety} /spamtrap removerole @role`, value: 'Remove a role from managing the bot.', inline: false },
              { name: `${E.safety} /spamtrap roles`, value: 'View all roles that can manage the bot.', inline: false },
            )
            .setFooter({ text: 'spamtrap.help' });
          return interaction.reply({ embeds: [infoEmbed], flags: MessageFlags.Ephemeral });
        }

        // ── Role management (admin only) ──
        if (sub === 'addrole') {
          // Only server owner or existing admins can manage roles
          if (interaction.guild.ownerId !== interaction.user.id &&
              !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: `${E.protection} Only the server owner or administrators can manage bot roles.`, flags: MessageFlags.Ephemeral });
          }
          const role = interaction.options.getRole('role');
          if (!g.allowedRoles) g.allowedRoles = [];
          if (g.allowedRoles.includes(role.id)) {
            return interaction.reply({ content: `${E.done} <@&${role.id}> is already an allowed role.`, flags: MessageFlags.Ephemeral });
          }
          g.allowedRoles.push(role.id);
          store.saveGuild(guildId, g);
          return interaction.reply({ content: `${E.done} <@&${role.id}> can now manage Spam Trap.`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'removerole') {
          if (interaction.guild.ownerId !== interaction.user.id &&
              !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: `${E.protection} Only the server owner or administrators can manage bot roles.`, flags: MessageFlags.Ephemeral });
          }
          const role = interaction.options.getRole('role');
          if (!g.allowedRoles) g.allowedRoles = [];
          g.allowedRoles = g.allowedRoles.filter((id) => id !== role.id);
          store.saveGuild(guildId, g);
          return interaction.reply({ content: `${E.done} <@&${role.id}> removed from Spam Trap roles.`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'roles') {
          const roles = (g.allowedRoles || []).map((id) => `<@&${id}>`).join(', ') || 'Not set (using default: Ban Members + Manage Server)';
          const rolesEmbed = new EmbedBuilder()
            .setTitle(`Spam Trap Roles ${E.safety}`)
            .setColor(0xf47521)
            .setDescription('Roles that can manage Spam Trap commands:')
            .addFields(
              { name: 'Allowed Roles', value: roles },
              { name: 'How it works', value: 'If no roles are set, anyone with **Ban Members + Manage Server** can use the bot.\nOnce you add roles, **only those roles** can use commands.\nThe server owner always has access.' }
            );
          return interaction.reply({ embeds: [rolesEmbed], flags: MessageFlags.Ephemeral });
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
        content: `${E.experiments} **${store.EXPERIMENT_LABELS[key]}** is now **${newValue ? 'ON' : 'OFF'}**.`,
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

      return interaction.reply({ content: `${E.done} Custom messages saved.`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: `${E.protection} Something went wrong.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

// ---------- guildCreate: auto-setup ----------

client.on('guildCreate', async (guild) => {
  console.log(`[JOIN] Joined server: ${guild.name} (${guild.id})`);

  // Check if bot has Manage Channels permission
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    console.log(`[JOIN] Missing Manage Channels permission in ${guild.name}`);
    return;
  }

  try {
    // Create the trap channel at position 0 (top of server)
    const channel = await guild.channels.create({
      name: '\u{1FAA4}\u2502spam-trap',
      type: 0, // GuildText
      position: 0,
      reason: 'Spam Trap: auto-created trap channel',
    });

    console.log(`[JOIN] Created #${channel.name} in ${guild.name}`);

    // Save it as the trap channel
    const g = store.getGuild(guild.id);
    g.trapChannels = [channel.id];
    g.autoTrapChannelId = channel.id;
    store.saveGuild(guild.id, g);

    // Post the warning
    const result = await postWarning(channel, g);
    if (!result.ok) {
      console.error(`[JOIN] Channel created in ${guild.name} but failed to post warning: ${result.error.message}`);
    }

    console.log(`[JOIN] Setup complete for ${guild.name}`);
  } catch (err) {
    console.error(`[JOIN] Failed to auto-create channel in ${guild.name}: ${err.message}`);
  }
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
