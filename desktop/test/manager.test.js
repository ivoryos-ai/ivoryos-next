'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ProfileManager, portIsFree } = require('../src/manager');

const FAKE = path.join(__dirname, 'fake-edge.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivoryos-mgr-'));
const freePort = () => new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});
const post = (port, p) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: p }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject); req.end();
});
const getJson = (port, p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => resolve(JSON.parse(b))); }).on('error', reject);
});
const waitFor = async (fn, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('timed out');
};

// A "Python" that is node, and a "script" that is the fake edge: a script profile runs
// `<python> <script> <args>` with IVORYOS_PORT set, which is all the fake needs.
function fakeRuntime(overrides = {}) {
    return { python: process.execPath, ensurePackages: async () => {}, ...overrides };
}

test('script profiles start on their port, report it, and stop', async (t) => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    t.after(() => mgr.stopAll());
    const port = await freePort();
    const p = mgr.create({ kind: 'script', name: 'Demo', script: FAKE, port });
    const status = await mgr.start(p.id);
    assert.equal(status.state, 'running');
    assert.equal(status.url, `http://127.0.0.1:${port}`);
    assert.match(mgr.logTail(p.id), /fake edge listening/);
    await mgr.stop(p.id);
    assert.equal(mgr.statusOf(p.id).state, 'stopped');
});

test('two profiles cannot share a port, and the message names the other one', async (t) => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    t.after(() => mgr.stopAll());
    const port = await freePort();
    const a = mgr.create({ kind: 'script', name: 'Bench A', script: FAKE, port });
    const b = mgr.create({ kind: 'script', name: 'Bench B', script: FAKE, port });
    await mgr.start(a.id);
    await assert.rejects(mgr.start(b.id), /already used by "Bench A"/);
    assert.equal(mgr.statusOf(b.id).state, 'error');
    await mgr.stopAll();
});

test('the web Restart button (exit 75) keeps the profile running; a crash is reported', async (t) => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    t.after(() => mgr.stopAll());
    const port = await freePort();
    const p = mgr.create({ kind: 'script', name: 'Demo', script: FAKE, port });
    await mgr.start(p.id);
    const firstPid = (await getJson(port, '/api/status')).pid;
    await post(port, '/restart');
    // Wait for a different process to be answering: the old one keeps serving for a moment after
    // it asks to be restarted, and a request sent to it then would race its own exit.
    let pid = firstPid;
    await waitFor(() => { getJson(port, '/api/status').then((s) => { pid = s.pid; }, () => {}); return pid !== firstPid; });
    await waitFor(() => mgr.statusOf(p.id).state === 'running');
    const crashed = new Promise((resolve) => mgr.once('crashed', resolve));
    await post(port, '/crash');
    await crashed;
    assert.equal(mgr.statusOf(p.id).state, 'crashed');
    assert.match(mgr.statusOf(p.id).logTail, /Traceback: boom/);
});

test('a script with its own interpreter is asked whether its edge carries a UI before the app’s is passed', async (t) => {
    const home = tmp();
    const asked = [];
    let carries = true;
    const mgr = new ProfileManager({ home, frontendDir: '/app/ui', getRuntime: async () => fakeRuntime({
        python: path.join(home, 'launcher-python'),
        hasOwnUi: async (python, opts) => { asked.push({ python, cwd: opts.cwd }); return carries; },
    }) });
    t.after(() => mgr.stopAll());
    const port = await freePort();
    const p = mgr.create({ kind: 'script', name: 'Project', script: FAKE, python: process.execPath, port });
    await mgr.start(p.id);
    assert.deepEqual(asked, [{ python: process.execPath, cwd: path.dirname(FAKE) }]);
    assert.equal((await getJson(port, '/api/status')).frontendDir, undefined, 'serves the UI it carries');
    await mgr.stop(p.id);

    carries = false;
    await mgr.start(p.id);
    assert.equal((await getJson(port, '/api/status')).frontendDir, '/app/ui', 'none of its own: the app’s');
});

test('an invalid profile does not start, and says why', async () => {
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => fakeRuntime() });
    const p = mgr.create({ kind: 'script', name: 'Missing', script: '/nowhere/demo.py' });
    await assert.rejects(mgr.start(p.id), /does not exist/);
});

