/**
 * The launcher's rules for what the Hub offers: which rows belong to the public or the private
 * hub, how a platform's drivers are named on a deck, and whether a workflow template fits a deck.
 * Pure, so the rules are checked without the app (hubCatalog.test.ts).
 */
import type { Deck, HubTemplate, Visibility } from '@/desktop';

export type Scope = 'public' | 'private';

type Owned = { visibility?: Visibility | null; organizations?: { name: string } | null };

/** A row with no visibility comes from a Hub before the private hub existed: those were all public. */
export function visibilityOf(row: Owned): Visibility {
  return row.visibility || 'public';
}

/** The public hub shows public rows; the private hub shows the caller's own and their teams'. */
export function inScope(row: Owned, scope: Scope): boolean {
  return (visibilityOf(row) === 'public') === (scope === 'public');
}

/** A requirement's package, for telling whether two rows ship the same code: `pkg[extra]>=1` -> `pkg`. */
function packageOf(requirement: string): string {
  const r = (requirement || '').trim().toLowerCase();
  if (/^(git|hg|bzr|svn)\+|:\/\//.test(r)) return r.split(/[@#]/)[0];
  return r.split(/[\s\[<>=!~;]/)[0].replace(/_/g, '-');
}

/** Where a Hub row's package comes from: a package index, a code repository, or an archive file. */
export type PackageLabel = { label: string; requirement: string; source: 'index' | 'repository' | 'file' };

/**
 * What a Hub row installs, for the tag on its card, or null when it names no package.
 * `requirement` is what pip is given: the row's own text, with the `git+` a bare repository URL
 * needs (requirementFor in desktop/src/hubCatalog.js, which the install uses). `label` is that,
 * short enough to tell two cards apart in a narrow tag: an index package as written, extras and
 * pin included (`plr-ivoryos[serial]==1.0.0b3`); a repository as host and path, keeping a pinned
 * `@ref` (`github.com/numat/ismatec`); an archive by its file name; `name @ url` by its name.
 */
export function packageLabel(pipName: string | null | undefined): PackageLabel | null {
  const target = (pipName || '').trim();
  if (!target) return null;
  const vcs = /^(git|hg|bzr|svn)\+/i.test(target);
  const archive = /\.(whl|tar\.gz|tgz|zip)(#.*)?$/i.test(target);
  const url = /^(https?|ssh):\/\//i.test(target) || target.startsWith('git@');
  const requirement = !vcs && !archive && url ? `git+${target}` : target;
  const named = /^([A-Za-z0-9][A-Za-z0-9._-]*(?:\[[^\]]*\])?)\s*@\s*\S/.exec(target);
  if (named && !/^git@/i.test(target)) return { label: named[1], requirement, source: archive ? 'file' : 'repository' };
  if (archive) {
    const file = target.replace(/#.*$/, '').split('/').pop();
    return { label: file || target, requirement, source: 'file' };
  }
  if (!vcs && !url) return { label: target, requirement, source: 'index' };
  const label = target
    .replace(/^(git|hg|bzr|svn)\+/i, '')
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/^[^@/]+@([^:/]+):/, '$1/') // git@github.com:owner/repo
    .replace(/^[^@/]+@/, '') // user@host/...
    .replace(/#.*$/, '')
    .replace(/\.git(?=@|$)/, '')
    .replace(/\/+(?=@|$)/, '');
  return { label: label || target, requirement, source: 'repository' };
}

/**
 * One card per plugin: a plugin published in both forms (a v1 Flask blueprint for the original
 * IvoryOS and a v2 ivoryos_edge Plugin, same name, same package) shows only its v2 row here, the
 * one this app can install. A v1 row with no v2 counterpart stays, with its explanation. Apply
 * after filtering by scope, or a private v2 row would hide a public v1 one from the public hub.
 */
export function preferV2<T extends { name: string; pip_name: string; plugin_api?: 'v1' | 'v2' | null }>(rows: T[]): T[] {
  const key = (p: T) => `${p.name.trim().toLowerCase()}|${packageOf(p.pip_name)}`;
  const withV2 = new Set(rows.filter(p => p.plugin_api === 'v2').map(key));
  return rows.filter(p => p.plugin_api === 'v2' || !withV2.has(key(p)));
}

/** Who a private-hub row is shared with, for its badge. */
export function ownerLabel(row: Owned): string | null {
  const v = visibilityOf(row);
  if (v === 'private') return 'Only you';
  if (v === 'org') return row.organizations?.name || 'Your organization';
  return null;
}

/**
 * A deck instrument name from a suggestion, free among `used`: the same rule as the launcher's
 * `freeName` (desktop/src/deckEdit.js), applied locally so a platform's several drivers get
 * distinct names before any of them is on the deck.
 */
export function uniqueName(suggestion: string, used: Iterable<string>): string {
  let base = String(suggestion || 'device').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = 'device';
  if (!/^[a-z]/.test(base)) base = `device_${base}`;
  const taken = new Set(used);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

/** Names for a list of suggestions, each unique among `used` and among each other. */
export function uniqueNames(suggestions: string[], used: Iterable<string>): string[] {
  const taken = new Set(used);
  return suggestions.map(s => {
    const name = uniqueName(s, taken);
    taken.add(name);
    return name;
  });
}

export type TemplateFit = {
  /** Instruments the template's steps call that the deck has no instrument of that name for. */
  missing: string[];
  /**
   * For a missing name, deck instruments built from one of the template's Hub modules but named
   * differently: the same driver under another name, which is what a template most often meets.
   * A template lists which modules it was written for and which names its steps call, but not
   * which name is which module, so these are candidates to choose from, not a proven match.
   */
  sameDriver: Record<string, string[]>;
  /** True when every instrument it calls is on the deck. */
  fits: boolean;
};

/**
 * Whether a template's steps can run on a deck, judged the way the edge will judge it: by
 * instrument name. Hub module ids are not used, since a deck names its instruments freely and a
 * step calls a name, so a template made for the same drivers can still miss (and a hand-added
 * instrument with the right name can still fit). Unfit templates can still be added; the edge's
 * Library marks their steps, and they can be re-pointed in the Designer.
 */
export function templateFit(template: Pick<HubTemplate, 'instruments'> & { module_ids?: number[] }, deck: Deck | null): TemplateFit {
  const live = (deck?.instruments || []).filter(i => i.enabled !== false);
  const onDeck = new Set(live.map(i => i.name));
  const names = new Set(template.instruments || []);
  const missing = (template.instruments || []).filter(name => !onDeck.has(name));
  const modules = new Set((template.module_ids || []).map(Number));
  // Deck instruments from the template's modules that no template name already claims.
  const candidates = live.filter(i => i.hub && modules.has(Number(i.hub.moduleId)) && !names.has(i.name)).map(i => i.name);
  const sameDriver: Record<string, string[]> = {};
  for (const name of missing) sameDriver[name] = candidates;
  return { missing, sameDriver, fits: missing.length === 0 };
}

/**
 * The template's body with its steps pointed at other instrument names (`{fromName: toName}`),
 * so a workflow written for `pump` runs on a deck whose same driver is called `syringe_pump`
 * without a trip through the Designer. Only the `instrument` field changes; arguments, return
 * variables and everything else are left as written.
 */
export function repointInstruments(body: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  const live = Object.fromEntries(Object.entries(mapping).filter(([from, to]) => to && to !== from));
  if (!Object.keys(live).length) return body;
  const out: Record<string, unknown> = { ...body };
  for (const phase of ['prep', 'script', 'cleanup']) {
    const steps = body[phase];
    if (!Array.isArray(steps)) continue;
    out[phase] = steps.map(step => (step && typeof step === 'object' && typeof (step as { instrument?: unknown }).instrument === 'string' && live[(step as { instrument: string }).instrument]
      ? { ...(step as Record<string, unknown>), instrument: live[(step as { instrument: string }).instrument] }
      : step));
  }
  return out;
}

const CLAUSE = /^(~=|===|==|!=|<=|>=|<|>)\s*([A-Za-z0-9.*+!_-]+)$/;
const RELEASE = /^\d+(\.\d+)*$/;

/** A plain named requirement (`pkg[extra]>=1,<2`) as its parts, or null for anything else (a URL, a path, markers). */
function parseRequirement(req: string): { name: string; key: string; extras: string[]; clauses: string[] } | null {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*(.*)$/.exec(req.trim());
  if (!m) return null;
  const spec = m[3].trim();
  const clauses = spec ? spec.split(',').map(c => c.trim()) : [];
  const parsed = clauses.map(c => CLAUSE.exec(c));
  if (parsed.some(c => !c)) return null;
  return {
    name: m[1],
    key: m[1].toLowerCase().replace(/[-_.]+/g, '-'),
    extras: (m[2] || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    clauses: parsed.map(c => `${c![1]}${c![2]}`),
  };
}

function compareRelease(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Version clauses for one package, each once. Of several lower bounds of one kind (`>=0.1.7`,
 * `>=0.1.9`) only the highest is kept, and of upper bounds the lowest, since the others say
 * nothing more; anything else (`==1.0` beside `>=2`) is kept as written for the resolver to judge.
 */
function combineClauses(clauses: string[]): string[] {
  const out: string[] = [];
  for (const c of clauses) {
    if (out.includes(c)) continue;
    const [, op, version] = CLAUSE.exec(c)!;
    const bound = op === '>=' || op === '>' ? 1 : op === '<=' || op === '<' ? -1 : 0;
    if (!bound || !RELEASE.test(version)) { out.push(c); continue; }
    const at = out.findIndex(o => { const p = CLAUSE.exec(o)!; return p[1] === op && RELEASE.test(p[2]); });
    if (at === -1) out.push(c);
    else if (Math.sign(compareRelease(version, CLAUSE.exec(out[at])![2])) === bound) out[at] = c;
  }
  return out;
}

/**
 * Every package once, in first-seen order. Requirements naming one package (`pkg`, `pkg>=0.1.7`,
 * `pkg[full]>=0.1.9` from a driver and its plugin) become one requirement holding all their
 * extras and version clauses, which is what is shown before an install and written to the deck.
 * Anything that is not a plain named requirement (a URL, a path) is kept once by its exact text.
 */
export function unionPackages(...lists: string[][]): string[] {
  const out: string[] = [];
  const named = new Map<string, { at: number; name: string; extras: string[]; clauses: string[] }>();
  for (const list of lists) for (const p of list) {
    if (!p || !p.trim()) continue;
    const req = parseRequirement(p);
    if (!req) { if (!out.includes(p)) out.push(p); continue; }
    const seen = named.get(req.key);
    if (!seen) { named.set(req.key, { at: out.length, name: req.name, extras: req.extras, clauses: req.clauses }); out.push(''); continue; }
    seen.extras = [...new Set([...seen.extras, ...req.extras])];
    seen.clauses = [...seen.clauses, ...req.clauses];
  }
  for (const { at, name, extras, clauses } of named.values()) {
    out[at] = `${name}${extras.length ? `[${[...extras].sort().join(',')}]` : ''}${combineClauses(clauses).join(',')}`;
  }
  return out;
}
