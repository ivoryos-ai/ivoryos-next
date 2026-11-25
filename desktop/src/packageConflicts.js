'use strict';
// When a deck's packages cannot be installed: why, said so a person can act on it, and the same
// facts written as a brief for an AI coding agent (issue 82).
//
// Decks share one Python environment unless one is given its own (manager.js `_planInstall`).
// One process holds one version of each package, so there are three different failures, and only
// one of them is fixed by a separate environment:
//   - 'deck':   the deck's own list does not install (two of its drivers want different versions
//               of one package). No environment can hold both for one deck; one of them has to go
//               to another deck, or a version has to change.
//   - 'edge':   the deck's list installs alone but not beside what IvoryOS itself needs. Its own
//               environment has IvoryOS in it too, so that does not help either.
//   - 'shared': the deck's list installs alone, but not together with another deck's in the
//               shared environment. Giving one of them its own environment does.
// Before this, the third was not even noticed: `uv pip install` of one deck's list replaced a
// package another deck needed, reported success, and the other deck kept its old list's
// fingerprint, so it was never reinstalled and ran on the wrong version.
//
// Resolving a conflict itself is not attempted: which version of which driver to use is a choice
// about code that drives hardware, often only answerable by trying it. The brief hands an agent
// what it needs to find one, and the rules (a throwaway environment, never the launcher's).
//
// Pure; tested in test/packageConflicts.test.js.

/** Requirement lists as one, each requirement once (as written), in order. */
function combine(...lists) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
        for (const req of list || []) {
            const r = String(req).trim();
            if (r && !seen.has(r)) { seen.add(r); out.push(r); }
        }
    }
    return out;
}

/**
 * What uv said about a failed resolution, as plain sentences. uv draws its explanation for a
 * terminal: a "No solution found" line, then the reasoning wrapped over several lines behind box
 * characters, then any `hint:` lines. Anything else (a network error, a missing file) is its
 * `error:` lines, or the last lines it printed.
 */
function explainFailure(output) {
    const lines = String(output || '').split(/\r?\n/);
    const clean = (line) => line.replace(/[╰─▶│×╭╮╯┬┴├┤]/g, ' ').replace(/\s+/g, ' ').trim();
    const start = lines.findIndex((l) => /No solution found/.test(l));
    if (start !== -1) {
        const paragraphs = [];
        let current = [];
        for (const raw of lines.slice(start + 1)) {
            const line = clean(raw);
            if (!line) { if (current.length) { paragraphs.push(current.join(' ')); current = []; } continue; }
            if (/^hint:/i.test(line)) {
                if (current.length) paragraphs.push(current.join(' '));
                current = [line.replace(/^hint:\s*/i, 'Hint: ')];
                continue;
            }
            current.push(line);
        }
        if (current.length) paragraphs.push(current.join(' '));
        return paragraphs.join('\n\n') || 'No set of versions satisfies every requirement.';
    }
    const errors = lines.map(clean).filter((l) => /^error:/i.test(l));
    if (errors.length) return errors.map((l) => l.replace(/^error:\s*/i, '')).join('\n');
    return lines.map(clean).filter(Boolean).slice(-3).join('\n');
}

/** Whether uv's output says the requirements cannot all be met (as opposed to a download failing). */
function isUnsatisfiable(output) {
    return /No solution found/.test(String(output || ''));
}

