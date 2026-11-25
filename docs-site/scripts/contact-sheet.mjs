// A contact sheet of annotated pictures, two across, to look several over at once after changing
// a scene or the look:
//
//   node scripts/contact-sheet.mjs /tmp/sheet.png designer-overview run-once library
import sharp from 'sharp';
import path from 'node:path';
import { OUT } from './shots.mjs';
const [dest, ...names] = process.argv.slice(2);
const W = 1180, H = 760;
const tiles = await Promise.all(names.map(async (n) => ({ input: await sharp(path.join(OUT, `${n}.webp`)).resize(W, H, { fit: 'contain', background: '#555' }).png().toBuffer() })));
const rows = Math.ceil(tiles.length / 2);
await sharp({ create: { width: W * 2, height: H * rows, channels: 3, background: '#555' } })
  .composite(tiles.map((t, k) => ({ ...t, left: (k % 2) * W, top: Math.floor(k / 2) * H }))).png().toFile(dest);
