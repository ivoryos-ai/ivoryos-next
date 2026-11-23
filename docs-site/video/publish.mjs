// Puts the finished film where the documentation site serves it (public/video/): the film, its
// subtitles as WebVTT, and a poster frame. Run after compose.mjs; the "Watch the tour" page
// (src/content/docs/start/video-tour.mdx) shows what is there. Chapter times on that page are
// written by hand from script.md: check them after a new take.
//
//   node docs-site/video/publish.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'out');
const dest = path.join(here, '..', 'public', 'video');
const POSTER_AT = 75; // seconds in: the Designer with a step being dragged

fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(path.join(out, 'ivoryos-tutorial.mp4'), path.join(dest, 'ivoryos-tutorial.mp4'));

const srt = fs.readFileSync(path.join(out, 'ivoryos-tutorial.srt'), 'utf8');
const vtt = srt.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2').replace(/^\d+\r?\n(?=\d\d:\d\d:\d\d\.)/gm, '');
fs.writeFileSync(path.join(dest, 'ivoryos-tutorial.vtt'), `WEBVTT\n\n${vtt}`);

const ffmpeg = process.env.FFMPEG
  || execFileSync('uv', ['run', '-q', '--with', 'imageio-ffmpeg', 'python', '-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(POSTER_AT), '-i', path.join(dest, 'ivoryos-tutorial.mp4'), '-frames:v', '1', '-q:v', '3', path.join(dest, 'ivoryos-tutorial.jpg')]);
console.log(`published to ${path.relative(process.cwd(), dest)}`);
