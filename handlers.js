const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const db = require('./db');
const { DEFAULTS, CHANNEL_WARNING, EMOJI, render } = require('./templates');

// ════════════════════════════════════════════════════════════
//  EXPERIMENT LABELS
// ════════════════════════════════════════════════════════════

const EXP_LABELS = {
  forward_message: { name: 'Forward Message', desc: 'Send the caught message to the log channel.' },
  reinvite: { name: 'Reinvite', desc: 'Include an invite link in the DM so users can rejoin.' },
  no_warning: { name: 'No Warning Msg', desc: 'Remove the warning post from the trap channel.' },
  no_dm: { name: 'No DM', desc: 'Skip DMing the user after they trigger.' },
  channel_warmer: { name: 'Channel Warmer', desc: 'Post a daily message to keep the trap active.' },
  random_name: { name: 'Random Channel Name', desc: 'Rename the trap channel daily (word list).' },
  random_name_chaos: { name: 'Random Name (Chaos)', desc: 'Rename with random characters daily.' },
  timeout_first: { name: 'Timeout First', desc: 'Timeout the user for 1 hour before acting.' },
  recent_delete_only: { name: 'Only Recent Delete', desc: 'Delete last 15 min instead of 1 hour.' },
  many_honeypots: { name: 'Many Traps', desc: 'Allow multiple trap channels.' },
  ensure_deletion: { name: 'Ensure Deletion', desc: 'Search and clean up leftover messages after 2 min.' },
};

// ════════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLER: /spamtrap
// ════════════════════════════════════════════════════════════

