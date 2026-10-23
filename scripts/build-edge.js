'use strict';
// Build the ivoryos-edge package with its web UI inside, so an edge installed from it (pip, or the
// desktop app's bundled wheel) serves the pages of its own version with no checkout beside it:
//
//   1. `npm run build` in frontend/ (the static export, frontend/out)
//   2. copy frontend/out to edge_server/ivoryos_edge/ui/ (package data, gitignored)
//   3. `uv build` edge_server/: its build backend (edge_server/build_backend.py) refuses a wheel
//      or sdist without that folder, so a package with no pages cannot come out of any path
//   4. remove ui/ again, so a checkout keeps serving frontend/out in development
//
//   npm run build:edge                         sdist and wheel, into edge_server/dist/
//   npm run build:edge -- --wheel              the wheel only
//   npm run build:edge -- --skip-frontend      use frontend/out as already built
//   npm run build:edge -- --out-dir <folder>
//
// desktop/scripts/prepare-resources.js calls buildEdge() for the wheel the app bundles. uv comes
// from IVORYOS_UV, else the PATH.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const EDGE = path.join(REPO_ROOT, 'edge_server');
const PACKAGED_UI = path.join(EDGE, 'ivoryos_edge', 'ui');

/**
 * @param {object} [opts]
 * @param {string} [opts.uv]              the uv to build with
 * @param {string} [opts.outDir]          where the wheel (and sdist) go
 * @param {boolean} [opts.wheelOnly]      no sdist
 * @param {boolean} [opts.buildFrontend]  false: package frontend/out as it is
 */
function buildEdge({ uv = process.env.IVORYOS_UV || 'uv', outDir = path.join(EDGE, 'dist'), wheelOnly = false, buildFrontend = true } = {}) {
    if (buildFrontend) {
        // npm is npm.cmd on Windows, which only a shell runs.
        execFileSync('npm', ['run', 'build'], { cwd: FRONTEND, stdio: 'inherit', shell: process.platform === 'win32' });
    }
    const ui = path.join(FRONTEND, 'out');
    if (!fs.existsSync(path.join(ui, 'index.html'))) {
        throw new Error('frontend/out is missing. Run `npm run build` in frontend/ first.');
    }
    fs.rmSync(PACKAGED_UI, { recursive: true, force: true });
    fs.cpSync(ui, PACKAGED_UI, { recursive: true });
    try {
        execFileSync(uv, ['build', ...(wheelOnly ? ['--wheel'] : []), '--out-dir', outDir, EDGE], { stdio: 'inherit' });
    } finally {
        fs.rmSync(PACKAGED_UI, { recursive: true, force: true });
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const at = args.indexOf('--out-dir');
    if (at >= 0 && !args[at + 1]) throw new Error('--out-dir needs a folder');
    buildEdge({
        wheelOnly: args.includes('--wheel'),
        buildFrontend: !args.includes('--skip-frontend'),
        // Relative to where it was typed: `npm run` itself starts in the repository root.
        ...(at >= 0 ? { outDir: path.resolve(process.env.INIT_CWD || '.', args[at + 1]) } : {}),
    });
}

module.exports = { buildEdge };
