'use strict';
// Runs the launcher's profiles: any number of them at once, each its own edge process on its own
// port, each with a supervisor (supervisor.js) that restarts it on request and reports a crash.
//
// No Electron here, so the logic is testable on its own; main.js connects it to windows, dialogs
// and IPC. Profiles share one Python environment (runtime.js): drivers installed for one deck
// are importable by every profile, which is simpler than a venv per profile and costs only the
// isolation between decks that, on one bench, are usually the same instruments anyway. So every
// install into it is checked against the other decks' lists first (`_planInstall`), and a deck
// whose packages cannot share it is given its own (`setEnvironment`, issue 82).

const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const { EdgeSupervisor } = require('./supervisor');
const {
    loadProfiles, saveProfiles, withDefaults, validateProfile, commandFor, usesOwnInterpreter, readDeckFile, writeDeckFile,
} = require('./profiles');
const { normalizeNotifications, changeNotifications } = require('./notifyPrefs');
const { validateManifest, mergeIntoDeck, packageKey } = require('./manifest');
const {
    parseRequirement, withVersion, probeInput, describePackages, packagesAfterRemoving, withPackages, optimizerOf,
} = require('./deckPackages');
const {
    updateInstrument, removeInstrument, setInstrumentEnabled, removePlugin, setPluginEnabled, loadSignature, stable,
} = require('./deckEdit');
const { addWorkflows } = require('./library');
const { selectionOf, withSelection } = require('./optimizers');
const { combine, explainFailure, isUnsatisfiable, conflictTitle, conflictMessage, agentBrief } = require('./packageConflicts');
const { runtimeDir, deckEnvironmentDir } = require('./runtime');

function portIsFree(port) {
    return new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => srv.close(() => resolve(true)));
        srv.listen(port, '0.0.0.0');
    });
}

class ProfileManager extends EventEmitter {
    /**
     * @param {object} opts
     * @param {string} opts.home                    the launcher's data folder
     * @param {() => Promise<import('./runtime').PythonRuntime>} opts.getRuntime  resolves once Python is ready
     * @param {string|null} [opts.frontendDir]      the web UI every edge should serve
     */
    /**
     * @param {boolean} [opts.cloudComingSoon]  a release build where Cloud is not offered yet: its
     *   decks hide their Cloud pages (IVORYOS_CLOUD_COMING_SOON) and Cloud-only mode is off.
     */
    /**
     * @param {(id: string) => ({id: string, name: string|null}|null|Promise<{id: string, name: string|null}|null>)} [opts.activeRun]
     *   the run a profile's deck is on now, or null (main.js: attention.lastRun). An install into a
     *   running deck is refused while there is one.
     */
    constructor({ home, getRuntime, frontendDir = null, cloudComingSoon = false, activeRun = null }) {
        super();
        this.activeRun = activeRun || (() => null);
        this.cloudComingSoon = !!cloudComingSoon;
        this.home = home;
        this.getRuntime = getRuntime;
        this.frontendDir = frontendDir;
        this.store = loadProfiles(home);
        this.running = new Map(); // id -> { supervisor, startedWith, packagesChanged }
        this.status = new Map(); // id -> { state, message, port, error }
        this.locks = new Map(); // id -> the tail of that profile's operation queue
    }

    /**
     * Run `fn` after every earlier operation on this profile has finished.
     *
     * Start, stop, restart, installs and deck edits all spawn or kill the profile's process, and
     * they used to be free to overlap. Two deck edits in quick succession each restarted the deck;
     * both starts passed the "already running?" check before either had registered its process, so
     * two edges were spawned, the manager kept one, and the other ran on untracked -- which Stop
     * could then never reach. Queuing per profile makes each operation see the state the previous
     * one left, while different profiles still start and stop independently.
     */
    _exclusive(id, fn) {
        const previous = this.locks.get(id) || Promise.resolve();
        const run = previous.catch(() => {}).then(fn);
        const tail = run.catch(() => {});
        this.locks.set(id, tail);
        tail.then(() => { if (this.locks.get(id) === tail) this.locks.delete(id); });
        return run;
    }

    // --- profiles ---------------------------------------------------------------------------

    _save() {
        saveProfiles(this.home, this.store);
        this.emit('changed');
    }

    get(id) {
        const profile = this.store.profiles.find((p) => p.id === id);
        if (!profile) throw new Error('That profile no longer exists.');
        return profile;
    }

    statusOf(id) {
        const s = this.status.get(id) || { state: 'stopped' };
        const port = s.port || this.get(id).port;
        const pending = s.state === 'running' ? this._pending(id) : [];
        return { ...s, port, url: s.state === 'running' ? `http://127.0.0.1:${port}` : null, needsRestart: pending.length > 0, pending };
    }

    // --- what a running profile has not applied yet -------------------------------------------
    //
    // Nothing the launcher does restarts a running profile by itself: not an edit to its deck, not
    // an install, not a saved setting. A restart ends whatever run the bench is on and drops the
    // deck off Cloud, so it is only ever the person's click. What the launcher owes them instead
    // is to say, always, when what is saved differs from what the process started with: the
    // status carries `needsRestart` and `pending` (which kinds), and the page says "not applied
    // yet" until a restart. It is compared, not flagged, so a change that is undone is no change,
    // and a file edited outside the app counts too.

