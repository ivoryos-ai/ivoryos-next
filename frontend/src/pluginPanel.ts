"use client";
import { useSyncExternalStore } from 'react';
import { HOME_HREF } from '@/homePage';

/**
 * Where the plugin panel is and what it shows, shared by the panel itself (PluginPanel, mounted
 * once in the root layout so it survives navigation), the nav's plugin entries, which open plugins
 * into it, and the `/plugin` page. Saved per browser in localStorage.
 *
 * A plugin is shown one of three ways, switched with the buttons on its own header. The last one
 * used is how it opens from the nav next time. `Plugin(modes=[...])` limits which are offered (all
 * three by default), and its `placement` says which it starts in (`startMode`).
 * - `page`: a page of its own. The `/plugin?id=` route is that page; the panel covers the page area
 *   while the route is open (`onPage`) and stays mounted, hidden, when you leave, so the plugin
 *   keeps running and is back at once. The nav treats it as a page: its entry is the current page,
 *   and clicking Instruments goes to Instruments. (It used to be an overlay over whatever page was
 *   open, so the nav still worked underneath and seemed to do nothing.)
 * - `side`: beside the page, docked on the right; the page shrinks to make room.
 * - `window`: floating over the pages, dragged and resized.
 */
export type PanelMode = 'page' | 'side' | 'window';
export const PANEL_MODES: PanelMode[] = ['page', 'side', 'window'];
/** What the panel needs to know about a plugin, as `/api/plugins` lists it. */
export type PanelPlugin = { id: string; placement?: string; modes?: string[] };
export type FloatRect = { x: number; y: number; w: number; h: number };

export type PanelState = {
  /** The plugin shown, or null when the panel is closed. */
  open: string | null;
  /** The way each plugin was last shown, by id; absent means its `startMode`. */
  modes: Record<string, PanelMode>;
  /** The window's place and size. An x below 0 means "not placed yet": the right-hand side. */
  float: FloatRect;
  /** The docked panel's width, in px. */
  sideWidth: number;
  /** The plugin the `/plugin` page is showing now (set by that page, never saved). */
  onPage: string | null;
};

const KEY = 'ivoryos_plugin_panel';
export const DEFAULT_PANEL: PanelState = {
  open: null, modes: {}, float: { x: -1, y: 96, w: 420, h: 560 }, sideWidth: 420, onPage: null,
};

let state: PanelState = DEFAULT_PANEL;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

/** Read the saved state; called after hydration so the first render matches the static HTML. */
export function loadPanel(): PanelState {
  if (loaded || typeof window === 'undefined') return state;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const modes: Record<string, PanelMode> = {};
      if (saved.modes && typeof saved.modes === 'object') {
        Object.entries(saved.modes as Record<string, any>).forEach(([id, m]) => {
          if (PANEL_MODES.includes(m)) modes[id] = m;
        });
      }
      state = {
        ...state,
        open: typeof saved.open === 'string' ? saved.open : null,
        modes,
        float: { ...DEFAULT_PANEL.float, ...(saved.float || {}) },
        sideWidth: typeof saved.sideWidth === 'number' ? saved.sideWidth : DEFAULT_PANEL.sideWidth,
      };
    }
  } catch { /* private window or bad JSON: defaults */ }
  emit();
  return state;
}

function save() {
  const { onPage: _page, ...kept } = state;
  try { localStorage.setItem(KEY, JSON.stringify(kept)); } catch { /* not persisted */ }
}

export function setPanel(patch: Partial<Omit<PanelState, 'onPage'>>) {
  state = { ...state, ...patch };
  save();
  emit();
}

/** The ways this plugin may be shown: what its developer listed, or all of them. */
export function allowedModes(p: PanelPlugin): PanelMode[] {
  const listed = PANEL_MODES.filter(m => p.modes?.includes(m));
  return listed.length ? listed : PANEL_MODES;
}

/** How a plugin opens the first time: its `placement`, if its `modes` allow that. There is no left
 * dock, so `panel-left` is a window, which `openInPanel` starts on the left. */
export function startMode(p: PanelPlugin): PanelMode {
  const wanted: PanelMode = p.placement === 'panel-right' ? 'side' : p.placement === 'panel-left' ? 'window' : 'page';
  const allowed = allowedModes(p);
  return allowed.includes(wanted) ? wanted : allowed[0];
}

/** How this plugin is shown while open, and opens from the nav. */
export function modeFor(s: PanelState, p: PanelPlugin): PanelMode {
  const saved = s.modes[p.id];
  return saved && allowedModes(p).includes(saved) ? saved : startMode(p);
}

export function setMode(id: string, mode: PanelMode) {
  setPanel({ modes: { ...state.modes, [id]: mode } });
}

/** Told by the `/plugin` page which plugin it shows; null when it is left. */
export function setPluginPage(id: string | null) {
  if (state.onPage === id) return;
  state = { ...state, onPage: id };
  emit();
}

/** Show a plugin in the panel. A `panel-left` plugin's window starts on the left, the first time
 * it is placed. */
export function openInPanel(p: PanelPlugin) {
  const unplaced = state.float.x < 0;
  setPanel({
    open: p.id,
    ...(unplaced && p.placement === 'panel-left' ? { float: { ...state.float, x: 24 } } : {}),
  });
}

export function usePanel(): PanelState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
    () => DEFAULT_PANEL,
  );
}

/** The page a plugin opens on. */
export const pluginPageHref = (id: string) => `/plugin?id=${encodeURIComponent(id)}`;

let lastPage: string | null = null;
/** Noted on every page that is not a plugin's, so a plugin leaving its page for the side of the
 * page or a window goes back to what you were doing. */
export function rememberPage(href: string) { lastPage = href; }
export const pageToReturnTo = () => lastPage ?? HOME_HREF;