async function handleSpamtrap(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const settings = db.ensureGuild(guildId);

  // ── /spamtrap channel ──
  if (sub === 'channel') {
    const ch = interaction.options.getChannel('channel');
    db.updateGuild(guildId, { channel_ids: [ch.id] });

    // Send and pin the multilingual warning (unless No Warning experiment is on)
    if (!settings.experiments.no_warning) {
      try {
        const warningMsg = await ch.send(CHANNEL_WARNING);
        await warningMsg.pin().catch(() => {});
      } catch (e) {
        console.log(`[CMD] Could not post warning in #${ch.name}: ${e.message}`);
      }
    }

    return interaction.reply({
      content: `${EMOJI} Trap channel set to <#${ch.id}>.${settings.experiments.no_warning ? '' : ' Warning posted and pinned.'} Any non-bot, non-admin message there will trigger **${settings.action}**.`,
      flags: 64,
    });
  }

  // ── /spamtrap channels (multi) ──
  if (sub === 'channels') {
    if (!settings.experiments.many_honeypots) {
      return interaction.reply({
        content: `${EMOJI} Enable the **Many Traps** experiment first (\`/spamtrap toggle experiment:Many Traps\`).`,
        flags: 64,
      });
    }
    const ids = [];
    for (let i = 1; i <= 5; i++) {
      const ch = interaction.options.getChannel(`channel${i}`);
      if (ch) ids.push(ch.id);
    }
    db.updateGuild(guildId, { channel_ids: ids });

    // Send and pin the warning in each trap channel (unless No Warning is on)
    if (!settings.experiments.no_warning) {
      for (const id of ids) {
        try {
          const ch = interaction.guild.channels.cache.get(id);
          if (ch) {
            const warningMsg = await ch.send(CHANNEL_WARNING);
            await warningMsg.pin().catch(() => {});
          }
        } catch (e) {
          console.log(`[CMD] Could not post warning in channel ${id}: ${e.message}`);
        }
      }
    }

    const mentions = ids.map((id) => `<#${id}>`).join(', ');
    return interaction.reply({
      content: `${EMOJI} Trap channels set to: ${mentions}.${settings.experiments.no_warning ? '' : ' Warnings posted and pinned.'}`,
      flags: 64,
    });
  }

  // ── /spamtrap log ──
  if (sub === 'log') {
    const ch = interaction.options.getChannel('channel');
    db.updateGuild(guildId, { log_channel_id: ch.id });
    return interaction.reply({
      content: `${EMOJI} Log channel set to <#${ch.id}>.`,
      flags: 64,
    });
  }

  // ── /spamtrap action ──
  if (sub === 'action') {
    const type = interaction.options.getString('type');
    db.updateGuild(guildId, { action: type });
    const descriptions = {
      softban: 'Users will be banned then unbanned (messages purged, can rejoin).',
      ban: 'Users will be permanently banned.',
      disabled: 'No moderation action, events are only logged.',
    };
    return interaction.reply({
      content: `${EMOJI} Action set to **${type}**. ${descriptions[type]}`,
      flags: 64,
    });
  }

  // ── /spamtrap experiments ──
  if (sub === 'experiments') {
    const exp = settings.experiments;
    const lines = Object.entries(EXP_LABELS).map(([key, meta]) => {
      const on = exp[key] ? EMOJI : '\u2014';
      return `${on} **${meta.name}** -- ${meta.desc}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI} Experiments`)
      .setDescription(lines.join('\n'))
      .setColor(0x5865f2)
      .setFooter({ text: 'Use /spamtrap toggle to enable or disable experiments.' });

    return interaction.reply({ embeds: [embed], flags: 64 });
  }

  // ── /spamtrap toggle ──
  if (sub === 'toggle') {
    const key = interaction.options.getString('experiment');
    const exp = { ...settings.experiments };

    // Mutual exclusion: random_name and random_name_chaos
    if (key === 'random_name' && !exp[key]) exp.random_name_chaos = false;
    if (key === 'random_name_chaos' && !exp[key]) exp.random_name = false;

    exp[key] = !exp[key];
    db.updateGuild(guildId, { experiments: exp });

    const label = EXP_LABELS[key]?.name || key;
    const state = exp[key] ? 'enabled' : 'disabled';
    return interaction.reply({
      content: `${EMOJI} **${label}** is now **${state}**.`,
      flags: 64,
    });
  }

  // ── /spamtrap status ──
  if (sub === 'status') {
    const s = db.getGuild(guildId) || settings;
    const channels = s.channel_ids.length
      ? s.channel_ids.map((id) => `<#${id}>`).join(', ')
      : 'Not set';
    const enabledExps = Object.entries(s.experiments)
      .filter(([, v]) => v)
      .map(([k]) => EXP_LABELS[k]?.name || k);

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI} SpamTrap Status`)
      .setColor(s.channel_ids.length ? 0x57f287 : 0xed4245)
      .addFields(
        { name: 'Trap Channel(s)', value: channels, inline: true },
        { name: 'Log Channel', value: s.log_channel_id ? `<#${s.log_channel_id}>` : 'Not set', inline: true },
        { name: 'Action', value: s.action, inline: true },
        { name: 'Total Catches', value: `${s.counter}`, inline: true },
        { name: 'Experiments', value: enabledExps.length ? enabledExps.join(', ') : 'None', inline: false }
      );

    // Show custom messages if any
    if (s.warning_message || s.dm_message || s.log_message) {
      const customized = [];
      if (s.warning_message) customized.push('Warning');
      if (s.dm_message) customized.push('DM');
      if (s.log_message) customized.push('Log');
      embed.addFields({ name: 'Custom Messages', value: customized.join(', '), inline: false });
    }

    return interaction.reply({ embeds: [embed], flags: 64 });
  }

  // ── /spamtrap disable ──
  if (sub === 'disable') {
    db.updateGuild(guildId, { channel_ids: [] });
    return interaction.reply({
      content: `${EMOJI} SpamTrap **disabled**. No channels are being watched. Settings are preserved for later.`,
      flags: 64,
    });
  }

  // ── /spamtrap stats ──
  if (sub === 'stats') {
    const s = db.getGuild(guildId) || settings;
    const recent = db.getRecentLogs(guildId, 5);
    const global = db.getGlobalStats();

    let recentText = 'No actions logged yet.';
    if (recent.length) {
      recentText = recent
        .map((r) => `\`${r.created_at}\` **${r.result}** ${r.user_tag}`)
        .join('\n');
    }

    const embed = new EmbedBuilder()
      .setTitle(`${EMOJI} SpamTrap Statistics`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'This Server', value: `${s.counter} catches`, inline: true },
        { name: 'All Servers', value: `${global.total} catches across ${global.servers} servers`, inline: true },
        { name: 'Recent Actions', value: recentText, inline: false }
      );

    return interaction.reply({ embeds: [embed], flags: 64 });
  }
}

// ════════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLER: /spamtrap-messages
// ════════════════════════════════════════════════════════════

async function handleSpamtrapMessages(interaction) {
  const settings = db.ensureGuild(interaction.guildId);

  const modal = new ModalBuilder()
    .setCustomId('spamtrap_messages_modal')
    .setTitle('Customize SpamTrap Messages');

  const warningInput = new TextInputBuilder()
    .setCustomId('warning_message')
    .setLabel('Warning Message (in trap channel)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Leave empty to use the default.')
    .setValue(settings.warning_message || '')
    .setRequired(false)
    .setMaxLength(1500);

  const dmInput = new TextInputBuilder()
    .setCustomId('dm_message')
    .setLabel('DM Message (sent to caught user)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Leave empty to use the default.')
    .setValue(settings.dm_message || '')
    .setRequired(false)
    .setMaxLength(1000);

  const logInput = new TextInputBuilder()
    .setCustomId('log_message')
    .setLabel('Log Message (posted in log channel)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Must include {{user:mention}} or {{user:id}}. Leave empty for default.')
    .setValue(settings.log_message || '')
    .setRequired(false)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(warningInput),
    new ActionRowBuilder().addComponents(dmInput),
    new ActionRowBuilder().addComponents(logInput)
  );

  return interaction.showModal(modal);
}