    /**
     * Everything a profile's process reads when it starts, as comparable text per kind. The deck
     * or script is read each time, not remembered by its modification time: two saves within one
     * tick of the clock (an edit and its undo) can leave the same time and size on Windows, and
     * these are small files read only for profiles that are running.
     */
    _startedWith(profile) {
        const { port, listenOnNetwork, env, script, cwd, args, python, deck, dataDir, environment } = profile;
        const parts = {
            settings: stable({ port, listenOnNetwork, env, script, cwd, args, python, deck, dataDir, environment }),
            cloud: this.store.cloudUrl || null,
        };
        if (profile.kind === 'deck') {
            parts.deck = loadSignature(readDeckFile(profile.deck));
        } else {
            try { parts.script = crypto.createHash('sha1').update(fs.readFileSync(profile.script)).digest('hex'); } catch { parts.script = null; }
        }
        return parts;
    }

    /**
     * Which kinds of change a running profile has not applied: 'deck' (its instruments or
     * plugins), 'script', 'packages' (installed while it ran), 'settings', 'cloud' (the launcher's
     * Cloud address). Empty when it runs what is saved.
     */
    _pending(id) {
        const run = this.running.get(id);
        if (!run || !run.startedWith) return [];
        let now;
        try { now = this._startedWith(this.get(id)); } catch { return []; }
        const was = run.startedWith;
        return [
            now.deck !== was.deck && 'deck',
            now.script !== was.script && 'script',
            run.packagesChanged && 'packages',
            now.settings !== was.settings && 'settings',
            now.cloud !== was.cloud && 'cloud',
        ].filter(Boolean);
    }

    list() {
        return this.store.profiles.map((p) => ({ ...p, status: this.statusOf(p.id), problems: validateProfile(p) }));
    }

    create(fields) {
        // A new profile takes the first port no other profile has: two on 8080 cannot run at once,
        // and a deck made from a Hub platform is meant to run beside the one it was made from.
        const used = new Set(this.store.profiles.map((p) => Number(p.port)));
        let port = Number(fields && fields.port) || 8080;
        if (!(fields && fields.port)) while (used.has(port)) port += 1;
        const profile = withDefaults(this.home, { ...fields, port, id: undefined });
        this.store.profiles.push(profile);
        // A new deck file carries the profile's name (readDeckFile's default is "My deck").
        if (profile.kind === 'deck') {
            writeDeckFile(profile.deck, fs.existsSync(profile.deck) ? readDeckFile(profile.deck) : { ...readDeckFile(profile.deck), name: profile.name });
        }
        this._save();
        return profile;
    }

    /**
     * The first port from 8080 that no profile uses and nothing on this computer is listening on,
     * for a new profile. `create` alone only avoids other profiles, since it cannot wait; a port
     * another program holds would otherwise surface only when the new deck fails to start.
     */
    async freePort(from = 8080) {
        const used = new Set(this.store.profiles.map((p) => Number(p.port)));
        for (let port = from; port < from + 200; port += 1) {
            if (!used.has(port) && (await portIsFree(port))) return port;
        }
        return from;
    }

    update(id, patch) {
        const at = this.store.profiles.findIndex((p) => p.id === id);
        if (at === -1) throw new Error('That profile no longer exists.');
        // id and kind are identity: changing them would orphan the profile's deck and data. Which
        // Python a deck runs in changes only through setEnvironment, which installs into it first.
        const { id: _i, kind: _k, environment: _e, ...rest } = patch || {};
        this.store.profiles[at] = withDefaults(this.home, { ...this.store.profiles[at], ...rest });
        this._save();
        return this.store.profiles[at];
    }

    remove(id) {
        return this._exclusive(id, () => this._remove(id));
    }

    async _remove(id) {
        await this._stop(id);
        this.store.profiles = this.store.profiles.filter((p) => p.id !== id);
        this.status.delete(id);
        this._save(); // the deck and data folders stay on disk; removing a profile loses no runs
        // Its own Python, if it had one, is only installed packages: nothing of the deck's.
        try { fs.rmSync(deckEnvironmentDir(runtimeDir(this.home), id), { recursive: true, force: true }); } catch { /* in use: left */ }
    }

    get hubUrl() {
        return this.store.hubUrl || process.env.IVORYOS_HUB_URL || 'https://ivoryos.ai';
    }

    setHubUrl(url) {
        this.store.hubUrl = url ? String(url).replace(/\/+$/, '') : null;
        this._save();
    }

    /** Whether a new version of the app downloads by itself (it still installs only on restart). */
    get autoUpdate() {
        return this.store.autoUpdate !== false;
    }

    setAutoUpdate(on) {
        this.store.autoUpdate = !!on;
        this._save();
    }

