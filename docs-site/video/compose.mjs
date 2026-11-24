// Makes the tutorial film from a take (lib/recorder.mjs) and the spoken lines (voice.py):
//
//   node docs-site/video/compose.mjs                 the whole film -> out/ivoryos-tutorial.mp4
//   node docs-site/video/compose.mjs --from 60 --to 75    a stretch of it (seconds), to check
//   node docs-site/video/compose.mjs --still 12.5     one frame, as out/still-12.5.png
//   node docs-site/video/compose.mjs --sheets         a frame from every beat, six to a sheet (out/sheets/)
//
// Also writes out/ivoryos-tutorial.srt (subtitles) and script.md (the narration with times).
//
// For every frame of the film: the launcher's picture at that moment, the deck tab's laid over it
// where the window had it, the pointer and a ring where it clicked, then the part of the window
// the film is looking at, scaled to the frame, with the chapter title over it when one is due.
// ffmpeg comes from the imageio-ffmpeg Python package (there need be none installed); set FFMPEG
// to use another.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const TAKE = path.join(HERE, '.work', 'take');
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const takeDir = arg('--take', TAKE);

// The look: the documentation's own (scripts/annotate.mjs). Teal for what points, navy-gray
// panels, light text, regular weight, sentence case.
export const LOOK = { teal: '#3bb8a8', navy: '#1f2a3b', text: '#f3f5f8', soft: '#b8c2cf', font: "'Helvetica Neue', Helvetica, Arial, sans-serif" };
const FPS = 30;
const W = 1920;
const H = 1080;
const INTRO = 3.2; // seconds of title card
const OUTRO = 5.0; // at least; longer when a line is said over the closing card
const TITLE = 'Getting started with IvoryOS';
const SUBTITLE = 'From the Automation Hub to your first results';
const CLOSING = ['Documentation', 'docs.ivoryos.ai'];

const take = JSON.parse(fs.readFileSync(path.join(takeDir, 'take.json'), 'utf8'));
const script = JSON.parse(fs.readFileSync(path.join(HERE, 'voiceover.json'), 'utf8'));
const voice = JSON.parse(fs.readFileSync(path.join(OUT, 'vo', 'timing.json'), 'utf8'));
const K = take.scale;
const NW = take.size.width * K;
const NH = take.size.height * K;

// --- time: the take's clock (ms) <-> the film's (ms), with cut and fast spans --------------------

const warps = [...take.warps].sort((a, b) => a.t0 - b.t0);
const marks = [{ real: 0, film: 0 }]; // where the mapping changes slope
{
  let real = 0;
  let film = 0;
  for (const w of warps) {
    film += w.t0 - real;
    marks.push({ real: w.t0, film, speed: w.speed });
    film += w.speed ? (w.t1 - w.t0) / w.speed : 0;
    marks.push({ real: w.t1, film });
    real = w.t1;
  }
  marks.push({ real: take.length, film: film + take.length - real });
}
const FILM_MS = marks[marks.length - 1].film;
const toFilm = (real) => {
  let i = marks.length - 1;
  while (i > 0 && marks[i].real > real) i--;
  const m = marks[i];
  const next = marks[i + 1];
  if (!next) return m.film;
  const span = next.real - m.real;
  return span ? m.film + ((real - m.real) / span) * (next.film - m.film) : m.film;
};
const toReal = (film) => {
  // The last mark at or before this film time: after a cut, the far side of it.
  let i = 0;
  for (let j = 0; j < marks.length; j++) if (marks[j].film <= film) i = j;
  const m = marks[i];
  const next = marks[i + 1];
  if (!next || next.film === m.film) return m.real;
  return m.real + ((film - m.film) / (next.film - m.film)) * (next.real - m.real);
};

// --- what was on screen at a moment ---------------------------------------------------------------

const bySource = {};
for (const f of take.frames) (bySource[f.src] ||= []).push(f);
const lastAtOrBefore = (list, t, key = 't') => {
  let lo = 0;
  let hi = list.length - 1;
  let found = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][key] <= t) { found = list[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
};
const frameOf = (src, t) => lastAtOrBefore(bySource[src] || [], t) || (bySource[src] || [])[0] || null;

const pointerAt = (t) => {
  const list = take.pointer;
  const a = lastAtOrBefore(list, t) || list[0];
  const b = list[list.indexOf(a) + 1];
  if (!b || b.t === a.t) return a;
  const k = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t)));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
};

