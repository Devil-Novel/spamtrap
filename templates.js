// ── Custom Emoji ──
const EMOJI = '<:Done:1523817641653829774>';

// ── Pinned channel warning (sent once when the trap is set) ──

const CHANNEL_WARNING = [
  '## DO NOT SEND MESSAGES IN THIS CHANNEL',
  'This channel is used to detect spam bots. **Any message sent here will automatically result in a soft ban.**',
  '> Translations \u{1F310}',
  '> \u{1F1E9}\u{1F1EA} **Deutsch**',
  '> **SENDE KEINE NACHRICHTEN IN DIESEM KANAL.** Dieser Kanal dient zur Erkennung von Spam-Bots. Jede hier gesendete Nachricht f\u00FChrt automatisch zu einem Softban.',
  '> \u{1F1EE}\u{1F1E9} **Bahasa Indonesia**',
  '> **JANGAN KIRIM PESAN DI CHANNEL INI.** Channel ini digunakan untuk mendeteksi bot spam. Pesan apa pun yang dikirim di sini akan otomatis mengakibatkan softban.',
  '> \u{1F1F2}\u{1F1FE} **Bahasa Melayu**',
  '> **JANGAN HANTAR MESEJ DI CHANNEL INI.** Saluran ini digunakan untuk mengesan bot spam. Sebarang mesej yang dihantar di sini akan mengakibatkan softban secara automatik.',
  '> \u{1F1E7}\u{1F1F7} **Portugu\u00EAs (Brasil)**',
  '> **N\u00C3O ENVIE MENSAGENS NESTE CANAL.** Este canal \u00E9 usado para detectar bots de spam. Qualquer mensagem enviada aqui resultar\u00E1 automaticamente em um soft ban.',
  '> \u{1F1F7}\u{1F1FA} **\u0420\u0443\u0441\u0441\u043A\u0438\u0439**',
  '> **\u041D\u0415 \u041E\u0422\u041F\u0420\u0410\u0412\u041B\u042F\u0419 \u0421\u041E\u041E\u0411\u0429\u0415\u041D\u0418\u042F \u0412 \u042D\u0422\u041E\u0422 \u041A\u0410\u041D\u0410\u041B.** \u042D\u0442\u043E\u0442 \u043A\u0430\u043D\u0430\u043B \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u0434\u043B\u044F \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u0438\u044F \u0441\u043F\u0430\u043C-\u0431\u043E\u0442\u043E\u0432. \u041B\u044E\u0431\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435, \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u043E\u0435 \u0441\u044E\u0434\u0430, \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043F\u0440\u0438\u0432\u0435\u0434\u0451\u0442 \u043A softban.',
  '> \u{1F1EA}\u{1F1F8} **Espa\u00F1ol**',
  '> **NO ENV\u00CDES MENSAJES EN ESTE CANAL.** Este canal se utiliza para detectar bots de spam. Cualquier mensaje enviado aqu\u00ED resultar\u00E1 autom\u00E1ticamente en un soft ban.',
].join('\n');

// ── Default Templates ──

const DEFAULTS = {
  warning: CHANNEL_WARNING,

  dm: [
    '## Spam Trap Triggered\n',
    'You have been **{{action:text}}** from **{{server:name}}** for sending a message in the [trap]({{trap:channel:link}}) channel.\n',
    'It looks like your account may have been **hacked or compromised**.\n',
    '**What you should do:**',
    '1. Change your Discord password immediately.',
    '2. Enable **Two-Factor Authentication (2FA)** if you haven\'t already.',
    '3. Remove any suspicious authorized apps (User Settings > Authorized Apps).',
    '{{reinvite:block}}',
  ].join('\n'),

  log: '{{user:mention}} was **{{action:text}}** for triggering the spam trap in {{trap:channel:mention}}\n-# User ID: `{{user:id}}`',
};

// ── Action Text Map ──

const ACTION_TEXT = {
  softban: 'soft-banned (kicked + messages removed)',
  ban: 'permanently banned',
  disabled: 'disabled (no action taken)',
};

// ── Variable Replacement ──

function render(template, vars) {
  if (!template) return null;

  let result = template;

  // {{action:text}}
  result = result.replace(/\{\{action:text\}\}/g, ACTION_TEXT[vars.action] || vars.action);

  // {{server:name}}
  result = result.replace(/\{\{server:name\}\}/g, vars.serverName || 'Unknown Server');

  // {{server:name:linked}}
  if (vars.serverVanity) {
    result = result.replace(
      /\{\{server:name:linked\}\}/g,
      `[${vars.serverName}](https://discord.gg/${vars.serverVanity})`
    );
  } else {
    result = result.replace(/\{\{server:name:linked\}\}/g, vars.serverName || 'Unknown Server');
  }

  // {{server:public-link}}
  result = result.replace(
    /\{\{server:public-link\}\}/g,
    vars.serverVanity ? `https://discord.gg/${vars.serverVanity}` : ''
  );

  // {{trap:channel:link}}
  result = result.replace(
    /\{\{trap:channel:link\}\}/g,
    vars.channelLink || '#unknown'
  );

  // {{trap:channel:mention}}
  result = result.replace(
    /\{\{trap:channel:mention\}\}/g,
    vars.channelId ? `<#${vars.channelId}>` : '#unknown'
  );

  // {{user:mention}}
  result = result.replace(
    /\{\{user:mention\}\}/g,
    vars.userId ? `<@${vars.userId}>` : '@unknown'
  );

  // {{user:id}}
  result = result.replace(/\{\{user:id\}\}/g, vars.userId || '0');

  // {{reinvite:link}}
  result = result.replace(
    /\{\{reinvite:link\}\}/g,
    vars.inviteLink || ''
  );

  // {{reinvite:block}} -- full block with invite if available
  if (vars.inviteLink) {
    result = result.replace(
      /\{\{reinvite:block\}\}/g,
      `\n**You are welcome back!** Once your account is secure, rejoin here: ${vars.inviteLink}`
    );
  } else {
    result = result.replace(/\{\{reinvite:block\}\}/g, '');
  }

  // {{trap:moderation-count}}
  result = result.replace(
    /\{\{trap:moderation-count\}\}/g,
    String(vars.moderationCount || 0)
  );

  return result.trim();
}

module.exports = { DEFAULTS, CHANNEL_WARNING, ACTION_TEXT, EMOJI, render };