    /** Window preferences: 'minimizeToTray' (default off, stored as `trayOnMinimize`: profiles.js
     *  says why), 'closeToTray' (default on), 'trayHintShown'. */
    windowPref(key) {
        if (key === 'trayHintShown') return !!this.store.trayHintShown;
        if (key === 'minimizeToTray') return this.store.trayOnMinimize === true;
        return this.store[key] !== false;
    }

    setWindowPref(key, on) {
        if (!['minimizeToTray', 'closeToTray', 'trayHintShown'].includes(key)) throw new Error(`Unknown setting: ${key}`);
        this.store[key === 'minimizeToTray' ? 'trayOnMinimize' : key] = !!on;
        this._save();
    }

    /** The app version that last emptied the shared HTTP cache at startup (main.js says why). */
    get cacheClearedFor() {
        return this.store.cacheClearedFor || null;
    }

    setCacheClearedFor(version) {
        this.store.cacheClearedFor = String(version);
        this._save();
    }

    /** Where decks pair with IvoryOS Cloud: the hosted service unless a lab runs its own. */
    /** 'system' | 'light' | 'dark': the app's one theme, applied to every page it shows. */
    get theme() {
        return this.store.theme || 'system';
    }

    setTheme(theme) {
        if (!['system', 'light', 'dark'].includes(theme)) throw new Error(`Unknown theme: ${theme}`);
        this.store.theme = theme;
        this._save();
    }

    /**
     * Someone who only uses Cloud: the launcher shows Cloud and the account, not decks or the Hub,
     * and the app never prepares Python (a download of its own on first launch, for nothing).
     * Decks already set up are kept, just hidden and not started, until this is turned off.
     */
    get cloudOnly() {
        // Kept as saved, but not in force while Cloud is not offered.
        return !this.cloudComingSoon && !!this.store.cloudOnly;
    }

    setCloudOnly(on) {
        this.store.cloudOnly = !!on;
        this._save();
    }

    /** What the person is notified about (notifyPrefs.js): one switch per kind of moment. */
    get notifications() {
        return normalizeNotifications(this.store.notifications);
    }

    setNotifications(patch) {
        this.store.notifications = changeNotifications(this.store.notifications, patch);
        this._save();
        return this.store.notifications;
    }

    /**
     * Automation Hub items this account starred ('module:12', 'platform:4', 'plugin:3',
     * 'template:9'), for the browser's Starred view. Kept per account on this computer: two people
     * sharing a bench PC each get their own, and signing out shows the signed-out list.
     */
    starred(account) {
        const all = this.store.starred || {};
        return Array.isArray(all[account]) ? all[account] : [];
    }

    setStarred(account, key, on) {
        if (!/^(module|platform|plugin|template):\d+$/.test(String(key))) throw new Error(`Not a Hub item: ${key}`);
        const all = { ...(this.store.starred || {}) };
        const list = (Array.isArray(all[account]) ? all[account] : []).filter((k) => k !== key);
        all[account] = on ? [...list, key] : list;
        this.store.starred = all;
        this._save();
        return all[account];
    }

    /**
     * Put the profiles in this order (the launcher's sidebar, dragged). Ids not listed keep their
     * relative order after the listed ones, so a profile created meanwhile is never dropped.
     */
    reorder(ids) {
        const byId = new Map(this.store.profiles.map((p) => [p.id, p]));
        const listed = (Array.isArray(ids) ? ids : []).filter((id) => byId.has(id));
        const rest = this.store.profiles.filter((p) => !listed.includes(p.id));
        this.store.profiles = [...listed.map((id) => byId.get(id)), ...rest];
        this._save();
    }

    get cloudUrl() {
        return this.store.cloudUrl || process.env.IVORYOS_CLOUD_URL || 'https://cloud.ivoryos.ai';
    }