test('install writes the deck only after packages install, and a failure leaves it unchanged', async () => {
    const home = tmp();
    let fail = true;
    const installed = [];
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime({
        ensurePackages: async (reqs) => { if (fail) throw Object.assign(new Error('uv pip failed'), { output: 'No solution found' }); installed.push(...reqs); },
    }) });
    const [deckProfile] = mgr.list();
    const manifest = { packages: ['vendor-pumps==1.0'], instruments: [{ name: 'pump', import: 'vendor_pumps', class: 'Pump', args: { port: 'COM3' } }] };

    await assert.rejects(mgr.install(deckProfile.id, manifest), /uv pip failed/);
    assert.deepEqual(mgr.readDeck(deckProfile.id).instruments || [], []);

    fail = false;
    const result = await mgr.install(deckProfile.id, manifest);
    assert.deepEqual(result.added, ['pump']);
    assert.deepEqual(installed, ['vendor-pumps==1.0']);
    assert.equal(mgr.readDeck(deckProfile.id).instruments[0].args.port, 'COM3');

    await mgr.saveInstrument(deckProfile.id, 'pump', { name: 'pump', import: 'vendor_pumps', class: 'Pump', args: { port: 'COM4' } });
    assert.equal(mgr.readDeck(deckProfile.id).instruments[0].args.port, 'COM4');
    await mgr.setInstrumentEnabled(deckProfile.id, 'pump', false);
    assert.equal(mgr.readDeck(deckProfile.id).instruments[0].enabled, false);
});

test("a deck's package list follows its instruments, and packages update and come off it without uninstalling", async () => {
    const installs = [];
    let fail = false;
    // What the environment says each entry needs (runtime.probeDeckPackages): the pump needs its
    // driver, the plugin its own package, nothing needs `leftover`.
    const probeDeckPackages = async ({ entries, requirements }) => ({
        requirements: Object.fromEntries(requirements.map((r) => [r.key, { dist: r.name, version: '1.0' }])),
        entries: Object.fromEntries(entries.map((e) => [e.id, e.id === 'instrument:pump' ? ['vendor-pumps'] : e.id.startsWith('plugin:') ? ['view-kit'] : []])),
    });
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => fakeRuntime({
        probeDeckPackages,
        ensurePackages: async (reqs) => { installs.push([...reqs]); if (fail) throw Object.assign(new Error('uv pip failed'), { output: 'No solution found' }); },
        upgradeCandidate: async (reqs, target, installed) => ({ latest: target.name === 'vendor-pumps' ? '1.4' : null, changes: [], installed }),
    }) });
    const [deckProfile] = mgr.list();
    await mgr.install(deckProfile.id, {
        packages: ['vendor-pumps==1.0', 'view-kit==1.0', 'leftover==1.0', 'ax-platform==1.3.1'],
        instruments: [{ name: 'pump', import: 'vendor_pumps', class: 'Pump' }],
        plugins: ['view_kit.plugin:plugin'],
    });

    const { rows } = await mgr.deckPackages(deckProfile.id);
    assert.deepEqual(rows.map((r) => [r.key, r.status]), [['vendor-pumps', 'used'], ['view-kit', 'used'], ['leftover', 'unused'], ['ax-platform', 'used']]);

    // Optimizers are not checked here: their versions are the tested ones on the Optimizers card.
    const updates = await mgr.checkPackageUpdates(deckProfile.id);
    assert.deepEqual(Object.keys(updates).sort(), ['leftover', 'vendor-pumps', 'view-kit']);
    assert.equal(updates['vendor-pumps'].latest, '1.4');
    assert.equal(updates['vendor-pumps'].installed, '1.0', 'checked from the installed version');

    // An update that does not install leaves the deck as it was.
    fail = true;
    await assert.rejects(mgr.updatePackage(deckProfile.id, 'vendor-pumps', '1.4'), /uv pip failed/);
    assert.ok(mgr.readDeck(deckProfile.id).packages.includes('vendor-pumps==1.0'));
    fail = false;
    await mgr.updatePackage(deckProfile.id, 'vendor-pumps', '1.4');
    assert.ok(mgr.readDeck(deckProfile.id).packages.includes('vendor-pumps==1.4'));
    assert.ok(installs.at(-1).includes('vendor-pumps==1.4'), 'installed with the rest of the deck');

    // Removing the pump and the plugin takes off what only they needed; `leftover` is for the person.
    await mgr.removeInstrument(deckProfile.id, 'pump');
    await mgr.removePlugin(deckProfile.id, 'view_kit.plugin:plugin');
    assert.deepEqual(mgr.readDeck(deckProfile.id).packages, ['leftover==1.0', 'ax-platform==1.3.1']);
    const before = installs.length;
    await mgr.removePackages(deckProfile.id, ['leftover']);
    assert.deepEqual(mgr.readDeck(deckProfile.id).packages, ['ax-platform==1.3.1']);
    assert.equal(installs.length, before, 'taking a package off the list installs and uninstalls nothing');
});

