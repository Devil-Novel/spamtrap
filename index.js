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

// Defense in depth: without these, an error/rejection that slips past every
// local try/catch (a new one we haven't thought of, a library edge case,
// etc.) crashes the entire Node process - taking the whole bot offline until
// Railway notices and restarts it. Logging instead of crashing keeps the
// bot online through the one bad event instead of losing everything.
client.on('error', (err) => {
  console.error('[CLIENT ERROR]', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
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

  const caughtUserId = member.id;

  // 3) Delete the message immediately. Nothing below is allowed to delay this.
  if (message.deletable) {
    await message.delete().catch(() => {});
  }

  if (act === 'disabled') {
    await logToChannel(message.guild, guildConfig, `${E.time} Message from <@${member.id}> caught but action is disabled (log only).`);
    return;
  }

  // 4) Timeout First (optional)
  if (guildConfig.experiments.timeoutFirst) {
    await member.timeout(60 * 60 * 1000, 'Spam Trap: pre-ban timeout').catch(() => {});
  }

  // 5) Ban immediately (also purges their messages). This is the priority
  // action, it used to run after the DM send below, which meant a slow or
  // rate-limited Discord DM delivery delayed the actual ban.
  const purgeSeconds = guildConfig.experiments.onlyRecentDelete ? 15 * 60 : 60 * 60;
  try {
    await message.guild.members.ban(caughtUserId, {
      deleteMessageSeconds: purgeSeconds,
      reason: 'Spam Trap: wrote in trap channel',
    });
  } catch (err) {
    await logToChannel(message.guild, guildConfig, `${E.protection} Failed to ban <@${caughtUserId}>: ${err.message}`);
    return;
  }

  // 6) If action is softban, unban immediately
  if (act === 'softban') {
    await message.guild.members.unban(caughtUserId, 'Spam Trap: softban - allow rejoin').catch(() => {});
  }

  // 7) Send the DM now that the user is already actioned. A slow DM delivery
  // or invite creation can no longer delay the ban above. The rejoin link is
  // always included (not gated behind an experiment) - if invite creation
  // fails for any reason, we fall back to a generic rejoin line instead of
  // leaving a broken/blank link in the message.
  if (!guildConfig.experiments.noDm) {
    let dmText = guildConfig.customMessages.dm || DEFAULT_DM;
    let rejoinLine = "Once your account is secure, you're welcome to rejoin the server.";
    try {
      const invite = await message.channel.createInvite({ maxAge: 7 * 24 * 60 * 60, maxUses: 1, unique: true });
      rejoinLine = `Once your account is secure, you're welcome to rejoin using this link: ${invite.url}`;
    } catch (_) {}
    dmText = replaceVars(dmText, { actionText: actText, serverName, trapChannelLink, trapChannelMention });
    try {
      await member.send(`${dmText}\n\n${rejoinLine}`);
    } catch (_) {
      // user has DMs closed - ignore
    }
  }

  // 8) Log
  const { guildCount, globalCount } = store.incrementCatch(guildId);
  store.pushRecentAction(guildId, { userId: caughtUserId, action: actText, timestamp: Date.now() });

  // Keep every trap channel's public counter in sync, not just the one that
  // caught this particular message - otherwise counters drift apart under
  // the Many Traps experiment.
  for (const trapChannelId of guildConfig.trapChannels) {
    const trapChannel =
      trapChannelId === message.channel.id
        ? message.channel
        : await message.guild.channels.fetch(trapChannelId).catch(() => null);
    if (trapChannel) await postOrUpdateKickCounter(trapChannel, guildId, guildCount);
  }

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

// Flattens an embed into plain text for servers without Embed Links, so the
// log entry still gets posted instead of silently vanishing.
function embedToPlainText(embed) {
  const data = embed.data || {};
  const lines = [];
  if (data.title) lines.push(`**${data.title}**`);
  if (data.description) lines.push(data.description);
  for (const field of data.fields || []) {
    lines.push(`**${field.name}:** ${field.value}`);
  }
  return lines.join('\n');
}

async function logToChannel(guild, guildConfig, text, embed) {
  if (!guildConfig.logChannel) return;
  try {
    const channel = await guild.channels.fetch(guildConfig.logChannel);
    if (!channel) return;
    try {
      await channel.send({ content: text || undefined, embeds: embed ? [embed] : undefined });
    } catch (err) {
      // No Embed Links permission - post the same info as plain text rather
      // than dropping the log entry entirely.
      if (embed && isEmbedPermError(err)) {
        const fallbackText = [text, embedToPlainText(embed)].filter(Boolean).join('\n');
        await channel.send({ content: fallbackText }).catch(() => {});
      }
    }
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

// Same brand orange used by the Status/Stats/Roles/Kick-Counter embeds, so
// the warning message matches the rest of the bot instead of looking like a
// plain, un-styled message.
function buildWarningEmbed(text) {
  return new EmbedBuilder().setColor(0xf47521).setDescription(text);
}

// Missing the "Embed Links" permission makes an embed send fail outright.
// Rather than leave the trap channel with no warning at all (protection still
// works, but nobody's told why they got banned), fall back to sending the
// same text as a plain message - which only needs "Send Messages". This is
// what kept older servers working before the embed conversion.
function isEmbedPermError(err) {
  // 50013 = Missing Permissions, 50001 = Missing Access
  return err && (err.code === 50013 || err.code === 50001);
}

// Never throws: a channel with no access to send to would otherwise crash
// whatever command triggered this (e.g. leave a slash command interaction
// hanging with no response). Callers should check `.ok`.
async function postWarning(channel, guildConfig) {
  if (guildConfig.experiments.noWarning) return { ok: true, skipped: true };
  const text = guildConfig.customMessages.warning || DEFAULT_WARNING;
  try {
    await channel.send({ embeds: [buildWarningEmbed(text)] });
    return { ok: true };
  } catch (err) {
    // Embed failed (likely no Embed Links permission) - retry as plain text
    // so the warning still appears.
    if (isEmbedPermError(err)) {
      try {
        await channel.send(text);
        console.warn(`[WARNING] Posted plain-text warning in #${channel.name} (${channel.id}) - bot lacks Embed Links permission.`);
        return { ok: true, plainTextFallback: true };
      } catch (err2) {
        console.error(`[WARNING] Failed to post warning (even as plain text) in #${channel.name} (${channel.id}): ${err2.message}`);
        return { ok: false, error: err2 };
      }
    }
    console.error(`[WARNING] Failed to post warning in #${channel.name} (${channel.id}): ${err.message}`);
    return { ok: false, error: err };
  }
}

function buildKickCounterEmbed(count) {
  return new EmbedBuilder()
    .setColor(0xf47521)
    .setDescription(`${E.protection} **Spam Trap Kicks:** ${count}`);
}

// Posts (and pins) a small public embed showing the running kick count for
// this trap channel, or edits it in place if one already exists there. This
// is separate from the multilingual warning message - it's a live counter
// visible to every member, not just mods.
async function postOrUpdateKickCounter(channel, guildId, count) {
  const g = store.getGuild(guildId);
  const existingId = (g.kickCounterMessages || {})[channel.id];
  const embed = buildKickCounterEmbed(count);

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      try {
        await msg.edit({ embeds: [embed] });
      } catch (editErr) {
        // Counter was posted as plain text (no Embed Links), so it has no
        // embed to update - edit the plain content instead.
        await msg.edit({ content: `${E.protection} **Spam Trap Kicks:** ${count}` });
      }
      return;
    } catch (_) {
      // message was deleted/unpinned - fall through and recreate it below
    }
  }

  try {
    const msg = await channel.send({ embeds: [embed] });
    store.setKickCounterMessage(guildId, channel.id, msg.id);
    await msg.pin().catch(() => {});
  } catch (err) {
    // No Embed Links permission - post the counter as a plain message so the
    // running total is still visible, just unstyled.
    if (isEmbedPermError(err)) {
      try {
        const msg = await channel.send(`${E.protection} **Spam Trap Kicks:** ${count}`);
        store.setKickCounterMessage(guildId, channel.id, msg.id);
        await msg.pin().catch(() => {});
        return;
      } catch (_) {}
    }
    console.error(`[COUNTER] Failed to post kick counter in #${channel.name} (${channel.id}): ${err.message}`);
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

    // Previously only trapChannels[0] ever got warmed/renamed, so under the
    // Many Traps experiment every channel past the first kept its original
    // name forever - defeating the point of blending in. Now every trap
    // channel gets the same daily treatment.
    const doWarm = g.experiments.channelWarmer && now - (g.lastWarm || 0) > DAY;
    const doRename = (g.experiments.randomChannelName || g.experiments.randomNameChaos) && now - (g.lastRename || 0) > DAY;
    if (!doWarm && !doRename) continue;

    for (const channelId of g.trapChannels) {
      let channel;
      try {
        channel = await client.channels.fetch(channelId);
      } catch (_) {
        continue;
      }
      if (!channel) continue;

      if (doWarm) {
        try {
          const warmMsg = await channel.send('\u{1FAA4}');
          setTimeout(() => warmMsg.delete().catch(() => {}), 12 * 60 * 60 * 1000);
        } catch (_) {}
      }

      if (doRename) {
        const newName = g.experiments.randomNameChaos ? randomChaosName() : randomWord();
        try {
          await channel.setName(newName, 'Spam Trap: scheduled rename');
        } catch (_) {}
      }
    }

    // This loop can span several awaited Discord API calls per guild, so use
    // updateGuild() rather than saveGuild(g) - a catch could have updated
    // catchCount/recentActions/kickCounterMessages on disk while we were
    // busy sending/renaming, and we only mean to touch the timestamps here.
    store.updateGuild(guildId, (fresh) => {
      if (doWarm) fresh.lastWarm = now;
      if (doRename) fresh.lastRename = now;
    });
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
      if (!interaction.guild) {
        return await interaction.reply({
          content: `${E.protection} This command only works in a server. If you just invited the bot, please try again in a few seconds.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!hasPermission(interaction)) {
        return await interaction.reply({ content: `${E.protection} You need Ban Members + Manage Server permissions.`, flags: MessageFlags.Ephemeral });
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
        return await interaction.showModal(modal);
      }

      if (interaction.commandName === 'spamtrap') {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild.id;
        let g = store.getGuild(guildId);

        if (sub === 'channel') {
          // This does several sequential Discord API calls before it can
          // respond (possibly deleting the old auto channel, posting the
          // warning, posting/pinning the kick counter). That easily blows
          // past Discord's 3-second initial-response window, which makes
          // the eventual interaction.reply() fail with "Unknown interaction"
          // - deferring immediately buys 15 minutes instead of 3 seconds.
          await interaction.deferReply();
          const channel = interaction.options.getChannel('channel');
          await maybeDeleteOldAutoChannel(interaction.guild, g, [channel.id]);
          // Re-read fresh before saving: a message catch could have written
          // catchCount/recentActions/kickCounterMessages to disk during the
          // await above, and saving our stale in-memory `g` would silently
          // wipe that out. updateGuild() only touches the fields we set here.
          const autoTrapChannelId = g.autoTrapChannelId;
          g = store.updateGuild(guildId, (fresh) => {
            fresh.trapChannels = [channel.id];
            fresh.autoTrapChannelId = autoTrapChannelId;
          });
          const result = await postWarning(channel, g);
          if (!result.ok) {
            return await interaction.editReply({
              content: `${E.protection} Trap channel set to <#${channel.id}>, but I couldn't post the warning message there (${result.error.message}). Make sure I have **View Channel** and **Send Messages** permissions in that channel.`,
            });
          }
          await postOrUpdateKickCounter(channel, guildId, g.catchCount || 0);
          return await interaction.editReply(`${E.protection} Trap channel set to <#${channel.id}>. Watching now.`);
        }

        if (sub === 'log') {
          const channel = interaction.options.getChannel('channel');
          g.logChannel = channel.id;
          store.saveGuild(guildId, g);
          return await interaction.reply(`${E.done} Log channel set to <#${channel.id}>.`);
        }

        if (sub === 'action') {
          const type = interaction.options.getString('type');
          g.action = type;
          store.saveGuild(guildId, g);
          return await interaction.reply(`${E.done} Action set to **${type}**.`);
        }

        if (sub === 'channels') {
          if (!g.experiments.manyTraps) {
            return await interaction.reply({
              content: `${E.experiments} Enable the **Many Traps** experiment first (\`/spamtrap toggle\`).`,
              flags: MessageFlags.Ephemeral,
            });
          }
          // Up to 5 channels, each needing a warning post + counter post/pin -
          // definitely too slow for the 3-second window, so defer up front.
          await interaction.deferReply();
          const rawChannels = [1, 2, 3, 4, 5]
            .map((n) => interaction.options.getChannel(`channel${n}`))
            .filter(Boolean);
          const seen = new Set();
          const channels = rawChannels.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
          const newIds = channels.map((c) => c.id);
          await maybeDeleteOldAutoChannel(interaction.guild, g, newIds);
          // Same reasoning as /spamtrap channel: re-read fresh so we don't
          // clobber a concurrent catch's writes with our stale copy of `g`.
          const autoTrapChannelId = g.autoTrapChannelId;
          g = store.updateGuild(guildId, (fresh) => {
            fresh.trapChannels = newIds;
            fresh.autoTrapChannelId = autoTrapChannelId;
          });
          const failed = [];
          for (const c of channels) {
            const result = await postWarning(c, g);
            if (!result.ok) {
              failed.push(c);
              continue;
            }
            await postOrUpdateKickCounter(c, guildId, g.catchCount || 0);
          }
          const dupeNote = rawChannels.length !== channels.length ? ` (duplicates removed)` : '';
          let reply = `${E.protection} Trap channels set: ${channels.map((c) => `<#${c.id}>`).join(', ')}${dupeNote}`;
          if (failed.length) {
            reply += `\n${E.protection} Couldn't post the warning in ${failed.map((c) => `<#${c.id}>`).join(', ')}. Check my **View Channel** / **Send Messages** permissions there.`;
          }
          return await interaction.editReply({ content: reply });
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
          return await interaction.reply({ content: 'Select an experiment to enable/disable:', components: [row], flags: MessageFlags.Ephemeral });
        }

        if (sub === 'experiments') {
          return await interaction.reply({ embeds: [buildExperimentsEmbed(guildId)] });
        }

        if (sub === 'status') {
          return await interaction.reply({ embeds: [buildStatusEmbed(guildId)] });
        }

        if (sub === 'stats') {
          return await interaction.reply({ embeds: [buildStatsEmbed(guildId)] });
        }

        if (sub === 'disable') {
          g.trapChannels = [];
          store.saveGuild(guildId, g);
          return await interaction.reply(`${E.done} Spam Trap disabled. Other settings were kept — use \`/spamtrap channel\` to re-enable.`);
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
          return await interaction.reply({ embeds: [infoEmbed], flags: MessageFlags.Ephemeral });
        }

        // ── Role management (admin only) ──
        if (sub === 'addrole') {
          // Only server owner or existing admins can manage roles
          if (interaction.guild.ownerId !== interaction.user.id &&
              !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return await interaction.reply({ content: `${E.protection} Only the server owner or administrators can manage bot roles.`, flags: MessageFlags.Ephemeral });
          }
          const role = interaction.options.getRole('role');
          if (!g.allowedRoles) g.allowedRoles = [];
          if (g.allowedRoles.includes(role.id)) {
            return await interaction.reply({ content: `${E.done} <@&${role.id}> is already an allowed role.`, flags: MessageFlags.Ephemeral });
          }
          g.allowedRoles.push(role.id);
          store.saveGuild(guildId, g);
          return await interaction.reply({ content: `${E.done} <@&${role.id}> can now manage Spam Trap.`, flags: MessageFlags.Ephemeral });
        }

        if (sub === 'removerole') {
          if (interaction.guild.ownerId !== interaction.user.id &&
              !interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
            return await interaction.reply({ content: `${E.protection} Only the server owner or administrators can manage bot roles.`, flags: MessageFlags.Ephemeral });
          }
          const role = interaction.options.getRole('role');
          if (!g.allowedRoles) g.allowedRoles = [];
          g.allowedRoles = g.allowedRoles.filter((id) => id !== role.id);
          store.saveGuild(guildId, g);
          return await interaction.reply({ content: `${E.done} <@&${role.id}> removed from Spam Trap roles.`, flags: MessageFlags.Ephemeral });
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
          return await interaction.reply({ embeds: [rolesEmbed], flags: MessageFlags.Ephemeral });
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
      return await interaction.update({
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

      return await interaction.reply({ content: `${E.done} Custom messages saved.`, flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    if (interaction.isRepliable() && !interaction.replied) {
      const errorText = `${E.protection} Something went wrong.`;
      if (interaction.deferred) {
        // deferReply() already happened - can't call reply() again, but the
        // interaction is still waiting on editReply(), so use that instead
        // of leaving it hanging for the full 15-minute deferred window.
        interaction.editReply({ content: errorText }).catch(() => {});
      } else {
        interaction.reply({ content: errorText, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
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
      name: '\u{1FAA4}│spam-trap',
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

    await postOrUpdateKickCounter(channel, guild.id, 0);

    console.log(`[JOIN] Setup complete for ${guild.name}`);
  } catch (err) {
    console.error(`[JOIN] Failed to auto-create channel in ${guild.name}: ${err.message}`);
  }
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
