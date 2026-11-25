'use strict';
// The Python environment the edge runs in, managed with uv.
//
// It lives in the user's data folder, never inside the app: the app bundle is code-signed, and a
// signed bundle cannot have packages installed into it without breaking the signature. So the
// app ships a uv binary and (when packaged) a wheel of the edge; on first launch it creates a
// venv here and installs the edge into it, and every driver installed later lands here too.
//
// uv does the heavy lifting: it downloads a standalone CPython if the machine has none (so the
// user never installs Python), and installs packages an order of magnitude faster than pip,
// which matters because a driver install happens with the edge stopped.
//
// Decks share this one environment unless a deck is given its own (`forDeck`, issue 82), which
// is how two decks needing different versions of one package run on one computer. A deck's own
// environment is the same kind of thing in `envs/<profile id>/`, with the same edge. uv links its
// files from its cache rather than copying them, so a second environment holding PyTorch takes
// seconds and little disk (measured: 2 s and about 50 MB for a copy of a 1.1 GB environment).

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PYTHON_VERSION = '3.11';

function venvPython(venvDir) {
    return process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python');
}

/** Where the launcher keeps its Python (main.js makes the shared runtime here). */
function runtimeDir(home) {
    return path.join(home, 'runtime');
}

/** The folder of a deck's own environment, beside the shared one. Profile ids are `p_<hex>`. */
function deckEnvironmentDir(dir, id) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error(`Not a profile id: ${id}`);
    return path.join(dir, 'envs', String(id));
}

/** Run a command, streaming its output to `onLine`; resolve with the output, reject on failure. */
function run(command, args, { onLine, env, cwd } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env: { ...process.env, ...env }, cwd, windowsHide: true });
        let output = '';
        const take = (d) => {
            const text = d.toString();
            output += text;
            if (onLine) text.split(/\r?\n/).filter(Boolean).forEach(onLine);
        };
        child.stdout.on('data', take);
        child.stderr.on('data', take);
        child.on('error', (err) => reject(new Error(`Could not run ${path.basename(command)}: ${err.message}`)));
        child.on('exit', (code) => {
            if (code === 0) resolve(output);
            else {
                const err = new Error(`${path.basename(command)} ${args[0] || ''} failed (exit ${code})`);
                err.output = output;
                reject(err);
            }
        });
    });
}

class PythonRuntime {
    /**
     * @param {object} opts
     * @param {string} opts.uv          path to the uv binary
     * @param {string} opts.dir         runtime folder (holds venv/ and state.json)
     * @param {object} opts.edgeSource  how to install the edge: {kind: 'wheel', path} or
     *                                  {kind: 'editable', path} (a source checkout, in development)
     * @param {(line: string) => void} [opts.onLine]
     * @param {string} [opts.firstSetup]  what ensure() says while it makes the venv
     */
    constructor(opts) {
        this.uv = opts.uv;
        this.dir = opts.dir;
        this.venv = path.join(opts.dir, 'venv');
        this.statePath = path.join(opts.dir, 'state.json');
        this.edgeSource = opts.edgeSource;
        this.onLine = opts.onLine || (() => {});
        this.firstSetup = opts.firstSetup || 'Setting up Python (first launch only)…';
        this.decks = new Map(); // profile id -> that deck's own PythonRuntime
        this._edgeRequirements = null; // {fingerprint, requirements}
    }

    get python() {
        return venvPython(this.venv);
    }

    // --- a deck's own environment (manager.js: profile `environment: 'own'`) ------------------------

    /**
     * The environment a deck that has its own runs in: a runtime like this one in `envs/<id>/`,
     * with the same edge. Not created here: its ensure() does that, the first time it is used.
     */
    forDeck(id) {
        if (!this.decks.has(id)) {
            this.decks.set(id, new PythonRuntime({
                uv: this.uv, dir: deckEnvironmentDir(this.dir, id), edgeSource: this.edgeSource, onLine: this.onLine,
                firstSetup: 'Setting up this deck’s own Python…',
            }));
        }
        return this.decks.get(id);
    }

    hasDeckEnvironment(id) {
        return fs.existsSync(venvPython(path.join(deckEnvironmentDir(this.dir, id), 'venv')));
    }

    /** Throw a deck's own environment away (it moved back to the shared one, or was removed). */
    removeDeckEnvironment(id) {
        fs.rmSync(deckEnvironmentDir(this.dir, id), { recursive: true, force: true });
        this.decks.delete(id);
    }

