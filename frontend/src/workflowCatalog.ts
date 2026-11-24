"use client";
import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from '@/config';
import { subscribeEdge } from '@/edgeSocket';
import { scanDynamicParams, workflowOutputs, getReturnLeaves } from '@ivoryos/shared-ui';

/**
 * The saved workflows the Designer's toolbox offers: each one's row from `/api/workflows` and its
 * saved body (issue 92).
 *
 * Kept in memory for the page session, like the socket in edgeSocket.ts, so the Designer opened
 * again draws at once. A refresh reads the list (one request) and fetches only the bodies that are
 * new or whose `body_hash` changed, all at once. The Designer used to fetch every body one after
 * another on every visit, and nothing updated its toolbox after a save: a workflow just saved was
 * missing from it until a reload, and one saved again offered its old steps (a Link pinned the
 * version before the edit).
 *
 * A save here puts the stored body in at once (`putSavedWorkflow`). Anything else that changes a
 * workflow (another tab, the Library, a push from Cloud, an accepted proposal) is announced on the
 * page socket's `workflows` topic (edge live.py), which refreshes the catalogue while a page uses it.
 */
export type WorkflowSummary = {
  name: string;
  version?: number;
  body_hash?: string;
  description?: string;
  compatibility?: any;
  [key: string]: any;
};
export type CatalogEntry = { summary: WorkflowSummary; body: any };
export type WorkflowCatalog = ReadonlyMap<string, CatalogEntry>;
/** `catalog` is null until the list has been read once; `ready` is true once that was tried. */
export type CatalogState = { catalog: WorkflowCatalog | null; ready: boolean };

let state: CatalogState = { catalog: null, ready: false };
const NOT_LOADED: CatalogState = { catalog: null, ready: false };
const watchers = new Set<() => void>();
let running: Promise<void> | null = null;
let again = false;
// The last `workflows` version the socket gave, to tell a change from the same news repeated.
let seenVersion: string | undefined;
// Counts saves put in by this page. A list read before one of them would put the old version back.
let puts = 0;

function set(next: CatalogState) {
  state = next;
  for (const fn of [...watchers]) fn();
}

const bodyUrl = (name: string) => `${API_BASE}/api/workflows/${encodeURIComponent(name)}`;

/** The same saved version, so the body already in hand is still the one stored. */
const current = (entry: CatalogEntry | undefined, row: WorkflowSummary) =>
  !!entry?.body && !!row.body_hash && entry.body.body_hash === row.body_hash && entry.body.version === row.version;

async function load(): Promise<void> {
  const putsBefore = puts;
  const res = await fetch(`${API_BASE}/api/workflows`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `The workflow list could not be read (${res.status})`);
  const rows: WorkflowSummary[] = Array.isArray(data.workflows) ? data.workflows : [];
  const known = state.catalog;
  const bodies = await Promise.all(rows.map(async row => {
    const had = known?.get(row.name);
    if (current(had, row)) return had!.body;
    try {
      const r = await fetch(bodyUrl(row.name));
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      return body;
    } catch (e) {
      console.error(`Could not read the saved workflow '${row.name}'`, e);
      // The steps we had are better than none; the next change tries again.
      return had?.body ?? null;
    }
  }));
  // A save was put in while this was read: what was read may be older than it. Read again.
  if (puts !== putsBefore) { again = true; return; }
  const next = new Map<string, CatalogEntry>();
  rows.forEach((row, i) => { if (bodies[i]) next.set(row.name, { summary: row, body: bodies[i] }); });
  set({ catalog: next, ready: true });
}

/** Read the list again, and any body that changed. Calls made while one runs share one more. */
export function refreshWorkflowCatalog(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        try {
          await load();
        } catch (e) {
          // Offline: keep what is in memory. The page stops waiting either way.
          console.error('Failed to load workflows for the toolbox (might be offline)', e);
          if (!state.ready) set({ ...state, ready: true });
        }
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** A workflow this page just saved, as the edge stored it: in the toolbox with no request. */
export function putSavedWorkflow(name: string, body: any) {
  puts += 1;
  const next = new Map(state.catalog ?? []);
  const before = next.get(name)?.summary;
  next.set(name, {
    // The rest of its row (the compatibility verdict among it) is read with the next refresh,
    // which the edge's announcement of this save starts.
    summary: { ...(before || {}), name, version: body?.version, body_hash: body?.body_hash, description: body?.description },
    body,
  });
  set({ catalog: next, ready: true });
}

function onHint(data: any) {
  const version = data?.version;
  if (typeof version !== 'string' || version === seenVersion) return;
  const first = seenVersion === undefined;
  seenVersion = version;
  // The first version heard only says where things stand; the refresh a page starts as it opens
  // reads that. Every later one is a change.
  if (!first) refreshWorkflowCatalog();
}

function subscribe(fn: () => void) {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

/**
 * The catalogue, kept current while the calling component is mounted: read once as it mounts
 * (drawn from memory meanwhile), and again whenever the edge announces a change.
 */
export function useWorkflowCatalog(): CatalogState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => NOT_LOADED);
  useEffect(() => {
    const stop = subscribeEdge('workflows', onHint);
    refreshWorkflowCatalog();
    return stop;
  }, []);
  return snapshot;
}

/**
 * The toolbox's "Library Workflows": one entry per saved workflow, to drag in as a copy or a link.
 * `instruments` is the deck's (with Flow Control), for the types of what each workflow saves.
 */
export function libraryToolbox(catalog: WorkflowCatalog, instruments: Record<string, any>): Record<string, any> {
  const library: Record<string, any> = {};
  // Workflows earlier in the list are visible while later ones are described, as before, so a
  // workflow linking another can take the types of that one's outputs.
  const lookup: Record<string, any> = { ...instruments, 'Library Workflows': library };
  for (const [name, { summary, body }] of catalog) {
    library[name] = {
      description: body?.description || 'Saved Workflow from Library',
      parameters: scanDynamicParams(body),
      return_type: 'None',
      // The full saved body, so a Copy-mode drag can inline the real steps without a second round
      // trip, and so Detach can turn a link back into an editable copy.
      body,
      // The deck's verdict on it (compatibility.py): one that will not run is folded away in the
      // toolbox, as Cloud does with the same verdict.
      compatibility: summary.compatibility,
      // What it saves, as the outputs of a step that links it (shared-ui workflowOutputs): the
      // same names, renamable on the step, and numeric ones offered to Optimize.
      return_paths: workflowOutputs(body, (inst, method) => getReturnLeaves(lookup[inst]?.[method])),
    };
  }
  return library;
}

/** The newest saved version of each workflow: the "vN available" badges on placed copies and links. */
export function catalogVersions(catalog: WorkflowCatalog | null): Record<string, number> {
  const versions: Record<string, number> = {};
  catalog?.forEach(({ body }, name) => { if (body?.version) versions[name] = body.version; });
  return versions;
}
