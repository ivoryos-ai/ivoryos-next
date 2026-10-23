'use strict';
// One tag, v<version>, releases the edge and the desktop app together: .github/workflows/edge-pypi.yml
// publishes ivoryos-edge to PyPI and .github/workflows/desktop.yml builds the installers, which
// bundle that same package. Both start with this check, so neither goes out at a version the other
// does not have: the tag's version must be the one in edge_server/pyproject.toml and in
// desktop/package.json. A suffix (v0.2.0-test.1) makes a desktop pre-release; the check then reads
// the version before it, and PyPI is skipped (desktop.yml, edge-pypi.yml).
//
//   node scripts/check-release-version.js v0.1.2

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function versions() {
    const pyproject = fs.readFileSync(path.join(ROOT, 'edge_server', 'pyproject.toml'), 'utf8');
    // The [project] table runs to the next table header.
    const table = (/^\[project\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(pyproject) || [])[1] || '';
    const edge = (/^version\s*=\s*"([^"]+)"/m.exec(table) || [])[1];
    const desktop = JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'package.json'), 'utf8')).version;
    return { edge, desktop };
}

const tag = process.argv[2] || '';
const match = /^v(\d+\.\d+\.\d+)(-.+)?$/.exec(tag);
if (!match) {
    console.log(`::error::A release tag is v<major>.<minor>.<patch>, optionally with a suffix (v0.2.0-test.1); got "${tag}".`);
    process.exit(1);
}
const [, version, suffix] = match;
const { edge, desktop } = versions();
const wrong = [
    edge !== version && `edge_server/pyproject.toml says version = "${edge}"`,
    desktop !== version && `desktop/package.json says "version": "${desktop}"`,
].filter(Boolean);
if (wrong.length) {
    console.log(`::error::The tag ${tag} is version ${version}, but ${wrong.join(' and ')}. Set both to ${version}, merge, and tag again.`);
    process.exit(1);
}
console.log(`${tag}: ivoryos-edge ${version} and the desktop app ${version}${suffix ? ' (a pre-release: not published to PyPI)' : ''}`);