test('optimizers install with the rest of the deck, and the deck changes only once they did', async () => {
    let fail = true;
    const installs = [];
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => fakeRuntime({
        ensurePackages: async (reqs) => { installs.push([...reqs]); if (fail) throw Object.assign(new Error('uv pip failed'), { output: 'No solution found' }); },
    }) });
    const [deckProfile] = mgr.list();
    await assert.rejects(mgr.setOptimizers(deckProfile.id, { baybe: '0.15.0' }), /uv pip failed/);
    assert.deepEqual(mgr.readDeck(deckProfile.id).packages || [], []);
    assert.match(mgr.statusOf(deckProfile.id).message, /^Install failed/);

    fail = false;
    const chosen = await mgr.setOptimizers(deckProfile.id, { ax: '1.3.1', baybe: '0.15.0' });
    assert.deepEqual(chosen, { ax: '1.3.1', baybe: '0.15.0', nimo: null });
    // One resolution for the deck's whole list, optimizers included.
    assert.deepEqual(installs.at(-1), ['ax-platform==1.3.1', 'baybe==0.15.0']);
    assert.deepEqual(mgr.readDeck(deckProfile.id).packages, ['ax-platform==1.3.1', 'baybe==0.15.0']);
});

// A deck profile runs real Python, so these stand in for a started one the way _start leaves it:
// its process, and what that process read when it started.
function pretendRunning(mgr, id) {
    const seen = { stops: 0 };
    mgr.running.set(id, { supervisor: { stop: async () => { seen.stops += 1; }, logTail: '' }, startedWith: mgr._startedWith(mgr.get(id)), packagesChanged: false });
    mgr._setStatus(id, { state: 'running' });
    seen.state = () => { const s = mgr.statusOf(id); return [s.state, s.pending.join('+'), seen.stops]; };
    return seen;
}

test('editing a running deck never restarts it: the edit is saved and shown as not applied yet', async () => {
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => fakeRuntime() });
    const [deckProfile] = mgr.list();
    const id = deckProfile.id;
    await mgr.install(id, {
        packages: [],
        instruments: [{ name: 'pump', import: 'vendor_pumps', class: 'Pump', args: { port: 'COM3' } }, { name: 'balance', import: 'vendor_balances', class: 'Balance' }],
        plugins: ['view_kit.plugin:plugin'],
    });
    const { state } = pretendRunning(mgr, id);
    assert.deepEqual(state(), ['running', '', 0]);
    assert.equal(mgr.statusOf(id).needsRestart, false);

    // The check marks: off is saved and pending, back on is the deck that is loaded again.
    await mgr.setInstrumentEnabled(id, 'balance', false);
    assert.equal(mgr.readDeck(id).instruments[1].enabled, false);
    assert.deepEqual(state(), ['running', 'deck', 0]);
    assert.equal(mgr.statusOf(id).needsRestart, true);
    await mgr.setInstrumentEnabled(id, 'balance', true);
    assert.deepEqual(state(), ['running', '', 0]);
    await mgr.setPluginEnabled(id, 'view_kit.plugin:plugin', false);
    assert.deepEqual(state(), ['running', 'deck', 0]);
    await mgr.setPluginEnabled(id, 'view_kit.plugin:plugin', true);
    assert.deepEqual(state(), ['running', '', 0]);

    // So are a changed argument and a removal.
    await mgr.saveInstrument(id, 'pump', { name: 'pump', import: 'vendor_pumps', class: 'Pump', args: { port: 'COM4' } });
    assert.deepEqual(state(), ['running', 'deck', 0]);
    await mgr.removePlugin(id, 'view_kit.plugin:plugin');
    await mgr.removeInstrument(id, 'balance');
    assert.deepEqual(state(), ['running', 'deck', 0]);

    // Stopping it is the person's; a stopped deck has nothing pending, and edits it freely.
    await mgr.stop(id);
    assert.deepEqual(state(), ['stopped', '', 1]);
    await mgr.setInstrumentEnabled(id, 'pump', false);
    assert.deepEqual(state(), ['stopped', '', 1]);
});

