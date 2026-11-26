// Draws style.json as a page, so the look can be judged without recording anything: for each
// theme its colours, a title card, a moment in the app with every kind of on-screen text, a
// closing card and a cover, side by side. Everything on the page is drawn from style.json; change
// a value there and run this again.
//
//   node docs-site/video/kit/board.mjs        -> kit/out/style-board.html, cover-classic.jpg, cover-next.jpg
//
// The page has no <html> or <body> of its own: it opens in a browser as it is, and can be
// published as it is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadStyle, renderCover, dataUri } from './cover.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const DOCS = path.join(HERE, '..', '..');
// The one mark, for both themes (brand/ivoryos-logo.ai is its source).
const MARK = path.join(DOCS, 'src', 'assets', 'ivoryos-mark.svg');
const style = loadStyle();
const L = style.shared.layout;

// What each theme is shown with. Positions are in the 1280x720 layout, over that picture.
const SAMPLES = {
  classic: {
    app: path.join(HERE, 'samples', 'classic-app.jpg'),
    cover: { kind: 'tutorial', headline: 'Getting started', points: ['Your instruments as Python classes', 'Design, run and track workflows', 'No front-end code to write'] },
    title: { kicker: 'IvoryOS tutorial', title: 'Getting started with IvoryOS', sub: 'From a few Python classes to a lab you can control, script and run from the browser.' },
    closing: { kicker: 'Try it', title: 'pip install ivoryos', sub: '' },
    caption: { tag: 'new', tagText: 'New · !223', title: 'Dict arguments get a table editor', text: '`dispense(recipe_ul: Dict[str, float])`: one row per dye, or switch to JSON.' },
    ring: { x: 396, y: 200, w: 612, h: 36 },
    pointer: { x: 700, y: 262 },
    chapter: 'Build a workflow',
  },
  next: {
    app: path.join(DOCS, 'src', 'assets', 'screenshots', 'designer-workflow.png'),
    cover: { kind: 'tutorial', headline: 'Getting started', points: ['A lab from the Automation Hub', 'Design a workflow, then run it', 'Every result kept as data'] },
    title: { kicker: '', title: 'Getting started with IvoryOS', sub: 'From the Automation Hub to your first results' },
    closing: { kicker: '', title: 'Documentation', sub: 'Link in the description' },
    caption: { tag: 'new', tagText: 'New', title: 'A value that stays open', text: 'Start it with `#` and give it a name: it is asked for when the workflow runs.' },
    ring: { x: 684, y: 331, w: 190, h: 25 },
    pointer: { x: 792, y: 368 },
    chapter: 'Design a workflow',
  },
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const marked = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
// A length of the 1280-wide layout, as a share of the frame it is drawn in.
const u = (px) => `${(px / (L.width / 100)).toFixed(3)}cqw`;
const jpeg = async (file, width) => `data:image/jpeg;base64,${(await sharp(file).resize({ width }).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()).toString('base64')}`;

/** The rules that draw one theme's frames, every value from style.json. */
function themeCss(key, t) {
  const s = `.t-${key}`;
  const c = t.card;
  const cap = t.caption;
  const tag = t.tag;
  const left = c.align === 'left';
  return `
${s} .stage{font-family:${t.font.family};color:${t.color.text}}
${s} .card{background:${c.background};align-items:${left ? 'flex-start' : 'center'};text-align:${c.align};padding:0 ${left ? u(115) : u(90)}}
${s} .card .bar{width:${u(c.bar?.width ?? 0)};height:${u(c.bar?.height ?? 0)};border-radius:${u(2)};background:${c.bar?.color ?? 'none'};margin-bottom:${u(26)}}
${s} .card .kicker{font-size:${u(c.kicker.size)};font-weight:${c.kicker.weight};letter-spacing:${c.kicker.tracking};color:${c.kicker.color};${c.kicker.uppercase ? 'text-transform:uppercase;' : ''}}
${s} .card h3{font-size:${u(c.title.size)};font-weight:${c.title.weight};letter-spacing:${c.title.tracking};line-height:1.05;margin:${u(12)} 0}
${s} .card .sub{font-size:${u(c.sub.size)};font-weight:${c.sub.weight};color:${c.sub.color};line-height:1.45;max-width:${u(960)}}
${s} .card .foot{position:absolute;bottom:${u(40)};${left ? `left:${u(115)}` : 'left:0;right:0;justify-content:center'};display:flex;align-items:center;gap:${u(14)};font-size:${u(c.foot.size)};color:${c.foot.color}}
${s} .card .foot img{height:${u(34)};${c.foot.logo === 'tile' ? `background:#fff;border-radius:${u(6)};padding:${u(2)}` : ''}}
${s} .caption{bottom:${u(cap.edge.bottom)};max-width:${u(cap.maxWidth)};background:${cap.background};border-radius:${u(cap.radius)};padding:${cap.padding.split(' ').map((p) => u(parseFloat(p))).join(' ')};box-shadow:${cap.shadow}}
${s} .caption .title{font-size:${u(cap.title.size)};font-weight:${cap.title.weight};color:${cap.title.color}}
${s} .caption .text{font-size:${u(cap.text.size)};font-weight:${cap.text.weight};color:${cap.text.color};margin-top:${u(5)};line-height:1.45}
${s} .caption code{font-family:${t.font.mono};font-size:.92em;color:${t.color.code};background:rgba(148,163,184,.2);padding:0 ${u(6)};border-radius:${u(5)}}
${s} .tag{font-size:${u(tag.size)};font-weight:${tag.weight};letter-spacing:${tag.tracking};${tag.uppercase ? 'text-transform:uppercase;' : ''}padding:${u(3)} ${u(9)};border-radius:999px;margin-right:${u(10)};vertical-align:${u(3)};color:${tag.text};${tag.shape === 'filled' ? `background:${tag.new}` : `box-shadow:inset 0 0 0 1px ${tag.new}`}}
${s} .tag.fix{${tag.shape === 'filled' ? `background:${tag.fix}` : `box-shadow:inset 0 0 0 1px ${tag.fix}`}}
${s} .tag.qol{${tag.shape === 'filled' ? `background:${tag.qol}` : `box-shadow:inset 0 0 0 1px ${tag.qol}`}}
${s} .ring{border:${u(t.ring.width)} solid ${t.ring.color};border-radius:${u(t.ring.radius)};${t.ring.glow ? `box-shadow:0 0 0 ${u(4)} ${t.ring.color}38,0 0 ${u(22)} ${t.ring.color}66` : ''}}
${s} .ripple{width:${u(38)};height:${u(38)};margin:${u(-19)} 0 0 ${u(-19)};border:${u(3)} solid ${t.click.color};background:${t.click.color}22}
${s} .pointer{width:${u(t.pointer.size)}}
${t.chapter.onScreen ? `${s} .chip{top:${u(6)};height:${u(t.chapter.height)};border-radius:${u(t.chapter.radius)};background:${t.chapter.background};font-size:${u(t.chapter.size)};padding:0 ${u(16)} 0 ${u(14)};gap:${u(10)}}
${s} .chip i{width:${u(9)};height:${u(9)};background:${t.chapter.dot}}` : `${s} .chip{display:none}`}`;
}

const card = (t, logo, { kicker, title, sub }, foot) => `
  <div class="frame"><div class="stage card">
    ${t.card.bar ? '<div class="bar"></div>' : ''}
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
    <h3>${esc(title)}</h3>
    ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
    <div class="foot"><img src="${logo}" alt=""><span>${esc(foot)}</span></div>
  </div></div>`;

const app = (t, s, picture) => `
  <div class="frame"><div class="stage">
    <img class="app" src="${picture}" alt="">
    <div class="chip"><i></i>${esc(s.chapter)}</div>
    <div class="ring" style="left:${u(s.ring.x)};top:${u(s.ring.y)};width:${u(s.ring.w)};height:${u(s.ring.h)}"></div>
    <div class="ripple" style="left:${u(s.pointer.x)};top:${u(s.pointer.y)}"></div>
    <svg class="pointer" viewBox="0 0 24 26" style="left:${u(s.pointer.x - 3)};top:${u(s.pointer.y - 2)}"><path d="${t.pointer.path}" fill="${t.pointer.fill}" stroke="${t.pointer.stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <div class="caption"><div class="title"><span class="tag ${s.caption.tag}">${esc(s.caption.tagText)}</span>${marked(s.caption.title)}</div><div class="text">${marked(s.caption.text)}</div></div>
  </div></div>`;

const swatches = (t) => `<div class="swatches">${Object.entries(t.color).map(([name, value]) => `
    <div class="swatch"><i style="background:${value}"></i><b>${name}</b><span>${esc(value)}</span></div>`).join('')}</div>`;

const row = (label, note, cells) => `
  <section class="row">
    <div class="rowhead"><h2>${label}</h2><p>${note}</p></div>
    <div class="pair">${Object.keys(style.themes).map((k) => `<div class="cell t-${k}"><div class="who">${esc(style.themes[k].label)}</div>${cells[k]}</div>`).join('')}</div>
  </section>`;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const cells = { summary: {}, colour: {}, title: {}, app: {}, closing: {}, cover: {} };
  const notes = [];
  for (const [key, t] of Object.entries(style.themes)) {
    const s = SAMPLES[key];
    const out = path.join(OUT, `cover-${key}.jpg`);
    const made = await renderCover({ theme: key, ...s.cover, shot: s.app, logo: MARK, out });
    notes.push(...made.notes);
    const logo = dataUri(MARK);
    cells.colour[key] = `<p class="summary">${esc(t.summary)}</p>${swatches(t)}`;
    cells.title[key] = card(t, logo, s.title, t.product.tagline);
    cells.app[key] = app(t, s, await jpeg(s.app, 1280));
    cells.closing[key] = card(t, logo, s.closing, t.product.tagline);
    cells.cover[key] = `<img class="cover" src="${await jpeg(out, 1280)}" alt="The ${esc(t.label)} cover">`;
  }
  const sh = style.shared;
  const kinds = Object.entries(sh.onScreenText.kinds).map(([name, k]) => {
    const limits = Object.entries(k).filter(([f]) => f !== 'for').map(([f, v]) => `${f.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${typeof v === 'object' ? Object.values(v).join(', ') : v}`).join(' · ');
    return `<tr><th>${name}</th><td>${esc(k.for)}</td><td class="num">${esc(limits)}</td></tr>`;
  }).join('');
  const facts = [
    ['Frame', `${sh.frame.width}×${sh.frame.height}, ${sh.frame.fps} frames a second`],
    ['Voice', `${sh.voice.engine} ${sh.voice.voice}, speed ${sh.voice.speed}; ${Object.entries(sh.voice.pronounce).map(([a, b]) => `“${a}” said “${b}”`).join(', ')}`],
    ['Loudness', `${sh.audio.loudnessLufs} LUFS, peak ${sh.audio.truePeakDb} dB, ${sh.audio.codec.toUpperCase()} ${sh.audio.bitrateKbps}k`],
    ['Reading pace', `${sh.pacing.readSecondsPerWord} s a word on a caption; a ring held ${sh.pacing.ringHoldS.join(' to ')} s`],
    ['Subtitles', `cues of ${sh.subtitles.maxCueChars} characters at most, ${sh.subtitles.maxLines} lines of ${sh.subtitles.maxLineChars}`],
    ['Chapters', `“${sh.chapters.first}” at 0:00, at least ${sh.chapters.minCount}, each ${sh.chapters.minSeconds} s or longer`],
    ['Cover', `${sh.cover.width * sh.cover.scale}×${sh.cover.height * sh.cover.scale} JPEG under ${sh.cover.maxBytes / 1e6} MB; ${sh.cover.pointsMax} points of ${sh.cover.pointMaxChars} characters`],
  ].map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('');

  const html = `<meta name="claude:viewport-fit-sides" content="cover">
<title>IvoryOS Video Style</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap">
<style>
/* One column of rows; each row is one element of a video, drawn in both themes side by side. */
:root{--bg:#f5f6f8;--surface:#ffffff;--fg:#17191e;--soft:#566170;--line:#dde2e8;--accent:#4a6280;
  --sans:"Geist","Segoe UI","Helvetica Neue",system-ui,sans-serif;--mono:"Geist Mono",ui-monospace,Consolas,monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#11151c;--surface:#181e27;--fg:#eceef2;--soft:#9aa5b3;--line:#2a323e;--accent:#a9bed5;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#11151c;--surface:#181e27;--fg:#eceef2;--soft:#9aa5b3;--line:#2a323e;--accent:#a9bed5;color-scheme:dark}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--fg);font-family:var(--sans);font-size:15px;line-height:1.5}
.wrap{max-width:1240px;margin:0 auto;padding-block:40px 64px;padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:44px}
header h1{font-size:30px;font-weight:600;letter-spacing:-.02em;margin:0 0 6px;text-wrap:balance}
header p{margin:0;color:var(--soft);max-width:68ch}
.row{display:flex;flex-direction:column;gap:14px}
.rowhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px}
h2{font-size:17px;font-weight:600;margin:0;letter-spacing:-.01em}
.rowhead p{margin:0;color:var(--soft);font-size:14px}
.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.cell{min-width:0;display:flex;flex-direction:column;gap:8px}
.who{font-size:12.5px;font-weight:500;color:var(--soft);letter-spacing:.02em}
.summary{margin:0;font-size:14.5px;max-width:52ch}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:8px}
.swatch{display:grid;grid-template-columns:28px 1fr;column-gap:9px;align-items:center;font-size:12.5px;line-height:1.3}
.swatch i{grid-row:span 2;width:28px;height:28px;border-radius:7px;box-shadow:inset 0 0 0 1px var(--line)}
.swatch b{font-weight:500}
.swatch span{font-family:var(--mono);font-size:11px;color:var(--soft);overflow-wrap:anywhere}
.frame{container-type:inline-size;aspect-ratio:16/9;max-width:100%;position:relative;overflow:hidden;border-radius:8px;box-shadow:0 0 0 1px var(--line)}
.stage{position:absolute;inset:0}
.card{display:flex;flex-direction:column;justify-content:center}
.card h3{margin:0}
.app{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:left top;max-width:none}
.caption{position:absolute;left:50%;transform:translateX(-50%);width:max-content}
.tag{display:inline-block}
.ring,.ripple,.pointer,.chip{position:absolute}
.ripple{border-radius:50%;opacity:.85}
.pointer{filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));overflow:visible}
.chip{left:50%;transform:translateX(-50%);display:flex;align-items:center;white-space:nowrap}
.chip i{border-radius:50%}
.cover{display:block;width:100%;border-radius:8px;box-shadow:0 0 0 1px var(--line)}
.tablewrap{overflow-x:auto;background:var(--surface);border-radius:10px;box-shadow:0 0 0 1px var(--line)}
table{border-collapse:collapse;width:100%;min-width:620px;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:9px 14px;border-top:1px solid var(--line)}
tr:first-child th,tr:first-child td{border-top:0}
tbody th{font-weight:600;white-space:nowrap}
td.num{font-family:var(--mono);font-size:12px;color:var(--soft)}
ol.rules{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;max-width:78ch}
dl{margin:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px 28px}
dt{font-size:12.5px;color:var(--soft);font-weight:500}
dd{margin:0}
@media (max-width:760px){.pair{grid-template-columns:minmax(0,1fr)}header h1{font-size:25px}}
${Object.entries(style.themes).map(([k, t]) => themeCss(k, t)).join('\n')}
</style>
<main class="wrap">
  <header>
    <h1>IvoryOS video style</h1>
    <p>Every release video, tutorial and promo is drawn from one style file. Classic and NextGen take the same inputs and follow the same rules; the theme is what tells them apart.</p>
  </header>
  ${row('Colour', 'A theme’s whole palette.', cells.colour)}
  ${row('Title card', 'Opens every video.', cells.title)}
  ${row('In the app', 'Caption, tag, ring, pointer and click; NextGen also names the chapter on screen.', cells.app)}
  ${row('Closing card', 'One line on what to do next.', cells.closing)}
  ${row('Cover', 'Made by cover.mjs from the same inputs: kind, headline, up to three points, a screenshot.', cells.cover)}
  <section class="row">
    <div class="rowhead"><h2>On-screen text</h2><p>The kinds a video may use, and their limits, for both themes.</p></div>
    <div class="tablewrap"><table><tbody>${kinds}</tbody></table></div>
    <ol class="rules">${sh.onScreenText.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
  </section>
  <section class="row">
    <div class="rowhead"><h2>The same for both</h2><p>What no theme changes.</p></div>
    <dl>${facts}</dl>
  </section>
</main>
`;
  const file = path.join(OUT, 'style-board.html');
  fs.writeFileSync(file, html);
  console.log(`${file}  (${Math.round(html.length / 1024)} KB)`);
  for (const n of new Set(notes)) console.log(`  note: ${n}`);
}

await main();
