'use strict';
// Decks sharing one Python environment, and a deck given its own (issue 82): manager.js
// `_planInstall` and `setEnvironment`, against a runtime that resolves like uv in miniature.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileManager } = require('../src/manager');
const { writeDeckFile } = require('../src/profiles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivoryos-env-'));

// Drivers and what they pin. Two different pins of one package cannot both be met.
const DEPS = {
    'plr-ivoryos==1.0.0b1': ['pylabrobot==1.0.0b1'],
    'old-plr-driver==0.3': ['pylabrobot==0.2.1'],
    'old-orm-driver==1': ['sqlalchemy==1.4'],
};
const EDGE = ['sqlalchemy==2.0', 'fastapi'];

function resolve(requirements) {
    const all = requirements.flatMap((r) => [r, ...(DEPS[r] || [])]);
    const pins = new Map();
    for (const r of all) {
        const m = /^([a-z0-9-]+)==(\S+)$/.exec(r);
        if (!m) continue;
        if (pins.has(m[1]) && pins.get(m[1]) !== m[2]) {
            return {
                ok: false,
                output: `  × No solution found when resolving dependencies:\n  ╰─▶ Because you require ${m[1]}==${pins.get(m[1])} and ${m[1]}==${m[2]}, we can\n      conclude that your requirements are unsatisfiable.`,
            };
        }
        pins.set(m[1], m[2]);
    }
    return { ok: true, changes: [...pins].map(([name, version]) => ({ change: '+', name, version })) };
}

/** A shared runtime and the decks' own ones, each recording what it was asked to install. */
function runtimes() {
    const make = (name) => {
        const installed = {};
        const rt = {
            name, python: `/py/${name}/bin/python`, uv: '/bin/uv', installs: [], resolves: 0,
            ensure: async () => {},
            edgeRequirements: async () => EDGE,
            resolve: async (reqs) => { rt.resolves += 1; return resolve(reqs); },
            packagesUpToDate: (reqs, key) => installed[key] === JSON.stringify([...reqs].sort()),
            installedPackages: (key) => (installed[key] ? JSON.parse(installed[key]) : null),
            forgetPackages: (key) => { delete installed[key]; },
            ensurePackages: async (reqs, { key, install }) => {
                if (rt.packagesUpToDate(reqs, key)) return;
                rt.installs.push(install || reqs);
                installed[key] = JSON.stringify([...reqs].sort());
            },
        };
        return rt;
    };
    const shared = make('shared');
    const own = new Map();
    const removed = [];
    shared.forDeck = (id) => { if (!own.has(id)) own.set(id, make(id)); return own.get(id); };
    shared.removeDeckEnvironment = (id) => { own.delete(id); removed.push(id); };
    return { shared, own, removed };
}

function setUp() {
    const rts = runtimes();
    const mgr = new ProfileManager({ home: tmp(), getRuntime: async () => rts.shared });
    const flex = mgr.create({ kind: 'deck', name: 'Flex' });
    const old = mgr.create({ kind: 'deck', name: 'Old bench' });
    return { mgr, ...rts, flex: flex.id, old: old.id };
}

const plr = { packages: ['plr-ivoryos==1.0.0b1'], instruments: [{ name: 'flex', import: 'plr_ivoryos.opentrons', class: 'Flex' }] };
const oldPlr = { packages: ['old-plr-driver==0.3'], instruments: [{ name: 'star', import: 'old_plr_driver', class: 'Star' }] };

test('an install is one resolution with the other decks and the edge, so nothing of theirs is replaced', async () => {
    const { mgr, shared, flex, old } = setUp();
    await mgr.install(flex, plr);
    await mgr.install(old, { packages: ['vendor-pumps==1.0'], instruments: [] });
    assert.deepEqual(shared.installs, [
        ['plr-ivoryos==1.0.0b1', ...EDGE],
        ['vendor-pumps==1.0', ...EDGE, 'plr-ivoryos==1.0.0b1'],
    ]);
});

test("a deck that cannot share with another installs nothing, names that deck, and says what would help", async () => {
    const { mgr, shared, flex, old } = setUp();
    const third = mgr.create({ kind: 'deck', name: 'Balance' }).id;
    await mgr.install(flex, plr);
    await mgr.install(third, { packages: ['vendor-balance==2'], instruments: [] });
    const before = mgr.readDeck(old);

    const err = await mgr.install(old, oldPlr).then(() => null, (e) => e);
    assert.equal(err.code, 'package-conflict');
    assert.equal(err.detail.kind, 'shared');
    // Only the deck it clashes with, not every deck in the environment.
    assert.deepEqual(err.detail.others.map((o) => o.name), ['Flex']);
    assert.match(err.message, /“Old bench” cannot share Python with “Flex”\. Because you require pylabrobot==/);
    assert.match(err.detail.brief, /old_plr_driver/);
    assert.equal(shared.installs.length, 2);
    assert.deepEqual(mgr.readDeck(old), before);
    // Nothing happened to the deck: no error state of its own (the page shows a dialog).
    assert.equal(mgr.statusOf(old).state, 'stopped');
});

