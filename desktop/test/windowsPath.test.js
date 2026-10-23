'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { repairWindowsPath } = require('../src/windowsPath');

const SYSTEM = ['C:\\Windows\\System32', 'C:\\Windows', 'C:\\Windows\\System32\\Wbem', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0'];

test('a PATH that lost System32 gets the system folders back, at the end, under its own key', () => {
    const env = { SystemRoot: 'C:\\Windows', Path: 'C:\\Program Files\\Git\\bin;$($env:PATH);C:\\Windows\\System32\\WindowsPowerShell\\v1.0' };
    const added = repairWindowsPath(env, 'win32');
    assert.deepEqual(added, ['C:\\Windows\\System32', 'C:\\Windows', 'C:\\Windows\\System32\\Wbem']);
    assert.equal(env.Path, 'C:\\Program Files\\Git\\bin;$($env:PATH);C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\Wbem');
    assert.equal(env.PATH, undefined, 'no second PATH beside Path');
});

test('folders already there count however they are written', () => {
    const before = 'C:\\WINDOWS\\system32\\;c:\\windows;C:\\Windows\\System32\\wbem;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\';
    const env = { SystemRoot: 'C:\\WINDOWS', PATH: before, PATHEXT: '.COM;.EXE;.BAT;.CMD;.PY' };
    assert.deepEqual(repairWindowsPath(env, 'win32'), []);
    assert.equal(env.PATH, before);
});

test('an unexpanded %SystemRoot% (a REG_SZ PATH) is not System32', () => {
    const env = { SystemRoot: 'C:\\Windows', Path: '%SystemRoot%\\system32;%SystemRoot%' };
    assert.deepEqual(repairWindowsPath(env, 'win32').slice(0, 2), ['C:\\Windows\\System32', 'C:\\Windows']);
});

test('the Windows folder comes from SystemRoot, then windir', () => {
    const env = { windir: 'D:\\WIN', Path: '' };
    repairWindowsPath(env, 'win32');
    assert.ok(env.Path.startsWith('D:\\WIN\\System32;D:\\WIN;'));
});

test('PATHEXT without .COM gets it (chcp is chcp.com); an unset PATHEXT is left to cmd.exe', () => {
    const env = { SystemRoot: 'C:\\Windows', Path: SYSTEM.join(';'), PATHEXT: '.EXE;.PY' };
    assert.deepEqual(repairWindowsPath(env, 'win32'), ['.COM', '.BAT', '.CMD']);
    assert.equal(env.PATHEXT, '.COM;.BAT;.CMD;.EXE;.PY');
    const unset = { SystemRoot: 'C:\\Windows', Path: SYSTEM.join(';') };
    repairWindowsPath(unset, 'win32');
    assert.equal(unset.PATHEXT, undefined);
});

test('nothing changes off Windows', () => {
    const env = { PATH: '/usr/bin' };
    assert.deepEqual(repairWindowsPath(env, 'darwin'), []);
    assert.equal(env.PATH, '/usr/bin');
});

// The command electron-updater 6 runs to check a downloaded installer's signature, which fails on
// anything written to stderr.
function updaterSignatureCheck(env, file) {
    return new Promise((resolve) => {
        execFile('set "PSModulePath=" & chcp 65001 >NUL & powershell.exe',
            ['-NoProfile', '-NonInteractive', '-InputFormat', 'None', '-Command', `"Get-AuthenticodeSignature -LiteralPath '${file}' | ConvertTo-Json -Compress"`],
            { shell: true, timeout: 30000, env },
            (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
}

test('the updater\'s signature check passes again once the PATH is repaired', { skip: process.platform !== 'win32' }, async () => {
    const root = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
    const env = { ...process.env };
    const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
    env[key] = env[key].split(';').filter((d) => !d.toLowerCase().startsWith(root)).join(';');

    const broken = await updaterSignatureCheck(env, process.env.ComSpec);
    assert.match(broken.stderr, /'chcp' is not recognized|'powershell\.exe' is not recognized/);

    repairWindowsPath(env, 'win32');
    const fixed = await updaterSignatureCheck(env, process.env.ComSpec);
    assert.equal(fixed.stderr, '');
    assert.equal(JSON.parse(fixed.stdout).Status, 0, 'cmd.exe is signed');
});