    _readState() {
        try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); } catch { return {}; }
    }

    _writeState(state) {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2));
    }

    /** What `pip install` is given to install the edge: this build's wheel, or the checkout. */
    _edgeTarget() {
        return this.edgeSource.kind === 'editable' ? ['-e', this.edgeSource.path] : [this.edgeSource.path];
    }

    // --- environments the person manages (e.g. a project's own .venv, used from their IDE) ----------

    /**
     * Describe an interpreter: its Python version and whether IvoryOS is importable from it, which
     * is what decides whether a script can run there. Never throws: a path that is not a working
     * Python is reported as such.
     */
    async inspect(python) {
        const probe = 'import json, sys\ntry:\n    import importlib.metadata as m; v = m.version("ivoryos-edge")\nexcept Exception:\n    v = None\nprint(json.dumps({"python": sys.version.split()[0], "edge": v, "prefix": sys.prefix}))';
        try {
            const out = await run(python, ['-c', probe]);
            const info = JSON.parse(out.trim().split(/\r?\n/).pop());
            return { ok: true, python, version: info.python, edge: info.edge, prefix: info.prefix };
        } catch (e) {
            return { ok: false, python, error: fs.existsSync(python) ? (e.output || e.message).trim().split('\n').pop() : 'No file at this path.' };
        }
    }

    /**
     * Whether the edge `python` imports would find a built UI of its own: the copy its wheel
     * carries (ivoryos_edge/ui/), or frontend/out beside an editable checkout, as
     * `_frontend_dirs` in the edge's server.py looks. Asked with the environment and folder the
     * script will run with, so it finds the same ivoryos_edge. Never throws: no answer is false.
     */
    async hasOwnUi(python, { env, cwd } = {}) {
        const probe = 'import importlib.util, os\ns = importlib.util.find_spec("ivoryos_edge")\npkg = os.path.dirname(s.origin) if s and s.origin else None\nprint(bool(pkg) and any(os.path.isfile(os.path.join(d, "index.html")) for d in (os.path.join(pkg, "ui"), os.path.join(pkg, "..", "..", "frontend", "out"))))';
        try {
            const out = await run(python, ['-c', probe], { env, cwd });
            return out.trim().split(/\r?\n/).pop() === 'True';
        } catch {
            return false;
        }
    }

    /**
     * A `.venv` in `folder` with this launcher's edge installed: the environment a project's IDE
     * and the launcher then share. Reused if it already exists (only the edge is installed).
     * @returns {Promise<string>} the new interpreter's path
     */
    async createProjectVenv(folder) {
        const venvDir = path.join(folder, '.venv');
        const python = venvPython(venvDir);
        if (!fs.existsSync(python)) {
            await run(this.uv, ['venv', '--python', PYTHON_VERSION, '--seed', venvDir], { onLine: this.onLine });
        }
        await this.installEdgeInto(python);
        return python;
    }

    /** Install this launcher's edge into another environment (one the person chose). */
    async installEdgeInto(python) {
        return run(this.uv, ['pip', 'install', '--python', python, ...this._edgeTarget()], { onLine: this.onLine });
    }

    /** A string that changes whenever a different edge build has to be installed. */
    _edgeFingerprint() {
        const src = this.edgeSource;
        if (src.kind === 'editable') return `editable:${path.resolve(src.path)}`;
        const stat = fs.statSync(src.path);
        return `wheel:${path.basename(src.path)}:${stat.size}`;
    }

    /**
     * Make sure the venv exists and holds the current edge. Cheap when nothing changed: it checks
     * a fingerprint rather than asking uv, so an ordinary launch adds no delay.
     * @param {{onProgress?: (msg: string) => void}} [opts]
     */
    async ensure({ onProgress = () => {} } = {}) {
        const state = this._readState();
        if (!fs.existsSync(this.python)) {
            onProgress(this.firstSetup);
            fs.mkdirSync(this.dir, { recursive: true });
            await run(this.uv, ['venv', '--python', PYTHON_VERSION, '--seed', this.venv], { onLine: this.onLine });
            delete state.edge;
        }
        const fingerprint = this._edgeFingerprint();
        if (state.edge !== fingerprint) {
            onProgress('Installing the IvoryOS edge…');
            await run(this.uv, ['pip', 'install', '--python', this.python, ...this._edgeTarget()], { onLine: this.onLine });
            state.edge = fingerprint;
            state.installedAt = new Date().toISOString();
            this._writeState(state);
        }
        this._clearStaleEdgeFolder();
    }

    /** The venv's site-packages folders (one on Windows; lib/pythonX.Y/site-packages elsewhere). */
    _sitePackages() {
        if (process.platform === 'win32') return [path.join(this.venv, 'Lib', 'site-packages')];
        const lib = path.join(this.venv, 'lib');
        try {
            return fs.readdirSync(lib).filter(n => n.startsWith('python')).map(n => path.join(lib, n, 'site-packages'));
        } catch { return []; }
    }

    /**
     * Clear a leftover `ivoryos_edge` folder (no `__init__.py`) from site-packages (issue 80).
     * An uninstalled wheel leaves behind folders the edge made at run time; Python then treats the
     * folder as a namespace package that hides an editable install ("cannot import name
     * 'WorkflowError' ... (unknown location)"). Runs on every launch: an empty folder is deleted,
     * one holding files is renamed to `ivoryos_edge.leftover-<time>` so nothing is lost.
     */
    _clearStaleEdgeFolder() {
        for (const site of this._sitePackages()) {
            const dir = path.join(site, 'ivoryos_edge');
            try {
                if (!fs.statSync(dir).isDirectory() || fs.existsSync(path.join(dir, '__init__.py'))) continue;
            } catch { continue; }
            try {
                const hasFiles = fs.readdirSync(dir, { recursive: true, withFileTypes: true }).some(e => !e.isDirectory());
                if (hasFiles) {
                    const aside = `${dir}.leftover-${new Date().toISOString().replace(/[:.]/g, '-')}`;
                    fs.renameSync(dir, aside);
                    this.onLine(`Moved a leftover ivoryos_edge folder, which hid the installed edge, to ${aside}`);
                } else {
                    fs.rmSync(dir, { recursive: true, force: true });
                    this.onLine(`Removed an empty leftover ivoryos_edge folder, which hid the installed edge: ${dir}`);
                }
            } catch (e) {
                this.onLine(`Could not clear the leftover ivoryos_edge folder ${dir}: ${e.message}`);
            }
        }
    }

    /**
     * Make sure a deck's packages are installed. Skipped when that deck's list is unchanged since
     * its last successful install, which is what keeps an ordinary start fast; tracked per `key`
     * (the launcher passes the profile id) because several decks share this one environment.
     * After reset() every list is installed again, so a rebuilt environment still has the drivers.
     *
     * `install` is what is actually given to uv, when it is more than the deck's list: in the
     * shared environment, the deck's list together with every other deck's and the edge's own
     * requirements (manager.js `_planInstall`), so that no other deck's package is replaced by a
     * version it cannot use. The fingerprint is still of the deck's own list.
     */
    async ensurePackages(requirements, { key = 'default', onProgress = () => {}, install = null } = {}) {
        if (this.packagesUpToDate(requirements, key)) return;
        if (requirements.length) {
            onProgress(`Installing ${requirements.length} driver package${requirements.length === 1 ? '' : 's'}…`);
            await this.install(install || requirements);
        }
        const latest = this._readState();
        this._writeState({ ...latest, packagesByKey: { ...(latest.packagesByKey || {}), [key]: JSON.stringify([...requirements].sort()) } });
    }

    /** Whether `requirements` is what was last installed successfully for `key`. */
    packagesUpToDate(requirements, key = 'default') {
        return (this._readState().packagesByKey || {})[key] === JSON.stringify([...requirements].sort());
    }

    /** The list last installed successfully for `key` (as ensurePackages recorded it), or null. */
    installedPackages(key) {
        const recorded = (this._readState().packagesByKey || {})[key];
        try { return recorded ? JSON.parse(recorded) : null; } catch { return null; }
    }

    /** Forget what was installed for `key`, so its next ensurePackages installs (a deck moving in). */
    forgetPackages(key) {
        const state = this._readState();
        if (!state.packagesByKey || !(key in state.packagesByKey)) return;
        delete state.packagesByKey[key];
        this._writeState(state);
    }

    /**
     * The edge's own requirements as installed here (`Requires-Dist` of ivoryos-edge, extras left
     * out), for every resolution to include: a driver pinning an old SQLAlchemy would otherwise
     * replace the one the edge needs, and every deck in the environment would stop starting. The
     * requirements rather than the edge itself, because uv reinstalls an editable edge (a
     * development checkout) on every dry run, which read as "would replace a package" to a deck
     * that is running. Cached until the edge build changes. Never throws: [] when it cannot say.
     */
    async edgeRequirements() {
        const fingerprint = this._edgeFingerprint();
        if (this._edgeRequirements && this._edgeRequirements.fingerprint === fingerprint) return this._edgeRequirements.requirements;
        const probe = 'import json, importlib.metadata as m\ntry:\n    r = m.requires("ivoryos-edge") or []\nexcept Exception:\n    r = []\nprint(json.dumps([x for x in r if "extra ==" not in x and "extra==" not in x]))';
        let requirements = [];
        try {
            requirements = JSON.parse((await run(this.python, ['-c', probe])).trim().split(/\r?\n/).pop());
        } catch { /* not set up yet: nothing to protect */ }
        this._edgeRequirements = { fingerprint, requirements };
        return requirements;
    }

    /**
     * Whether `requirements` can be installed here, without installing anything (the resolution
     * an install does, as a dry run): {ok: true, changes} or {ok: false, output}. `changes` are
     * parseDryRun's; a '-' is an installed package that would be replaced.
     */
    async resolve(requirements) {
        if (!requirements.length) return { ok: true, changes: [] };
        const { parseDryRun } = require('./deckPackages');
        try {
            const out = await run(this.uv, ['pip', 'install', '--dry-run', '--python', this.python, '--torch-backend', 'cpu', ...requirements]);
            return { ok: true, changes: parseDryRun(out) };
        } catch (e) {
            return { ok: false, output: String(e.output || e.message) };
        }
    }

    /**
     * Install pip requirements into the venv. Into a deck that is running only when nothing
     * installed is replaced (`installPlan`, manager.js `_installFor`): a running interpreter holds
     * its packages' compiled files open, and on Windows those cannot be replaced until it exits.
     * PyTorch comes as its CPU-only build (`--torch-backend cpu`), for every install into this
     * environment, so one install never swaps it for another build: on Linux the default from
     * PyPI carries the CUDA libraries, a few GB nobody asked for. Ax and BayBE pull it in.
     */
    async install(requirements) {
        if (!requirements.length) return '';
        return run(this.uv, ['pip', 'install', '--python', this.python, '--torch-backend', 'cpu', ...requirements], { onLine: this.onLine });
    }

    /**
     * What a problem report says about an environment: Python, the edge, which optimizer backends
     * are installed (by version; importing them would take seconds and is what the edge's own log
     * already reports), and every installed package. Never throws.
     */
    async describe(python) {
        const probe = [
            'import json, sys, importlib.metadata as m',
            'def v(name):',
            '    try:',
            '        return m.version(name)',
            '    except Exception:',
            '        return None',
            'pkgs = sorted({f"{d.metadata[\'Name\']}=={d.version}" for d in m.distributions() if d.metadata[\'Name\']}, key=str.lower)',
            'print(json.dumps({"python": sys.version.split()[0], "prefix": sys.prefix, "edge": v("ivoryos-edge"),',
            '    "optimizers": {"ax": v("ax-platform"), "baybe": v("baybe"), "nimo": v("nimo")}, "packages": pkgs}))',
        ].join('\n');
        try {
            const out = await run(python, ['-c', probe]);
            return JSON.parse(out.trim().split(/\r?\n/).pop());
        } catch (e) {
            return { error: fs.existsSync(python) ? (e.output || e.message).trim().split('\n').pop() : 'No Python at this path.' };
        }
    }

    /**
     * Which of a deck's packages each of its instruments and plugins needs, and what is installed
     * (deckPackages.js explains why this is worked out rather than recorded). `input` is
     * deckPackages.probeInput(deck); the answer is {requirements: {key: {dist, version} | null},
     * entries: {entryId: [key]}}. An entry needs the distribution that provides one of its
     * modules and everything that distribution depends on (whatever the markers say: counting
     * one too many keeps a package on the list, which is the harmless direction). A local archive
     * is matched to its distribution by the file it was installed from (direct_url.json).
     */
    async probeDeckPackages(input, python = this.python) {
        const probe = [
            'import json, os, re, sys, importlib.metadata as m',
            'from urllib.parse import urlparse, unquote',
            'q = json.loads(sys.argv[1])',
            'norm = lambda s: re.sub(r"[-_.]+", "-", s).lower()',
            'dists = {}',
            'for d in m.distributions():',
            '    n = d.metadata["Name"]',
            '    if n and norm(n) not in dists:',
            '        dists[norm(n)] = d',
            'def deps(n):',
            '    out = []',
            '    for r in dists[n].requires or []:',
            '        g = re.match(r"\\s*([A-Za-z0-9][A-Za-z0-9._-]*)", r)',
            '        if g:',
            '            out.append(norm(g.group(1)))',
            '    return out',
            'def closure(start):',
            '    seen, stack = set(), list(start)',
            '    while stack:',
            '        n = stack.pop()',
            '        if n in seen or n not in dists:',
            '            continue',
            '        seen.add(n)',
            '        stack.extend(deps(n))',
            '    return seen',
            'def archive(d):',
            '    try:',
            '        url = (json.loads(d.read_text("direct_url.json") or "null") or {}).get("url") or ""',
            '    except Exception:',
            '        return None',
            '    return os.path.basename(unquote(urlparse(url).path)).lower() if url.startswith("file:") else None',
            'by_file = {}',
            'for n, d in dists.items():',
            '    f = archive(d)',
            '    if f:',
            '        by_file[f] = n',
            'reqs = {}',
            'for r in q["requirements"]:',
            '    n = r.get("name") or (by_file.get(os.path.basename(r["path"]).lower()) if r.get("path") else None)',
            '    reqs[r["key"]] = n if n in dists else None',
            'top = m.packages_distributions()',
            'entries = {}',
            'for e in q["entries"]:',
            '    need = closure({norm(x) for mod in e["modules"] for x in top.get(mod, [])})',
            '    entries[e["id"]] = [k for k, n in reqs.items() if n and n in need]',
            'print(json.dumps({"requirements": {k: ({"dist": n, "version": dists[n].version} if n else None) for k, n in reqs.items()}, "entries": entries}))',
        ].join('\n');
        const out = await run(python, ['-c', probe, JSON.stringify(input)]);
        return JSON.parse(out.trim().split(/\r?\n/).pop());
    }

    /**
     * The newest version of one of a deck's packages that installs together with the rest of that
     * deck's list, as the deck would install it (the same `uv pip install`, as a dry run, with
     * this one package let go up from what is installed). `requirements` is the deck's list,
     * `target` a deckPackages.parseRequirement() of one of them and `installed` its version.
     * Never offers a downgrade, and a pre-release is offered when the installed one is one (the
     * `>=` names it, which is what uv needs to consider pre-releases of that package).
     * @returns {Promise<{latest: string|null, changes: {change: string, name: string, version: string}[], error?: string}>}
     */
    async upgradeCandidate(requirements, target, installed) {
        const { parseDryRun } = require('./deckPackages');
        const loose = `${target.display}${target.extras}${installed ? `>=${installed}` : ''}${target.marker}`;
        const others = requirements.filter((r) => String(r).trim() !== target.requirement);
        try {
            const out = await run(this.uv, ['pip', 'install', '--dry-run', '--python', this.python, '--torch-backend', 'cpu',
                '--upgrade-package', target.display, '--refresh-package', target.display, ...others, loose]);
            const changes = parseDryRun(out);
            const mine = changes.find((c) => c.change === '+' && c.name === target.name);
            return { latest: mine ? mine.version : null, changes: changes.filter((c) => c.name !== target.name) };
        } catch (e) {
            // uv's explanation is its last lines, drawn with box characters for a terminal.
            const lines = String(e.output || e.message).trim().split(/\r?\n/).filter(Boolean);
            const error = lines.slice(-3).join(' ').replace(/[╰─▶│×]/g, ' ').replace(/\s+/g, ' ').trim();
            return { latest: null, changes: [], error };
        }
    }

    /**
     * What installing `requirements` would change in the environment, without changing anything
     * (`uv pip install --dry-run`, the resolution an install does): [{change, name, version}]. A
     * '-' is a package already installed that would be replaced or removed, which is what a
     * running deck cannot take (manager.js `_installFor`). Throws as the install would.
     */
    async installPlan(requirements) {
        if (!requirements.length) return [];
        const { parseDryRun } = require('./deckPackages');
        return parseDryRun(await run(this.uv, ['pip', 'install', '--dry-run', '--python', this.python, '--torch-backend', 'cpu', ...requirements]));
    }

    /** `uv pip check`: installed packages whose requirements are not met. Never throws. */
    async check(python) {
        try {
            return (await run(this.uv, ['pip', 'check', '--python', python])).trim();
        } catch (e) {
            return (e.output || e.message).trim();
        }
    }

    /**
     * Throw the venv away; the next ensure() rebuilds it. For a broken environment. Decks' own
     * environments go too: each is rebuilt, with its deck's packages, the next time it starts.
     */
    reset() {
        fs.rmSync(this.venv, { recursive: true, force: true });
        fs.rmSync(path.join(this.dir, 'envs'), { recursive: true, force: true });
        this.decks.clear();
        this._edgeRequirements = null;
        const state = this._readState();
        delete state.edge;
        delete state.packagesByKey;
        this._writeState(state);
    }
}

module.exports = { PythonRuntime, PYTHON_VERSION, venvPython, run, runtimeDir, deckEnvironmentDir };
