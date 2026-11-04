'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadProfiles, saveProfiles, withDefaults, validateProfile, commandFor } = require('../src/profiles');
const { updateInstrument, removeInstrument, setInstrumentEnabled, freeName, DeckEditError } = require('../src/deckEdit');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivoryos-prof-'));

test('first run creates one deck profile with its own deck and data folder', () => {
    const home = tmp();
    const { profiles } = loadProfiles(home);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].kind, 'deck');
    assert.ok(profiles[0].deck.startsWith(path.join(home, 'profiles', profiles[0].id)));
    assert.ok(fs.existsSync(path.join(home, 'profiles.json')));
    assert.equal(loadProfiles(home).profiles[0].id, profiles[0].id, 'stable across loads');
});

test('a launcher that predates profiles keeps its deck and history as the first profile', () => {
    const home = tmp();
    fs.mkdirSync(path.join(home, 'data'));
    fs.writeFileSync(path.join(home, 'data', 'deck.json'), '{"instruments": []}');
    const [first] = loadProfiles(home).profiles;
    assert.equal(first.deck, path.join(home, 'data', 'deck.json'));
    assert.equal(first.dataDir, path.join(home, 'data'));
});

test('script profiles keep the script’s own data by default and pass port and env through', () => {
    const home = tmp();
    const script = path.join(home, 'demo.py');
    fs.writeFileSync(script, 'import ivoryos_edge\nivoryos_edge.run(__name__)\n');
    const p = withDefaults(home, { kind: 'script', script, port: 8081, env: { PUMP_PORT: 'COM3' }, args: ['--fast'] });
    assert.equal(p.name, 'demo.py');
    assert.equal(p.dataDir, null);
    assert.deepEqual(validateProfile(p), []);
    const cmd = commandFor(p, { python: '/venv/bin/python', frontendDir: '/ui' });
    assert.equal(cmd.command, '/venv/bin/python');
    assert.deepEqual(cmd.args, [script, '--fast']);
    assert.equal(cmd.cwd, home);
    assert.equal(cmd.env.PUMP_PORT, 'COM3');
    assert.equal(cmd.env.IVORYOS_PORT, '8081');
    assert.equal(cmd.env.IVORYOS_HOST, '127.0.0.1');
    assert.equal(cmd.env.IVORYOS_DATA_DIR, undefined);
    assert.equal(commandFor({ ...p, python: '/my/venv/python' }, { python: '/venv/bin/python' }).command, '/my/venv/python');
    // The edge keeps its own Cloud default unless the launcher was given one; a profile's env wins.
    assert.equal(cmd.env.IVORYOS_CLOUD_URL, undefined);
    assert.equal(commandFor(p, { python: 'py', cloudUrl: 'http://lab-cloud:3000' }).env.IVORYOS_CLOUD_URL, 'http://lab-cloud:3000');
    const own = { ...p, env: { IVORYOS_CLOUD_URL: 'http://mine:3000' } };
    assert.equal(commandFor(own, { python: 'py', cloudUrl: 'http://lab-cloud:3000' }).env.IVORYOS_CLOUD_URL, 'http://mine:3000');
});