const FULL = { x: 0, y: 0, width: take.size.width, height: take.size.height };
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const viewAt = (t) => {
  let from = FULL;
  let view = FULL;
  for (const z of take.zooms) {
    if (z.t > t) break;
    const target = z.rect || FULL;
    const k = ease(Math.min(1, (toFilm(t) - toFilm(z.t)) / z.ms));
    from = view;
    view = {
      x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k,
      width: from.width + (target.width - from.width) * k, height: from.height + (target.height - from.height) * k,
    };
  }
  return view;
};

// --- drawing ----------------------------------------------------------------------------------------

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const card = (lines) => sharp(svg(W, H, `
  <rect width="${W}" height="${H}" fill="${LOOK.navy}"/>
  <rect x="${W / 2 - 36}" y="${H / 2 - 92}" width="72" height="3" rx="1.5" fill="${LOOK.teal}"/>
  <text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" font-family="${LOOK.font}" font-size="62" font-weight="400" fill="${LOOK.text}">${esc(lines[0])}</text>
  <text x="${W / 2}" y="${H / 2 + 58}" text-anchor="middle" font-family="${LOOK.font}" font-size="30" font-weight="400" fill="${LOOK.soft}">${esc(lines[1] || '')}</text>`)).removeAlpha().raw().toBuffer();

// The pointer: the arrow everyone knows, in the film's own colours, with its tip at (0, 0).
const pointerSvg = (size) => {
  const s = size / 24;
  return svg(Math.ceil(26 * s), Math.ceil(28 * s), `<g transform="scale(${s})">
    <path d="M2 1.5 L2 20.5 L7 16.2 L10.3 24 L13.8 22.5 L10.6 14.9 L17.4 14.9 Z" fill="#ffffff" stroke="${LOOK.navy}" stroke-width="1.6" stroke-linejoin="round"/></g>`);
};
const rippleSvg = (r, alpha, stroke) => svg(Math.ceil(r * 2 + 8), Math.ceil(r * 2 + 8),
  `<circle cx="${r + 4}" cy="${r + 4}" r="${r}" fill="${LOOK.teal}" fill-opacity="${alpha * 0.18}" stroke="${LOOK.teal}" stroke-opacity="${alpha}" stroke-width="${stroke}"/>`);
// A chapter's title, shown for a few seconds in the window's title bar, which is empty there.
const CHIP_H = 40;
const chipWidth = (title) => Math.round(50 + title.length * 11.6);
const chipSvg = (title, alpha) => {
  const w = chipWidth(title);
  return svg(w, CHIP_H, `<g opacity="${alpha}">
    <rect width="${w}" height="${CHIP_H}" rx="8" fill="${LOOK.navy}"/>
    <circle cx="20" cy="${CHIP_H / 2}" r="4.5" fill="${LOOK.teal}"/>
    <text x="35" y="${CHIP_H / 2 + 7.5}" font-family="${LOOK.font}" font-size="21" font-weight="400" fill="${LOOK.text}">${esc(title)}</text></g>`);
};

// The window's own three buttons are drawn by macOS, not by the page, so the recording has an
// empty corner where they sit. Put back as they look on a window that is not in front: gray.
const LIGHTS = svg(60 * K, 14 * K, [7, 27, 47].map((x) => `<circle cx="${x * K}" cy="${7 * K}" r="${6 * K}" fill="#d9dde3" stroke="#c6ccd4" stroke-width="${K / 2}"/>`).join(''));

let baseKey = null;
let base = null; // raw RGB of the whole window, native size
async function windowAt(t) {
  const l = frameOf('launcher', t);
  const lay = lastAtOrBefore(take.layout, t);
  const tabFrame = lay && lay.src ? frameOf(lay.src, t) : null;
  const key = `${l && l.file}|${tabFrame && tabFrame.file}|${lay && JSON.stringify(lay.bounds)}`;
  if (key === baseKey) return false;
  baseKey = key;
  let img = sharp(path.join(takeDir, l.file)).resize(NW, NH, { fit: 'fill' });
  const over = [{ input: LIGHTS, left: Math.round(13 * K), top: Math.round(11 * K) }];
  if (tabFrame) {
    const b = lay.bounds;
    const tab = await sharp(path.join(takeDir, tabFrame.file)).resize(Math.round(b.width * K), Math.round(b.height * K), { fit: 'fill' }).toBuffer();
    over.unshift({ input: tab, left: Math.round(b.x * K), top: Math.round(b.y * K) });
  }
  img = img.composite(over);
  base = await img.removeAlpha().raw().toBuffer();
  return true;
}

