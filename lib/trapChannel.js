// Trap-channel setup logic shared between the /spamtrap slash commands
// (index.js) and the web dashboard's channel editor (web/server.js), so
// setting a trap channel from either place behaves identically: same
// warning embed, same plain-text fallback when Embed Links is missing, same
// pinned kick counter, same auto-created-channel cleanup.
const { EmbedBuilder } = require('discord.js');
const store = require('./store');
const { DEFAULT_WARNING } = require('./messages');
const E = require('./emojis');

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

// Same brand orange used by the Status/Stats/Roles embeds. The warning text
// and the live kick count are shown in ONE embed (the count as a trailing
// field) instead of two separate messages, so the trap channel only has a
// single pinned message to read. When `text` is falsy (the noWarning
// experiment is on), the embed falls back to showing just the count.
function buildTrapEmbed(text, count) {
  const embed = new EmbedBuilder().setColor(0xf47521);
  if (text) {
    embed.setDescription(text).addFields({ name: '​', value: `${E.protection} **Spam Trap Kicks:** ${count}` });
  } else {
    embed.setDescription(`${E.protection} **Spam Trap Kicks:** ${count}`);
  }
  return embed;
}

function buildTrapPlainText(text, count) {
  return text ? `${text}\n\n${E.protection} **Spam Trap Kicks:** ${count}` : `${E.protection} **Spam Trap Kicks:** ${count}`;
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

// Sends (and pins) the combined warning+counter message. Used both for the
// initial setup and to recreate the message later if it's ever deleted or
// unpinned out from under us. Never throws - callers should check `.ok`.
async function sendTrapMessage(channel, guildId, text, count) {
  try {
    const msg = await channel.send({ embeds: [buildTrapEmbed(text, count)] });
    store.setKickCounterMessage(guildId, channel.id, msg.id);
    await msg.pin().catch(() => {});
    return { ok: true };
  } catch (err) {
    // Embed failed (likely no Embed Links permission) - retry as plain text
    // so the warning still appears.
    if (isEmbedPermError(err)) {
      try {
        const msg = await channel.send(buildTrapPlainText(text, count));
        store.setKickCounterMessage(guildId, channel.id, msg.id);
        await msg.pin().catch(() => {});
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

// Never throws: a channel with no access to send to would otherwise crash
// whatever command triggered this (e.g. leave a slash command interaction
// hanging with no response, or a dashboard request with no response). Callers
// should check `.ok`.
async function postWarning(channel, guildId, guildConfig) {
  if (guildConfig.experiments.noWarning) return { ok: true, skipped: true };
  const text = guildConfig.customMessages.warning || DEFAULT_WARNING;
  return sendTrapMessage(channel, guildId, text, guildConfig.catchCount || 0);
}

// Updates the live kick count in place on the existing warning+counter
// message, preserving whatever warning text is currently configured (picking
// up any edits to it automatically). Recreates the message from scratch if
// it's missing - deleted, unpinned, or postWarning never got to post it in
// the first place (e.g. it was skipped because the noWarning experiment is
// on, or it failed and the admin hasn't fixed permissions yet).
async function postOrUpdateKickCounter(channel, guildId, guildConfig, count) {
  const g = store.getGuild(guildId);
  const existingId = (g.kickCounterMessages || {})[channel.id];
  const text = guildConfig.experiments.noWarning ? null : guildConfig.customMessages.warning || DEFAULT_WARNING;

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      try {
        await msg.edit({ embeds: [buildTrapEmbed(text, count)] });
      } catch (editErr) {
        // Message was posted as plain text (no Embed Links) - edit the plain
        // content instead.
        await msg.edit({ content: buildTrapPlainText(text, count) });
      }
      return;
    } catch (_) {
      // message was deleted/unpinned - fall through and recreate it below
    }
  }

  await sendTrapMessage(channel, guildId, text, count);
}

module.exports = {
  maybeDeleteOldAutoChannel,
  buildTrapEmbed,
  isEmbedPermError,
  postWarning,
  postOrUpdateKickCounter,
};
