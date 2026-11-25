'use strict';
// A deck's `packages` as something to manage: which instrument or plugin needs each one, what
// version is installed, and the list kept in step with what is on the deck.
//
// Nothing here uninstalls anything. Decks share one environment (runtime.js), so a package one deck
// stops listing may be another's; taking it off a deck's list only means that deck no longer asks
// for it. What a package is *for* is not recorded anywhere: it is worked out from the environment
// (PythonRuntime.probeDeckPackages): each entry's import module, the distribution that provides it,
// and that distribution's dependencies, so it holds for decks installed before this existed, for
// a Hub module's pinned dependencies (`pylabrobot` beside `plr-ivoryos`), and for private
// repositories installed from an archive.
//
// Pure apart from the probe result the caller passes in; tested in test/deckPackages.test.js.

const { packageKey } = require('./manifest');
const { pluginRef } = require('./deckEdit');
const { OPTIMIZERS } = require('./optimizers');

const NAMED = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/;
const normalize = (name) => String(name).toLowerCase().replace(/[-_.]+/g, '-');

/**
 * One `packages` entry, taken apart: {requirement, key, name, extras, spec, marker, kind}.
 * `kind` is `name` (an index package, the only kind that can be checked for updates), `path`
 * (a local archive, as a private repository is installed) or `url` (a VCS or URL requirement).
 * `name` is the normalized distribution name, null when the requirement does not say it.
 */
function parseRequirement(requirement) {
    const req = String(requirement).trim();
    const key = packageKey(req);
    if (key.startsWith('path:')) return { requirement: req, key, name: null, extras: '', spec: '', marker: '', kind: 'path', path: req };
    const [body, ...markerParts] = req.split(';');
    const marker = markerParts.length ? `;${markerParts.join(';')}` : '';
    // `name @ git+https://...` names its distribution; a bare URL does not.
    const at = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*@\s*(.+)$/.exec(body.trim());
    if (at) return { requirement: req, key, name: normalize(at[1]), display: at[1], extras: at[2] || '', spec: '', marker, kind: 'url' };
    if (/^[a-z]+\+|^[a-z]+:\/\//i.test(body.trim())) return { requirement: req, key, name: null, extras: '', spec: '', marker, kind: 'url' };
    const m = NAMED.exec(body.trim());
    if (!m) return { requirement: req, key, name: null, extras: '', spec: '', marker, kind: 'url' };
    return { requirement: req, key, name: normalize(m[1]), display: m[1], extras: (m[2] || '').replace(/\s+/g, ''), spec: m[3].trim(), marker, kind: 'name' };
}

/** The same requirement pinned to `version`, keeping its extras and environment marker. */
function withVersion(requirement, version) {
    const r = parseRequirement(requirement);
    if (r.kind !== 'name') throw new Error(`${requirement} is not an index package, so it has no version to change.`);
    return `${r.display}${r.extras}==${version}${r.marker}`;
}

const topModule = (dotted) => String(dotted || '').split('.')[0].trim();

/** Every module an instrument entry imports: its class's, and those of the objects in its arguments. */
function instrumentModules(entry) {
    const found = new Set();
    const walk = (value) => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (!value || typeof value !== 'object') return;
        if (value.$object && typeof value.$object === 'object') {
            if (value.$object.import) found.add(topModule(value.$object.import));
            walk(value.$object.args);
            return;
        }
        Object.values(value).forEach(walk);
    };
    if (entry.import) found.add(topModule(entry.import));
    walk(entry.args);
    for (const call of entry.calls || []) walk(call && call.args);
    found.delete('');
    return [...found];
}

/** The deck's instruments and plugins as {id, label, modules}, switched-off ones included (they are kept). */
function deckEntries(deck) {
    const entries = [];
    for (const inst of (deck && deck.instruments) || []) {
        if (inst && inst.name) entries.push({ id: `instrument:${inst.name}`, label: inst.name, modules: instrumentModules(inst) });
    }
    for (const p of (deck && deck.plugins) || []) {
        const ref = pluginRef(p);
        if (ref) entries.push({ id: `plugin:${ref}`, label: ref, modules: [topModule(ref.split(':')[0])].filter(Boolean) });
    }
    return entries;
}

