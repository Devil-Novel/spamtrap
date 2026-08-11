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
    ),

  new SlashCommandBuilder()
    .setName('spamtrap-messages')
    .setDescription('Customize the warning, DM, and log messages')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
].map((c) => c.toJSON());

module.exports = { commands };
