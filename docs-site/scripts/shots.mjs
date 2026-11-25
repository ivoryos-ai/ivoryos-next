// Saving one documentation picture: annotate the page (annotate.mjs), photograph it, take the
// annotations off again, and keep the notes' words beside the picture so the page that shows it
// can give them to screen readers and to search (src/components/Shot.astro).
//
// Pictures are WebP under src/assets/annotated/. The words go in a notes file in the same folder,
// one per script (notes.json for screenshots.mjs), merged by name so running a few scenes leaves
// the others' entries alone.

import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotate, clearAnnotations } from './annotate.mjs';

export const VIEW = { width: 1180, height: 760 };
export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'annotated');

const plain = (text) => (text || '').replaceAll('**', '');

export function recordNotes(name, notes, file = 'notes.json') {
  fs.mkdirSync(OUT, { recursive: true });
  const target = path.join(OUT, file);
  const all = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
  all[name] = notes.map((n) => ({ title: n.title, ...(n.text ? { text: plain(n.text) } : {}) }));
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  fs.writeFileSync(target, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** A PNG buffer of a picture (annotated or not) written as the docs keep it. */
export async function writeShot(name, png, notes = [], notesFile = 'notes.json') {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.webp`);
  await sharp(png).webp({ quality: 92, effort: 6 }).toFile(file);
  recordNotes(name, notes, notesFile);
  return file;
}

/**
 * Annotate `page` with `notes`, save the picture as `name`, and leave the page as it was.
 * opts: clip ({x, y, width, height}, viewport coordinates), dim (false for no darkening),
 * keep (targets left undarkened, without a ring), numbered, notesFile.
 */
export async function saveShot(page, name, notes = [], opts = {}) {
  if (notes.length) await annotate(page, notes, { bounds: opts.clip, dim: opts.dim, keep: opts.keep, numbered: opts.numbered });
  let png;
  try {
    png = await page.screenshot(opts.clip ? { clip: opts.clip } : {});
  } finally {
    if (notes.length) await clearAnnotations(page);
  }
  return writeShot(name, png, notes, opts.notesFile);
}