    /** Takes effect for each edge the next time it starts, since the edge reads it at startup. */
    setCloudUrl(url) {
        let value = url ? String(url).trim().replace(/\/+$/, '') : '';
        // "localhost:3002" or "cloud.mylab.org": http for this computer or the lab network, where
        // a Cloud normally serves plain http, https for anything else.
        if (value && !/^https?:\/\//.test(value)) {
            const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/:]+\.local)/.test(value);
            value = `${local ? 'http' : 'https'}://${value}`;
        }
        this.store.cloudUrl = value || null;
        this._save();
    }

    logFile(id) {
        return path.join(this.home, 'logs', `${id}.log`);
    }

    logTail(id) {
        const run = this.running.get(id);
        return run ? run.supervisor.logTail : (this.status.get(id)?.logTail || '');
    }

    // --- running ----------------------------------------------------------------------------

    _setStatus(id, next) {
        this.status.set(id, { ...(this.status.get(id) || {}), ...next });
        this.emit('changed');
    }

    start(id) {
        return this._exclusive(id, () => this._start(id));
    }

    stop(id) {
        return this._exclusive(id, () => this._stop(id));
    }

    restart(id) {
        return this._exclusive(id, async () => {
            await this._stop(id);
            return this._start(id);
        });
    }

    async _start(id) {
        const profile = this.get(id);
        if (this.running.has(id)) return this.statusOf(id);
        const problems = validateProfile(profile);
        if (problems.length) {
            this._setStatus(id, { state: 'error', message: problems.join(' ') });
            throw new Error(problems.join(' '));
        }
        this._setStatus(id, { state: 'starting', message: 'Preparing Python…', error: null, conflict: null, port: profile.port, portNote: null, installing: null });
        // Taken before the process exists, so a change made while it starts counts as not applied.
        const startedWith = this._startedWith(profile);
        try {
            const onProgress = (message) => this._setStatus(id, { message });
            // A deck with its own environment runs from it; everything else from the shared one.
            const runtime = await this._runtimeFor(profile, onProgress);
            if (profile.kind === 'deck') {
                const deck = readDeckFile(profile.deck);
                // The first profile loadProfiles makes on a fresh install has no folder yet (only
                // create() writes one), and the edge runs with dataDir as its cwd: spawning into a
                // missing cwd fails as "spawn python.exe ENOENT", naming the wrong file.
                fs.mkdirSync(profile.dataDir, { recursive: true });
                const packages = deck.packages || [];
                // Installed when the list changed since its last install (edited by hand, or by an
                // agent following the conflict brief), checked against the other decks like any install.
                const upToDate = runtime.packagesUpToDate && runtime.packagesUpToDate(packages, id);
                if (!upToDate) {
                    const plan = await this._planInstall(profile, runtime, packages, deck);
                    await runtime.ensurePackages(packages, { key: id, install: plan.install, onProgress });
                }
            }
            const other = [...this.running.keys()].map((rid) => this.get(rid)).find((p) => this.statusOf(p.id).port === profile.port);
            if (other) throw new Error(`Port ${profile.port} is already used by "${other.name}". Give this profile another port.`);
            if (!(await portIsFree(profile.port))) {
                throw new Error(`Port ${profile.port} is in use by another program. Stop it, or give this profile another port.`);
            }

            const ctx = { python: runtime.python, frontendDir: this.frontendDir, cloudUrl: this.store.cloudUrl || null, cloudComingSoon: this.cloudComingSoon };
            if (this.frontendDir && usesOwnInterpreter(profile, runtime.python)) {
                // Asked of the edge the script will import: same variables, its own folder first.
                const { env } = commandFor(profile, ctx);
                ctx.edgeHasUi = await runtime.hasOwnUi(profile.python, { env, cwd: path.dirname(profile.script) });
            }
            const cmd = commandFor(profile, ctx);
            const supervisor = new EdgeSupervisor({ ...cmd, logFile: this.logFile(id) });
            this.running.set(id, { supervisor, startedWith, packagesChanged: false });
            supervisor.on('log', (line) => this.emit('log', id, line));
            // The edge chose another port than the profile's: follow it, and keep why for the
            // launcher to show (the script sets its own port, or its IvoryOS ignores IVORYOS_PORT).
            supervisor.on('port', (port, requested) => this._setStatus(id, { port, portNote: { requested, actual: port } }));
            supervisor.on('restart-requested', () => {
                // The edge's own Restart (a person's click on its page): the new process reads its
                // deck or script again and imports what is installed now, but is started with the
                // same command, so changed settings and a changed Cloud address still wait.
                const run = this.running.get(id);
                if (run) {
                    try {
                        const now = this._startedWith(this.get(id));
                        run.startedWith = { ...run.startedWith, deck: now.deck, script: now.script };
                        run.packagesChanged = false;
                    } catch { /* the profile is gone */ }
                }
                this._setStatus(id, { state: 'starting', message: 'Restarting…' });
            });
            supervisor.on('ready', () => this._setStatus(id, { state: 'running', message: 'Running', error: null }));
            supervisor.on('crashed', (info) => {
                // Running until now, or a start that never got there (the Start that asked says so).
                const wasRunning = this.statusOf(id).state === 'running';
                this.running.delete(id);
                const message = info.error ? `Could not start: ${info.error.message}` : `Stopped unexpectedly (exit code ${info.code ?? info.signal}).`;
                this._setStatus(id, { state: 'crashed', message, error: message, logTail: info.logTail });
                this.emit('crashed', id, { ...info, wasRunning });
            });
            this._setStatus(id, { message: 'Loading instruments…' });
            await supervisor.start();
            return this.statusOf(id);
        } catch (e) {
            const run = this.running.get(id);
            this.running.delete(id);
            this._setStatus(id, {
                state: 'error', message: e.message, error: e.message,
                logTail: [e.output, run && run.supervisor.logTail].filter(Boolean).join('\n'),
                // The deck page offers what the install dialog does: its own Python, the brief.
                conflict: e.code === 'package-conflict' ? e.detail : null,
            });
            throw e;
        }
    }

    // --- which Python a profile runs in -------------------------------------------------------

    _ownEnvironment(profile) {
        return profile.kind === 'deck' && profile.environment === 'own';
    }

    /**
     * The runtime a profile runs in: a deck's own (made the first time it is needed, so a deck
     * created with `environment: 'own'`, or whose folder was thrown away, gets it on its next
     * start) or the shared one.
     */
    async _runtimeFor(profile, onProgress = () => {}) {
        const shared = await this.getRuntime();
        if (!this._ownEnvironment(profile) || !shared.forDeck) return shared;
        const own = shared.forDeck(profile.id);
        await own.ensure({ onProgress });
        return own;
    }

    /** The Python a profile runs with: a script's own interpreter, a deck's own environment, or the shared one. */
    async pythonFor(id) {
        const profile = this.get(id);
        if (profile.kind === 'script') return profile.python || (await this.getRuntime()).python;
        return (await this._runtimeFor(profile)).python;
    }

    /**
     * The other decks in the shared environment, each with the packages it has there: what an
     * install must not break. That is the requirements on its list that were installed for it
     * (runtime.installedPackages), not its whole list: one added by hand and never installed is not
     * something it has, and counting it let one deck's unfinished edit stop every other deck from
     * installing, and named them as the conflict. It meets the others when it next starts. One
     * taken off its list is no longer needed by it, though still installed, so it is free to change.
     * A deck with its own environment is not among them, nor a script (it lists no packages). A
     * private repository's archive that is gone from disk is left out, since it could not be
     * installed again anyway.
     */
    _sharingDecks(exceptId, runtime) {
        return this.store.profiles
            .filter((p) => p.id !== exceptId && p.kind === 'deck' && !this._ownEnvironment(p))
            .map((p) => {
                let packages = readDeckFile(p.deck).packages || [];
                if (runtime && runtime.installedPackages) {
                    const has = new Set((runtime.installedPackages(p.id) || []).map((r) => String(r).trim()));
                    packages = packages.filter((r) => has.has(String(r).trim()));
                }
                packages = packages.filter((r) => !packageKey(r).startsWith('path:') || fs.existsSync(String(r).trim()));
                return { id: p.id, name: p.name, file: p.deck, packages };
            })
            .filter((o) => o.packages.length);
    }

    /**
     * What to give uv so that `packages`, this deck's whole list, go in without breaking anything
     * else in its environment: {install, changes} (`changes` is the dry run's, null when the
     * runtime cannot dry-run). In the shared environment that is the deck's list together with
     * every other deck's and the edge's own requirements, resolved as one: `uv pip install` of one
     * deck's list alone replaced whatever another deck needed and reported success.
     *
     * When that does not resolve, nothing is installed and a 'package-conflict' error says which
     * of three things it is (packageConflicts.js): the deck's own list ('deck'), its list beside
     * IvoryOS's ('edge'), or its list beside another deck's ('shared', the one a deck's own
     * environment fixes, naming those decks). `deckAfter` is the deck as it would be, for the
     * brief's list of instruments.
     */
    async _planInstall(profile, runtime, packages, deckAfter = null) {
        if (!runtime.resolve) return { install: packages, changes: null };
        const edge = runtime.edgeRequirements ? await runtime.edgeRequirements() : [];
        const others = this._ownEnvironment(profile) ? [] : this._sharingDecks(profile.id, runtime);
        const all = combine(packages, edge, ...others.map((o) => o.packages));
        const together = await runtime.resolve(all);
        if (together.ok) return { install: all, changes: together.changes };

        const conflict = (kind, output, culprits = []) => {
            const deck = deckAfter || readDeckFile(profile.deck);
            const detail = {
                kind,
                deck: { id: profile.id, name: profile.name, file: profile.deck },
                others: culprits.map(({ id, name, file, packages: p }) => ({ id, name, file, packages: p })),
                explanation: explainFailure(output),
                packages,
            };
            detail.title = conflictTitle(detail);
            detail.brief = agentBrief({
                conflict: detail, requested: packages, current: readDeckFile(profile.deck).packages || [],
                instruments: (deck.instruments || []).map((i) => ({ name: i.name, import: i.import, class: i.class })),
                python: runtime.python, uv: runtime.uv, platform: process.platform,
            });
            return Object.assign(new Error(conflictMessage(detail)), { code: 'package-conflict', detail, output });
        };

        const alone = others.length ? await runtime.resolve(combine(packages, edge)) : together;
        if (!alone.ok) {
            // A download that failed, or a file that is missing, is not a conflict: said as uv says it.
            if (!isUnsatisfiable(alone.output)) {
                throw Object.assign(new Error(`Could not work out what to install: ${explainFailure(alone.output)}`), { output: alone.output });
            }
            const withoutEdge = edge.length ? await runtime.resolve(combine(packages)) : alone;
            throw conflict(withoutEdge.ok ? 'edge' : 'deck', alone.output);
        }
        // Fine alone, not with the others: which of them. Several are tried at once (each is a
        // resolution against the index); when no single one is to blame, all of them together are.
        const culprits = [];
        for (let i = 0; i < others.length; i += 3) {
            const tried = await Promise.all(others.slice(i, i + 3).map(async (o) => ({ o, res: await runtime.resolve(combine(packages, edge, o.packages)) })));
            for (const { o, res } of tried) if (!res.ok) culprits.push({ ...o, output: res.output });
        }
        if (!culprits.length && !isUnsatisfiable(together.output)) {
            throw Object.assign(new Error(`Could not work out what to install: ${explainFailure(together.output)}`), { output: together.output });
        }
        throw conflict('shared', culprits.length ? culprits[0].output : together.output, culprits.length ? culprits : others);
    }

    /**
     * Give a deck its own Python environment ('own'), or put it back in the shared one ('shared').
     * Its packages are installed into the new one first, and only then does the profile say so,
     * so a failure leaves it where it was. Moving out can happen while it runs (the new
     * environment is beside the old, and it moves at its next restart, like any changed setting);
     * moving back cannot, since its environment is thrown away, and is checked against the shared
     * environment's other decks like any install.
     */
    setEnvironment(id, environment) {
        if (!['own', 'shared'].includes(environment)) throw new Error(`Unknown environment: ${environment}`);
        return this._exclusive(id, async () => {
            const profile = this._deckProfile(id);
            if ((profile.environment === 'own' ? 'own' : 'shared') === environment) return profile;
            const run = this.running.get(id);
            if (environment === 'shared' && run) {
                throw Object.assign(new Error(`Stop ${profile.name} first: it is running from its own Python, which is removed when it moves back.`), { code: 'stop-first' });
            }
            const deck = readDeckFile(profile.deck);
            const packages = deck.packages || [];
            const shared = await this.getRuntime();
            const before = this.statusOf(id);
            const progress = (message) => this._setStatus(id, run ? { installing: message } : { state: 'installing', message });
            try {
                if (environment === 'own') {
                    progress('Setting up its own Python…');
                    const own = await this._runtimeFor({ ...profile, environment: 'own' }, progress);
                    const plan = await this._planInstall({ ...profile, environment: 'own' }, own, packages, deck);
                    own.forgetPackages?.(id);
                    await own.ensurePackages(packages, { key: id, install: plan.install, onProgress: progress });
                    // Back in the shared one later means installing there again.
                    shared.forgetPackages?.(id);
                } else {
                    progress('Checking the shared Python…');
                    const plan = await this._planInstall({ ...profile, environment: 'shared' }, shared, packages, deck);
                    shared.forgetPackages?.(id);
                    await shared.ensurePackages(packages, { key: id, install: plan.install, onProgress: progress });
                    shared.removeDeckEnvironment?.(id);
                }
            } catch (e) {
                this._setStatus(id, run ? { installing: null } : { state: before.state, message: before.message });
                throw e;
            }
            this.store.profiles = this.store.profiles.map((p) => (p.id === id ? { ...p, environment } : p));
            this._save();
            this._setStatus(id, run ? { installing: null } : { state: 'stopped', message: environment === 'own' ? 'Has its own Python' : 'Uses the shared Python', conflict: null, error: null });
            return this.get(id);
        });
    }

    async _stop(id) {
        const run = this.running.get(id);
        if (!run) return;
        this._setStatus(id, { state: 'stopping', message: 'Stopping…' });
        await run.supervisor.stop();
        this.running.delete(id);
        this._setStatus(id, { state: 'stopped', message: 'Stopped', logTail: run.supervisor.logTail });
    }

    async stopAll() {
        await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
    }

    // --- the deck of a deck profile ---------------------------------------------------------

    _deckProfile(id) {
        const profile = this.get(id);
        if (profile.kind !== 'deck') throw new Error('Only deck profiles have a deck to edit. A script sets up its own instruments.');
        return profile;
    }

    readDeck(id) {
        return readDeckFile(this._deckProfile(id).deck);
    }

    /**
     * Apply a deck edit (sync or async) to the deck file, and nothing else. A running deck is
     * never restarted for it: ticking an instrument off must not end the run the bench is on, or
     * drop it off Cloud. The edge reads its deck only when it starts, so its status says
     * `needsRestart` while the file differs from what it loaded (`_pending`), and the restart is
     * the person's own click, when nothing is running.
     */
    _editDeck(id, edit) {
        return this._exclusive(id, async () => {
            const profile = this._deckProfile(id);
            const next = await edit(readDeckFile(profile.deck));
            writeDeckFile(profile.deck, next);
            this.emit('changed');
            return next;
        });
    }

    saveInstrument(id, originalName, entry) {
        return this._editDeck(id, (deck) => (originalName
            ? updateInstrument(deck, originalName, entry)
            : mergeIntoDeck(deck, { instruments: [entry] }).deck));
    }

    /**
     * Take an instrument off the deck, and off the deck's package list whatever only it needed
     * (deckPackages.packagesAfterRemoving). Nothing is uninstalled.
     */
    removeInstrument(id, name) {
        return this._editDeck(id, async (deck) => {
            const neededBy = await this._neededBy(id, deck);
            const next = removeInstrument(deck, name);
            return withPackages(next, packagesAfterRemoving(deck, neededBy, [`instrument:${name}`]));
        });
    }

    /** Which of the deck's packages each entry needs, or null when Python cannot say (not set up yet). */
    async _neededBy(id, deck) {
        try {
            const runtime = await this._runtimeFor(this.get(id));
            if (!runtime.probeDeckPackages) return null;
            return (await runtime.probeDeckPackages(probeInput(deck))).entries;
        } catch {
            return null;
        }
    }

    setInstrumentEnabled(id, name, enabled) {
        return this._editDeck(id, (deck) => setInstrumentEnabled(deck, name, enabled));
    }

    /** Take a plugin off the deck, and its package off the list when nothing else needs it (still installed). */
    removePlugin(id, ref) {
        return this._editDeck(id, async (deck) => {
            const neededBy = await this._neededBy(id, deck);
            return withPackages(removePlugin(deck, ref), packagesAfterRemoving(deck, neededBy, [`plugin:${ref}`]));
        });
    }

    // --- the deck's packages (deckPackages.js) ------------------------------------------------

    /** The deck's packages with installed versions and what needs each: {rows, error}. */
    async deckPackages(id) {
        const deck = this.readDeck(id);
        try {
            const runtime = await this._runtimeFor(this.get(id));
            const probe = await runtime.probeDeckPackages(probeInput(deck));
            return { rows: describePackages(deck, probe), error: null };
        } catch (e) {
            return { rows: describePackages(deck, null), error: `Could not read the installed packages: ${e.message}` };
        }
    }

    /**
     * For each index package on the deck (optimizers aside: their versions are the tested ones the
     * Optimizers card offers), the newest version that installs with the rest of the deck's list.
     * {key: {latest, changes, error?}}; `latest` null means it is up to date.
     */
    async checkPackageUpdates(id) {
        const deck = this.readDeck(id);
        const runtime = await this._runtimeFor(this.get(id));
        const probe = await runtime.probeDeckPackages(probeInput(deck)).catch(() => null);
        const requirements = deck.packages || [];
        const targets = requirements.map(parseRequirement).filter((r) => r.kind === 'name' && !optimizerOf(r.requirement));
        const results = {};
        // A few at a time: each is a resolution against the index.
        for (let i = 0; i < targets.length; i += 3) {
            await Promise.all(targets.slice(i, i + 3).map(async (r) => {
                const found = probe && probe.requirements ? probe.requirements[r.key] : null;
                results[r.key] = await runtime.upgradeCandidate(requirements, r, found ? found.version : null);
            }));
        }
        return results;
    }

    /**
     * Pin one of the deck's packages to `version` and install it with the rest of the deck's list,
     * the way an install from the Hub does (`_installFor`): a conflict is refused before anything
     * changes and the deck is written only once it installed. An update replaces an installed
     * package, so a running deck has to be stopped first, by the person.
     */
    updatePackage(id, key, version) {
        return this._exclusive(id, async () => {
            const profile = this._deckProfile(id);
            const deck = readDeckFile(profile.deck);
            const at = (deck.packages || []).findIndex((r) => packageKey(r) === key);
            if (at === -1) throw new Error(`This deck does not list ${key}.`);
            const packages = deck.packages.slice();
            packages[at] = withVersion(packages[at], version);
            await this._installFor(id, packages, { doing: `Updating ${key}…`, done: 'Updated', failed: 'Update failed', deck: { ...deck, packages } },
                () => writeDeckFile(profile.deck, { ...deck, packages }));
            return readDeckFile(profile.deck);
        });
    }

    /**
     * Take packages off the deck's list. They stay installed (decks share one environment), and
     * the deck is not restarted: what it loads does not change.
     */
    removePackages(id, keys) {
        return this._exclusive(id, async () => {
            const profile = this._deckProfile(id);
            const deck = readDeckFile(profile.deck);
            const drop = new Set(keys);
            const next = withPackages(deck, (deck.packages || []).filter((r) => !drop.has(packageKey(r))));
            writeDeckFile(profile.deck, next);
            this.emit('changed');
            return next;
        });
    }

    setPluginEnabled(id, ref, enabled) {
        return this._editDeck(id, (deck) => setPluginEnabled(deck, ref, enabled));
    }

    /**
     * Install `packages` (a deck's whole list, in one resolution) and then `commit()` the deck
     * file, which is therefore written only once everything installed.
     *
     * A running deck is neither stopped nor restarted for it. It used to be stopped, installed
     * into and started again, whatever it was doing. Now, for a deck that is running:
     *   - on a run, the install is refused (code 'run-under-way'): nothing changes under a run;
     *   - if it would replace or remove a package already installed, it is refused (code
     *     'stop-first') and the person stops the deck themselves. A running interpreter holds its
     *     packages' compiled files open, on Windows they cannot be replaced until it exits, and
     *     an install that fails halfway leaves that package broken for the deck using it;
     *   - if it only adds packages, it goes in while the deck runs, the deck is committed, and
     *     the status says it is not applied yet (`_pending`: 'packages', and 'deck' for what the
     *     commit added) until the person restarts it.
     * A stopped deck installs as before: 'installing', then 'stopped' or 'error' with pip's output.
     *
     * Before any of that, the list is planned against everything else in the deck's environment
     * (`_planInstall`). A conflict installs nothing and leaves the deck's status as it was: the
     * page shows it in a dialog (code 'package-conflict'). `words.deck` is the deck as it would be.
     */
    async _installFor(id, packages, words, commit) {
        const run = this.running.get(id);
        const profile = this.get(id);
        const name = profile.name;
        if (run) {
            let active = null;
            try { active = await this.activeRun(id); } catch { /* cannot tell: the dry run below still protects it */ }
            if (active) {
                throw Object.assign(new Error(
                    `${active.name ? `"${active.name}"` : 'A run'} is under way on ${name}. Installing changes the Python it is running on, `
                    + 'so nothing is installed during a run: try again when it has ended.',
                ), { code: 'run-under-way' });
            }
        }
        const before = this.statusOf(id);
        const progress = (message) => this._setStatus(id, run ? { installing: message } : { message });
        if (run) progress('Checking packages…'); else this._setStatus(id, { state: 'installing', message: 'Checking packages…' });
        let runtime;
        let plan;
        try {
            runtime = await this._runtimeFor(profile, progress);
            plan = await this._planInstall(profile, runtime, packages, words.deck);
        } catch (e) {
            // Nothing was installed: the deck is as it was.
            this._setStatus(id, run ? { installing: null } : { state: before.state, message: before.message });
            throw e;
        }
        let changes = plan.changes;
        if (run) {
            if (!changes && runtime.installPlan) changes = await runtime.installPlan(packages);
            const replaced = [...new Set((changes || []).filter((c) => c.change === '-').map((c) => `${c.name} ${c.version}`))];
            if (replaced.length) {
                this._setStatus(id, { installing: null });
                throw Object.assign(new Error(
                    `This would replace ${replaced.length === 1 ? 'a package' : 'packages'} already installed (${replaced.slice(0, 4).join(', ')}${replaced.length > 4 ? ', …' : ''}), `
                    + `and ${name} is running on ${replaced.length === 1 ? 'it' : 'them'}. Stop ${name}, then try again. It is never stopped for you.`,
                ), { code: 'stop-first' });
            }
        }
        if (run) progress(words.doing); else this._setStatus(id, { state: 'installing', message: words.doing });
        try {
            await runtime.ensurePackages(packages, { key: id, install: plan.install, onProgress: progress });
            commit();
        } catch (e) {
            // A running deck is still running what it had; only a stopped one shows the failure as its state.
            if (run) this._setStatus(id, { installing: null });
            else this._setStatus(id, { state: 'error', message: `${words.failed}: ${e.message}`, error: e.message, logTail: e.output || '' });
            throw e;
        }
        if (run) {
            if (changes && changes.length) run.packagesChanged = true;
            this._setStatus(id, { installing: null });
        } else {
            this._setStatus(id, { state: 'stopped', message: words.done, conflict: null });
        }
    }

    /**
     * Install a manifest's packages and merge it into this profile's deck (`_installFor`: never
     * restarting a running deck, and the deck only written once every package installed, so a
     * failed install leaves the deck as it was).
     * @returns {{added: string[], replaced: string[]}}
     */
    install(id, manifestInput, options) {
        return this._exclusive(id, () => this._install(id, manifestInput, options));
    }

    async _install(id, manifestInput, { allowPaths = false } = {}) {
        const profile = this._deckProfile(id);
        const { manifest } = validateManifest(manifestInput, { allowPaths });
        const merged = mergeIntoDeck(readDeckFile(profile.deck), manifest);
        await this._installFor(id, merged.deck.packages || [], { doing: 'Installing drivers…', done: 'Installed', failed: 'Install failed', deck: merged.deck },
            () => writeDeckFile(profile.deck, merged.deck));
        return { added: merged.added, replaced: merged.replaced, pluginsAdded: merged.pluginsAdded };
    }

    /**
     * Choose a deck's optimizer backends (optimizers.js): `selection` is {id: version | null}.
     * Installed the way the Hub's drivers are: the deck's whole package list in one resolution
     * (a conflict is refused before anything changes) and the deck written only once it installed.
     * A running deck is not restarted: it has the optimizer on its Optimize page after the person
     * restarts it (`_installFor`). Taking one out of the deck leaves it installed, since the decks
     * share one environment.
     */
    setOptimizers(id, selection) {
        return this._exclusive(id, async () => {
            const profile = this._deckProfile(id);
            const deck = readDeckFile(profile.deck);
            const packages = withSelection(deck.packages || [], selection);
            await this._installFor(id, packages, { doing: 'Installing optimizers…', done: 'Installed', failed: 'Install failed', deck: { ...deck, packages } },
                () => writeDeckFile(profile.deck, { ...deck, packages }));
            return selectionOf(packages);
        });
    }

    // --- the workflow library ---------------------------------------------------------------

    /**
     * Add workflows ({name, body}) to this profile's library (library.js): through the edge's API
     * while it runs, as files it adopts otherwise. Returns [{requested, saved}].
     */
    addWorkflows(id, workflows) {
        // Queued with the profile's other operations: a file written while the edge restarts
        // after an install would otherwise race the edge reading its library at startup.
        return this._exclusive(id, () => {
            const status = this.statusOf(id);
            return addWorkflows(this.get(id), workflows, { url: status.state === 'running' ? status.url : null });
        });
    }
}

module.exports = { ProfileManager, portIsFree };
