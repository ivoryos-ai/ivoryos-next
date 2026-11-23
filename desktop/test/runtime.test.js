'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PythonRuntime } = require('../src/runtime');

// A venv whose site-packages folder exists, with no Python in it: _clearStaleEdgeFolder only
// looks at the filesystem.
function fakeRuntime() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivoryos-runtime-'));
    const runtime = new PythonRuntime({ uv: 'uv', dir, edgeSource: { kind: 'editable', path: dir }, onLine: () => {} });
    const site = process.platform === 'win32'
        ? path.join(dir, 'venv', 'Lib', 'site-packages')
        : path.join(dir, 'venv', 'lib', 'python3.11', 'site-packages');
    fs.mkdirSync(site, { recursive: true });
    return { runtime, site };
}

test('an empty ivoryos_edge folder left by an uninstalled wheel is removed', () => {
    const { runtime, site } = fakeRuntime();
    fs.mkdirSync(path.join(site, 'ivoryos_edge', 'workflows'), { recursive: true });
    runtime._clearStaleEdgeFolder();
    assert.equal(fs.existsSync(path.join(site, 'ivoryos_edge')), false);
});

test('a leftover folder holding files is moved aside, not deleted', () => {
    const { runtime, site } = fakeRuntime();
    fs.mkdirSync(path.join(site, 'ivoryos_edge', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(site, 'ivoryos_edge', 'workflows', 'saved.json'), '{}');
    runtime._clearStaleEdgeFolder();
    assert.equal(fs.existsSync(path.join(site, 'ivoryos_edge')), false);
    const aside = fs.readdirSync(site).find(n => n.startsWith('ivoryos_edge.leftover-'));
    assert.ok(aside, 'moved beside itself');
    assert.ok(fs.existsSync(path.join(site, aside, 'workflows', 'saved.json')));
});

test('an installed edge (a package with __init__.py) is left alone', () => {
    const { runtime, site } = fakeRuntime();
    fs.mkdirSync(path.join(site, 'ivoryos_edge', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(site, 'ivoryos_edge', '__init__.py'), '');
    runtime._clearStaleEdgeFolder();
    assert.ok(fs.existsSync(path.join(site, 'ivoryos_edge', '__init__.py')));
});
