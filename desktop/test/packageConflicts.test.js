'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { combine, explainFailure, isUnsatisfiable, conflictTitle, agentBrief } = require('../src/packageConflicts');

// What uv 0.11 prints when two decks' lists meet (captured from a real dry run).
const UV_CONFLICT = [
    'Using Python 3.11.15 environment at: v',
    '  × No solution found when resolving dependencies:',
    '  ╰─▶ Because requests==2.32.3 depends on urllib3>=1.21.1,<3 and you require',
    '      requests==2.32.3, we can conclude that you require urllib3>=1.21.1,<3.',
    '      And because you require urllib3==1.20, we can conclude that your',
    '      requirements are unsatisfiable.',
    '',
    '      hint: Pre-releases are available for `urllib3` in the requested range',
    '      (e.g., 2.0.0a1), but pre-releases weren\'t enabled',
].join('\n');

test('lists combine with each requirement once, as written, in order', () => {
    assert.deepEqual(combine(['a==1', ' b '], ['b', 'c'], null, ['a==1']), ['a==1', 'b', 'c']);
});

test("uv's explanation is read as sentences, hints apart", () => {
    assert.equal(explainFailure(UV_CONFLICT), [
        'Because requests==2.32.3 depends on urllib3>=1.21.1,<3 and you require requests==2.32.3, we can conclude that you require urllib3>=1.21.1,<3. '
            + 'And because you require urllib3==1.20, we can conclude that your requirements are unsatisfiable.',
        "Hint: Pre-releases are available for `urllib3` in the requested range (e.g., 2.0.0a1), but pre-releases weren't enabled",
    ].join('\n\n'));
    assert.ok(isUnsatisfiable(UV_CONFLICT));
});

test('a failure that is not a conflict is said as uv says it, and is not called one', () => {
    const out = 'Using Python 3.11\nerror: Failed to fetch: `https://pypi.org/simple/vendor-pumps/`\n  Caused by: dns error';
    assert.equal(explainFailure(out), 'Failed to fetch: `https://pypi.org/simple/vendor-pumps/`');
    assert.equal(isUnsatisfiable(out), false);
});

const conflict = {
    kind: 'shared',
    deck: { name: 'Old bench', file: '/home/p_2/deck.json' },
    others: [{ name: 'Flex', file: '/home/p_1/deck.json', packages: ['plr-ivoryos==1.0.0b1'] }],
    explanation: 'Because you require pylabrobot==0.2.1 and pylabrobot==1.0.0b1, your requirements are unsatisfiable.',
};

test('the title says which kind of conflict it is', () => {
    assert.equal(conflictTitle(conflict), '“Old bench” cannot share Python with “Flex”');
    assert.equal(conflictTitle({ ...conflict, kind: 'deck' }), '“Old bench”\'s packages cannot be installed together');
    assert.equal(conflictTitle({ ...conflict, kind: 'edge' }), '“Old bench” needs versions IvoryOS cannot run with');
});

test('the brief for an agent holds everything it needs, and the rules', () => {
    const brief = agentBrief({
        conflict,
        requested: ['vendor-pumps==1.0', 'old-plr-driver==0.3'],
        current: ['vendor-pumps==1.0'],
        instruments: [{ name: 'pump', import: 'vendor_pumps', class: 'Pump' }],
        python: '/home/runtime/venv/bin/python', uv: '/app/bin/uv', platform: 'darwin',
    });
    for (const part of [
        conflict.explanation, '/home/p_2/deck.json', '/home/p_1/deck.json', 'plr-ivoryos==1.0.0b1',
        'Of these, new: old-plr-driver==0.3.', 'pump: `vendor_pumps`, class `Pump`', '/home/runtime/venv/bin/python',
        '"/app/bin/uv" venv --python 3.11 <folder>/env', 'Do not install anything into the launcher', 'change only the `packages` list',
        'its own Python environment, which the launcher offers',
    ]) assert.ok(brief.includes(part), `missing: ${part}`);
    // A deck's own conflict does not point at an environment that would not help.
    const own = agentBrief({ conflict: { ...conflict, kind: 'deck', others: [] }, requested: [], python: 'py', uv: 'uv', platform: 'win32' });
    assert.ok(!own.includes('its own Python environment'));
    assert.ok(own.includes('<folder>\\env\\Scripts\\python.exe'));
});
