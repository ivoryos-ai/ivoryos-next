"use client";
import { useSyncExternalStore } from 'react';

/**
 * Where the plugin panel is and what it shows, shared by the panel itself (PluginPanel, mounted
 * once in the root layout so it survives navigation), the nav's plugin entries, which open plugins
 * into it, and the `/plugin` page. Saved per browser in localStorage.
 *
 * Three ways to show a plugin:
 * - `full`: a page of its own. The `/plugin?id=` route is that page; the panel covers the page
 *   area while the route is open (`onPage`) and stays mounted, hidden, when you leave, so the
 *   plugin keeps running and is back at once. The nav treats it as a page: its entry is the
 *   current page, and clicking Instruments goes to Instruments. (It used to be an overlay over
 *   whatever page was open, so the nav still worked underneath and seemed to do nothing.)
 * - `side`: beside the page, docked on the right; the page shrinks to make room.
 * - `window`: floating over the pages, dragged and resized, only when `allowFloat` is on.
 *
 * Two settings (the Settings page) decide the defaults: `layout` is how a plugin opens from the
 * nav, and `allowFloat` whether the window is offered at all. Defaults: a page, no window.
 */
export type PanelMode = 'full' | 'side' | 'window';
export type PanelLayout = 'full' | 'side';
export type FloatRect = { x: number; y: number; w: number; h: number };

export type PanelState = {
  /** The plugin shown, or null when the panel is closed. */
  open: string | null;
  mode: PanelMode;
  /** How a plugin opens from the nav (a setting). */
  layout: PanelLayout;
  /** Whether a plugin may be shown in a floating window (a setting). */
  allowFloat: boolean;
  /** The window's place and size. An x below 0 means "not placed yet": the right-hand side. */
  float: FloatRect;
  /** The docked panel's width, in px. */
  sideWidth: number;
  /** Set once anything has been saved: the first visit opens a panel plugin beside the page by
   * default (when that is the layout), later visits respect a panel the person closed. */
  touched: boolean;
  /** The plugin the `/plugin` page is showing now (set by that page, never saved). */
  onPage: string | null;
};

const KEY = 'ivoryos_plugin_panel';
export const DEFAULT_PANEL: PanelState = {
  open: null, mode: 'full', layout: 'full', allowFloat: false,
  float: { x: -1, y: 96, w: 420, h: 560 }, sideWidth: 420, touched: false, onPage: null,
};

let state: PanelState = DEFAULT_PANEL;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(l => l());
}

const isMode = (v: unknown): v is PanelMode => v === 'full' || v === 'side' || v === 'window';

/** Read the saved state; called after hydration so the first render matches the static HTML. */
export function loadPanel(): PanelState {
  if (loaded || typeof window === 'undefined') return state;
  loaded = true;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      const layout: PanelLayout = saved.layout === 'side' ? 'side' : 'full';
      state = {
        ...state,
        open: typeof saved.open === 'string' ? saved.open : null,
        mode: isMode(saved.mode) ? saved.mode : layout,
        layout,
        allowFloat: !!saved.allowFloat,
        float: { ...DEFAULT_PANEL.float, ...(saved.float || {}) },
        sideWidth: typeof saved.sideWidth === 'number' ? saved.sideWidth : DEFAULT_PANEL.sideWidth,
        touched: !!saved.touched,
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
  state = { ...state, ...patch, touched: true };
  save();
  emit();
}

/** The two settings; a window no longer allowed goes back to the layout. */
export function setPanelSettings(patch: Partial<Pick<PanelState, 'layout' | 'allowFloat'>>) {
  const next = { ...state, ...patch };
  if (!next.allowFloat && next.mode === 'window') next.mode = next.layout;
  state = next;
  save();
  emit();
}

/** Told by the `/plugin` page which plugin it shows; null when it is left. */
export function setPluginPage(id: string | null) {
  if (state.onPage === id) return;
  state = { ...state, onPage: id };
  emit();
}

/**
 * Show a plugin in the panel, in `mode` or the layout chosen in Settings. A window is only given
 * when allowed. A `panel-left` plugin's window starts on the left, the first time it is placed.
 */
export function openInPanel(id: string, placement?: string, mode?: PanelMode) {
  const unplaced = state.float.x < 0;
  const wanted = mode ?? state.layout;
  setPanel({
    open: id,
    mode: wanted === 'window' && !state.allowFloat ? state.layout : wanted,
    ...(unplaced && placement === 'panel-left' ? { float: { ...state.float, x: 24 } } : {}),
  });
}

/** The mode the panel is drawn in now: a window is never drawn once it is no longer allowed. */
export function effectiveMode(s: PanelState): PanelMode {
  return s.mode === 'window' && !s.allowFloat ? s.layout : s.mode;
}

/** Whether this plugin is on screen: as a page only while its page is open. */
export function isShowing(s: PanelState, id: string) {
  return s.open === id && (effectiveMode(s) !== 'full' || s.onPage === id);
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
