'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HubCatalog, moduleToDeckEntry, pluginToDeckEntry, toEdgeWorkflow, requirementFor, builtInStep } = require('../src/hubCatalog');

/**
 * A fake PostgREST: answers from `tables`, refuses `visibility` when `legacy`, and answers a table
 * in `missing` as PostgREST answers one the database does not have.
 */
function fakeHub(tables, { legacy = false, missing = [] } = {}) {
    const calls = [];
    const fetch = async (url, init) => {
        const u = new URL(url);
        const table = u.pathname.split('/').pop();
        const select = u.searchParams.get('select') || '';
        calls.push({ table, query: u.search, auth: init.headers.Authorization });
        if (legacy && /visibility|plugin_api/.test(select)) {
            return { ok: false, status: 400, text: async () => JSON.stringify({ code: '42703', message: 'column modules.visibility does not exist' }) };
        }
        if (missing.includes(table)) {
            return { ok: false, status: 404, text: async () => JSON.stringify({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }) };
        }
        let rows = tables[table] || [];
        const moduleId = u.searchParams.get('module_id');
        if (moduleId) rows = rows.filter((r) => `eq.${r.module_id}` === moduleId);
        if (u.searchParams.get('is_current') === 'is.true') rows = rows.filter((r) => r.is_current);
        const id = u.searchParams.get('id');
        if (id && id.startsWith('eq.')) rows = rows.filter((r) => String(r.id) === id.slice(3));
        if (id && id.startsWith('in.(')) {
            const wanted = id.slice(4, -1).split(',');
            rows = rows.filter((r) => wanted.includes(String(r.id)));
        }
        const or = u.searchParams.get('or');
        if (or) {
            const own = /contributor_id\.eq\.([\w-]+)/.exec(or);
            rows = rows.filter((r) => !r.is_unlisted || (own && r.contributor_id === own[1]));
        }
        return { ok: true, status: 200, text: async () => JSON.stringify(rows) };
    };
    return { fetch, calls };
}

const modules = [
    { id: 1, name: 'Pump', pip_name: 'pumps==1.0', module_path: 'pumps', module_name: 'Pump', init_args: [{ name: 'port', type: 'str' }], is_unlisted: false, contributor_id: 'u1' },
    { id: 2, name: 'Draft', pip_name: 'draft', module_path: 'draft', module_name: 'D', init_args: [], is_unlisted: true, contributor_id: 'me' },
    { id: 3, name: 'Theirs', pip_name: 'x', module_path: 'x', module_name: 'X', init_args: [], is_unlisted: true, contributor_id: 'u9' },
];

test('an old Hub database (no visibility) shows listed rows plus only the caller\'s own', async () => {
    const hub = fakeHub({ modules }, { legacy: true });
    const anon = new HubCatalog({ fetch: hub.fetch, url: 'https://hub.example', key: 'anon' });
    assert.deepEqual((await anon.browse()).modules.map((m) => m.name), ['Pump']);
    assert.equal(anon.legacy, true);

    const me = new HubCatalog({ fetch: hub.fetch, url: 'https://hub.example', key: 'anon', token: async () => 'jwt', userId: () => 'me' });
    const mine = (await me.browse()).modules;
    assert.deepEqual(mine.map((m) => [m.name, m.visibility]), [['Pump', 'public'], ['Draft', 'private']]);
    assert.equal(hub.calls.at(-1).auth, 'Bearer jwt');
});

test('a migrated database is trusted: rows come back as row-level security returned them', async () => {
    const rows = [{ ...modules[0], visibility: 'public' }, { ...modules[2], visibility: 'org', organizations: { name: 'Lab' } }];
    const hub = fakeHub({ modules: rows });
    const c = new HubCatalog({ fetch: hub.fetch, url: 'https://hub.example', key: 'anon', token: async () => 'jwt' });
    assert.deepEqual((await c.browse()).modules.map((m) => m.visibility), ['public', 'org']);
    assert.equal(c.legacy, false);
    assert.match(hub.calls[0].query, /visibility/);
});

test('deck entries, plugin entries and templates convert as the Hub converts them', async () => {
    const { instrument, packages } = moduleToDeckEntry(modules[0], 'pump_1', { args: { port: 'COM3' } });
    assert.deepEqual([instrument.import, instrument.class, instrument.args.port, packages[0]], ['pumps', 'Pump', 'COM3', 'pumps==1.0']);
    assert.equal(requirementFor('https://github.com/x/y.git'), 'git+https://github.com/x/y.git');

    assert.match(pluginToDeckEntry({ name: 'Old', plugin_api: null }).blocked, /v1 plugin/);
    assert.deepEqual(pluginToDeckEntry({ name: 'New', plugin_api: 'v2', import_path: 'view.plugin', module_name: 'plugin', pip_name: 'view' }),
        { packages: ['view'], plugins: ['view.plugin:plugin'], blocked: null });

    const wf = toEdgeWorkflow({ name: 't', script_dict: { prep: [{ instrument: 'pause', action: 'pause', args: { statement: 'Load vials' } }], script: [{ instrument: 'deck.pump', action: 'prime', args: {} }, { instrument: 'wait', action: 'wait', args: { statement: 2 } }], cleanup: [] } }, 'x');
    // A pause is a User input with nothing to save: it shows the message and waits for Continue.
    assert.deepEqual(wf.prep.map((b) => [b.instrument, b.action, b.args]), [['Flow_Control', 'User_Input', { prompt: 'Load vials' }]]);
    assert.deepEqual(wf.script.map((b) => [b.instrument, b.action, b.args]), [['pump', 'prime', {}], ['Flow_Control', 'Sleep', { duration_seconds: 2 }]]);
});

