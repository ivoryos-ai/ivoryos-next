// Records the tutorial on the real desktop app (see README.md):
//
//   node docs-site/video/record.mjs              a new take, from a new install of the lab
//   node docs-site/video/record.mjs --dry        the same, without waiting for the spoken lines
//   node docs-site/video/record.mjs --resume     keep the deck from the last take (skips chapter 1)
//
// The app runs in a home folder of its own (docs-site/.desktop-home/video). A new take removes that
// home's decks first, so the film shows the first install; the Python environment in it is kept,
// which is why the install takes seconds on camera rather than a minute or two.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp, HOMES } from '../scripts/desktop-app.mjs';
import { Recorder } from './lib/recorder.mjs';
import { tutorial } from './tutorial.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const dry = process.argv.includes('--dry');
const resume = process.argv.includes('--resume');
const home = path.join(HOMES, 'video');

const voice = JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'vo', 'timing.json'), 'utf8'));
if (dry) for (const line of Object.values(voice)) line.seconds = 0.2;

if (!resume) for (const name of ['profiles.json', 'profiles', 'logs']) fs.rmSync(path.join(home, name), { recursive: true, force: true });

// 16:9, so the window fills the frame; twice this in pixels on a Retina display.
const a = await launchApp({ home, size: { width: 1440, height: 810 }, profiles: [] });
const rec = new Recorder(a, path.join(WORK, dry ? 'take-dry' : 'take'), voice);
let failed = null;
try {
  a.launcher.setDefaultTimeout(15000);
  await a.launcher.getByRole(resume ? 'button' : 'heading', resume ? { name: /Start|Stop/ } : { name: 'Welcome to IvoryOS' }).first().waitFor({ timeout: 180000 });
  await a.launcher.waitForTimeout(1500);
  await rec.watch(a.launcher, 'launcher');
  await rec.start();
  await tutorial(rec, a, { resume });
} catch (e) {
  failed = e;
  const at = rec.beats[rec.beats.length - 1];
  console.error(`\nStopped${at ? ` in beat ${at.id}` : ''}: ${String(e.message).split('\n').slice(0, 4).join('\n')}`);
  fs.writeFileSync(path.join(WORK, 'failed.png'), await a.shot().catch(() => Buffer.alloc(0)));
  const page = (await a.tabPage().catch(() => null)) || a.launcher;
  const seen = await page.evaluate(() => [...document.querySelectorAll('button, input, a, [role=menuitem]')].filter((e) => e.offsetParent).map((e) => `${e.tagName.toLowerCase()} ${JSON.stringify((e.innerText || e.value || '').trim().slice(0, 40))} title=${JSON.stringify(e.title || '')} label=${JSON.stringify(e.getAttribute('aria-label') || '')} placeholder=${JSON.stringify(e.placeholder || '')} id=${e.id}`).join('\n')).catch(() => '');
  fs.writeFileSync(path.join(WORK, 'failed.txt'), seen);
  console.error(`  what the window showed: ${path.join(WORK, 'failed.png')} (controls on the page: failed.txt)`);
} finally {
  const take = await rec.stop();
  await a.close();
  console.log(`${failed ? 'partial ' : ''}take: ${rec.dir}  ${Math.round(take.length / 1000)}s recorded, ${take.frames.length} frames, ${take.beats.length} beats`);
}
if (failed) process.exit(1);
