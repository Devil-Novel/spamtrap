function replaceVars(template, data) {
  if (!template) return template;
  return template
    .replace(/{{action:text}}/g, data.actionText || '')
    .replace(/{{server:name:linked}}/g, data.serverNameLinked || data.serverName || '')
    .replace(/{{server:name}}/g, data.serverName || '')
    .replace(/{{trap:channel:link}}/g, data.trapChannelLink || '')
    .replace(/{{trap:channel:mention}}/g, data.trapChannelMention || '')
    .replace(/{{user:mention}}/g, data.userMention || '')
    .replace(/{{user:id}}/g, data.userId || '')
    .replace(/{{reinvite:link}}/g, data.reinviteLink || '')
    .replace(/{{trap:moderation-count}}/g, String(data.moderationCount || 0));
}

const DEFAULT_WARNING = [
  '## DO NOT SEND MESSAGES IN THIS CHANNEL',
  'This channel is used to detect spam bots. **Any message sent here will automatically result in a soft ban.**',
].join('\n');

// Shown separately now, via the "Translations" button on the trap channel
// message (ephemeral, only to whoever clicks it) instead of being baked into
// the warning embed every time - keeps the pinned message shorter. Not part
// of DEFAULT_WARNING, and not affected by a server's custom warning message:
// translations are fixed, bot-wide content, not something admins customize.
const TRANSLATIONS_TEXT = [
  '> \u{1F1E9}\u{1F1EA} **Deutsch**',
  '> **SENDE KEINE NACHRICHTEN IN DIESEM KANAL.** Dieser Kanal dient zur Erkennung von Spam-Bots. Jede hier gesendete Nachricht führt automatisch zu einem Softban.',
  '',
  '> \u{1F1EE}\u{1F1E9} **Bahasa Indonesia**',
  '> **JANGAN KIRIM PESAN DI CHANNEL INI.** Channel ini digunakan untuk mendeteksi bot spam. Pesan apa pun yang dikirim di sini akan otomatis mengakibatkan softban.',
  '',
  '> \u{1F1F2}\u{1F1FE} **Bahasa Melayu**',
  '> **JANGAN HANTAR MESEJ DI CHANNEL INI.** Saluran ini digunakan untuk mengesan bot spam. Sebarang mesej yang dihantar di sini akan mengakibatkan softban secara automatik.',
  '',
  '> \u{1F1E7}\u{1F1F7} **Português (Brasil)**',
  '> **NÃO ENVIE MENSAGENS NESTE CANAL.** Este canal é usado para detectar bots de spam. Qualquer mensagem enviada aqui resultará automaticamente em um soft ban.',
  '',
  '> \u{1F1F7}\u{1F1FA} **Русский**',
  '> **НЕ ОТПРАВЛЯЙ СООБЩЕНИЯ В ЭТОТ КАНАЛ.** Этот канал используется для обнаружения спам-ботов. Любое сообщение, отправленное сюда, автоматически приведёт к softban.',
  '',
  '> \u{1F1EA}\u{1F1F8} **Español**',
  '> **NO ENVÍES MENSAJES EN ESTE CANAL.** Este canal se utiliza para detectar bots de spam. Cualquier mensaje enviado aquí resultará automáticamente en un soft ban.',
  '',
  '> \u{1F1F8}\u{1F1E6} **العربية**',
  '> **لا ترسل رسائل في هذه القناة.** هذه القناة مخصصة للكشف عن بوتات السبام. أي رسالة ترسلها هنا ستؤدي تلقائياً إلى softban.',
].join('\n');

const DEFAULT_DM =
  '## Spam Trap Triggered \u{1FAA4}\n' +
  'Your account just sent a message in a monitored channel in **{{server:name}}**, which usually means it may be **hacked or compromised**. As a result, you have been **{{action:text}}**.\n\n' +
  'Before doing anything else, please change your Discord password, turn on Two-Factor Authentication if you haven\'t already, and remove any authorized apps you don\'t recognize under User Settings.';

const DEFAULT_LOG = '**{{action:text}}** in {{trap:channel:mention}}';

module.exports = { replaceVars, DEFAULT_WARNING, TRANSLATIONS_TEXT, DEFAULT_DM, DEFAULT_LOG };
