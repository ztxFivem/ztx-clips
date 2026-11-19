// Postet einen Changelog-Eintrag über den Webhook in den Discord-Kanal #changelog.
// Läuft in GitHub Actions (siehe .github/workflows/discord-changelog.yml in den Repos), geht aber auch lokal:
//
//   Release-Modus (ZTX Bot Studio, ZTX Clips – bei jeder veröffentlichten Release):
//     NAME, EMOJI, COLOR, TAG, URL, BODY, LINK  (+ WEBHOOK, ROLE)
//   Datei-Modus (Repo ztx-changelog – bei jedem Push): node discord-changelog.js --files
//     Neue „## 1.2.3 – TT.MM.JJJJ“-Abschnitte in den .md-Dateien (gegenüber dem vorherigen Commit) werden gepostet.
//   Einzelne Datei/Version von Hand:  node discord-changelog.js --file status.md --version 1.3.2
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WEBHOOK = process.env.WEBHOOK;
const ROLE = process.env.ROLE || '';
if (!WEBHOOK) { console.error('WEBHOOK fehlt (GitHub-Secret DISCORD_CHANGELOG_WEBHOOK).'); process.exit(1); }

// Programme im Repo ztx-changelog (Dateiname → Anzeige)
const FILES = {
  'status.md': { name: 'ZTX Status', emoji: '💬', color: 0xF39C12, link: 'https://discord.com/channels/1355586399906173060/1561993359604584448' },
  'screen-capture.md': { name: 'ZTX Screen Capture', emoji: '📸', color: 0x1ABC9C, link: 'https://discord.com/channels/1355586399906173060/1564677474996977734' },
  'converter.md': { name: 'ZTX Converter', emoji: '🔄', color: 0x9B59B6, link: '' },
  'server.md': { name: 'Server & Bots', emoji: '🛠️', color: 0x5865F2, link: '' },
};

function cleanBody(body) {
  return String(body || '').replace(/\r/g, '')
    .split('\n')
    .filter((l) => !/^\s*\*\*Download:?\*\*/i.test(l) && !/^\s*Lizenz\s*&\s*Support:/i.test(l) && !/^\s*#{1,3}\s*Neu in v?\d/i.test(l))
    .join('\n')
    .replace(/^#{1,2}\s+/gm, '### ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3800) || '› Verbesserungen und Fehlerbehebungen';
}

async function post({ name, emoji, color, version, body, url, link, date }) {
  const isServer = name === 'Server & Bots';
  const embed = {
    title: isServer ? `${emoji} ${version}` : `${emoji} ${name} · Version ${version}`,
    url: url || undefined,
    description: cleanBody(body),
    color: Number(color) || 0xF1C40F,
    footer: { text: isServer ? 'ZTX Updates' : 'ZTX Updates · Das Programm zeigt dir die Neuerungen auch selbst an' },
    timestamp: new Date(date || Date.now()).toISOString(),
  };
  const buttons = [];
  if (url) buttons.push({ type: 2, style: 5, label: 'Details & Download', emoji: { name: '⬇️' }, url });
  if (link) buttons.push({ type: 2, style: 5, label: `Zu ${name}`, emoji: { name: emoji }, url: link });
  const payload = {
    content: ROLE ? `<@&${ROLE}>` : '',
    embeds: [embed],
    allowed_mentions: { roles: ROLE ? [ROLE] : [] },
    components: buttons.length ? [{ type: 1, components: buttons }] : [],
  };
  let res = await fetch(`${WEBHOOK}?wait=true&with_components=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok && buttons.length) { // Falls Knöpfe nicht erlaubt sind: ohne Knöpfe nochmal
    console.warn('Mit Knöpfen nicht möglich:', res.status, await res.text());
    delete payload.components;
    res = await fetch(`${WEBHOOK}?wait=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  }
  if (!res.ok) throw new Error(`Discord: HTTP ${res.status} ${await res.text()}`);
  console.log(`✓ Gepostet: ${embed.title}`);
}

// Abschnitte einer CHANGELOG-Datei: [{ version, date, body }]
function sections(text) {
  text = String(text).replace(/\r/g, '');
  const heads = [...text.matchAll(/^##\s+v?([\w.\- ]+?)(?:\s+[–-]\s+(\d{1,2}\.\d{1,2}\.\d{4}))?\s*$/gm)];
  return heads.map((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const d = (m[2] || '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    return { version: m[1].trim(), date: d ? Date.UTC(+d[3], +d[2] - 1, +d[1], 12) : null, body: text.slice(m.index + m[0].length, end).trim() };
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--files')) {
    // neue Überschriften seit dem letzten Commit finden
    let diff = '';
    try { diff = execSync('git diff --unified=0 HEAD~1 HEAD -- "*.md"', { encoding: 'utf8' }); } catch { diff = ''; }
    let file = null;
    const todo = [];
    for (const line of diff.split('\n')) {
      const f = line.match(/^\+\+\+ b\/(.+)$/);
      if (f) { file = path.basename(f[1]); continue; }
      const h = line.match(/^\+##\s+v?([\w.\- ]+?)(?:\s+[–-]\s+\d{1,2}\.\d{1,2}\.\d{4})?\s*$/);
      if (h && file && FILES[file]) todo.push({ file, version: h[1].trim() });
    }
    if (!todo.length) { console.log('Keine neuen Einträge.'); return; }
    for (const t of todo) {
      const s = sections(fs.readFileSync(t.file, 'utf8')).find((x) => x.version === t.version);
      if (s) await post({ ...FILES[t.file], ...s });
    }
    return;
  }
  const fi = args.indexOf('--file');
  if (fi >= 0) {
    const file = args[fi + 1];
    const v = args[args.indexOf('--version') + 1];
    const all = sections(fs.readFileSync(file, 'utf8'));
    const s = args.includes('--version') ? all.find((x) => x.version === v) : all[0];
    if (!s) throw new Error(`Version ${v} nicht in ${file} gefunden`);
    return post({ ...FILES[path.basename(file)], ...s });
  }
  // Release-Modus
  const { NAME, EMOJI, COLOR, TAG, URL, BODY, LINK } = process.env;
  await post({ name: NAME, emoji: EMOJI || '📦', color: COLOR, version: String(TAG || '').replace(/^v/i, ''), body: BODY, url: URL, link: LINK });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
