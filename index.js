const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
require('dotenv').config();

// ==== الإعدادات ====
const TARGET_GUILD_ID = process.env.GUILD_ID || '1025348384900522004';
const TARGET_CHANNEL_ID = process.env.CHANNEL_ID || '1520799402883809382';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

// الرسايل اللي هتظهر في الستيت بالتبادل
const STATUSES = ['MEM DEVELOPMENT', 'Spam Trap'];
let statusIndex = 0;

function rotateStatus() {
  client.user.setActivity(STATUSES[statusIndex], { type: 4 }); // type 4 = Custom Status
  statusIndex = (statusIndex + 1) % STATUSES.length;
}

client.once('ready', () => {
  console.log(`✅ البوت شغال دلوقتي باسم: ${client.user.tag}`);
  console.log(`🎯 السيرفر المستهدف: ${TARGET_GUILD_ID}`);
  console.log(`🎯 القناة الممنوعة: ${TARGET_CHANNEL_ID}`);

  rotateStatus(); // أول ستيت فور ما البوت يشتغل
  setInterval(rotateStatus, 10 * 1000); // يبدل كل 10 ثواني - غيّر الرقم لو عايز وقت مختلف
});

client.on('messageCreate', async (message) => {
  try {
    // تجاهل رسايل البوتات
    if (message.author.bot) return;

    // لازم يكون في نفس السيرفر ونفس القناة المحددين
    if (!message.guild || message.guild.id !== TARGET_GUILD_ID) return;
    if (message.channel.id !== TARGET_CHANNEL_ID) return;

    const member = message.member;
    if (!member) return;

    // استثناء الأدمن من الطرد (لو عايز تشيل الاستثناء امسح السطرين دول)
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return;
    }

    // 1) امسح الرسالة
    if (message.deletable) {
      await message.delete().catch(() => {});
    }

    // 2) اطرد العضو من السيرفر
    if (member.kickable) {
      await member.kick('Wrote in a restricted channel').catch((err) => {
        console.error('❌ فشل في طرد العضو:', err.message);
      });

      // رسالة تنبيه في القناة (بتتمسح لوحدها بعد شوية)
      try {
        const notice = await message.channel.send(
          `🚫 <@${member.id}> has been kicked for writing in this channel.`
        );
        setTimeout(() => notice.delete().catch(() => {}), 5000);
      } catch (_) {}
    } else {
      console.log(`⚠️ مقدرتش أطرد ${member.user.tag} - صلاحيات البوت مش كفاية أو رتبته أعلى من رتبة البوت`);
    }
  } catch (err) {
    console.error('حصل خطأ غير متوقع:', err);
  }
});

client.login(process.env.BOT_TOKEN);
