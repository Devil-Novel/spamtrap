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
//
// Data-driven on purpose: adding a language is one entry here instead of
// hand-formatting a string block and risking a typo'd `>` or missing blank
// line. TRANSLATIONS_TEXT below is generated from this list, so every entry
// automatically gets identical formatting (flag + bold name, then a bold
// all-caps warning + explanation, same as the rest).
const TRANSLATIONS = [
  { flag: '\u{1F1E9}\u{1F1EA}', name: 'Deutsch', warning: 'SENDE KEINE NACHRICHTEN IN DIESEM KANAL.', body: 'Dieser Kanal dient zur Erkennung von Spam-Bots. Jede hier gesendete Nachricht führt automatisch zu einem Softban.' },
  { flag: '\u{1F1EE}\u{1F1E9}', name: 'Bahasa Indonesia', warning: 'JANGAN KIRIM PESAN DI CHANNEL INI.', body: 'Channel ini digunakan untuk mendeteksi bot spam. Pesan apa pun yang dikirim di sini akan otomatis mengakibatkan softban.' },
  { flag: '\u{1F1F2}\u{1F1FE}', name: 'Bahasa Melayu', warning: 'JANGAN HANTAR MESEJ DI CHANNEL INI.', body: 'Saluran ini digunakan untuk mengesan bot spam. Sebarang mesej yang dihantar di sini akan mengakibatkan softban secara automatik.' },
  { flag: '\u{1F1E7}\u{1F1F7}', name: 'Português (Brasil)', warning: 'NÃO ENVIE MENSAGENS NESTE CANAL.', body: 'Este canal é usado para detectar bots de spam. Qualquer mensagem enviada aqui resultará automaticamente em um soft ban.' },
  { flag: '\u{1F1F7}\u{1F1FA}', name: 'Русский', warning: 'НЕ ОТПРАВЛЯЙ СООБЩЕНИЯ В ЭТОТ КАНАЛ.', body: 'Этот канал используется для обнаружения спам-ботов. Любое сообщение, отправленное сюда, автоматически приведёт к softban.' },
  { flag: '\u{1F1EA}\u{1F1F8}', name: 'Español', warning: 'NO ENVÍES MENSAJES EN ESTE CANAL.', body: 'Este canal se utiliza para detectar bots de spam. Cualquier mensaje enviado aquí resultará automáticamente en un soft ban.' },
  { flag: '\u{1F1F8}\u{1F1E6}', name: 'العربية', warning: 'لا ترسل رسائل في هذه القناة.', body: 'هذه القناة مخصصة للكشف عن بوتات السبام. أي رسالة ترسلها هنا ستؤدي تلقائياً إلى softban.' },
  { flag: '\u{1F1E8}\u{1F1F3}', name: '中文', warning: '请勿在此频道发送消息。', body: '此频道用于检测垃圾邮件机器人。在此发送的任何消息都将自动导致 softban。' },
  { flag: '\u{1F1F0}\u{1F1F7}', name: '한국어', warning: '이 채널에 메시지를 보내지 마세요.', body: '이 채널은 스팸 봇을 탐지하는 데 사용됩니다. 여기에 전송된 모든 메시지는 자동으로 softban 처리됩니다.' },
  { flag: '\u{1F1EB}\u{1F1F7}', name: 'Français', warning: "N'ENVOYEZ PAS DE MESSAGES DANS CE SALON.", body: 'Ce salon sert à détecter les bots de spam. Tout message envoyé ici entraînera automatiquement un softban.' },
];

const TRANSLATIONS_TEXT = TRANSLATIONS.map((t) => `> ${t.flag} **${t.name}**\n> **${t.warning}** ${t.body}`).join('\n\n');

const DEFAULT_DM =
  '## Spam Trap Triggered \u{1FAA4}\n' +
  'Your account just sent a message in a monitored channel in **{{server:name}}**, which usually means it may be **hacked or compromised**. As a result, you have been **{{action:text}}**.\n\n' +
  'Before doing anything else, please change your Discord password, turn on Two-Factor Authentication if you haven\'t already, and remove any authorized apps you don\'t recognize under User Settings.';

const DEFAULT_LOG = '**{{action:text}}** in {{trap:channel:mention}}';

module.exports = { replaceVars, DEFAULT_WARNING, TRANSLATIONS_TEXT, DEFAULT_DM, DEFAULT_LOG };