async function handleMessagesModal(interaction) {
  const guildId = interaction.guildId;
  const warning = interaction.fields.getTextInputValue('warning_message').trim() || null;
  const dm = interaction.fields.getTextInputValue('dm_message').trim() || null;
  const log = interaction.fields.getTextInputValue('log_message').trim() || null;

  // Validate log message contains required variable
  if (log && !log.includes('{{user:mention}}') && !log.includes('{{user:id}}')) {
    return interaction.reply({
      content: `${EMOJI} Log message must include \`{{user:mention}}\` or \`{{user:id}}\`.`,
      flags: 64,
    });
  }

  db.updateGuild(guildId, {
    warning_message: warning,
    dm_message: dm,
    log_message: log,
  });

  const parts = [];
  parts.push(warning ? `${EMOJI} Warning message updated.` : `${EMOJI} Warning message reset to default.`);
  parts.push(dm ? `${EMOJI} DM message updated.` : `${EMOJI} DM message reset to default.`);
  parts.push(log ? `${EMOJI} Log message updated.` : `${EMOJI} Log message reset to default.`);

  return interaction.reply({ content: parts.join('\n'), flags: 64 });
}

// ════════════════════════════════════════════════════════════
//  TRAP HANDLER (message event)
// ════════════════════════════════════════════════════════════

async function handleTrap(message) {
  if (message.author.bot) return;
  if (!message.guild) return;

  const guildId = message.guild.id;
  const settings = db.getGuild(guildId);
  if (!settings) return;
  if (!settings.channel_ids.length) return;
  if (!settings.channel_ids.includes(message.channel.id)) return;

  const guild = message.guild;
  const member = message.member;
  const userId = message.author.id;
  const userTag = message.author.tag || message.author.username;
  const msgContent = message.content?.substring(0, 500) || '[no text]';

  // ── Edge case: server owner ──
  if (guild.ownerId === userId) {
    console.log(`[TRAP] Server owner ${userTag} triggered trap in ${guild.name} -- skipped.`);
    db.logAction(guildId, userId, userTag, settings.action, 'skipped', 'User is the server owner.');
    await postLog(guild, settings, userTag, userId, 'skipped', 'User is the server owner.', message.channel.id);
    return;
  }

  // ── Edge case: administrator ──
  if (member && member.permissions.has(PermissionFlagsBits.Administrator)) {
    console.log(`[TRAP] Admin ${userTag} triggered trap in ${guild.name} -- skipped.`);
    db.logAction(guildId, userId, userTag, settings.action, 'skipped', 'User has Administrator permission.');
    await postLog(guild, settings, userTag, userId, 'skipped', 'User has Administrator permission.', message.channel.id);
    return;
  }

  // ── Edge case: cannot ban ──
  if (member && !member.bannable) {
    console.log(`[TRAP] Cannot ban ${userTag} in ${guild.name} -- role too high or missing perms.`);
    db.logAction(guildId, userId, userTag, settings.action, 'failed', 'Bot cannot ban this user (role hierarchy or missing permissions).');
    await postLog(guild, settings, userTag, userId, 'failed', 'Cannot ban -- role hierarchy or missing permissions.', message.channel.id);
    return;
  }

  // ── Disabled mode: log only ──
  if (settings.action === 'disabled') {
    const count = db.incrementCounter(guildId);
    db.logAction(guildId, userId, userTag, 'disabled', 'logged', 'Action is disabled, event logged only.', msgContent);
    await postLog(guild, settings, userTag, userId, 'logged', 'Action disabled -- logged only.', message.channel.id, msgContent);
    return;
  }

  try {
    // ── Build template variables ──
    const templateVars = {
      action: settings.action,
      serverName: guild.name,
      serverVanity: guild.vanityURLCode || null,
      channelId: message.channel.id,
      channelLink: `https://discord.com/channels/${guildId}/${message.channel.id}`,
      userId,
      inviteLink: null,
      moderationCount: settings.counter + 1,
    };

    // ── Reinvite: generate a single-use invite ──
    if (settings.experiments.reinvite) {
      try {
        const systemChannel = guild.systemChannel || guild.channels.cache.find(
          (ch) => ch.type === 0 && ch.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite)
        );
        if (systemChannel) {
          const invite = await systemChannel.createInvite({
            maxAge: 604800, // 7 days
            maxUses: 1,
            unique: true,
            reason: '[SpamTrap] Reinvite for softbanned user.',
          });
          templateVars.inviteLink = `https://discord.gg/${invite.code}`;
        }
      } catch (e) {
        console.log(`[TRAP] Could not create reinvite: ${e.message}`);
      }
    }

    // ── 1. DM the user (unless no_dm) ──
    if (!settings.experiments.no_dm) {
      const dmTemplate = settings.dm_message || DEFAULTS.dm;
      const dmText = render(dmTemplate, templateVars);
      await message.author.send(dmText).catch(() => {
        console.log(`[TRAP] Could not DM ${userTag} (DMs disabled).`);
      });
    }

    // ── 2. Delete the triggering message ──
    await message.delete().catch(() => {});

    // ── 3. Timeout first (experiment) ──
    if (settings.experiments.timeout_first && member) {
      try {
        await member.timeout(3600000, '[SpamTrap] Timeout before ban.'); // 1 hour
      } catch (e) {
        console.log(`[TRAP] Could not timeout ${userTag}: ${e.message}`);
      }
    }

    // ── 4. Calculate delete seconds ──
    let deleteSeconds;
    if (settings.experiments.recent_delete_only) {
      deleteSeconds = 15 * 60; // 15 minutes
    } else {
      deleteSeconds = 3600; // 1 hour
    }

    // ── 5. Ban ──
    await guild.members.ban(userId, {
      deleteMessageSeconds: deleteSeconds,
      reason: `[SpamTrap] ${settings.action} -- posted in trap channel.`,
    });

    // ── 6. Softban: unban after a short delay ──
    if (settings.action === 'softban') {
      await new Promise((r) => setTimeout(r, 3000));
      await guild.members.unban(userId, '[SpamTrap] Softban complete -- user may rejoin.').catch((err) => {
        console.error(`[TRAP] Failed to unban ${userTag}: ${err.message}`);
      });
    }

    // ── 7. Ensure deletion (experiment): clean up leftover messages after 2 min ──
    if (settings.experiments.ensure_deletion) {
      setTimeout(async () => {
        try {
          for (const channelId of settings.channel_ids) {
            const ch = guild.channels.cache.get(channelId);
            if (!ch) continue;
            const messages = await ch.messages.fetch({ limit: 50 });
            const userMsgs = messages.filter((m) => m.author.id === userId);
            for (const [, m] of userMsgs) {
              await m.delete().catch(() => {});
            }
          }
        } catch (e) {
          console.log(`[TRAP] Ensure deletion error: ${e.message}`);
        }
      }, 120000);
    }

    // ── 8. Counter + Logging ──
    const count = db.incrementCounter(guildId);
    db.logAction(guildId, userId, userTag, settings.action, settings.action, 'Caught in trap channel.', msgContent);
    console.log(`[TRAP] ${settings.action} on ${userTag} in ${guild.name} (#${count})`);

    await postLog(guild, settings, userTag, userId, settings.action, 'Caught in trap channel.', message.channel.id, msgContent);

  } catch (err) {
    console.error(`[TRAP] Failed to action ${userTag}: ${err.message}`);
    db.logAction(guildId, userId, userTag, settings.action, 'error', err.message, msgContent);
    await postLog(guild, settings, userTag, userId, 'error', err.message, message.channel.id);
  }
}