let lastKey = null;
let lastOut = null;
async function liveFrame(filmMs) {
  const t = toReal(filmMs);
  const changed = await windowAt(t);
  const view = viewAt(t);
  const p = pointerAt(t);
  const ripples = take.clicks.map((c) => ({ ...c, age: filmMs - toFilm(c.t) })).filter((c) => c.age >= 0 && c.age < 520);
  const chapter = take.chapters.map((c) => ({ ...c, age: filmMs - toFilm(c.t) })).filter((c) => c.age >= 0 && c.age < 4200).pop();
  const key = JSON.stringify([view, p, ripples.map((r) => Math.round(r.age / 33)), chapter && [chapter.title, Math.round(Math.min(chapter.age, 4200 - chapter.age) / 33)]]);
  if (!changed && key === lastKey) return lastOut;
  lastKey = key;
  const z = W / view.width; // film pixels per window point
  const sx = (x) => (x - view.x) * z;
  const sy = (y) => (y - view.y) * z;
  const overlays = [];
  const put = (input, left, top, w, h) => {
    // sharp refuses an overlay that leaves the frame; ones wholly outside are not drawn.
    left = Math.round(left); top = Math.round(top);
    if (left < 0 || top < 0 || left + w > W || top + h > H) return;
    overlays.push({ input, left, top });
  };
  for (const r of ripples) {
    const k = r.age / 520;
    const radius = (9 + 22 * ease(k)) * Math.min(z, 2.2) * 0.75 + 6;
    const size = Math.ceil(radius * 2 + 8);
    put(rippleSvg(radius, 1 - k, 3), sx(r.x) - radius - 4, sy(r.y) - radius - 4, size, size);
  }
  const ps = 30 * Math.min(1.5, Math.max(1, z / 1.33));
  put(pointerSvg(ps), sx(p.x) - (2 * ps) / 24, sy(p.y) - (1.5 * ps) / 24, Math.ceil((26 * ps) / 24), Math.ceil((28 * ps) / 24));
  if (chapter) {
    const alpha = Math.min(1, chapter.age / 300, (4200 - chapter.age) / 400);
    const w = chipWidth(chapter.title);
    put(chipSvg(chapter.title, alpha.toFixed(2)), (W - w) / 2, 4, w, CHIP_H);
  }
  const left = Math.max(0, Math.min(NW - 2, Math.round(view.x * K)));
  const top = Math.max(0, Math.min(NH - 2, Math.round(view.y * K)));
  lastOut = await sharp(base, { raw: { width: NW, height: NH, channels: 3 } })
    .extract({ left, top, width: Math.min(NW - left, Math.round(view.width * K)), height: Math.min(NH - top, Math.round(view.height * K)) })
    .resize(W, H, { fit: 'fill', kernel: 'lanczos3' })
    .composite(overlays)
    .removeAlpha().raw().toBuffer();
  return lastOut;
}

// --- the film's plan: cards, live picture, and where each line is spoken ----------------------------

// A line marked `closing` (rec.closing) is said over the closing card, a moment after it appears.
const CLOSING_LEAD = 0.7;
const lines = take.beats.map((b) => ({
  id: b.id,
  text: script.lines[b.id].say,
  screen: script.lines[b.id].screen || '',
  start: b.closing ? INTRO + FILM_MS / 1000 + CLOSING_LEAD : INTRO + toFilm(b.t) / 1000,
  seconds: voice[b.id].seconds,
  closing: !!b.closing,
}));
// The closing card stays for its line and a breath after it.
const OUTRO_S = Math.max(OUTRO, ...lines.filter((l) => l.closing).map((l) => CLOSING_LEAD + l.seconds + 2));
const TOTAL = INTRO + FILM_MS / 1000 + OUTRO_S;

let introCard;
let outroCard;
async function frameAt(sec) {
  if (sec < INTRO) return (introCard ||= await card([TITLE, SUBTITLE]));
  if (sec >= INTRO + FILM_MS / 1000) return (outroCard ||= await card(CLOSING));
  return liveFrame((sec - INTRO) * 1000);
}

const stamp = (s, sep = ',') => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};