// The same cases the Designer's JSON import is held to (shared-ui fromLegacyBuiltIn).
const legacySteps = require('../../tests/fixtures/legacy_steps.json');
for (const c of legacySteps.cases) {
    test(`legacy step: ${c.name}`, () => assert.deepEqual(builtInStep(c.legacy), c.expected));
}

test('a template with legacy variable and math steps installs as Set variable steps', () => {
    const wf = toEdgeWorkflow({ name: 't', script_dict: { prep: [], cleanup: [], script: [
        { instrument: 'variable', action: 'n', args: { statement: 4 }, arg_types: { statement: 'int' }, return: '' },
        { instrument: 'math_variable', action: 'half', args: { statement: '#n / 2' }, arg_types: { statement: 'float' }, return: '', batch_action: true },
    ] } }, 'x');
    assert.deepEqual(wf.script.map((b) => [b.instrument, b.action, b.args.value, b.batch_action]),
        [['Flow_Control', 'Set_Variable', '4', false], ['Flow_Control', 'Set_Variable', 'n / 2', true]]);
});

test('what a module version pins is installed beside its package, so a pre-release it pins is named', async () => {
    const flex = { id: 422, name: 'Opentrons Flex', pip_name: 'plr-ivoryos==1.0.0b1', module_path: 'plr_ivoryos.opentrons', module_name: 'Flex', init_args: [], is_unlisted: false };
    const hub = fakeHub({ modules: [flex, modules[0]], module_versions: [
        { module_id: 422, is_current: false, requires: { pylabrobot: '==0.9' } },
        { module_id: 422, is_current: true, requires: { pylabrobot: '==1.0.0b1', 'pylabrobot[serial]': '' } },
    ] });
    const c = new HubCatalog({ fetch: hub.fetch, url: 'https://hub.example', key: 'anon' });
    const entry = await c.deckEntry({ moduleId: 422, name: 'flex' });
    assert.deepEqual(entry.packages, ['plr-ivoryos==1.0.0b1', 'pylabrobot==1.0.0b1', 'pylabrobot[serial]']);
    assert.deepEqual(entry.warnings, []);
    // A module whose current version pins nothing installs its own package alone.
    assert.deepEqual((await c.deckEntry({ moduleId: 1, name: 'pump' })).packages, ['pumps==1.0']);

    // A row names packages and versions; anything else is left out, and said.
    const odd = moduleToDeckEntry({ ...flex, requires: { '--index-url': 'https://evil.example', pylabrobot: '==1.0.0b1; rm -rf /', numpy: '>=1.26,<3' } }, 'flex');
    assert.deepEqual(odd.packages, ['plr-ivoryos==1.0.0b1', 'numpy>=1.26,<3']);
    assert.equal(odd.warnings.length, 2);
});

test('a Hub without module versions installs a module\'s package alone', async () => {
    const c = new HubCatalog({ fetch: fakeHub({ modules }, { missing: ['module_versions'] }).fetch, url: 'https://hub.example', key: 'anon' });
    assert.deepEqual((await c.deckEntry({ moduleId: 1, name: 'pump' })).packages, ['pumps==1.0']);
});

test('an unknown or unshared row says so', async () => {
    const c = new HubCatalog({ fetch: fakeHub({ modules }).fetch, url: 'https://hub.example', key: 'anon' });
    await assert.rejects(c.module(99), /not shared with you/);
    await assert.rejects(c.deckEntry({ moduleId: 1, name: '1bad' }), /letters, digits/);
});

test('a problem report is inserted write-only, with the session when signed in', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, text: async () => '' }; };
    const hub = new HubCatalog({ fetch, url: 'https://hub.example/', key: 'anon', token: async () => 'user-jwt' });
    const res = await hub.fileReport({ id: 'abc', title: 't', body: 'b' });
    assert.deepEqual(res, { id: 'abc' });
    assert.equal(calls[0].url, 'https://hub.example/rest/v1/problem_reports');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer user-jwt');
    // No read-back: clients have no select policy on the table.
    assert.equal(calls[0].init.headers.Prefer, 'return=minimal');
});

