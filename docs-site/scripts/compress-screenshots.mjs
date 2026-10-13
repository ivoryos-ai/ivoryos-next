// Re-compress every screenshot in place (the screenshot script does this as it captures).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'screenshots');
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png'))) {
  const file = path.join(dir, f);
  const buf = await sharp(file).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  fs.writeFileSync(file, buf);
}
console.log('compressed', fs.readdirSync(dir).length, 'files');