function writeWords() {
  fs.mkdirSync(OUT, { recursive: true });
  // Subtitles: a line of several sentences is shown a sentence at a time, each for its share.
  const cues = [];
  for (const l of lines) {
    const parts = l.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g).map((s) => s.trim()).filter(Boolean);
    const total = parts.reduce((n, s) => n + s.length, 0);
    let at = l.start;
    for (const part of parts) {
      const dur = (l.seconds * part.length) / total;
      cues.push({ start: at, end: at + dur, text: part });
      at += dur;
    }
  }
  fs.writeFileSync(path.join(OUT, 'ivoryos-tutorial.srt'), cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n'));
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const chapters = take.chapters.map((c) => ({ title: c.title, at: INTRO + toFilm(c.t) / 1000 }));
  let md = `# Getting started with IvoryOS: narration\n\nThe tutorial video's spoken lines, in order, with when each starts and what is on screen.\nGenerated by \`compose.mjs\` from \`voiceover.json\` and the last recording; edit the lines there,\nnot here. Length: ${mmss(TOTAL)}. Each line is its own file, \`out/vo/<id>.wav\`, so any of them can be\nre-recorded (see README.md).\n`;
  let ch = 0;
  lines.forEach((l, i) => {
    while (ch < chapters.length && chapters[ch].at <= l.start + 0.5) md += `\n## ${chapters[ch++].title}\n\n| # | Time | Line | Narration | On screen |\n|---|---|---|---|---|\n`;
    md += `| ${i + 1} | ${mmss(l.start)} | \`${l.id}\` | ${l.text} | ${l.screen} |\n`;
  });
  fs.writeFileSync(path.join(HERE, 'script.md'), md);
}

function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  return execFileSync('uv', ['run', '-q', '--with', 'imageio-ffmpeg', 'python', '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
}

async function main() {
  if (process.argv.includes('--still')) {
    const sec = Number(arg('--still'));
    const raw = await frameAt(sec);
    const file = path.join(OUT, `still-${sec}.png`);
    await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
    console.log(file);
    return;
  }
  if (process.argv.includes('--sheets')) {
    // One frame from late in every beat, six to a sheet: the quick way to look a take over.
    writeWords();
    const dir = path.join(OUT, 'sheets');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const [cw, ch] = [960, 540];
    for (let i = 0; i < lines.length; i += 6) {
      const tiles = [];
      for (const [k, l] of lines.slice(i, i + 6).entries()) {
        const raw = await frameAt(l.start + Math.max(l.seconds * 0.85, l.seconds - 0.4));
        const label = svg(cw, 34, `<rect width="${cw}" height="34" fill="${LOOK.navy}"/><text x="12" y="23" font-family="${LOOK.font}" font-size="18" fill="${LOOK.text}">${esc(`${l.id}  ${stamp(l.start, '.').slice(3, 10)}`)}</text>`);
        const tile = await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).resize(cw, ch).composite([{ input: label, left: 0, top: 0 }]).png().toBuffer();
        tiles.push({ input: tile, left: (k % 3) * cw, top: Math.floor(k / 3) * ch });
      }
      const file = path.join(dir, `sheet-${String(i / 6 + 1).padStart(2, '0')}.png`);
      await sharp({ create: { width: cw * 3, height: ch * 2, channels: 3, background: LOOK.navy } }).composite(tiles).png().toFile(file);
      console.log(file);
    }
    return;
  }
  writeWords();
  const from = Number(arg('--from', 0));
  const to = Math.min(TOTAL, Number(arg('--to', TOTAL)));
  const whole = from === 0 && to === TOTAL;
  const target = path.join(OUT, whole ? 'ivoryos-tutorial.mp4' : `part-${from}-${to}.mp4`);
  const spoken = lines.filter((l) => l.start + l.seconds > from && l.start < to);
  const inputs = spoken.flatMap((l) => ['-i', path.join(OUT, 'vo', `${l.id}.wav`)]);
  const delays = spoken.map((l, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.max(0, Math.round((l.start - from) * 1000))}:all=1[a${i}]`);
  const mix = spoken.length
    ? [...delays, `${spoken.map((_, i) => `[a${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0:dropout_transition=0,apad[aout]`].join(';')
    : null;
  const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', ...inputs,
    ...(mix ? ['-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', target];
  const ff = spawn(ffmpegPath(), args, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ff.on('exit', (code) => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve())));
  const count = Math.round((to - from) * FPS);
  const began = Date.now();
  for (let i = 0; i < count; i++) {
    const raw = await frameAt(from + i / FPS);
    if (!ff.stdin.write(raw)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 300 === 0) console.log(`  ${Math.round((i / count) * 100)}%  ${stamp(from + i / FPS, '.').slice(3, 8)}  (${Math.round((Date.now() - began) / 1000)}s)`);
  }
  ff.stdin.end();
  await done;
  console.log(`${target}  ${stamp(to - from, '.').slice(3, 8)}`);
}

await main();