test('whatever is saved differently from what a running profile started with is not applied yet', async () => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    const [deckProfile] = mgr.list();
    const id = deckProfile.id;
    const { state } = pretendRunning(mgr, id);

    // A saved setting, and the same setting put back.
    const port = mgr.get(id).port;
    mgr.update(id, { port: port + 1 });
    assert.deepEqual(state(), ['running', 'settings', 0]);
    mgr.update(id, { port });
    assert.deepEqual(state(), ['running', '', 0]);
    // What does not reach the process is no change: its name, whether it starts with the app.
    mgr.update(id, { name: 'Renamed', autoStart: true });
    assert.deepEqual(state(), ['running', '', 0]);
    mgr.update(id, { env: { PUMP_PORT: 'COM4' } });
    assert.deepEqual(state(), ['running', 'settings', 0]);

    // The launcher's Cloud address is read by each edge when it starts.
    mgr.setCloudUrl('cloud.mylab.local');
    assert.deepEqual(state(), ['running', 'settings+cloud', 0]);

    // A deck file changed outside the app counts as well.
    const deck = mgr.readDeck(id);
    fs.mkdirSync(path.dirname(mgr.get(id).deck), { recursive: true });
    fs.writeFileSync(mgr.get(id).deck, JSON.stringify({ ...deck, instruments: [{ name: 'pump', import: 'vendor_pumps', class: 'Pump' }] }));
    assert.deepEqual(state(), ['running', 'deck+settings+cloud', 0]);
});

test('a script profile says when its file changed since it started, until it is restarted', async (t) => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    t.after(() => mgr.stopAll());
    const script = path.join(home, 'deck.js');
    fs.copyFileSync(FAKE, script);
    const port = await freePort();
    const p = mgr.create({ kind: 'script', name: 'Bench', script, port });
    await mgr.start(p.id);
    assert.deepEqual(mgr.statusOf(p.id).pending, []);

    fs.appendFileSync(script, '\n// pump on COM4 now\n');
    assert.deepEqual(mgr.statusOf(p.id).pending, ['script']);
    assert.equal(mgr.statusOf(p.id).needsRestart, true);

    // The edge's own Restart reads the file again; nobody restarted it from here.
    const firstPid = (await getJson(port, '/api/status')).pid;
    await post(port, '/restart');
    let pid = firstPid;
    await waitFor(() => { getJson(port, '/api/status').then((s) => { pid = s.pid; }, () => {}); return pid !== firstPid; });
    await waitFor(() => mgr.statusOf(p.id).state === 'running');
    assert.deepEqual(mgr.statusOf(p.id).pending, []);

    // A setting saved meanwhile still waits: that restart reused the command it was started with.
    mgr.update(p.id, { env: { PUMP_PORT: 'COM4' } });
    assert.deepEqual(mgr.statusOf(p.id).pending, ['settings']);
    await mgr.restart(p.id);
    assert.deepEqual(mgr.statusOf(p.id).pending, []);
});

