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
// hanging with no response, or a dashboard request with no response). Callers
// should check `.ok`.
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

module.exports = {
  maybeDeleteOldAutoChannel,
  buildWarningEmbed,
  isEmbedPermError,
  postWarning,
  buildKickCounterEmbed,
  postOrUpdateKickCounter,
};
