'use strict';
// The Windows folders every program expects on PATH, put back for this app when the machine's PATH
// has lost them.
//
// electron-updater checks a downloaded update's signature by running, through cmd.exe,
// `chcp 65001 >NUL & powershell.exe ... Get-AuthenticodeSignature`, and any output on stderr fails
// the check. chcp lives in System32, so on a machine whose PATH no longer lists it (a PATH
// overwritten by a bad `setx` or SetEnvironmentVariable, or stored as REG_SZ so `%SystemRoot%` is
// never expanded) every update was refused with "'chcp' is not recognized as an internal or
// external command". Python, pip and the build steps of a driver install reach into System32 too.
//
// Only what is missing is added, at the end, so nothing that resolves today resolves differently.
// The machine's own setting is left alone: that is the person's to fix.

const path = require('node:path');

const EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'];

/** The key PATH is stored under: `Path` on Windows, which a plain copy of the environment keeps. */
const keyOf = (env, name) => Object.keys(env).find((k) => k.toUpperCase() === name) || name;

const sameFolder = (a) => path.win32.normalize(a).replace(/\\+$/, '').toLowerCase();

function systemFolders(env) {
    const root = env[keyOf(env, 'SYSTEMROOT')] || env[keyOf(env, 'WINDIR')] || 'C:\\Windows';
    return [
        path.win32.join(root, 'System32'),
        root,
        path.win32.join(root, 'System32', 'Wbem'),
        path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0'),
    ];
}

/**
 * Add to `env` (process.env by default) the system folders its PATH lacks and the executable
 * extensions its PATHEXT lacks. Does nothing off Windows. Returns what was added.
 */
function repairWindowsPath(env = process.env, platform = process.platform) {
    if (platform !== 'win32') return [];
    const added = [];
    const pathKey = keyOf(env, 'PATH');
    const dirs = String(env[pathKey] || '').split(';').filter(Boolean);
    const have = new Set(dirs.map(sameFolder));
    for (const dir of systemFolders(env)) {
        if (!have.has(sameFolder(dir))) { dirs.push(dir); added.push(dir); }
    }
    if (added.length) env[pathKey] = dirs.join(';');
    // Unset, cmd.exe uses its own list, which has them all.
    const extKey = keyOf(env, 'PATHEXT');
    if (env[extKey]) {
        const exts = env[extKey].split(';').filter(Boolean);
        const missing = EXTENSIONS.filter((e) => !exts.some((x) => x.toUpperCase() === e));
        if (missing.length) { env[extKey] = [...missing, ...exts].join(';'); added.push(...missing); }
    }
    return added;
}

module.exports = { repairWindowsPath };
