const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder,
  REST,
  Routes,
} = require('discord.js');
require('dotenv').config();

const store = require('./lib/store');
const { replaceVars, DEFAULT_WARNING, TRANSLATIONS_TEXT, DEFAULT_DM, DEFAULT_LOG } = require('./lib/messages');
const {
  maybeDeleteOldAutoChannel,
  purgeOldBotMessages,
  isEmbedPermError,
  postWarning,
  postOrUpdateKickCounter,
} = require('./lib/trapChannel');

// Moved to lib/emojis.js so lib/trapChannel.js (used by both the bot and the
// dashboard) references the exact same ids instead of a second copy. Declared
// here, before anything below that uses E in a template literal (RESET_NOTICE_DM,
// etc.) - a `const` used before its own declaration line throws, it isn't
// hoisted the way a function declaration is.
const E = require('./lib/emojis');
const DONE_EMOJI = E.done;

// Discord user id of the bot's operator. Deliberately separate from
// hasPermission()'s per-guild check (guild owner / allowed roles / Ban
// Members+Manage Server) - this gates a command that lists every server the
// bot is in across ALL guilds, which would otherwise leak other communities'
// names/ids/member counts to any admin of any single server that has the bot.
// Unset (undefined) means nobody passes the check - safe default, not open.
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;

// Shared real links, reused instead of re-typing the invite/permissions
// bitmask, Discord invite, GitHub repo, and site URL in multiple places
// (site + here) so they can't quietly drift out of sync.
const INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=1523811499766976723&permissions=1099511720981&scope=bot%20applications.commands';
const COMMUNITY_URL = 'https://discord.gg/WuJMbkNZBJ';
const DASHBOARD_URL = 'https://spamtrap.help';
const TRAP_BADGE_URL = 'https://spamtrap.help/trap-badge.png';

// Fixed, non-templated text - sent once per server via /spamtrap notify-reset
// to the server owner, for servers whose trap channel got wiped by the
// Railway ephemeral-storage bug (see README "Persistent Storage").
const RESET_NOTICE_DM =
  `${E.protection} Good news about Spam Trap! We fixed a hosting issue that was resetting server settings, and it will not happen again. ` +
  "If your trap channel or log channel isn't set yet, just run /spamtrap channel one more time, it'll stick for good from now on.\n\n" +
  `${E.dashboard} We also made the dashboard much easier to use, you can now set your trap channel(s) and log channel right from spamtrap.help, no commands needed.\n\n` +
  `${E.done} Thanks for using Spam Trap and for your patience while we got this sorted!`;

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
  if (action === 'softban') return 'soft-banned (can rejoin)';
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
      { name: 'Action', value: `\`${g.action}\`` },
      { name: 'Active experiments', value: experimentsOn },
      { name: 'Catch count (this server)', value: `\`${g.catchCount || 0}\`` },
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
      { name: 'This server', value: `\`${g.catchCount || 0}\` caught` },
      { name: 'Global (all servers)', value: `\`${db.global.totalCatches || 0}\` caught` },
      { name: 'Last 5 actions', value: recent }
    );
}

// ---------- Trap channel "Kicks" button info panel ----------
// Shown ephemerally to whoever clicks the kick-counter button on the trap
// channel message. One combined embed (what this channel is + this server's
// and global stats) built from data we can actually stand behind - no
// invented 7-day windows we don't track, no per-channel breakdown we don't
// store.

// A few honest, mildly-fun footer lines, picked by how many catches this
// server has racked up - same spirit as other bots' "that's a lot of spam"
// flavor text, without pretending we track more than we do.
function trapStatsFlavor(count) {
  if (count === 0) return "No catches yet here - that's a good sign, or nobody's tried it yet.";
  if (count < 10) return "Early days - every catch here is one less spam wave in your server.";
  if (count < 100) return 'A solid haul so far. The trap is earning its keep.';
  if (count < 1000) return "That's a lot of bots that picked the wrong channel.";
  return 'A genuinely absurd number of spam bots have met their end in here.';
}

