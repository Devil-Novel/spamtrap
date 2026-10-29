// /protection slash command handling. Administrator or server owner only -
// deliberately NOT the /spamtrap "allowed roles" list, because these settings
// can delete messages and strip roles server-wide. Every reply is ephemeral
// and has mentions disabled.
const { EmbedBuilder, MessageFlags, PermissionsBitField } = require('discord.js');
const cfgMod = require('./config');
const { missingPermissions } = require('./permissions');
const { FEATURE_LABELS } = require('./incidents');

const NO_PINGS = { parse: [] };
const EPH = MessageFlags.Ephemeral;

function isAdminOrOwner(interaction) {
  if (!interaction.guild) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  const p = interaction.memberPermissions;
  return !!(p && typeof p.has === 'function' && p.has(PermissionsBitField.Flags.Administrator));
}

function reply(interaction, content) {
  return interaction.reply({ content, flags: EPH, allowedMentions: NO_PINGS });
}

function onOff(b) {
  return b ? 'ON' : 'off';
}

function buildStatusEmbed(interaction, cfg, ctx) {
  const guild = interaction.guild;
  const L = cfg.limits;
  const f = cfg.features;
  const missing = missingPermissions(guild, cfg);
  const raidNote = f.raid && !ctx.memberEvents ? ' (inactive: ENABLE_MEMBER_EVENTS is false, so join events are not received)' : '';
  const raidActive = ctx.state.isRaidActive(guild.id);
  const embed = new EmbedBuilder()
    .setTitle('Server protection status')
    .setColor(0xf47521)
    .setDescription(
      'These protections are separate from the trap channel. `/spamtrap disable` turns off trap channels only; each protection has its own switch here.\n' +
        'Alert-only never deletes or times out anything.'
    )
    .addFields(
      {
        name: 'Features',
        value: [
          `scam: ${onOff(f.scam)} - suspected phishing links (local heuristics; can misfire)`,
          `raid: ${onOff(f.raid)}${raidNote}${raidActive ? ' - RAID MODE ACTIVE' : ''}`,
          `mentions: ${onOff(f.mentions)}`,
          `repeats: ${onOff(f.repeats)}`,
          `newcomers: ${onOff(f.newcomers)}`,
          `webhooks: ${onOff(f.webhooks)}`,
          `antinuke: ${onOff(f.antinuke)}`,
        ].join('\n'),
      },
      { name: 'Message action', value: `\`${cfg.messageAction}\``, inline: true },
      { name: 'Anti-nuke action', value: `\`${cfg.nukeAction}\``, inline: true },
      { name: 'Member events requested', value: ctx.memberEvents ? 'yes (ENABLE_MEMBER_EVENTS=true)' : 'no (ENABLE_MEMBER_EVENTS=false)', inline: true },
      {
        name: 'Limits',
        value:
          `mentions \`${L.mentionLimit}\` · repeats \`${L.repeatLimit}\` · window \`${L.messageWindowSeconds}s\` · webhook \`${L.webhookLimit}\`\n` +
          `joins \`${L.joinLimit}\` in \`${L.joinWindowSeconds}s\` · raid \`${L.raidMinutes}m\` · raidFilter \`${L.raidFilter}\`\n` +
          `newcomer \`${L.newcomerMinutes}m\` · timeout \`${L.timeoutMinutes}m\` · nuke \`${L.nukeLimit}\` in \`${L.nukeWindowSeconds}s\``,
      },
      {
        name: 'Exemptions & lists',
        value:
          `trusted roles: ${cfg.trustedRoles.length ? cfg.trustedRoles.map((id) => `<@&${id}>`).join(' ') : 'none'}\n` +
          `trusted webhooks: ${cfg.trustedWebhooks.length} · blocked domains: ${cfg.blockedDomains.length} · allowed domains: ${cfg.allowedDomains.length}\n` +
          'always exempt: server owner, Spam Trap itself; staff (Administrator / Manage Server / Manage Messages / Moderate Members) are exempt from the message protections but NOT from anti-nuke',
      },
      { name: 'Incidents', value: `${cfg.incidentCount} total, last ${Math.min(cfg.incidents.length, cfgMod.INCIDENTS_MAX)} kept - see \`/protection recent\``, inline: true }
    );
  embed.addFields({
    name: missing.length ? 'Missing permissions' : 'Permissions',
    value: missing.length
      ? missing.map((m) => `• **${m.perm}** - needed to ${m.why}`).join('\n') + '\nChannel overrides and role hierarchy can still block enforcement even when these are granted.'
      : 'All permissions needed for the current settings are granted. Channel overrides and role hierarchy can still block enforcement.',
  });
  return embed;
}

