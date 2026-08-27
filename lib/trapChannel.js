// Trap-channel setup logic shared between the /spamtrap slash commands
// (index.js) and the web dashboard's channel editor (web/server.js), so
// setting a trap channel from either place behaves identically: same
// warning embed, same plain-text fallback when Embed Links is missing, same
// pinned kick counter, same auto-created-channel cleanup.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('./store');
const { DEFAULT_WARNING } = require('./messages');
const E = require('./emojis');

// Hotlinked from the site instead of bundled/uploaded per-message - same
// pattern already used for the favicon/OG image in web/public/index.html.
const TRAP_BADGE_URL = 'https://spamtrap.help/trap-badge.png';

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

// Cleans up leftover bot messages from before a trap channel is (re)set -
// mainly for servers that configured their trap channel before the
// warning+counter message was merged into one, which would otherwise end up
// with an old standalone message sitting next to the new combined one every
// time postWarning runs. Only ever deletes messages the bot itself posted -
// never touches anything a real member wrote, even if this channel wasn't
// empty. Best-effort: missing "Manage Messages" just means the old
// message(s) stick around, it never blocks setting up the new one.
//
// `excludeMessageId` matters when the admin runs /spamtrap channel from
// inside the channel they're setting as the trap: deferReply() posts its own
// "thinking..." placeholder message into that same channel, and without this
// exclusion it looks just like any other old bot message and gets purged too
// - which then makes the later editReply() fail with "Unknown Message"
// because the message it's trying to edit no longer exists.
async function purgeOldBotMessages(channel, excludeMessageId) {
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    const ownMessages = recent.filter((m) => m.author.id === channel.client.user.id && m.id !== excludeMessageId);
    if (ownMessages.size === 0) return;

    // bulkDelete only accepts messages under 14 days old; anything older has
    // to be deleted one at a time.
    const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
    const bulkable = ownMessages.filter((m) => Date.now() - m.createdTimestamp < TWO_WEEKS_MS);
    const mustDeleteIndividually = ownMessages.filter((m) => Date.now() - m.createdTimestamp >= TWO_WEEKS_MS);

    if (bulkable.size === 1) {
      await bulkable.first().delete().catch(() => {});
    } else if (bulkable.size > 1) {
      await channel.bulkDelete(bulkable, true).catch(() => {});
    }
    for (const m of mustDeleteIndividually.values()) {
      await m.delete().catch(() => {});
    }
  } catch (err) {
    // Most likely missing "Manage Messages" (bulkDelete) or "Read Message
    // History" (fetch) - not fatal, just means old messages aren't cleaned up.
    console.error(`[TRAP] Couldn't clean up old messages in #${channel.name} (${channel.id}): ${err.message}`);
  }
}

// Same brand orange used by the Status/Stats/Roles embeds, with the Spam
// Trap badge as a thumbnail so it doesn't read as a plain, un-styled wall of
// text. When `text` is falsy (the noWarning experiment is on), no embed is
// shown at all - just the counter button below.
function buildWarningEmbed(text) {
  return new EmbedBuilder().setColor(0xf47521).setDescription(text).setThumbnail(TRAP_BADGE_URL);
}

// The kicks button reads as a live counter "badge" rather than a wall of
// embed text - matches how other moderation bots surface a running count.
// The Translations button replaces the multilingual block that used to be
// baked into the warning embed on every message - now it's shown ephemerally
// (only to whoever clicks it) instead of taking up space for everyone. Both
// are clickable: index.js's interactionCreate handler responds to these
// exact customIds (see buildTrapPanel for kicks, the translations reply for
// the other).
function buildTrapButtonsRow(count) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('spamtrap_kick_counter')
      .setLabel(`Spam Trap Kicks: ${count}`)
      .setEmoji(E.protection)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('spamtrap_translations')
      .setLabel('Translations')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Secondary)
  );
}

// Missing the "Embed Links" permission makes an embed send fail outright.
// Rather than leave the trap channel with no warning at all (protection still
// works, but nobody's told why they got banned), fall back to sending the
// same text as a plain message - which only needs "Send Messages". This is
// what kept older servers working before the embed conversion. Message
// components (the counter button) don't require Embed Links at all, so the
// button still comes through even on this fallback path.
function isEmbedPermError(err) {
  // 50013 = Missing Permissions, 50001 = Missing Access
  return err && (err.code === 50013 || err.code === 50001);
}

// Sends (and pins) the combined warning embed + counter button. Used both for
// the initial setup and to recreate the message later if it's ever deleted or
// unpinned out from under us. Never throws - callers should check `.ok`.
async function sendTrapMessage(channel, guildId, text, count) {
  const row = buildTrapButtonsRow(count);
  try {
    const payload = text ? { embeds: [buildWarningEmbed(text)], components: [row] } : { embeds: [], components: [row] };
    const msg = await channel.send(payload);
    store.setKickCounterMessage(guildId, channel.id, msg.id);
    await msg.pin().catch(() => {});
    return { ok: true };
  } catch (err) {
    // Embed failed (likely no Embed Links permission) - retry as plain text
    // (still with the button, which doesn't need that permission) so the
    // warning still appears.
    if (isEmbedPermError(err)) {
      try {
        const msg = await channel.send({ content: text || undefined, components: [row] });
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
// message's button, preserving whatever warning text is currently configured
// (picking up any edits to it automatically). Recreates the message from
// scratch if it's missing - deleted, unpinned, or postWarning never got to
// post it in the first place (e.g. it was skipped because the noWarning
// experiment is on, or it failed and the admin hasn't fixed permissions yet).
async function postOrUpdateKickCounter(channel, guildId, guildConfig, count) {
  const g = store.getGuild(guildId);
  const existingId = (g.kickCounterMessages || {})[channel.id];
  const text = guildConfig.experiments.noWarning ? null : guildConfig.customMessages.warning || DEFAULT_WARNING;
  const row = buildTrapButtonsRow(count);

  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      try {
        const payload = text ? { embeds: [buildWarningEmbed(text)], components: [row] } : { embeds: [], components: [row] };
        await msg.edit(payload);
      } catch (editErr) {
        // Message was posted as plain text (no Embed Links) - edit the plain
        // content instead, still updating the button.
        await msg.edit({ content: text || null, components: [row] });
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
  purgeOldBotMessages,
  buildWarningEmbed,
  buildTrapButtonsRow,
  isEmbedPermError,
  postWarning,
  postOrUpdateKickCounter,
};
