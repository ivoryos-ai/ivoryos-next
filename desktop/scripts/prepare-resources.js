'use strict';
// Put what the packaged app ships into desktop/resources/, which electron-builder copies into the
// app's resources folder:
//
//   resources/bin/uv[.exe]        manages Python on the user's machine
//   resources/edge/*.whl          the edge server, built from ../edge_server with the web UI inside
//                                 (../scripts/build-edge.js); an environment "Install IvoryOS here"
//                                 puts it in serves that UI
//   resources/frontend/           the web UI, from ../frontend/out: the launcher page, and what
//                                 edges in the app's own environment serve
//   resources/example/            the simulated drivers behind "Try the example" (src/example.js)
//
// Run on each target OS (uv is a native binary): `npm run build` in ../frontend, then
// `npm run prepare-resources` and `npm run dist`. Both copies of the UI come from that one build.
// Development (`npm start`) does not need any of this; see src/resources.js.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { findSystemUv, REPO_ROOT } = require('../src/resources');
const { buildEdge } = require('../../scripts/build-edge');

const OUT = path.join(__dirname, '..', 'resources');
const EXE = process.platform === 'win32' ? '.exe' : '';

function step(message) { console.log(`\n> ${message}`); }

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'bin'), { recursive: true });

step('uv');
const uv = process.env.IVORYOS_UV || findSystemUv();
if (!uv) throw new Error('uv not found. Install it (https://docs.astral.sh/uv/) or set IVORYOS_UV.');
fs.copyFileSync(uv, path.join(OUT, 'bin', `uv${EXE}`));
fs.chmodSync(path.join(OUT, 'bin', `uv${EXE}`), 0o755);
console.log(`  ${uv} (${execFileSync(uv, ['--version']).toString().trim()})`);

step('web UI');
const ui = path.join(REPO_ROOT, 'frontend', 'out');
if (!fs.existsSync(path.join(ui, 'index.html'))) {
    throw new Error('frontend/out is missing. Run `npm run build` in frontend/ first.');
}
fs.cpSync(ui, path.join(OUT, 'frontend'), { recursive: true });

step('edge wheel, with the same web UI inside');
buildEdge({ uv, outDir: path.join(OUT, 'edge'), wheelOnly: true, buildFrontend: false });

step('example lab');
const { DRIVER_FILES } = require('../src/example');
fs.mkdirSync(path.join(OUT, 'example'), { recursive: true });
for (const f of DRIVER_FILES) fs.copyFileSync(path.join(REPO_ROOT, 'example', f), path.join(OUT, 'example', f));

console.log(`\nResources ready in ${OUT}`);