/** What PythonRuntime.probeDeckPackages is asked about this deck. */
function probeInput(deck) {
    return {
        entries: deckEntries(deck).map(({ id, modules }) => ({ id, modules })),
        requirements: ((deck && deck.packages) || []).map(parseRequirement)
            .map(({ key, name, path }) => ({ key, name, ...(path ? { path } : {}) })),
    };
}

const OPTIMIZER_BY_KEY = new Map(OPTIMIZERS.map((o) => [packageKey(o.package), o.name]));

/** The optimizer a requirement is (Ax, BayBE, NIMO), or null. Those belong to the Optimizers card. */
function optimizerOf(requirement) {
    return OPTIMIZER_BY_KEY.get(packageKey(requirement)) || null;
}

/**
 * The deck's packages for the page: [{requirement, key, name, spec, kind, version, optimizer,
 * usedBy, status}]. `status` is `used`, `unused` (installed, and nothing on the deck needs it), or
 * `unknown` (not installed, or the probe could not say which distribution it is).
 */
function describePackages(deck, probe) {
    const labels = new Map(deckEntries(deck).map((e) => [e.id, e.label]));
    const usedBy = new Map();
    for (const [id, keys] of Object.entries((probe && probe.entries) || {})) {
        for (const key of keys) {
            if (!usedBy.has(key)) usedBy.set(key, []);
            if (labels.has(id)) usedBy.get(key).push(labels.get(id));
        }
    }
    return ((deck && deck.packages) || []).map((requirement) => {
        const r = parseRequirement(requirement);
        const found = probe && probe.requirements ? probe.requirements[r.key] : null;
        const optimizer = optimizerOf(requirement);
        const users = usedBy.get(r.key) || [];
        const status = optimizer || users.length ? 'used' : found ? 'unused' : 'unknown';
        return {
            requirement: r.requirement,
            key: r.key,
            name: r.display || (found && found.dist) || r.requirement,
            spec: r.spec,
            kind: r.kind,
            version: found ? found.version : null,
            optimizer,
            usedBy: users,
            status,
        };
    });
}

/**
 * The deck's packages once the entries `removedIds` are gone: a package goes when a removed entry
 * needed it and nothing left on the deck does. A package nothing needed before (one added by hand,
 * or left from an earlier removal) is left for the person to decide, as is every optimizer. With
 * no probe result (Python not ready, the probe failed) the list is kept as it is.
 */
function packagesAfterRemoving(deck, neededBy, removedIds) {
    const packages = (deck && deck.packages) || [];
    if (!neededBy) return packages;
    const removed = new Set(removedIds);
    const stillNeeded = new Set();
    const freed = new Set();
    for (const [id, keys] of Object.entries(neededBy)) {
        for (const key of keys) (removed.has(id) ? freed : stillNeeded).add(key);
    }
    return packages.filter((req) => {
        const key = packageKey(req);
        return !freed.has(key) || stillNeeded.has(key) || optimizerOf(req);
    });
}

/** The deck with `packages` replaced (the key kept even when empty: a deck always lists them). */
function withPackages(deck, packages) {
    return { ...deck, packages };
}

/** Lines of `uv pip install --dry-run` output as [{change: '+'|'-', name, version}]. */
function parseDryRun(output) {
    const changes = [];
    for (const line of String(output || '').split(/\r?\n/)) {
        const m = /^\s*([+-])\s+([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?==(\S+)/.exec(line);
        if (m) changes.push({ change: m[1], name: normalize(m[2]), version: m[3] });
    }
    return changes;
}

module.exports = {
    parseRequirement, withVersion, instrumentModules, deckEntries, probeInput, optimizerOf,
    describePackages, packagesAfterRemoving, withPackages, parseDryRun, normalize,
};
