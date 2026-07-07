require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!BOT_TOKEN || !CLIENT_ID) {
  console.error('❌ Missing BOT_TOKEN or CLIENT_ID in .env — set them before deploying commands');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    if (GUILD_ID) {
      // Fast registration on a single guild (for testing - shows up instantly)
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log(`✅ Commands registered on guild ${GUILD_ID} successfully`);
    } else {
      // Global registration (can take up to an hour to appear everywhere)
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ Commands registered globally successfully (may take up to an hour to appear)');
    }
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
  }
})();