function buildRecentEmbed(cfg) {
  const embed = new EmbedBuilder().setTitle('Recent protection incidents').setColor(0xf47521);
  if (!cfg.incidents.length) {
    embed.setDescription(`No incidents recorded yet. (${cfg.incidentCount} total so far.)`);
    return embed;
  }
  const lines = cfg.incidents.slice(0, cfgMod.INCIDENTS_MAX).map((i) => {
    const who = i.subjectType === 'webhook' ? `webhook \`${i.subjectId}\`` : i.subjectType === 'server' ? 'server-wide' : `<@${i.subjectId}>`;
    return `<t:${Math.floor(i.ts / 1000)}:R> **${FEATURE_LABELS[i.feature] || i.feature}** · ${who}\n↳ ${i.reason}\n↳ ${i.action} → ${i.outcome}`;
  });
  embed.setDescription(lines.join('\n\n').slice(0, 4000));
  embed.setFooter({ text: `${cfg.incidentCount} total · latest ${cfg.incidents.length} kept · no message content is stored` });
  return embed;
}

async function handle(interaction, ctx) {
  if (!interaction.guild) return reply(interaction, 'This command only works in a server.');
  if (!isAdminOrOwner(interaction)) {
    return reply(interaction, 'Only the server owner or an Administrator can change server protection settings.');
  }
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();
  const cfg = cfgMod.getProtection(guildId);

  if (sub === 'status') {
    return interaction.reply({ embeds: [buildStatusEmbed(interaction, cfg, ctx)], flags: EPH, allowedMentions: NO_PINGS });
  }
  if (sub === 'recent') {
    return interaction.reply({ embeds: [buildRecentEmbed(cfg)], flags: EPH, allowedMentions: NO_PINGS });
  }

  if (sub === 'feature') {
    const name = interaction.options.getString('name');
    const enabled = interaction.options.getBoolean('enabled');
    const v = cfgMod.validateFeature(name);
    if (!v.ok) return reply(interaction, v.error);
    cfgMod.updateProtection(guildId, (p) => { p.features[name] = !!enabled; });
    let msg = `**${name}** is now **${enabled ? 'ON' : 'off'}**.`;
    if (name === 'raid' && enabled && !ctx.memberEvents) {
      msg += '\nNote: join-based raid detection needs member events. The operator must enable the Server Members Intent in the Discord Developer Portal (and get Discord\'s approval if the bot is large enough to require it), then set `ENABLE_MEMBER_EVENTS=true` and restart. Until then this setting is saved but inactive.';
    }
    if (name === 'antinuke' && enabled) {
      msg += '\nAnti-nuke needs the **View Audit Log** permission. Default action is alert-only; `/protection action target:antinuke type:strip_roles` enables containment.';
    }
    if (name === 'scam' && enabled) {
      msg += '\nScam detection uses local heuristics plus your block list; it reports *suspected* phishing and can produce false positives. It does not scan attachments or follow redirects.';
    }
    if (enabled && cfg.messageAction === 'alert' && name !== 'antinuke') msg += '\nMessage action is `alert`: nothing will be deleted or timed out until you change it.';
    return reply(interaction, msg);
  }

  if (sub === 'limit') {
    const name = interaction.options.getString('name');
    const value = interaction.options.getInteger('value');
    const v = cfgMod.validateLimit(name, value);
    if (!v.ok) return reply(interaction, v.error);
    cfgMod.updateProtection(guildId, (p) => { p.limits[name] = value; });
    let msg = `**${name}** set to **${value}** (${cfgMod.LIMITS[name].unit}).`;
    if (name === 'raidFilter' && value === 1) msg += '\nDuring an active raid, messages from the arrival cohort will get the message action (delete at most - nobody is timed out for joining).';
    return reply(interaction, msg);
  }

  if (sub === 'action') {
    const target = interaction.options.getString('target');
    const type = interaction.options.getString('type');
    const v = cfgMod.validateAction(target, type);
    if (!v.ok) return reply(interaction, v.error);
    cfgMod.updateProtection(guildId, (p) => {
      if (target === 'messages') p.messageAction = type;
      else p.nukeAction = type;
    });
    const fresh = cfgMod.getProtection(guildId);
    const missing = missingPermissions(interaction.guild, fresh);
    let msg = `${target === 'messages' ? 'Message' : 'Anti-nuke'} action set to **${type}**.`;
    if (type === 'strip_roles') msg += '\nContainment removes only dangerous roles the bot can edit from the executor and keeps every other role. It cannot restore deleted channels or roles, and cannot act on accounts above the bot\'s role.';
    if (type === 'timeout') msg += `\nTimeouts last ${fresh.limits.timeoutMinutes} min and never shorten an existing longer timeout.`;
    if (missing.length) msg += `\nMissing permissions for this: ${missing.map((m) => m.perm).join(', ')}.`;
    return reply(interaction, msg);
  }

  if (sub === 'trust') {
    const role = interaction.options.getRole('role');
    const trusted = interaction.options.getBoolean('trusted');
    if (!role) return reply(interaction, 'Pick a role.');
    if (role.id === interaction.guild.id) return reply(interaction, 'The @everyone role cannot be trusted - that would exempt everybody.');
    const list = cfg.trustedRoles;
    if (trusted && !list.includes(role.id) && list.length >= cfgMod.LIST_MAX) {
      return reply(interaction, `Trusted-role list is full (${cfgMod.LIST_MAX}). Remove one first.`);
    }
    cfgMod.updateProtection(guildId, (p) => {
      p.trustedRoles = p.trustedRoles.filter((id) => id !== role.id);
      if (trusted) p.trustedRoles.push(role.id);
    });
    return reply(interaction, trusted
      ? `Members with **${role.name}** are now exempt from the message protections and from anti-nuke.`
      : `**${role.name}** is no longer trusted.`);
  }

  if (sub === 'webhook') {
    const id = String(interaction.options.getString('id') || '').trim();
    const trusted = interaction.options.getBoolean('trusted');
    if (!cfgMod.validateSnowflake(id)) {
      return reply(interaction, 'That is not a webhook ID. Use the numeric ID only (17-20 digits) - never paste the webhook URL or token.');
    }
    const list = cfg.trustedWebhooks;
    if (trusted && !list.includes(id) && list.length >= cfgMod.LIST_MAX) {
      return reply(interaction, `Trusted-webhook list is full (${cfgMod.LIST_MAX}). Remove one first.`);
    }
    cfgMod.updateProtection(guildId, (p) => {
      p.trustedWebhooks = p.trustedWebhooks.filter((x) => x !== id);
      if (trusted) p.trustedWebhooks.push(id);
    });
    return reply(interaction, trusted ? `Webhook \`${id}\` is now trusted (its messages are not checked).` : `Webhook \`${id}\` is no longer trusted.`);
  }

  if (sub === 'domain') {
    const listName = interaction.options.getString('list');
    const op = interaction.options.getString('operation');
    const host = cfgMod.normalizeDomain(interaction.options.getString('host'));
    if (!['blockedDomains', 'allowedDomains'].includes(listName)) return reply(interaction, 'List must be blockedDomains or allowedDomains.');
    if (!['add', 'remove'].includes(op)) return reply(interaction, 'Operation must be add or remove.');
    if (!host) return reply(interaction, 'That does not look like a domain. Use a bare hostname like `example.com` (subdomains match automatically; wildcards are not needed).');
    const list = cfg[listName];
    if (op === 'add' && !list.includes(host) && list.length >= cfgMod.LIST_MAX) {
      return reply(interaction, `That list is full (${cfgMod.LIST_MAX} entries). Remove one first.`);
    }
    cfgMod.updateProtection(guildId, (p) => {
      p[listName] = p[listName].filter((d) => d !== host);
      if (op === 'add') p[listName].push(host);
    });
    const other = listName === 'blockedDomains' ? 'allowedDomains' : 'blockedDomains';
    let msg = `\`${host}\` ${op === 'add' ? 'added to' : 'removed from'} **${listName}** (matches the domain and all its subdomains).`;
    if (op === 'add' && cfg[other].some((d) => d === host || host.endsWith('.' + d) || d.endsWith('.' + host))) {
      msg += '\nNote: a related entry exists in the other list. Explicit blocks always take precedence over allow entries.';
    }
    return reply(interaction, msg);
  }

  return reply(interaction, 'Unknown subcommand.');
}

module.exports = { handle, isAdminOrOwner, buildStatusEmbed, buildRecentEmbed };