test('an install never stops a running deck: it goes in when it only adds, and is refused otherwise', async () => {
    const installs = [];
    let plan = [{ change: '+', name: 'vendor-pumps', version: '1.0' }];
    let activeRun = null;
    let fail = false;
    const mgr = new ProfileManager({
        home: tmp(),
        activeRun: () => activeRun,
        getRuntime: async () => fakeRuntime({
            installPlan: async () => plan,
            ensurePackages: async (reqs) => { if (fail) throw Object.assign(new Error('uv pip failed'), { output: 'No solution found' }); installs.push([...reqs]); },
        }),
    });
    const [deckProfile] = mgr.list();
    const id = deckProfile.id;
    const { state } = pretendRunning(mgr, id);
    const pump = { packages: ['vendor-pumps==1.0'], instruments: [{ name: 'pump', import: 'vendor_pumps', class: 'Pump' }] };

    // On a run: nothing is installed and the deck is as it was.
    activeRun = { id: 'r1', name: 'Screen #4' };
    await assert.rejects(mgr.install(id, pump), (e) => e.code === 'run-under-way' && /"Screen #4" is under way/.test(e.message));
    assert.deepEqual([installs.length, mgr.readDeck(id).instruments || [], state()], [0, [], ['running', '', 0]]);
    activeRun = null;

    // Only adding: installed while it runs, on the deck, and not applied until someone restarts it.
    assert.deepEqual((await mgr.install(id, pump)).added, ['pump']);
    assert.deepEqual(installs, [['vendor-pumps==1.0']]);
    assert.deepEqual(state(), ['running', 'deck+packages', 0]);
    assert.equal(mgr.statusOf(id).installing, null);

    // Replacing something installed (an update always does): the person stops the deck first.
    plan = [{ change: '-', name: 'vendor-pumps', version: '1.0' }, { change: '+', name: 'vendor-pumps', version: '1.4' }];
    await assert.rejects(mgr.updatePackage(id, 'vendor-pumps', '1.4'), (e) => e.code === 'stop-first' && /vendor-pumps 1\.0/.test(e.message) && /never stopped for you/.test(e.message));
    await assert.rejects(mgr.setOptimizers(id, { ax: '1.3.1' }), (e) => e.code === 'stop-first');
    assert.ok(mgr.readDeck(id).packages.includes('vendor-pumps==1.0'));
    assert.deepEqual([installs.length, state()], [1, ['running', 'deck+packages', 0]]);

    // An install that fails leaves a running deck running, with no error state of its own.
    plan = [{ change: '+', name: 'ax-platform', version: '1.3.1' }];
    fail = true;
    await assert.rejects(mgr.setOptimizers(id, { ax: '1.3.1' }), /uv pip failed/);
    assert.deepEqual(state(), ['running', 'deck+packages', 0]);
    fail = false;

    // Stopped by the person, the same update installs.
    await mgr.stop(id);
    await mgr.updatePackage(id, 'vendor-pumps', '1.4');
    assert.ok(mgr.readDeck(id).packages.includes('vendor-pumps==1.4'));
    assert.deepEqual(state(), ['stopped', '', 1]);
});

test('script profiles have no deck to edit', () => {
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => fakeRuntime() });
    const p = mgr.create({ kind: 'script', script: FAKE });
    assert.throws(() => mgr.readDeck(p.id), /Only deck profiles/);
});

test('overlapping restarts and edits leave exactly one process, and Stop reaches it', async (t) => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    t.after(() => mgr.stopAll());
    const port = await freePort();
    const p = mgr.create({ kind: 'script', name: 'Busy bench', script: FAKE, port });
    await mgr.start(p.id);
    // What rapid clicking in the launcher does: several restarts in flight at once.
    await Promise.all([mgr.restart(p.id), mgr.restart(p.id), mgr.restart(p.id), mgr.start(p.id)]);
    const tracked = mgr.running.get(p.id).supervisor.child.pid;
    assert.equal((await getJson(port, '/api/status')).pid, tracked, 'the process answering is the one the manager tracks');
    await mgr.stop(p.id);
    assert.equal(mgr.statusOf(p.id).state, 'stopped');
    assert.ok(await portIsFree(port), 'nothing is left listening: no untracked edge survived');
});

test('a Cloud address without a scheme gets http on this computer or the lab network, https elsewhere', () => {
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => fakeRuntime() });
    const cases = {
        'localhost:3002': 'http://localhost:3002',
        '192.168.1.20:3000/': 'http://192.168.1.20:3000',
        'labcloud.local:3000': 'http://labcloud.local:3000',
        'cloud.mylab.org': 'https://cloud.mylab.org',
        'https://localhost:3002': 'https://localhost:3002', // an explicit scheme is kept
    };
    for (const [typed, saved] of Object.entries(cases)) {
        mgr.setCloudUrl(typed);
        assert.equal(mgr.cloudUrl, saved, typed);
    }
    mgr.setCloudUrl('');
    assert.equal(mgr.cloudUrl, process.env.IVORYOS_CLOUD_URL || 'https://cloud.ivoryos.ai');
});