test('the app’s UI goes to edges in its venv; a script’s own interpreter serves the UI its edge carries', () => {
    const home = tmp();
    const script = path.join(home, 'deck.py');
    fs.writeFileSync(script, 'import ivoryos_edge\nivoryos_edge.run(__name__)\n');
    const ctx = { python: '/launcher/venv/bin/python', frontendDir: '/app/ui' };
    const inLauncher = withDefaults(home, { kind: 'script', script });
    assert.equal(commandFor(inLauncher, ctx).env.IVORYOS_FRONTEND_DIR, '/app/ui');
    assert.equal(commandFor(inLauncher, { ...ctx, edgeHasUi: true }).env.IVORYOS_FRONTEND_DIR, '/app/ui');
    const named = { ...inLauncher, python: '/launcher/venv/bin/python' };
    assert.equal(commandFor(named, { ...ctx, edgeHasUi: true }).env.IVORYOS_FRONTEND_DIR, '/app/ui', 'the launcher’s python, chosen by path');
    // A project's .venv ("Install IvoryOS here"): its edge can be another version than the app's.
    const project = { ...inLauncher, python: path.join(home, '.venv', 'bin', 'python') };
    assert.equal(commandFor(project, { ...ctx, edgeHasUi: true }).env.IVORYOS_FRONTEND_DIR, undefined);
    // ...unless that edge has no UI of its own (installed before its wheel carried one).
    assert.equal(commandFor(project, { ...ctx, edgeHasUi: false }).env.IVORYOS_FRONTEND_DIR, '/app/ui');
    assert.equal(commandFor(project, { python: ctx.python, edgeHasUi: false }).env.IVORYOS_FRONTEND_DIR, undefined, 'a build with no UI');
    const deck = withDefaults(home, { kind: 'deck' });
    assert.deepEqual(commandFor(deck, { ...ctx, edgeHasUi: true }).args.slice(-2), ['--frontend-dir', '/app/ui']);
    assert.equal(commandFor(deck, { ...ctx, edgeHasUi: true }).env.IVORYOS_FRONTEND_DIR, '/app/ui');
});

test('deck profiles run the deck through the CLI with their own data folder', () => {
    const home = tmp();
    const p = withDefaults(home, { kind: 'deck', name: 'Bench 3', listenOnNetwork: true });
    const cmd = commandFor(p, { python: 'py' });
    assert.deepEqual(cmd.args.slice(0, 5), ['-m', 'ivoryos_edge', '--deck', p.deck, '--data-dir']);
    assert.ok(cmd.args.includes('0.0.0.0'));
    assert.equal(cmd.env.IVORYOS_DATA_DIR, p.dataDir);
});

test('validateProfile names each problem', () => {
    const problems = validateProfile({ name: '', kind: 'script', script: '/nope.py', port: 80, env: { 'BAD-NAME': '1' } });
    assert.equal(problems.length, 4);
    assert.ok(problems.some((p) => /port/.test(p)));
    assert.ok(problems.some((p) => /BAD-NAME/.test(p)));
    assert.ok(problems.some((p) => /does not exist/.test(p)));
});

test('saveProfiles round-trips and remembers the Hub address', () => {
    const home = tmp();
    const store = loadProfiles(home);
    store.hubUrl = 'http://localhost:3000';
    store.profiles.push(withDefaults(home, { kind: 'deck', name: 'Second' }));
    saveProfiles(home, store);
    const again = loadProfiles(home);
    assert.equal(again.hubUrl, 'http://localhost:3000');
    assert.deepEqual(again.profiles.map((p) => p.name), ['My deck', 'Second']);
});

const deck = { format: 'ivoryos-deck/1', instruments: [
    { name: 'pump', import: 'p', class: 'Pump', args: { port: 'COM3' } },
    { name: 'balance', import: 'b', class: 'Balance' },
] };

test('updateInstrument changes a COM port, renames only to a free name', () => {
    const next = updateInstrument(deck, 'pump', { ...deck.instruments[0], args: { port: 'COM4' } });
    assert.equal(next.instruments[0].args.port, 'COM4');
    assert.equal(deck.instruments[0].args.port, 'COM3', 'original untouched');
    assert.equal(updateInstrument(deck, 'pump', { ...deck.instruments[0], name: 'pump_a' }).instruments[0].name, 'pump_a');
    assert.throws(() => updateInstrument(deck, 'pump', { ...deck.instruments[0], name: 'balance' }), DeckEditError);
    assert.throws(() => updateInstrument(deck, 'pump', { ...deck.instruments[0], name: '9x' }), DeckEditError);
    assert.throws(() => updateInstrument(deck, 'ghost', deck.instruments[0]), /no instrument/);
});