test('a Hub without the reports table says so, distinctly', async () => {
    const fetch = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }) });
    const hub = new HubCatalog({ fetch, url: 'https://hub.example', key: 'anon' });
    await assert.rejects(hub.fileReport({ id: 'x' }), (e) => e.code === 'unavailable' && /cannot take reports/.test(e.message));
});

test('an early-access request is a contact inquiry, insert only', async () => {
    const calls = [];
    const fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 201, text: async () => '' }; };
    const hub = new HubCatalog({ fetch, url: 'https://hub.example', key: 'anon' });
    await hub.contactInquiry({ name: 'Ada', email: 'ada@example.org', message: 'Cloud early access' });
    assert.equal(calls[0].url, 'https://hub.example/rest/v1/contact_inquiries');
    assert.deepEqual(JSON.parse(calls[0].init.body), { name: 'Ada', email: 'ada@example.org', message: 'Cloud early access' });
    assert.equal(calls[0].init.headers.Prefer, 'return=minimal');
});

test('a link\'s ids resolve against the Hub: drivers in link order, unseen ids reported, contributors named', async () => {
    const alice = '11111111-1111-4111-8111-111111111111';
    const hub = fakeHub({
        modules: [{ ...modules[0], contributor_id: alice, visibility: 'public' }],
        plugins: [{ id: 5, name: 'Sim', pip_name: 'sim', import_path: 'sim.plugin', module_name: 'plugin', plugin_api: 'v2', visibility: 'public' }],
        templates: [],
        profiles: [{ id: alice, full_name: 'Alice' }],
    });
    const c = new HubCatalog({ fetch: hub.fetch, url: 'https://hub.example', key: 'anon' });
    const { selection } = await c.selection({ modules: [1, 99, 1], plugins: [5, 6], templates: [7] });
    assert.deepEqual(selection.modules.map((m) => [m.id, m.contributor_name]), [[1, 'Alice'], [1, 'Alice']]);
    assert.deepEqual(selection.hiddenModules, [99]);
    assert.deepEqual(selection.plugins.map((p) => p.entry.plugins), [['sim.plugin:plugin']]);
    assert.deepEqual(selection.hiddenPlugins, [6]);
    assert.deepEqual(selection.hiddenTemplates, [7]);
    // One request per table, whatever the repeats.
    assert.equal(hub.calls.filter((call) => call.table === 'modules').length, 1);
});

test('contributor names are best effort: a Hub that will not say leaves the rows as they were', async () => {
    const someone = '22222222-2222-4222-8222-222222222222';
    const hub = fakeHub({ modules: [{ ...modules[0], contributor_id: someone, visibility: 'public' }] });
    const failing = async (url, init) => (url.includes('/profiles?')
        ? { ok: false, status: 401, text: async () => JSON.stringify({ message: 'permission denied' }) }
        : hub.fetch(url, init));
    const c = new HubCatalog({ fetch: failing, url: 'https://hub.example', key: 'anon' });
    const { selection } = await c.selection({ modules: [1] });
    assert.equal(selection.modules[0].name, 'Pump');
    assert.equal(selection.modules[0].contributor_name, undefined);
});

test('a computer that is offline is told to connect; other failures on the way say what to check', async () => {
    const failing = (error) => async () => { throw error; };
    const offline = new HubCatalog({ fetch: failing(new Error('net::ERR_INTERNET_DISCONNECTED')), url: 'https://hub.example', key: 'anon' });
    await assert.rejects(offline.browse(), (e) => e.code === 'offline' && /No internet connection/.test(e.message));

    // Node's fetch names the cause apart from its message.
    const dns = new HubCatalog({ fetch: failing(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })), url: 'https://hub.example', key: 'anon' });
    await assert.rejects(dns.browse(), (e) => e.code === 'offline');

    // The system says there is no network, whatever the request failed with.
    const unplugged = new HubCatalog({ fetch: failing(new Error('net::ERR_TIMED_OUT')), url: 'https://hub.example', key: 'anon', online: () => false });
    await assert.rejects(unplugged.browse(), (e) => e.code === 'offline');

    const blocked = new HubCatalog({ fetch: failing(new Error('net::ERR_CONNECTION_TIMED_OUT')), url: 'https://hub.example', key: 'anon', online: () => true });
    await assert.rejects(blocked.browse(), (e) => e.code === 'unreachable' && /firewall or proxy/.test(e.message) && /ERR_CONNECTION_TIMED_OUT/.test(e.message));
});

test('a Hub whose gateway is down says to try later, not its HTML', async () => {
    const fetch = async () => ({ ok: false, status: 503, text: async () => '<html>Service Unavailable</html>' });
    const c = new HubCatalog({ fetch, url: 'https://hub.example', key: 'anon' });
    await assert.rejects(c.browse(), (e) => e.code === 'hub-down' && /not answering right now \(503\)/.test(e.message));
});
