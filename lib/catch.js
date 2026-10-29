const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const store = require('./store');
const { replaceVars, DEFAULT_DM, DEFAULT_LOG } = require('./messages');
const { postOrUpdateKickCounter } = require('./trapChannel');
const E = require('./emojis');
function actionText(action) {
  if (action === 'softban') return 'soft-banned (can rejoin)';
  if (action === 'ban') return 'permanently banned';
  return 'flagged (no action taken)';
}
function createCatchHandler({ softbanRecovery, logToChannel }) {
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
  let actText = actionText(act);

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
  const pending = act === 'softban' ? softbanRecovery.prepare(guildId, caughtUserId) : null;
  try {
    await message.guild.members.ban(caughtUserId, {
      deleteMessageSeconds: purgeSeconds,
      reason: pending ? pending.reason : 'Spam Trap: wrote in trap channel',
    });
  } catch (err) {
    softbanRecovery.release(pending);
    await logToChannel(message.guild, guildConfig, `${E.protection} Failed to ban <@${caughtUserId}>: ${err.message}`);
    return;
  }

  // 6) If action is softban, unban immediately
  if (act === 'softban') {
    const recovered = await softbanRecovery.attempt(pending);
    if (!recovered) {
      actText = pending.cancelled ? 'banned; recovery stopped because the ban changed (moderator review required)' : 'banned; softban unban pending (moderator review required)';
      await logToChannel(message.guild, guildConfig, 'Softban unban failed for user ' + caughtUserId + (pending.cancelled ? '. Ban reason changed; review it manually.' : '. Recovery is queued; check Ban Members permissions and the ban list.'));
    }
  }

  // 7) Send the DM now that the user is already actioned. A slow DM delivery
  // or invite creation can no longer delay the ban above. The rejoin link is
  // always included (not gated behind an experiment) - if invite creation
  // fails for any reason, we fall back to a generic rejoin line instead of
  // leaving a broken/blank link in the message.
  if (!guildConfig.experiments.noDm) {
    let dmText = guildConfig.customMessages.dm || DEFAULT_DM;
    let rejoinLine = act === 'softban' && actText === actionText(act)
      ? "Once your account is secure, you're welcome to rejoin the server."
      : 'Contact the server moderators to discuss this ban.';
    try {
      if (act !== 'softban' || actText !== actionText(act)) throw new Error('No rejoin invite for an active ban');
      const invite = await message.channel.createInvite({ maxAge: 7 * 24 * 60 * 60, maxUses: 1, unique: true });
      rejoinLine = `Once your account is secure, you're welcome to rejoin using this link: ${invite.url}`;
    } catch (_) {}
    dmText = replaceVars(dmText, { actionText: actText, serverName, trapChannelLink, trapChannelMention });
    try {
      await member.send({ content: dmText.slice(0, 1650) + '\n\n' + rejoinLine, allowedMentions: { parse: [] } });
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
    if (trapChannel) await postOrUpdateKickCounter(trapChannel, guildId, guildConfig, guildCount);
  }

  let logText = guildConfig.customMessages.log || DEFAULT_LOG;
  logText = replaceVars(logText, { actionText: actText, serverName, trapChannelLink, trapChannelMention });

  const logEmbed = new EmbedBuilder()
    .setTitle(`Spam Trap catch ${E.protection}`)
    .setColor(0xe83535)
    .setDescription(String(logText).slice(0, 3500))
    .addFields(
      { name: 'User', value: `<@${caughtUserId}> (${caughtUserId})`, inline: true },
      { name: 'Channel', value: trapChannelMention, inline: true },
      { name: 'Result', value: actText, inline: true },
      { name: 'Catch count', value: `Server: \`${guildCount}\` | Global: \`${globalCount}\`` }
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


  return handleCatch;
}
module.exports = { createCatchHandler };
