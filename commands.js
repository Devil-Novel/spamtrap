const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('spamtrap')
    .setDescription('Spam Trap moderation bot controls')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addSubcommand((sub) =>
      sub
        .setName('channel')
        .setDescription('Set the trap channel')
        .addChannelOption((opt) => opt.setName('channel').setDescription('The trap channel').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('log')
        .setDescription('Set the mod log channel')
        .addChannelOption((opt) => opt.setName('channel').setDescription('The log channel').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('action')
        .setDescription('Choose the moderation action')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Action type')
            .setRequired(true)
            .addChoices(
              { name: 'softban (ban then unban, default)', value: 'softban' },
              { name: 'ban (permanent)', value: 'ban' },
              { name: 'disabled (log only)', value: 'disabled' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('channels')
        .setDescription('Set up to 5 trap channels (requires Many Traps experiment)')
        .addChannelOption((opt) => opt.setName('channel1').setDescription('Trap channel 1').setRequired(true))
        .addChannelOption((opt) => opt.setName('channel2').setDescription('Trap channel 2').setRequired(false))
        .addChannelOption((opt) => opt.setName('channel3').setDescription('Trap channel 3').setRequired(false))
        .addChannelOption((opt) => opt.setName('channel4').setDescription('Trap channel 4').setRequired(false))
        .addChannelOption((opt) => opt.setName('channel5').setDescription('Trap channel 5').setRequired(false))
    )
    .addSubcommand((sub) => sub.setName('toggle').setDescription('Enable or disable an experiment (dropdown)'))
    .addSubcommand((sub) => sub.setName('experiments').setDescription('View all experiments and their status'))
    .addSubcommand((sub) => sub.setName('status').setDescription('View the current configuration'))
    .addSubcommand((sub) => sub.setName('stats').setDescription('View moderation statistics'))
    .addSubcommand((sub) => sub.setName('disable').setDescription('Turn off the trap (keeps other settings)'))
    .addSubcommand((sub) => sub.setName('info').setDescription('Show all commands and how to use the bot'))
    .addSubcommand((sub) =>
      sub.setName('addrole').setDescription('Add a role that can manage Spam Trap')
        .addRoleOption((opt) => opt.setName('role').setDescription('The role to add').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub.setName('removerole').setDescription('Remove a role from managing Spam Trap')
        .addRoleOption((opt) => opt.setName('role').setDescription('The role to remove').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('roles').setDescription('View all roles that can manage Spam Trap'))
    .addSubcommand((sub) => sub.setName('servers').setDescription('(Bot owner only) List every server Spam Trap is currently in'))
    .addSubcommand((sub) =>
      sub
        .setName('notify-reset')
        .setDescription('(Bot owner only) DM owners of servers with no trap channel set, asking them to reconfigure')
        .addBooleanOption((opt) =>
          opt
            .setName('force')
            .setDescription('Resend to every current server, ignoring trap channel status and previous notifications')
            .setRequired(false)
        )
    ),

  new SlashCommandBuilder()
    .setName('spamtrap-messages')
    .setDescription('Customize the warning, DM, and log messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  // Server protection (scam links, raids, mass mentions, repeats, newcomers,
  // webhooks, anti-nuke). Independent of the trap channel; Administrator /
  // owner only, and the handler re-checks that regardless of this default.
  new SlashCommandBuilder()
    .setName('protection')
    .setDescription('Server protection settings (separate from the trap channel)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub.setName('status').setDescription('Show protection features, actions, limits, exemptions and missing permissions'))
    .addSubcommand((sub) => sub.setName('recent').setDescription('Show the latest protection incidents (no message content is stored)'))
    .addSubcommand((sub) =>
      sub
        .setName('feature')
        .setDescription('Turn a protection feature on or off (all are off by default)')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Feature').setRequired(true).addChoices(
            { name: 'scam - suspected phishing links + domain block list', value: 'scam' },
            { name: 'raid - join bursts (needs ENABLE_MEMBER_EVENTS)', value: 'raid' },
            { name: 'mentions - mass user/role/everyone mentions', value: 'mentions' },
            { name: 'repeats - the same message posted repeatedly', value: 'repeats' },
            { name: 'newcomers - no links/attachments right after joining', value: 'newcomers' },
            { name: 'webhooks - message floods from one webhook', value: 'webhooks' },
            { name: 'antinuke - bursts of destructive admin actions', value: 'antinuke' }
          )
        )
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('true = on, false = off').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('limit')
        .setDescription('Adjust a threshold or window')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Setting').setRequired(true).addChoices(
            { name: 'mentionLimit (default 8)', value: 'mentionLimit' },
            { name: 'repeatLimit (default 4)', value: 'repeatLimit' },
            { name: 'messageWindowSeconds (default 15)', value: 'messageWindowSeconds' },
            { name: 'webhookLimit (default 8)', value: 'webhookLimit' },
            { name: 'joinLimit (default 8)', value: 'joinLimit' },
            { name: 'joinWindowSeconds (default 15)', value: 'joinWindowSeconds' },
            { name: 'raidMinutes (default 5)', value: 'raidMinutes' },
            { name: 'raidFilter (0 = off, 1 = filter cohort messages)', value: 'raidFilter' },
            { name: 'newcomerMinutes (default 10)', value: 'newcomerMinutes' },
            { name: 'timeoutMinutes (default 10)', value: 'timeoutMinutes' },
            { name: 'nukeLimit (default 4)', value: 'nukeLimit' },
            { name: 'nukeWindowSeconds (default 20)', value: 'nukeWindowSeconds' }
          )
        )
        .addIntegerOption((opt) => opt.setName('value').setDescription('New value').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('action')
        .setDescription('What to do when something is detected')
        .addStringOption((opt) =>
          opt.setName('target').setDescription('Which detections').setRequired(true).addChoices(
            { name: 'messages (scam, mentions, repeats, newcomers, webhooks, raid filter)', value: 'messages' },
            { name: 'antinuke', value: 'antinuke' }
          )
        )
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Action').setRequired(true).addChoices(
            { name: 'alert - log only (default)', value: 'alert' },
            { name: 'delete - messages only', value: 'delete' },
            { name: 'timeout - messages only (deletes + times out the sender)', value: 'timeout' },
            { name: 'strip_roles - antinuke only (remove dangerous roles from the executor)', value: 'strip_roles' }
          )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('trust')
        .setDescription('Exempt a role from protections (max 50; @everyone is not allowed)')
        .addRoleOption((opt) => opt.setName('role').setDescription('Role').setRequired(true))
        .addBooleanOption((opt) => opt.setName('trusted').setDescription('true = trusted, false = remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('webhook')
        .setDescription('Trust a webhook by ID so its messages are not checked (max 50)')
        .addStringOption((opt) => opt.setName('id').setDescription('Webhook ID (numbers only, never the URL or token)').setRequired(true))
        .addBooleanOption((opt) => opt.setName('trusted').setDescription('true = trusted, false = remove').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('domain')
        .setDescription('Manage the blocked / allowed domain lists (max 50 each; subdomains match automatically)')
        .addStringOption((opt) =>
          opt.setName('list').setDescription('Which list').setRequired(true).addChoices(
            { name: 'blockedDomains (always flagged; wins over allow)', value: 'blockedDomains' },
            { name: 'allowedDomains (skip heuristics)', value: 'allowedDomains' }
          )
        )
        .addStringOption((opt) =>
          opt.setName('operation').setDescription('add or remove').setRequired(true).addChoices(
            { name: 'add', value: 'add' },
            { name: 'remove', value: 'remove' }
          )
        )
        .addStringOption((opt) => opt.setName('host').setDescription('Domain, e.g. example.com').setRequired(true))
    ),
].map((c) => c.toJSON());

module.exports = { commands };
