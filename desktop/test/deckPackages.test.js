'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseRequirement, withVersion, instrumentModules, probeInput, describePackages, packagesAfterRemoving, parseDryRun,
} = require('../src/deckPackages');

test('requirements are taken apart into name, extras, version and kind', () => {
    assert.deepEqual(
        (({ key, name, display, extras, spec, kind }) => ({ key, name, display, extras, spec, kind }))(parseRequirement('Vendor_Pumps[full] >= 1.2')),
        { key: 'vendor-pumps', name: 'vendor-pumps', display: 'Vendor_Pumps', extras: '[full]', spec: '>= 1.2', kind: 'name' },
    );
    assert.equal(parseRequirement('C:\\Users\\me\\private-packages\\github-lab-drivers-0123456789ab.tar.gz').kind, 'path');
    assert.equal(parseRequirement('git+https://example.com/x.git@abc').kind, 'url');
    const named = parseRequirement('drivers @ git+https://example.com/x.git');
    assert.equal(named.kind, 'url');
    assert.equal(named.name, 'drivers');
});

test('an update pins the version and keeps extras and markers', () => {
    assert.equal(withVersion('plr-ivoryos==1.0.0b1', '1.0.0b2'), 'plr-ivoryos==1.0.0b2');
    assert.equal(withVersion('Vendor_Pumps[full]>=1.2', '1.4'), 'Vendor_Pumps[full]==1.4');
    assert.equal(withVersion('pywin32>=300; sys_platform == "win32"', '311'), 'pywin32==311; sys_platform == "win32"');
    assert.throws(() => withVersion('C:\\pkgs\\a-0123456789ab.tar.gz', '1'), /not an index package/);
});

test('an instrument imports its class module and those of the objects in its arguments', () => {
    const entry = {
        name: 'flex', import: 'plr_ivoryos.opentrons.flex', class: 'Flex',
        args: { backend: { $object: { import: 'pylabrobot.opentrons', class: 'Backend', args: { io: { $object: { import: 'serial.tools', class: 'Port' } } } } } },
        calls: [{ method: 'setup', args: { deck: { $object: { import: 'decks', class: 'D' } } } }],
    };
    assert.deepEqual(instrumentModules(entry).sort(), ['decks', 'plr_ivoryos', 'pylabrobot', 'serial']);
    const input = probeInput({ packages: ['a==1'], instruments: [entry], plugins: [{ ref: 'view_kit.plugin:plugin', enabled: false }] });
    assert.deepEqual(input.entries.map((e) => e.id), ['instrument:flex', 'plugin:view_kit.plugin:plugin']);
    assert.deepEqual(input.entries[1].modules, ['view_kit']);
    assert.deepEqual(input.requirements, [{ key: 'a', name: 'a' }]);
});

const deck = {
    packages: ['plr-ivoryos==1.0.0b1', 'pylabrobot==1.0.0b1', 'colour-match-sdl>=0.1.7', 'old-pump==2.0', 'ax-platform==1.3.1', 'not-there==1'],
    instruments: [{ name: 'flex', import: 'plr_ivoryos.flex', class: 'Flex' }, { name: 'reader', import: 'plr_ivoryos.reader', class: 'R', enabled: false }],
    plugins: ['sdl_sim_web.next_plugin:plugin'],
};
const probe = {
    requirements: {
        'plr-ivoryos': { dist: 'plr-ivoryos', version: '1.0.0b1' }, pylabrobot: { dist: 'pylabrobot', version: '1.0.0b1' },
        'colour-match-sdl': { dist: 'colour-match-sdl', version: '0.1.9' }, 'old-pump': { dist: 'old-pump', version: '2.0' },
        'ax-platform': { dist: 'ax-platform', version: '1.3.1' }, 'not-there': null,
    },
    entries: {
        'instrument:flex': ['plr-ivoryos', 'pylabrobot'],
        'instrument:reader': ['plr-ivoryos', 'pylabrobot'],
        'plugin:sdl_sim_web.next_plugin:plugin': ['colour-match-sdl'],
    },
};

test('each package says what on the deck needs it, and what nothing needs', () => {
    const rows = Object.fromEntries(describePackages(deck, probe).map((r) => [r.key, r]));
    assert.deepEqual(rows['plr-ivoryos'].usedBy, ['flex', 'reader']);
    assert.equal(rows['plr-ivoryos'].version, '1.0.0b1');
    assert.equal(rows['colour-match-sdl'].status, 'used');
    assert.equal(rows['old-pump'].status, 'unused', 'installed, and nothing on the deck needs it');
    assert.equal(rows['ax-platform'].optimizer, 'Ax');
    assert.equal(rows['ax-platform'].status, 'used', 'an optimizer is never "unused": the Optimize page needs it');
    assert.equal(rows['not-there'].status, 'unknown');
    // No probe (Python not ready): nothing is called unused.
    assert.ok(describePackages(deck, null).every((r) => r.status !== 'unused'));
});

test('removing an entry takes off the list what only it needed, and nothing else', () => {
    // flex goes, but reader (switched off, still on the deck) needs the same packages.
    assert.deepEqual(packagesAfterRemoving(deck, probe.entries, ['instrument:flex']), deck.packages);
    // Both go: their packages go too. old-pump was unused already and stays for the person to decide.
    assert.deepEqual(
        packagesAfterRemoving(deck, probe.entries, ['instrument:flex', 'instrument:reader']),
        ['colour-match-sdl>=0.1.7', 'old-pump==2.0', 'ax-platform==1.3.1', 'not-there==1'],
    );
    assert.deepEqual(
        packagesAfterRemoving(deck, probe.entries, ['plugin:sdl_sim_web.next_plugin:plugin']),
        deck.packages.filter((p) => !p.startsWith('colour-match')),
    );
    // An optimizer stays whatever was removed, and without a probe nothing is dropped.
    assert.ok(packagesAfterRemoving(deck, { 'instrument:x': ['ax-platform'] }, ['instrument:x']).includes('ax-platform==1.3.1'));
    assert.deepEqual(packagesAfterRemoving(deck, null, ['instrument:flex', 'instrument:reader']), deck.packages);
});

test("uv's dry-run output is read as the changes it would make", () => {
    const out = 'Resolved 3 packages in 16ms\nWould uninstall 1 package\nWould install 2 packages\n - anyio==4.15.0\n + anyio==4.16.0\n + Plr_Ivoryos[sim]==1.0.0b2\n';
    assert.deepEqual(parseDryRun(out), [
        { change: '-', name: 'anyio', version: '4.15.0' },
        { change: '+', name: 'anyio', version: '4.16.0' },
        { change: '+', name: 'plr-ivoryos', version: '1.0.0b2' },
    ]);
    assert.deepEqual(parseDryRun('Would make no changes'), []);
});