const quote = (name) => `“${name}”`;
const listNames = (names) => (names.length <= 1 ? names.join('')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** One line on what failed, for the dialog title and the deck's status. */
function conflictTitle(conflict) {
    const others = (conflict.others || []).map((o) => quote(o.name));
    if (conflict.kind === 'shared') return `${quote(conflict.deck.name)} cannot share Python with ${listNames(others) || 'the other decks'}`;
    if (conflict.kind === 'edge') return `${quote(conflict.deck.name)} needs versions IvoryOS cannot run with`;
    return `${quote(conflict.deck.name)}'s packages cannot be installed together`;
}

/** The status message and error text: the title, then uv's explanation. */
function conflictMessage(conflict) {
    return `${conflictTitle(conflict)}. ${conflict.explanation}`;
}

const bullet = (items, none = '(none)') => (items.length ? items.map((i) => `- ${i}`).join('\n') : none);

/**
 * A brief for an AI coding agent (Claude Code, or any other with a shell on this computer), copied
 * from the conflict dialog. Self-contained: the agent has not seen the launcher. `info`:
 *   conflict   {kind, deck: {name, file}, others: [{name, file, packages}], explanation}
 *   requested  the deck's whole list as it would be
 *   current    the deck file's list now
 *   instruments [{name, import, class}] the deck's instruments (what has to import afterwards)
 *   python     the environment the install was for; uv; platform ('darwin' | 'win32' | 'linux')
 */
function agentBrief(info) {
    const { conflict, requested = [], current = [], instruments = [], python, uv, platform } = info;
    const win = platform === 'win32';
    const scratchPython = win ? '<folder>\\env\\Scripts\\python.exe' : '<folder>/env/bin/python';
    const shared = conflict.kind === 'shared';
    const why = {
        shared: `its package list installs on its own, but not together with the packages of ${listNames((conflict.others || []).map((o) => quote(o.name)))}, which share the same Python environment`,
        edge: 'its package list cannot be installed beside the packages IvoryOS itself needs',
        deck: 'its own package list cannot be installed together: two of its packages need different versions of something',
    }[conflict.kind];
    const added = requested.filter((r) => !current.includes(r));
    const sections = [
        '# A Python package conflict in IvoryOS',
        `I use the IvoryOS desktop launcher. Installing packages for my deck ${quote(conflict.deck.name)} failed: ${why}. Nothing was installed or changed.`,
        '## What uv said',
        conflict.explanation,
        '## The deck',
        `Deck file: \`${conflict.deck.file}\`. It is JSON, and its \`packages\` list is what the launcher installs (with \`uv pip install --torch-backend cpu\`).`,
        `Its package list would be:\n${bullet(requested)}`,
        added.length ? `Of these, new: ${added.join(', ')}.` : '',
        `Instruments it builds (module, class), which must still import afterwards:\n${bullet(instruments.map((i) => `${i.name}: \`${i.import}\`, class \`${i.class}\``))}`,
        ...(shared ? [
            '## The decks it shares Python with',
            ...(conflict.others || []).map((o) => `${quote(o.name)}, deck file \`${o.file}\`:\n${bullet(o.packages || [])}`),
        ] : []),
        '## This computer',
        `The launcher's Python: \`${python}\`. uv: \`${uv}\`. Do not install anything into the launcher's environment, or change it: other decks run from it.`,
        '## What I would like',
        [
            shared
                ? `1. Find a package list for ${quote(conflict.deck.name)} that installs together with the other decks' lists, or tell me there is none and why.`
                : `1. Find a package list for ${quote(conflict.deck.name)} that installs, or tell me there is none and why.`,
            `2. Try things only in a throwaway environment in a temporary folder: \`"${uv}" venv --python 3.11 <folder>/env\`, then \`"${uv}" pip install --python "${scratchPython}" --torch-backend cpu --dry-run <requirements>\` to resolve${shared ? ' (all the decks\' lists together)' : ''}, and a real install there to test.`,
            '3. In that environment, check that every instrument\'s module above still imports, and tell me what you could not test (the hardware).',
            '4. Prefer, in this order: a version of one package that works with the others (an exact pin is often stricter than the code needs); a change to code I own, such as my own driver; '
                + (shared ? `and last, giving ${quote(conflict.deck.name)} its own Python environment, which the launcher offers.` : 'and last, putting the drivers that clash on separate decks.'),
            '5. If a package declares a requirement its code does not need, say so and how you tested it, rather than forcing it: the launcher installs every declared requirement.',
            '6. When I agree, change only the `packages` list in the deck file. The launcher installs it, with the same check, the next time the deck starts.',
        ].join('\n'),
    ];
    return sections.filter(Boolean).join('\n\n');
}

module.exports = { combine, explainFailure, isUnsatisfiable, conflictTitle, conflictMessage, agentBrief };
