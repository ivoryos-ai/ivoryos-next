'use strict';
// Edits the launcher makes to a deck file: change an instrument (its COM port, say), rename it,
// switch it off, remove it; and the same for a plugin (the packages they leave behind are
// deckPackages.js's, applied by manager.js). Adding goes through manifest.js's mergeIntoDeck, the same path an
// install from the Hub takes. Pure functions over the parsed deck; the caller writes the file.

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

class DeckEditError extends Error {}

function instrumentsOf(deck) {
    return Array.isArray(deck && deck.instruments) ? deck.instruments : [];
}

/**
 * Replace the instrument called `name` with `entry`. `entry.name` may differ, which renames it;
 * the new name must be free. Workflows refer to instruments by name, so the caller should say
 * that a rename breaks the saved workflows that use the old one.
 */
function updateInstrument(deck, name, entry) {
    const list = instrumentsOf(deck);
    const at = list.findIndex((i) => i && i.name === name);
    if (at === -1) throw new DeckEditError(`There is no instrument called '${name}' on this deck.`);
    if (!entry || !NAME_RE.test(entry.name || '')) {
        throw new DeckEditError('Instrument names use letters, digits and underscores, and start with a letter.');
    }
    if (entry.name !== name && list.some((i) => i && i.name === entry.name)) {
        throw new DeckEditError(`There is already an instrument called '${entry.name}'.`);
    }
    const instruments = list.slice();
    instruments[at] = entry;
    return { ...deck, instruments };
}

function removeInstrument(deck, name) {
    return { ...deck, instruments: instrumentsOf(deck).filter((i) => !i || i.name !== name) };
}

/** Keep an instrument in the deck but skip it at startup: an unplugged device, a spare. */
function setInstrumentEnabled(deck, name, enabled) {
    return {
        ...deck,
        instruments: instrumentsOf(deck).map((i) => {
            if (!i || i.name !== name) return i;
            const next = { ...i };
            if (enabled) delete next.enabled; else next.enabled = false;
            return next;
        }),
    };
}

// A deck's `plugins` entry is "package.module:attribute" while it is on, and
// {ref, enabled: false} while it is switched off (ivoryos_edge.plugins.plugin_ref reads both).

/** The reference a `plugins` entry names, whether or not it is switched off. */
function pluginRef(entry) {
    if (entry && typeof entry === 'object') return String(entry.ref || '').trim();
    return String(entry || '').trim();
}

function pluginEnabled(entry) {
    return !(entry && typeof entry === 'object' && entry.enabled === false);
}

function pluginsOf(deck) {
    return Array.isArray(deck && deck.plugins) ? deck.plugins : [];
}

/** The deck with `plugins` set, leaving the key out when the list is empty (as mergeIntoDeck does). */
function withPlugins(deck, plugins) {
    const next = { ...deck };
    if (plugins.length) next.plugins = plugins; else delete next.plugins;
    return next;
}

function removePlugin(deck, ref) {
    const list = pluginsOf(deck);
    if (!list.some((p) => pluginRef(p) === ref)) throw new DeckEditError(`There is no plugin '${ref}' on this deck.`);
    return withPlugins(deck, list.filter((p) => pluginRef(p) !== ref));
}

/** Keep a plugin listed on the deck but skip it at startup. */
function setPluginEnabled(deck, ref, enabled) {
    const list = pluginsOf(deck);
    if (!list.some((p) => pluginRef(p) === ref)) throw new DeckEditError(`There is no plugin '${ref}' on this deck.`);
    return withPlugins(deck, list.map((p) => (pluginRef(p) !== ref ? p : enabled ? ref : { ref, enabled: false })));
}

/** A name not yet used on the deck, from a suggestion: `pump` -> `pump`, `pump_2`, ... */
function freeName(deck, suggestion) {
    let base = String(suggestion || 'device').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!base) base = 'device';
    if (!/^[a-z]/.test(base)) base = `device_${base}`;
    const used = new Set(instrumentsOf(deck).map((i) => i && i.name));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
}

module.exports = {
    DeckEditError, updateInstrument, removeInstrument, setInstrumentEnabled, freeName,
    pluginRef, pluginEnabled, removePlugin, setPluginEnabled,
};