test('instruments can be switched off, back on, and removed', () => {
    const off = setInstrumentEnabled(deck, 'balance', false);
    assert.equal(off.instruments[1].enabled, false);
    assert.equal('enabled' in setInstrumentEnabled(off, 'balance', true).instruments[1], false);
    assert.deepEqual(removeInstrument(deck, 'pump').instruments.map((i) => i.name), ['balance']);
});

test('freeName makes a usable, unused instrument name', () => {
    assert.equal(freeName(deck, 'Pump'), 'pump_2');
    assert.equal(freeName(deck, 'Sf10 Pump #1'), 'sf10_pump_1');
    assert.equal(freeName(deck, '1st HPLC'), 'device_1st_hplc');
    assert.equal(freeName(deck, '!!'), 'device');
});

test('launcher-wide settings survive a restart', () => {
    const home = tmp();
    const store = loadProfiles(home);
    saveProfiles(home, { ...store, hubUrl: 'http://localhost:3111', cloudUrl: 'http://localhost:3002' });
    const again = loadProfiles(home);
    assert.equal(again.hubUrl, 'http://localhost:3111');
    assert.equal(again.cloudUrl, 'http://localhost:3002');
});

test('notification choices and a muted deck survive a restart', () => {
    const { ProfileManager } = require('../src/manager');
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(mgr.notifications.events.finished, true);
    mgr.setNotifications({ events: { finished: false }, minRunMinutes: 30 });
    const [deck] = mgr.list();
    mgr.update(deck.id, { muteNotifications: true });
    const again = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(again.notifications.events.finished, false);
    assert.equal(again.notifications.events.input, true);
    assert.equal(again.notifications.minRunMinutes, 30);
    assert.equal(again.get(deck.id).muteNotifications, true);
});

test('a profiles.json saved with a byte-order mark is read, not replaced by defaults', () => {
    const home = tmp();
    const { profiles: [first] } = loadProfiles(home);
    const file = path.join(home, 'profiles.json');
    fs.writeFileSync(file, '﻿' + fs.readFileSync(file, 'utf8').replace(/"port": \d+/, '"port": 8095'));
    const [again] = loadProfiles(home).profiles;
    assert.equal(again.id, first.id);
    assert.equal(again.port, 8095);
});

test('close goes to the tray and minimize to the taskbar by default; both persist; unknown keys are refused', () => {
    const { ProfileManager } = require('../src/manager');
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(mgr.windowPref('minimizeToTray'), false);
    assert.equal(mgr.windowPref('closeToTray'), true);
    assert.equal(mgr.windowPref('trayHintShown'), false);
    mgr.setWindowPref('closeToTray', false);
    mgr.setWindowPref('minimizeToTray', true);
    mgr.setWindowPref('trayHintShown', true);
    const again = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(again.windowPref('closeToTray'), false, 'kept across launches');
    assert.equal(again.windowPref('minimizeToTray'), true, 'a chosen tray is kept');
    assert.equal(again.windowPref('trayHintShown'), true, 'the hint is shown once, not every launch');
    assert.throws(() => mgr.setWindowPref('launchMissiles', true), /Unknown setting/);
});

test('the app version that last emptied the HTTP cache is kept across launches', () => {
    // main.js empties Chromium's cache once per app version (an older edge's pages were kept in
    // it as fresh); a setting left out of loadProfiles is lost at the next launch, so this one is
    // held to the same read-back as the others.
    const { ProfileManager } = require('../src/manager');
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(mgr.cacheClearedFor, null, 'a first launch, or a profiles.json from before this: cleared once');
    mgr.setCacheClearedFor('0.1.2');
    const again = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(again.cacheClearedFor, '0.1.2', 'kept, so the same version does not clear again');
});