function buildTrapPanel(guildId, client) {
  const db = store.readDb();
  const g = store.getGuild(guildId);
  const globalServers = client.guilds.cache.size;

  const mostRecent = (g.recentActions || [])[0];
  const mostRecentLine = mostRecent
    ? `<@${mostRecent.userId}> — ${mostRecent.action} — <t:${Math.floor(mostRecent.timestamp / 1000)}:R>`
    : 'No catches yet';

  const embed = new EmbedBuilder()
    .setTitle(`What is Spam Trap? ${E.protection}`)
    .setColor(0xf47521)
    .setThumbnail(TRAP_BADGE_URL)
    .setDescription(
      'This channel is a **trap channel**, visible to members but not meant for normal use. ' +
        'Spam bots and compromised accounts often blast messages into every channel they can see, including this one.\n\n' +
        `When a message lands here, Spam Trap deletes it immediately and takes action on the account. This server currently uses **${actionText(g.action)}**: ` +
        "the user gets DMed an explanation, and it's all logged, in about a second."
    )
    .addFields(
      { name: 'This server', value: `\`${g.catchCount || 0}\` caught`, inline: true },
      { name: 'Trap channel(s)', value: `\`${g.trapChannels.length || 0}\``, inline: true },
      { name: 'Action', value: `\`${actionText(g.action)}\``, inline: true },
      { name: 'Most recent catch', value: mostRecentLine, inline: false },
      { name: 'Global (all servers)', value: `\`${db.global.totalCatches || 0}\` caught across \`${globalServers.toLocaleString()}\` servers`, inline: false }
    )
    .setFooter({ text: trapStatsFlavor(g.catchCount || 0) });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Invite Bot').setEmoji(E.protection).setStyle(ButtonStyle.Link).setURL(INVITE_URL),
    new ButtonBuilder().setLabel('Dashboard').setEmoji(E.dashboard).setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL),
    new ButtonBuilder().setLabel('Community Hub').setEmoji(E.discord).setStyle(ButtonStyle.Link).setURL(COMMUNITY_URL)
  );
  return { embed, row };
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
    if (trapChannel) await postOrUpdateKickCounter(trapChannel, guildId, guildConfig, guildCount);
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
// maybeDeleteOldAutoChannel, isEmbedPermError, postWarning, and
// postOrUpdateKickCounter now live in lib/trapChannel.js (imported above) so
// the dashboard's channel editor posts the exact same combined
// warning+counter message as these slash commands, instead of a second copy
// of this logic that could quietly drift out of sync.

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

  // Visible on every boot: how many servers' configs actually survived this
  // deploy. If this reads 0 (or far lower than expected) right after a
  // redeploy that wasn't a fresh install, storage isn't persisting - check
  // that DATABASE_PATH points at a mounted Railway Volume.
  const configuredCount = store
    .getAllGuildIds()
    .filter((id) => store.getGuild(id).trapChannels.length > 0).length;
  console.log(`[STORAGE] Loaded ${store.getAllGuildIds().length} known guild(s), ${configuredCount} with a trap channel configured.`);

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
    // message.member is null for webhook-sent messages (Discord doesn't
    // always flag webhook authors as "bot", so that alone won't catch them)
    // and for a couple of other edge cases where there's no real server
    // member behind the message. There's nothing to ban/moderate in that
    // case, so skip it instead of letting handleCatch throw on member.id.
    if (message.author.bot || !message.guild || !message.member) return;
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
    // The "Spam Trap Kicks: N" button on the trap channel message - public,
    // any member can click it (it's just information, nothing destructive),
    // so no hasPermission() admin gate here unlike the slash commands below.
    if (interaction.isButton() && interaction.customId === 'spamtrap_kick_counter') {
      if (!interaction.guild) return;
      const { embed, row } = buildTrapPanel(interaction.guild.id, interaction.client);
      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    // Same idea as the kicks button above - public, ephemeral, no permission
    // gate. Shows the multilingual translations that used to be baked into
    // the warning embed on every message, only to whoever asks for them.
    if (interaction.isButton() && interaction.customId === 'spamtrap_translations') {
      if (!interaction.guild) return;
      const translationsEmbed = new EmbedBuilder()
        .setTitle(`Translations ${E.multilingual}`)
        .setColor(0xf47521)
        .setDescription(TRANSLATIONS_TEXT);
      await interaction.reply({ embeds: [translationsEmbed], flags: MessageFlags.Ephemeral });
      return;
    }

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
          // Clean up any leftover bot messages from a previous setup (e.g. a
          // server that configured its trap channel before the warning and
          // counter were merged into one message) so we don't end up with an
          // old message sitting next to the new one.
          await purgeOldBotMessages(channel);
          const result = await postWarning(channel, guildId, g);
          if (!result.ok) {
            return await interaction.editReply({
              content: `${E.protection} Trap channel set to <#${channel.id}>, but I couldn't post the warning message there (${result.error.message}). Make sure I have **View Channel** and **Send Messages** permissions in that channel.`,
            });
          }
          await postOrUpdateKickCounter(channel, guildId, g, g.catchCount || 0);
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
            await purgeOldBotMessages(c);
            const result = await postWarning(c, guildId, g);
            if (!result.ok) {
              failed.push(c);
              continue;
            }
            await postOrUpdateKickCounter(c, guildId, g, g.catchCount || 0);
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

        // ── Bot owner only: cross-server list, gated on BOT_OWNER_ID, not ──
        // hasPermission()'s per-guild check above, since this exposes every
        // guild's name/id/member count, not just this one.
        if (sub === 'servers') {
          if (!BOT_OWNER_ID || interaction.user.id !== BOT_OWNER_ID) {
            return await interaction.reply({
              content: `${E.protection} This command is restricted to the bot owner.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          // One readDb() call, not one per guild - avoids N synchronous file
          // reads blocking the event loop as the server count grows.
          const db = store.readDb();
          const guildList = [...client.guilds.cache.values()]
            .sort((a, b) => b.memberCount - a.memberCount)
            .map((gu) => {
              const cfg = db.guilds[gu.id];
              const configured = cfg && cfg.trapChannels && cfg.trapChannels.length > 0;
              return `${gu.name} (${gu.id}) | ${gu.memberCount} members | ${configured ? 'configured' : 'NOT SET'}`;
            });
          const body = `Spam Trap is in ${guildList.length} server(s).\n\n${guildList.join('\n')}`;
          const attachment = new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: 'spamtrap-servers.txt' });
          return await interaction.editReply({
            content: `${E.protection} Spam Trap is in **${guildList.length}** server(s). Full list attached.`,
            files: [attachment],
          });
        }

        // ── Bot owner only: one-time DM to owners of servers whose trap ──
        // channel got wiped by the Railway storage bug. Marks each guild as
        // notified so re-running this later never double-messages anyone.
        if (sub === 'notify-reset') {
          if (!BOT_OWNER_ID || interaction.user.id !== BOT_OWNER_ID) {
            return await interaction.reply({
              content: `${E.protection} This command is restricted to the bot owner.`,
              flags: MessageFlags.Ephemeral,
            });
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });

          // force: true sends RESET_NOTICE_DM to every current server
          // regardless of trap channel status or prior notification - used
          // for a one-off broadcast (e.g. "this is fixed now, thanks!")
          // rather than the normal "only servers that still need fixing" run.
          const force = interaction.options.getBoolean('force') || false;

          // Iterate every guild the bot is currently in (live Discord data),
          // not Object.keys(db.guilds) - a guild with zero interactions
          // since the storage wipe has no store entry at all yet, so reading
          // only existing entries silently skipped most "not set" servers.
          // store.getGuild() lazily creates a default entry for those.
          const targetIds = [...client.guilds.cache.keys()].filter((id) => {
            if (force) return true;
            const cfg = store.getGuild(id);
            const notConfigured = !cfg.trapChannels || cfg.trapChannels.length === 0;
            return notConfigured && !cfg.notifiedAboutReset;
          });

          const results = [];
          for (const id of targetIds) {
            const gu = client.guilds.cache.get(id);
            let status;
            try {
              const owner = await gu.fetchOwner();
              await owner.user.send(RESET_NOTICE_DM);
              status = 'DM sent';
            } catch (err) {
              status = `failed (${err.message})`;
            }
            // Mark as notified either way - a failed DM (owner has server
            // DMs closed) will keep failing on retry, so this stops the
            // command from re-attempting the same server forever.
            store.updateGuild(id, (fresh) => {
              fresh.notifiedAboutReset = true;
            });
            results.push(`${gu.name} (${id}) | ${status}`);
            // Small delay between DMs to stay well clear of Discord's rate limits.
            await new Promise((resolve) => setTimeout(resolve, 350));
          }

          const sentCount = results.filter((r) => r.endsWith('DM sent')).length;
          const failedCount = results.length - sentCount;
          if (results.length === 0) {
            return await interaction.editReply({
              content: `${E.done} No servers needed a reminder - everything with no trap channel set has already been notified.`,
            });
          }
          const body = `Notify-reset run: ${sentCount} sent, ${failedCount} failed, ${results.length} total.\n\n${results.join('\n')}`;
          const attachment = new AttachmentBuilder(Buffer.from(body, 'utf8'), { name: 'spamtrap-notify-reset.txt' });
          return await interaction.editReply({
            content: `${E.protection} Notified **${sentCount}** server owner(s), **${failedCount}** failed (likely DMs closed). Full breakdown attached.`,
            files: [attachment],
          });
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
    const result = await postWarning(channel, guild.id, g);
    if (!result.ok) {
      console.error(`[JOIN] Channel created in ${guild.name} but failed to post warning: ${result.error.message}`);
    }

    await postOrUpdateKickCounter(channel, guild.id, g, 0);

    console.log(`[JOIN] Setup complete for ${guild.name}`);
  } catch (err) {
    console.error(`[JOIN] Failed to auto-create channel in ${guild.name}: ${err.message}`);
  }
});

// ---------- guildDelete: cleanup ----------
// Fires when the bot is removed from a server (kicked, or the server
// deletes it). Purges that server's stored config/logs entirely - this is
// what makes the Privacy Policy's "remove your data by removing Spam Trap
// from your server" claim actually true, and keeps db.json from growing
// forever with orphaned entries for servers that left long ago.
client.on('guildDelete', (guild) => {
  // Discord can re-fire this on a fresh boot for a guild we already cleaned
  // up in a previous deploy (e.g. it's still transiently unavailable to us).
  // Only log/act when there was actually something left to delete, so this
  // doesn't spam "[LEAVE] Removed from..." on every single redeploy.
  const removed = store.deleteGuild(guild.id);
  if (removed) {
    console.log(`[LEAVE] Removed from ${guild.name || 'an uncached server'} (${guild.id}) - deleting stored data.`);
  }
});

client.login(process.env.BOT_TOKEN || process.env.DISCORD_TOKEN);