test('the first profile of a fresh install gets its data folder when started', async (t) => {
    // loadProfiles makes that profile without writing its folder, and the edge runs with the
    // data folder as its cwd; a missing cwd failed every first launch as "spawn python ENOENT".
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    t.after(() => mgr.stopAll());
    const [first] = mgr.list();
    assert.equal(fs.existsSync(first.dataDir), false);
    mgr.update(first.id, { port: await freePort() });
    await mgr.start(first.id).catch(() => {}); // node is not an edge; only the folder matters here
    assert.ok(fs.existsSync(first.dataDir));
    assert.doesNotMatch(mgr.logTail(first.id), /ENOENT/);
});

test('a new profile gets a port no profile uses and nothing listens on; a new deck file takes its name', async (t) => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    const busy = net.createServer();
    const start = await freePort();
    await new Promise((r) => busy.listen(start, '0.0.0.0', r));
    t.after(() => busy.close());
    mgr.create({ kind: 'script', name: 'Other', script: FAKE, port: start + 1 });
    const port = await mgr.freePort(start);
    assert.ok(port !== start && port !== start + 1, `picked ${port}`);
    const deck = mgr.create({ kind: 'deck', name: 'Hein Lab flow bench', port });
    assert.equal(mgr.readDeck(deck.id).name, 'Hein Lab flow bench');
});

test('stars are kept per account, deduplicated, and survive a reload', () => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    mgr.setStarred('u1', 'module:12', true);
    mgr.setStarred('u1', 'module:12', true);
    mgr.setStarred('u1', 'platform:4', true);
    mgr.setStarred('u2', 'plugin:3', true);
    assert.deepEqual(mgr.starred('u1'), ['module:12', 'platform:4']);
    mgr.setStarred('u1', 'module:12', false);
    assert.throws(() => mgr.setStarred('u1', 'rm -rf', true), /Not a Hub item/);
    const again = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    assert.deepEqual(again.starred('u1'), ['platform:4']);
    assert.deepEqual(again.starred('u2'), ['plugin:3']);
    assert.deepEqual(again.starred('nobody'), []);
});

test('Cloud-only mode is kept as saved but not in force while Cloud is not offered', () => {
    const home = tmp();
    const first = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    first.setCloudOnly(true);
    assert.equal(first.cloudOnly, true);
    const release = new ProfileManager({ home, getRuntime: async () => fakeRuntime(), cloudComingSoon: true });
    assert.equal(release.cloudOnly, false);
    assert.equal(release.store.cloudOnly, true);   // still saved for a build that offers Cloud
});

test("a script profile switches its script's objects on and off, applied at the next start (issue 88)", async () => {
    const home = tmp();
    const mgr = new ProfileManager({ home, getRuntime: async () => fakeRuntime() });
    const p = mgr.create({ kind: 'script', name: 'Bench', script: FAKE, port: 9701 });
    const { state } = pretendRunning(mgr, p.id);

    mgr.setInstrumentChoice(p.id, 'calibration', true);
    mgr.setInstrumentChoice(p.id, 'camera', false);
    assert.deepEqual(mgr.get(p.id).instrumentChoices, { calibration: true, camera: false });
    assert.deepEqual(state(), ['running', 'deck', 0]); // saved, shown as not applied, never restarted

    // Forgetting both is back to what it started with: nothing to apply.
    mgr.setInstrumentChoice(p.id, 'calibration', null);
    mgr.setInstrumentChoice(p.id, 'camera', null);
    assert.deepEqual(mgr.get(p.id).instrumentChoices, {});
    assert.deepEqual(state(), ['running', '', 0]);

    // A deck profile switches the entries of its deck file instead.
    const [deckProfile] = mgr.list().filter((x) => x.kind === 'deck');
    assert.throws(() => mgr.setInstrumentChoice(deckProfile.id, 'pump', false), /script profile/);
    assert.throws(() => mgr.setInstrumentChoice(p.id, 'a,b', false), /not a name/);
});
