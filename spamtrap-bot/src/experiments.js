const cron = require('node-cron');
const db = require('./db');

// ── Random channel name word list (realistic-looking channel names) ──
const CHANNEL_NAMES = [
  'general', 'chat', 'lounge', 'off-topic', 'random',
  'welcome', 'introductions', 'hangout', 'chill', 'memes',
  'media', 'music', 'gaming', 'events', 'announcements',
  'feedback', 'suggestions', 'help', 'support', 'questions',
  'showcase', 'art', 'selfies', 'food', 'pets',
  'sports', 'movies', 'tech', 'science', 'news',
  'deals', 'promotion', 'links', 'resources', 'clips',
  'screenshots', 'highlights', 'lfg', 'looking-for-group', 'team-up',
  'voice-chat', 'stream', 'content', 'creative', 'builds',
  'trading', 'marketplace', 'giveaways', 'contests', 'polls',
];

// ── Warmer messages ──
const WARMER_MESSAGES = [
  'Anyone else online?',
  'Pretty quiet in here today.',
  "What's everyone up to?",
  'Just checking in.',
  'How is everyone doing?',
  'Any plans for today?',
  'Good vibes only.',
  'Rise and grind!',
  "Who's here?",
  "Let's goooo",
  'Happy gaming everyone!',
  'New update is fire tbh',
  'This channel needs more energy',
  'Drop a message if you see this',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomChars(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < len; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// ════════════════════════════════════════════════════════════
//  START SCHEDULED TASKS
// ════════════════════════════════════════════════════════════

function startScheduler(client) {
  // Run daily at a random hour between 06:00-22:00 UTC
  // We use 08:00 UTC as the fixed cron time, but randomize within the task
  cron.schedule('0 8 * * *', async () => {
    console.log('[SCHEDULER] Running daily experiments...');

    const guilds = db.getAllGuilds();

    for (const settings of guilds) {
      if (!settings.channel_ids.length) continue;

      const guild = client.guilds.cache.get(settings.guild_id);
      if (!guild) continue;

      const primaryChannelId = settings.channel_ids[0];
      const channel = guild.channels.cache.get(primaryChannelId);
      if (!channel) continue;

      // ── Channel Warmer ──
      if (settings.experiments.channel_warmer) {
        try {
          // Delay randomly 0-4 hours so it doesn't always fire at the same time
          const delay = Math.floor(Math.random() * 4 * 3600000);
          setTimeout(async () => {
            try {
              const msg = await channel.send(pick(WARMER_MESSAGES));
              // Delete after 12 hours to avoid clutter
              setTimeout(() => msg.delete().catch(() => {}), 43200000);
            } catch (e) {
              console.log(`[SCHEDULER] Warmer failed for ${guild.name}: ${e.message}`);
            }
          }, delay);
        } catch (e) {
          console.log(`[SCHEDULER] Warmer setup failed: ${e.message}`);
        }
      }

      // ── Random Channel Name ──
      if (settings.experiments.random_name && !settings.experiments.random_name_chaos) {
        try {
          const newName = pick(CHANNEL_NAMES);
          await channel.setName(newName, '[SpamTrap] Random channel name experiment.');
          console.log(`[SCHEDULER] Renamed #${channel.name} to #${newName} in ${guild.name}`);
        } catch (e) {
          console.log(`[SCHEDULER] Rename failed for ${guild.name}: ${e.message}`);
        }
      }

      // ── Random Channel Name (Chaos) ──
      if (settings.experiments.random_name_chaos) {
        try {
          const newName = randomChars(Math.floor(Math.random() * 8) + 4);
          await channel.setName(newName, '[SpamTrap] Random chaos name experiment.');
          console.log(`[SCHEDULER] Chaos-renamed to #${newName} in ${guild.name}`);
        } catch (e) {
          console.log(`[SCHEDULER] Chaos rename failed for ${guild.name}: ${e.message}`);
        }
      }
    }
  });

  console.log('[SCHEDULER] Daily experiments cron registered.');
}

module.exports = { startScheduler };
