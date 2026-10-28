"use client";
import { useSyncExternalStore } from 'react';

/**
 * Where the plugin panel is and what it shows, shared by the panel itself (PluginPanel, mounted
 * once in the root layout so it survives navigation), the nav's plugin entries, which open plugins
 * into it, and the `/plugin` page. Saved per browser in localStorage.
 *
 * Each plugin has three check marks, on the panel's own header (the gear) and on its nav entry's
 * right-click menu (PluginMenu.tsx): **As a page** or **Beside the page** (how it opens, one of
 * the two), and **Floating window** (whether it may be popped out over the pages).
 * - `full`, a page of its own, the default. The `/plugin?id=` route is that page; the panel
 *   covers the page area while the route is open (`onPage`) and stays mounted, hidden, when you
 *   leave, so the plugin keeps running and is back at once. The nav treats it as a page: its
 *   entry is the current page, and clicking Instruments goes to Instruments. (It used to be an
 *   overlay over whatever page was open, so the nav still worked underneath and seemed to do
 *   nothing.)
 * - `side`: beside the page, docked on the right; the page shrinks to make room.
 * - `window`: floating over the pages, dragged and resized; popped out from the header or the
 *   right-click menu while allowed, and never how a plugin opens from the nav.
 */
export type PanelLayout = 'full' | 'side';
export type PanelMode = PanelLayout | 'window';
export type PluginPrefs = { layout: PanelLayout; float: boolean };
export type FloatRect = { x: number; y: number; w: number; h: number };

export type PanelState = {
  /** The plugin shown, or null when the panel is closed. */
  open: string | null;
  /** Each plugin's check marks, by id; absent means a page, no window. */
  prefs: Record<string, PluginPrefs>;
  /** The open plugin is popped out (shown only while its `float` is allowed). */
  windowed: boolean;
  /** The window's place and size. An x below 0 means "not placed yet": the right-hand side. */
  float: FloatRect;
  /** The docked panel's width, in px. */
  sideWidth: number;
  /** The plugin the `/plugin` page is showing now (set by that page, never saved). */
  onPage: string | null;
};

export const DEFAULT_PREFS: PluginPrefs = { layout: 'full', float: false };
const KEY = 'ivoryos_plugin_panel';
export const DEFAULT_PANEL: PanelState = {
  open: null, prefs: {}, windowed: false, float: { x: -1, y: 96, w: 420, h: 560 }, sideWidth: 420, onPage: null,
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
      const prefs: Record<string, PluginPrefs> = {};
      if (saved.prefs && typeof saved.prefs === 'object') {
        Object.entries(saved.prefs as Record<string, any>).forEach(([id, p]) => {
          if (p && typeof p === 'object') prefs[id] = { layout: p.layout === 'side' ? 'side' : 'full', float: !!p.float };
        });
      }
      state = {
        ...state,
        open: typeof saved.open === 'string' ? saved.open : null,
        prefs,
        windowed: !!saved.windowed,
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

export function prefsFor(s: PanelState, id: string): PluginPrefs {
  return s.prefs[id] ?? DEFAULT_PREFS;
}

/** Change a plugin's check marks. */
export function setPrefs(id: string, patch: Partial<PluginPrefs>) {
  setPanel({ prefs: { ...state.prefs, [id]: { ...prefsFor(state, id), ...patch } } });
}

/** How this plugin is shown while open, and opens from the nav. */
export function modeFor(s: PanelState, id: string): PanelMode {
  const p = prefsFor(s, id);
  return s.open === id && s.windowed && p.float ? 'window' : p.layout;
}

/** Told by the `/plugin` page which plugin it shows; null when it is left. */
export function setPluginPage(id: string | null) {
  if (state.onPage === id) return;
  state = { ...state, onPage: id };
  emit();
}

/**
 * Show a plugin in the panel the way its check marks say, or popped out (`window`, only while
 * allowed). A `panel-left` plugin's window starts on the left, the first time it is placed.
 */
export function openInPanel(id: string, placement?: string, opts: { window?: boolean } = {}) {
  const unplaced = state.float.x < 0;
  setPanel({
    open: id,
    windowed: !!opts.window && prefsFor(state, id).float,
    ...(unplaced && placement === 'panel-left' ? { float: { ...state.float, x: 24 } } : {}),
  });
}

/** Whether this plugin is on screen: as a page only while its page is open. */
export function isShowing(s: PanelState, id: string) {
  return s.open === id && (modeFor(s, id) !== 'full' || s.onPage === id);
}

export function usePanel(): PanelState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
    () => DEFAULT_PANEL,
  );
}

export function isPanelPlugin(p: { placement?: string }) {
  return p.placement === 'panel-left' || p.placement === 'panel-right';
}

/** The page a plugin opens on. */
export const pluginPageHref = (id: string) => `/plugin?id=${encodeURIComponent(id)}`;