test('the old minimizeToTray: true, written for everyone, does not keep minimize in the tray', () => {
    const { ProfileManager } = require('../src/manager');
    const home = tmp();
    new ProfileManager({ home, getRuntime: async () => ({}) });  // writes profiles.json
    const file = path.join(home, 'profiles.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...stored, minimizeToTray: true, closeToTray: true }));
    const mgr = new ProfileManager({ home, getRuntime: async () => ({}) });
    assert.equal(mgr.windowPref('minimizeToTray'), false);
    assert.equal(mgr.windowPref('closeToTray'), true);
    mgr.setWindowPref('closeToTray', true);
    assert.equal('minimizeToTray' in JSON.parse(fs.readFileSync(file, 'utf8')), false, 'the old key is dropped on the next save');
});

test('a release without Cloud tells the decks it starts, so their own pages do not offer it', () => {
    const { commandFor, withDefaults } = require('../src/profiles');
    const profile = withDefaults('/tmp/home', { name: 'Bench', kind: 'deck', port: 8090 });
    assert.equal(commandFor(profile, { python: 'python', cloudComingSoon: true }).env.IVORYOS_CLOUD_COMING_SOON, '1');
    assert.equal(commandFor(profile, { python: 'python' }).env.IVORYOS_CLOUD_COMING_SOON, undefined);
});

// GitHub issue 37: a script from an existing repository imported a package beside it
// (`from drivers import ...`, `repo/drivers/`) and failed with "No module named 'drivers'" from
// the launcher while it ran in PyCharm, which puts the project's root on the module path.
test('a script profile puts its project on the module path, as PyCharm does', () => {
    const home = tmp();
    const repo = path.join(home, 'lab-repo');
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'drivers'));
    fs.mkdirSync(path.join(repo, 'src'));
    fs.mkdirSync(path.join(repo, '.git'));
    fs.writeFileSync(path.join(repo, 'pyproject.toml'), '[project]\nname = "lab"\n');
    const script = path.join(repo, 'scripts', 'deck.py');
    fs.writeFileSync(script, 'from drivers import pump\n');
    const p = withDefaults(home, { kind: 'script', script, port: 8081, env: { PYTHONPATH: '/extra' } });
    const cmd = commandFor(p, { python: '/venv/bin/python' });
    const entries = cmd.env.PYTHONPATH.split(path.delimiter);
    assert.equal(entries[0], '/extra', 'the profile’s own PYTHONPATH comes first');
    assert.ok(entries.includes(repo), `the project root: ${entries}`);
    assert.ok(entries.includes(path.join(repo, 'src')), 'a src layout');
    assert.ok(!entries.includes(home), 'the walk ends at the repository');
    assert.equal(cmd.cwd, path.join(repo, 'scripts'));
});

test('the module path has every project folder up to the repository, nearest first, and the working folder', () => {
    const { modulePathFor } = require('../src/profiles');
    const home = tmp();
    const repo = path.join(home, 'mono');
    const project = path.join(repo, 'labs', 'mylab');
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.idea'));
    fs.writeFileSync(path.join(project, 'requirements.txt'), 'pyserial\n');
    const script = path.join(project, 'scripts', 'deck.py');
    fs.writeFileSync(script, '');
    const entries = modulePathFor(script, repo, []).split(path.delimiter);
    assert.deepEqual(entries, [repo, project]);
    // A src/ that is a package of its own is not a source root.
    fs.mkdirSync(path.join(project, 'src'));
    fs.writeFileSync(path.join(project, 'src', '__init__.py'), '');
    assert.deepEqual(modulePathFor(script, null, []).split(path.delimiter), [project, repo]);
});

test('a script with no project around it gets no module path of its own', () => {
    const home = tmp();
    const script = path.join(home, 'alone.py');
    fs.writeFileSync(script, '');
    const { modulePathFor } = require('../src/profiles');
    assert.equal(modulePathFor(script, path.dirname(script), []), null);
    assert.equal(modulePathFor(script, path.dirname(script), ['/mine']), '/mine', 'only what the person set');
});
