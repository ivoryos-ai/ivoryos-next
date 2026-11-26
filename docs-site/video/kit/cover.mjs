// Makes a video's cover (the YouTube thumbnail, the docs poster) from style.json, the same way
// for every video of either product:
//
//   node docs-site/video/kit/cover.mjs --theme next --kind tutorial --headline "Getting started" \
//        --point "A lab from the Automation Hub" --point "Design, run and iterate" \
//        --shot docs-site/src/assets/screenshots/designer-workflow.png --out out/cover.jpg
//
//   --theme     classic | next                    (themes in style.json)
//   --kind      release | tutorial | promo        (sets the kicker; --kicker overrides it)
//   --headline  a version (1.8.0) or two or three words
//   --point     a highlight; up to three, 35 characters each
//   --shot      the screenshot the cover shows (PNG or JPEG)
//   --logo      the mark to use instead of this repository's
//   --html      also keep the page the cover was photographed from, beside it
//
// A cover that breaks a limit in style.json (too many points, a headline that will not fit) is
// refused with the reason, before anything is drawn.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOGO = path.join(HERE, '..', '..', 'src', 'assets', 'ivoryos-mark.svg');

export const loadStyle = () => JSON.parse(fs.readFileSync(path.join(HERE, 'style.json'), 'utf8'));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
export const dataUri = (file) => {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`${file}: not a picture this can embed (${Object.keys(MIME).join(', ')})`);
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
};

/** `{{a.b}}` in a template, from `values` (already safe to put in HTML). An unknown name is an error. */
export function fill(template, values) {
  return template.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
    const value = name.split('.').reduce((at, key) => (at == null ? at : at[key]), values);
    if (value == null) throw new Error(`the template asks for {{${name}}}, which style.json does not have`);
    return String(value);
  });
}

/** The stylesheet link for a theme's web font, or nothing for a theme set in system fonts. */
export const fontLink = (theme) => (theme.font.google
  ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${theme.font.google}&display=swap">`
  : '');

/** What is wrong with a cover's inputs, as sentences; empty when it can be drawn. */
export function coverProblems(style, { theme, kind = 'tutorial', headline, points = [] }) {
  const rules = style.shared.cover;
  const problems = [];
  if (!style.themes[theme]) problems.push(`no theme "${theme}"; there are: ${Object.keys(style.themes).join(', ')}`);
  if (!rules.kinds[kind]) problems.push(`no kind "${kind}"; there are: ${Object.keys(rules.kinds).join(', ')}`);
  if (!headline) problems.push('a cover needs a headline');
  else if (headline.length > rules.headlineMaxChars) problems.push(`the headline is ${headline.length} characters; a cover fits ${rules.headlineMaxChars}`);
  if (points.length > rules.pointsMax) problems.push(`${points.length} points; a cover fits ${rules.pointsMax}`);
  for (const p of points) if (p.length > rules.pointMaxChars) problems.push(`"${p}" is ${p.length} characters; a point fits ${rules.pointMaxChars}`);
  return problems;
}

/** The cover as a page of 1280x720, everything it needs inside it. */
export function coverHtml(style, { theme, kind = 'tutorial', kicker, headline, points = [], shot, logo = DEFAULT_LOGO }) {
  const problems = coverProblems(style, { theme, kind, headline, points });
  if (problems.length) throw new Error(problems.join('\n'));
  const t = style.themes[theme];
  const text = kicker ?? style.shared.cover.kinds[kind].kicker;
  return fill(fs.readFileSync(path.join(HERE, t.cover.template), 'utf8'), {
    ...t,
    fontLink: fontLink(t),
    shot: dataUri(shot),
    logo: dataUri(logo),
    kicker: esc(text),
    kickerClass: text ? '' : 'none',
    headline: esc(headline),
    size: headline.length <= style.shared.cover.numericHeadlineMaxChars ? '' : 'words',
    points: points.map((p) => `<li>${esc(p)}</li>`).join(''),
  });
}

/** Photograph the cover to `out`. Returns what to tell the person: the file, and anything that fell short. */
export async function renderCover(input) {
  const style = loadStyle();
  const rules = style.shared.cover;
  const html = coverHtml(style, input);
  const { chromium } = await import('playwright');
  // CHROMIUM names a browser to use when Playwright's own is not installed (npx playwright install chromium).
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const notes = [];
  try {
    const page = await browser.newPage({ viewport: { width: rules.width, height: rules.height }, deviceScaleFactor: rules.scale });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const family = style.themes[input.theme].font.google && style.themes[input.theme].font.family.split(',')[0].replace(/"/g, '').trim();
    if (family && !(await page.evaluate((f) => document.fonts.check(`600 20px "${f}"`), family))) {
      notes.push(`${family} could not be loaded (no network?); the cover is set in the next font of the theme's list`);
    }
    fs.mkdirSync(path.dirname(path.resolve(input.out)), { recursive: true });
    await page.screenshot({ path: input.out, type: rules.format, quality: rules.quality });
  } finally {
    await browser.close();
  }
  if (input.keepHtml) fs.writeFileSync(input.out.replace(/\.\w+$/, '.html'), html);
  const bytes = fs.statSync(input.out).size;
  if (bytes > rules.maxBytes) notes.push(`${bytes} bytes; YouTube takes ${rules.maxBytes}`);
  return { out: input.out, bytes, notes };
}

async function main() {
  const argv = process.argv.slice(2);
  const all = (name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []));
  const one = (name, fallback) => all(name).pop() ?? fallback;
  const input = {
    theme: one('--theme', 'next'), kind: one('--kind', 'tutorial'), kicker: one('--kicker'), headline: one('--headline'),
    points: all('--point'), shot: one('--shot'), logo: one('--logo', DEFAULT_LOGO), out: one('--out'), keepHtml: argv.includes('--html'),
  };
  if (!input.shot || !input.out) {
    console.error('cover.mjs needs --headline, --shot and --out; see the top of the file');
    process.exit(2);
  }
  try {
    const { out, bytes, notes } = await renderCover(input);
    console.log(`${out}  (${Math.round(bytes / 1024)} KB)`);
    for (const n of notes) console.log(`  note: ${n}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
