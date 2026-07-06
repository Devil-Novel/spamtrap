const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

// ── /spamtrap ──
const spamtrap = new SlashCommandBuilder()
  .setName('spamtrap')
  .setDescription('Configure the Spam Trap system.')
  .setDefaultMemberPermissions(
    PermissionFlagsBits.BanMembers | PermissionFlagsBits.ManageGuild
  )
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set the trap channel. Messages here trigger the action.')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('The channel to use as the spam trap.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('channels')
      .setDescription('Set multiple trap channels (requires Many Traps experiment).')
      .addChannelOption((opt) =>
        opt
          .setName('channel1')
          .setDescription('First trap channel.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel2')
          .setDescription('Second trap channel.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel3')
          .setDescription('Third trap channel.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel4')
          .setDescription('Fourth trap channel.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel5')
          .setDescription('Fifth trap channel.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('log')
      .setDescription('Set the log channel for moderation events.')
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel where actions are logged.')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('action')
      .setDescription('Choose what happens when someone is caught.')
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('The action to take on caught users.')
          .setRequired(true)
          .addChoices(
            { name: 'Softban -- ban then unban, removes messages (default)', value: 'softban' },
            { name: 'Ban -- permanent ban, removes messages', value: 'ban' },
            { name: 'Disabled -- log only, no moderation', value: 'disabled' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('experiments')
      .setDescription('View and toggle experimental features.')
  )
  .addSubcommand((sub) =>
    sub
      .setName('toggle')
      .setDescription('Toggle a specific experiment on or off.')
      .addStringOption((opt) =>
        opt
          .setName('experiment')
          .setDescription('Which experiment to toggle.')
          .setRequired(true)
          .addChoices(
            { name: 'Forward Message -- send caught message to log', value: 'forward_message' },
            { name: 'Reinvite -- include invite link in DM', value: 'reinvite' },
            { name: 'No Warning -- remove warning from trap channel', value: 'no_warning' },
            { name: 'No DM -- skip DM to caught user', value: 'no_dm' },
            { name: 'Channel Warmer -- daily message in trap channel', value: 'channel_warmer' },
            { name: 'Random Channel Name -- rename trap daily', value: 'random_name' },
            { name: 'Random Channel Name (Chaos) -- random chars daily', value: 'random_name_chaos' },
            { name: 'Timeout First -- 1hr timeout before ban', value: 'timeout_first' },
            { name: 'Only Recent Delete -- 15min instead of 1hr', value: 'recent_delete_only' },
            { name: 'Many Traps -- multiple trap channels', value: 'many_honeypots' },
            { name: 'Ensure Deletion -- cleanup leftover messages', value: 'ensure_deletion' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName('status').setDescription('View current SpamTrap configuration.')
  )
  .addSubcommand((sub) =>
    sub.setName('disable').setDescription('Disable the spam trap (keeps settings for later).')
  )
  .addSubcommand((sub) =>
    sub.setName('stats').setDescription('View moderation statistics.')
  );

// ── /spamtrap-messages ──
const spamtrapMessages = new SlashCommandBuilder()
  .setName('spamtrap-messages')
  .setDescription('Customize the warning, DM, and log messages.')
  .setDefaultMemberPermissions(
    PermissionFlagsBits.BanMembers | PermissionFlagsBits.ManageGuild
  );

module.exports = { spamtrap, spamtrapMessages };
