// Shared custom-emoji map, used by index.js (bot replies/embeds) and by
// lib/trapChannel.js (warning/kick-counter embeds), so the dashboard's
// channel-setup endpoints post visually identical messages to the slash
// commands instead of a second, drifting copy of these ids.
module.exports = {
  done: '<:Done:1523817641653829774>',
  experiments: '<:Experiments:1524000040828539011>',
  safety: '<:ServerSafety:1524000037166645331>',
  time: '<:SavesTime:1524000035577135114>',
  easy: '<:EasytoUse:1524000034079768716>',
  multilingual: '<:MultilingualWarnings:1524000032771149824>',
  dashboard: '<:WebDashboard:1524000030556426354>',
  recovery: '<:AccountRecovery:1524000028689961060>',
  protection: '<:InstantProtection:1524000022830518272>',
  discord: '<:Discord:1524000021198930031>',
};
