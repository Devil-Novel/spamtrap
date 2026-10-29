// Local-only scam link checks. Nothing leaves the process: no URL lookups, no
// redirect following, no attachment scanning. Heuristic results are reported
// as *suspected* phishing because they can be wrong.

// Domains Discord actually uses. A link that merely *looks* like one of these
// (lookalike spelling, extra words, different TLD) is the impersonation case.
const OFFICIAL_DISCORD_DOMAINS = [
  'discord.com', 'discordapp.com', 'discord.gg', 'discord.gift', 'discordapp.net',
  'discord.new', 'discord.media', 'discordstatus.com', 'dis.gd', 'discord.dev',
];

// TLDs accepted for *bare* hostnames (no scheme / no "www."). Links with a
// scheme are matched regardless of TLD. Kept deliberately short: it only
// exists so "discrod-nitro.gift" pasted without https:// is still noticed.
const BARE_TLDS = 'com|net|org|gg|gift|gifts|xyz|ru|io|tk|ml|cf|ga|gq|top|club|site|online|shop|link|app|dev|me|co|info|biz|live|fun|win|vip|pw|cc|cloud|host|page|website|store|lol|click|icu|buzz|rest|monster|cfd';

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]]+/gi;
const BARE_RE = new RegExp(`(?<![\\w@.])((?:[a-z0-9-]+\\.)+(?:${BARE_TLDS}))(?![\\w-])`, 'gi');

function normalizeHost(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.+$/, '')
    .split(':')[0];
}

// Exact host or a subdomain of it. "example.com" matches "a.example.com" but
// never "notexample.com" - the dot is required at the boundary.
function domainMatches(host, entry) {
  if (!host || !entry) return false;
  return host === entry || host.endsWith('.' + entry);
}
function inList(host, list) {
  return (list || []).some((e) => domainMatches(host, e));
}
function isOfficialDiscord(host) {
  return inList(host, OFFICIAL_DISCORD_DOMAINS);
}

// Pull hostnames out of free text. Returns unique, normalized hosts.
function extractHosts(text) {
  const hosts = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(URL_RE)) {
    let raw = m[0].replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    raw = raw.split(/[/?#]/)[0].split('@').pop();
    const h = normalizeHost(raw);
    if (h && h.includes('.')) hosts.add(h);
  }
  for (const m of s.matchAll(BARE_RE)) {
    const h = normalizeHost(m[1]);
    if (h) hosts.add(h);
  }
  return [...hosts];
}

// "d1sc0rd" -> "discord": collapse the usual digit/letter swaps and dashes so
// lookalikes land close to the real word.
function fold(label) {
  return label
    .toLowerCase()
    .replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't')
    .replace(/[^a-z]/g, '');
}
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}
// Any dot-separated label that contains "discord", or contains a 6-8 letter
// run that is one typo away from it, after folding. "discord-gifts.ru" ->
// "discordgifts" contains it; "dlscord.com" and "dlscord-gifts.ru" -> the
// run "dlscord" is distance 1. Whole short labels get a looser distance of 2
// ("dicsord"). Unrelated words stay clear: "discount" is distance 2 from
// "discord" in every window, so it is not flagged.
function looksLikeDiscord(host) {
  for (const label of host.split('.')) {
    const f = fold(label);
    if (!f) continue;
    if (f.includes('discord')) return true;
    if (f.length >= 5 && f.length <= 9 && editDistance(f, 'discord') <= 2) return true;
    for (const len of [6, 7, 8]) {
      for (let i = 0; i + len <= f.length; i++) {
        if (editDistance(f.slice(i, i + len), 'discord') <= 1) return true;
      }
    }
  }
  return false;
}
const NITRO_TEXT_RE = /\b(free|gift|giveaway|claim|airdrop)\b[^.\n]{0,40}\bnitro\b|\bnitro\b[^.\n]{0,40}\b(free|gift|giveaway|claim|airdrop)\b/i;

// Returns [{ host, reason, kind }] ; kind is "blocked" (list match, certain)
// or "suspected" (heuristic). Precedence: block list > allow list > heuristics.
function classifyText(text, cfg) {
  const hosts = extractHosts(text);
  if (!hosts.length) return [];
  const findings = [];
  const nitroWording = NITRO_TEXT_RE.test(String(text || ''));
  for (const host of hosts) {
    if (inList(host, cfg.blockedDomains)) {
      findings.push({ host, kind: 'blocked', reason: 'domain is on this server\'s block list' });
      continue;
    }
    if (inList(host, cfg.allowedDomains) || isOfficialDiscord(host)) continue;
    if (looksLikeDiscord(host)) {
      findings.push({ host, kind: 'suspected', reason: 'suspected Discord impersonation link (looks like a Discord domain but is not one)' });
      continue;
    }
    if (nitroWording || /nitro/i.test(host)) {
      findings.push({ host, kind: 'suspected', reason: 'suspected fake Nitro gift link (Nitro wording with a non-Discord link)' });
    }
  }
  return findings;
}

function hasLink(text) {
  return extractHosts(text).length > 0;
}

module.exports = { OFFICIAL_DISCORD_DOMAINS, extractHosts, normalizeHost, domainMatches, inList, looksLikeDiscord, classifyText, hasLink };
