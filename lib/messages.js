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
  '',
  '**Translations \u{1F310}**',
  '',
  '> \u{1F1E9}\u{1F1EA} **Deutsch**',
  '> **SENDE KEINE NACHRICHTEN IN DIESEM KANAL.** Dieser Kanal dient zur Erkennung von Spam-Bots. Jede hier gesendete Nachricht f\u00FChrt automatisch zu einem Softban.',
  '',
  '> \u{1F1EE}\u{1F1E9} **Bahasa Indonesia**',
  '> **JANGAN KIRIM PESAN DI CHANNEL INI.** Channel ini digunakan untuk mendeteksi bot spam. Pesan apa pun yang dikirim di sini akan otomatis mengakibatkan softban.',
  '',
  '> \u{1F1F2}\u{1F1FE} **Bahasa Melayu**',
  '> **JANGAN HANTAR MESEJ DI CHANNEL INI.** Saluran ini digunakan untuk mengesan bot spam. Sebarang mesej yang dihantar di sini akan mengakibatkan softban secara automatik.',
  '',
  '> \u{1F1E7}\u{1F1F7} **Portugu\u00EAs (Brasil)**',
  '> **N\u00C3O ENVIE MENSAGENS NESTE CANAL.** Este canal \u00E9 usado para detectar bots de spam. Qualquer mensagem enviada aqui resultar\u00E1 automaticamente em um soft ban.',
  '',
  '> \u{1F1F7}\u{1F1FA} **\u0420\u0443\u0441\u0441\u043A\u0438\u0439**',
  '> **\u041D\u0415 \u041E\u0422\u041F\u0420\u0410\u0412\u041B\u042F\u0419 \u0421\u041E\u041E\u0411\u0429\u0415\u041D\u0418\u042F \u0412 \u042D\u0422\u041E\u0422 \u041A\u0410\u041D\u0410\u041B.** \u042D\u0442\u043E\u0442 \u043A\u0430\u043D\u0430\u043B \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0434\u043B\u044F \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u0438\u044F \u0441\u043F\u0430\u043C-\u0431\u043E\u0442\u043E\u0432. \u041B\u044E\u0431\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435, \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u043E\u0435 \u0441\u044E\u0434\u0430, \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u0438\u0432\u0435\u0434\u0451\u0442 \u043A softban.',
  '',
  '> \u{1F1EA}\u{1F1F8} **Espa\u00F1ol**',
  '> **NO ENV\u00CDES MENSAJES EN ESTE CANAL.** Este canal se utiliza para detectar bots de spam. Cualquier mensaje enviado aqu\u00ED resultar\u00E1 autom\u00E1ticamente en un soft ban.',
  '',
  '> \u{1F1F8}\u{1F1E6} **\u0627\u0644\u0639\u0631\u0628\u064A\u0629**',
  '> **\u0644\u0627 \u062A\u0631\u0633\u0644 \u0631\u0633\u0627\u0626\u0644 \u0641\u064A \u0647\u0630\u0647 \u0627\u0644\u0642\u0646\u0627\u0629.** \u0647\u0630\u0647 \u0627\u0644\u0642\u0646\u0627\u0629 \u0645\u062E\u0635\u0635\u0629 \u0644\u0644\u0643\u0634\u0641 \u0639\u0646 \u0628\u0648\u062A\u0627\u062A \u0627\u0644\u0633\u0628\u0627\u0645. \u0623\u064A \u0631\u0633\u0627\u0644\u0629 \u062A\u0631\u0633\u0644\u0647\u0627 \u0647\u0646\u0627 \u0633\u062A\u0624\u062F\u064A \u062A\u0644\u0642\u0627\u0626\u064A\u0627\u064B \u0625\u0644\u0649 softban.',
].join('\n');

const DEFAULT_DM =
  '## Spam Trap Triggered \u{1FAA4}\n' +
  'Your account just sent a message in a monitored channel in **{{server:name}}**, which usually means the account may be **hacked or compromised**.\n' +
  'As a result, you have been **{{action:text}}**.\n' +
  '**What you should do:**\n' +
  '1. Change your Discord password immediately.\n' +
  '2. Enable **Two-Factor Authentication (2FA)** if you haven\'t already.\n' +
  '3. Remove any suspicious authorized apps (User Settings > Authorized Apps).\n' +
  'Once your account is secure, you are welcome to rejoin the server.';

const DEFAULT_LOG = '**{{action:text}}** in {{trap:channel:mention}}';

module.exports = { replaceVars, DEFAULT_WARNING, DEFAULT_DM, DEFAULT_LOG };