// ════════════════════════════════════════════════════════════
//  LOG HELPER
// ════════════════════════════════════════════════════════════

async function postLog(guild, settings, userTag, userId, result, detail, channelId, msgContent) {
  if (!settings.log_channel_id) return;

  const logChannel = guild.channels.cache.get(settings.log_channel_id);
  if (!logChannel) return;

  // ── Custom log message ──
  if (settings.log_message) {
    const templateVars = {
      action: result,
      serverName: guild.name,
      channelId,
      userId,
      moderationCount: settings.counter,
    };
    const text = render(settings.log_message, templateVars);
    await logChannel.send(text).catch(() => {});
    return;
  }

  // ── Default embed log ──
  const colors = {
    softban: 0xfee75c,
    ban: 0xed4245,
    skipped: 0x5865f2,
    failed: 0xeb459e,
    error: 0xeb459e,
    logged: 0x99aab5,
  };

  const embed = new EmbedBuilder()
    .setTitle(`${EMOJI} SpamTrap Triggered`)
    .setColor(colors[result] || 0x99aab5)
    .addFields(
      { name: 'User', value: `${userTag} (<@${userId}>) \`${userId}\``, inline: true },
      { name: 'Result', value: result.toUpperCase(), inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Detail', value: detail, inline: false }
    )
    .setTimestamp()
    .setFooter({ text: `Total catches: ${settings.counter}` });

  // Forward Message experiment: attach the message content
  if (settings.experiments.forward_message && msgContent && msgContent !== '[no text]') {
    embed.addFields({
      name: 'Message Content',
      value: msgContent.length > 1024 ? msgContent.substring(0, 1021) + '...' : msgContent,
      inline: false,
    });
  }

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = {
  handleSpamtrap,
  handleSpamtrapMessages,
  handleMessagesModal,
  handleTrap,
};