test("a deck's own list that does not resolve is its own conflict; one IvoryOS cannot run beside is the edge's", async () => {
    const { mgr, flex, old } = setUp();
    const both = await mgr.install(flex, { packages: [...plr.packages, ...oldPlr.packages], instruments: [] }).then(() => null, (e) => e);
    assert.deepEqual([both.code, both.detail.kind, both.detail.others], ['package-conflict', 'deck', []]);
    const edge = await mgr.install(old, { packages: ['old-orm-driver==1'], instruments: [] }).then(() => null, (e) => e);
    assert.deepEqual([edge.code, edge.detail.kind], ['package-conflict', 'edge']);
    assert.match(edge.message, /needs versions IvoryOS cannot run with/);
});

test('given its own environment, a deck installs there, and neither it nor the shared decks hold each other back', async () => {
    const { mgr, shared, own, removed, flex, old } = setUp();
    await mgr.install(flex, plr);
    await assert.rejects(mgr.install(old, oldPlr), (e) => e.code === 'package-conflict');

    const moved = await mgr.setEnvironment(old, 'own');
    assert.equal(moved.environment, 'own');
    // What the conflict dialog does next: the same install again, now into its own environment.
    await mgr.install(old, oldPlr);
    assert.deepEqual(own.get(old).installs.at(-1), ['old-plr-driver==0.3', ...EDGE]);
    assert.equal(shared.installs.length, 1);
    assert.equal(await mgr.pythonFor(old), `/py/${old}/bin/python`);
    assert.equal(await mgr.pythonFor(flex), shared.python);

    // The shared decks no longer count it, and it no longer counts them.
    await mgr.install(flex, { packages: ['old-plr-driver-free==1'], instruments: [] });
    assert.deepEqual(shared.installs.at(-1), ['plr-ivoryos==1.0.0b1', 'old-plr-driver-free==1', ...EDGE]);

    // Back to the shared one only when it fits there, checked like any install.
    await assert.rejects(mgr.setEnvironment(old, 'shared'), (e) => e.code === 'package-conflict' && e.detail.others[0].name === 'Flex');
    assert.equal(mgr.get(old).environment, 'own');
    await mgr.removePackages(flex, ['plr-ivoryos']);
    await mgr.setEnvironment(old, 'shared');
    assert.equal(mgr.get(old).environment, 'shared');
    assert.deepEqual(shared.installs.at(-1), ['old-plr-driver==0.3', ...EDGE, 'old-plr-driver-free==1']);
    assert.deepEqual(removed, [old]);
});

test('the environment changes only through setEnvironment, which a running deck applies at its next restart', async () => {
    const { mgr, flex } = setUp();
    mgr.update(flex, { environment: 'own' });
    assert.equal(mgr.get(flex).environment, 'shared');

    mgr.running.set(flex, { supervisor: { stop: async () => {}, logTail: '' }, startedWith: mgr._startedWith(mgr.get(flex)), packagesChanged: false });
    mgr._setStatus(flex, { state: 'running' });
    await mgr.setEnvironment(flex, 'own');
    assert.deepEqual(mgr.statusOf(flex).pending, ['settings']);
    // Moving back throws its environment away, which a running deck is using.
    await assert.rejects(mgr.setEnvironment(flex, 'shared'), (e) => e.code === 'stop-first');
});

test('a deck file changed outside the launcher is checked when the deck starts, and the deck page is told why', async () => {
    const { mgr, shared, flex, old } = setUp();
    await mgr.install(flex, plr);
    writeDeckFile(mgr.get(old).deck, { name: 'Old bench', packages: ['old-plr-driver==0.3'], instruments: [] });
    await assert.rejects(mgr.start(old), (e) => e.code === 'package-conflict');
    const status = mgr.statusOf(old);
    assert.equal(status.state, 'error');
    assert.equal(status.conflict.kind, 'shared');
    assert.equal(shared.installs.length, 1);
});

test("a list nobody installed holds no other deck back: it meets the others when its own deck starts", async () => {
    const { mgr, shared, flex, old } = setUp();
    writeDeckFile(mgr.get(old).deck, { name: 'Old bench', packages: ['old-plr-driver==0.3'], instruments: [] });
    await mgr.install(flex, plr);
    assert.deepEqual(shared.installs, [['plr-ivoryos==1.0.0b1', ...EDGE]]);
    await assert.rejects(mgr.start(old), (e) => e.code === 'package-conflict' && e.detail.others[0].name === 'Flex');
    // Taken off a deck's list, a package is no longer protected for it (it stays installed).
    await mgr.removePackages(flex, ['plr-ivoryos']);
    await assert.rejects(mgr.start(old), (e) => e.code !== 'package-conflict');
    assert.deepEqual(shared.installs.at(-1), ['old-plr-driver==0.3', ...EDGE]);
    await mgr.stop(old);
});

test('an unchanged list is not resolved again at start', async () => {
    const { mgr, shared, flex } = setUp();
    await mgr.install(flex, plr);
    const resolves = shared.resolves;
    // Stops at the port check or the spawn; what matters is that nothing was resolved for it.
    await mgr.start(flex).catch(() => {});
    await mgr.stop(flex);
    assert.equal(shared.resolves, resolves);
});
