"use client";
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, PictureInPicture2, PanelRightClose, Plug, Settings2, X } from 'lucide-react';
import { API_BASE } from '@/config';
import { HOME_HREF } from '@/homePage';
import { setDockRight } from '@/dockRight';
import { loadPanel, modeFor, pluginPageHref, prefsFor, setPanel, usePanel, type PanelMode, type PanelState } from '@/pluginPanel';
import { usePageArea } from '@/usePageArea';
import { PluginChoices } from './PluginMenu';

type PluginInfo = { id: string; name: string; url: string; placement?: string };
type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 280;
const MIN_H = 200;
const HEADER = 36;
/** Kept between the window and the edges of the browser window. */
const MARGIN = 8;

function frameSrc(p: PluginInfo) {
  return p.url.startsWith('http') ? p.url : `${API_BASE}${p.url}`;
}

/**
 * The plugin panel: a plugin shown as a page of its own, beside the page, or in a window over
 * the pages (pluginPanel.ts), so a live view (the bench animation, a camera, a running plot, the
 * liquid handler's worktable) stays in reach while you click through the app and while a
 * workflow runs.
 *
 * Two rules keep the plugin running without interruption:
 * - It lives in the root layout, around the pages, not in any page: client-side navigation
 *   keeps the layout mounted, so moving between pages never reloads the plugin. As a page it is
 *   hidden, not unmounted, while another page is open.
 * - It is ONE fixed-position element in every mode; switching only changes its style. React
 *   therefore keeps the same iframe throughout, where rendering a different element per mode
 *   would reload the plugin on every change. Beside the page it makes room by padding the page
 *   wrapper, which is likewise always the same element.
 */
export default function PluginPanelHost({ children }: { children: React.ReactNode }) {
  const onLauncher = (usePathname() || '').startsWith('/launcher');
  const panel = usePanel();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  useEffect(() => {
    loadPanel();
    if (onLauncher) return;
    // Nothing opens by itself: a plugin is a page until its check marks say otherwise.
    fetch(`${API_BASE}/api/plugins`)
      .then(r => r.json())
      .then(d => setPlugins(d.plugins || []))
      .catch(() => {});
  }, [onLauncher]);

  const plugin = onLauncher ? undefined : plugins.find(p => p.id === panel.open);
  const mode = plugin ? modeFor(panel, plugin.id) : 'full';
  // As a page, only while its page is open; beside the page and in a window, always.
  const shown = !!plugin && (mode !== 'full' || panel.onPage === plugin.id);
  const docked = shown && mode === 'side';
  const padRight = docked ? panel.sideWidth : 0;
  // The queue chip and run card, pinned to the right edge, move left of a docked panel.
  useEffect(() => { setDockRight('plugin', padRight || null); }, [padRight]);
  // Any plugin can be shown here (the nav's right-click menu), so any can be switched to.
  const choices = plugins;

  return (
    <>
      <div className="h-screen w-full overflow-hidden" style={{ paddingRight: padRight }}>
        <div className="h-full w-full overflow-auto">{children}</div>
      </div>
      {plugin ? <Panel plugin={plugin} choices={choices} panel={panel} mode={mode} shown={shown} /> : null}
    </>
  );
}

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return vp;
}

/** Follow the mouse until it is released. An overlay covers everything meanwhile, because the
 * plugin's iframe would otherwise swallow the mouse events once the pointer is over it. */
function useDrag() {
  const [cursor, setCursor] = useState<string | null>(null);
  const start = (e: React.MouseEvent, kind: string, onMove: (dx: number, dy: number) => void, onEnd: () => void) => {
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY;
    setCursor(kind);
    const move = (ev: MouseEvent) => onMove(ev.clientX - x0, ev.clientY - y0);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setCursor(null);
      onEnd();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const overlay = cursor ? <div className="fixed inset-0 z-[10000]" style={{ cursor }} /> : null;
  return { start, overlay };
}

/** A header dropdown that closes on a click elsewhere (including into the plugin's own page,
 * which blurs this window), on Escape, and when told to. */
function useOpenMenu() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('blur', close); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return [open, setOpen] as const;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const MENU = 'absolute top-full mt-1 z-10 w-52 py-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1a1a] shadow-xl';

function Panel({ plugin, choices, panel, mode, shown }: {
  plugin: PluginInfo; choices: PluginInfo[]; panel: PanelState; mode: PanelMode; shown: boolean;
}) {
  const router = useRouter();
  const vp = useViewport();
  const area = usePageArea();
  const { start, overlay } = useDrag();
  // While dragging, the live geometry is held here and saved once, on release.
  const [live, setLive] = useState<Rect | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  // The list of plugins to switch to, open under the name; the check marks, under the gear.
  const [picking, setPicking] = useOpenMenu();
  const [settingsOpen, setSettingsOpen] = useOpenMenu();
  const prefs = prefsFor(panel, plugin.id);

  const onPage = panel.onPage === plugin.id;
  // Leaving the page for the window goes to the landing page: the plugin page itself would be an
  // empty area with the window over it.
  const leavePage = () => { if (onPage) router.push(HOME_HREF); };
  const popOut = () => { setPanel({ windowed: true }); leavePage(); };
  // Back where its check marks put it.
  const dock = () => { setPanel({ windowed: false }); if (prefs.layout === 'full') router.push(pluginPageHref(plugin.id)); };
  const close = () => { setPanel({ open: null, windowed: false }); leavePage(); };

  // The window, kept reachable: a place saved on a larger screen must not strand it.
  const f = live ?? panel.float;
  const fw = clamp(f.w, MIN_W, vp.w - 2 * MARGIN);
  const fh = clamp(f.h, MIN_H, vp.h - 2 * MARGIN);
  const win = { x: clamp(f.x < 0 ? vp.w - fw - 24 : f.x, MARGIN, vp.w - fw - MARGIN), y: clamp(f.y, MARGIN, vp.h - fh - MARGIN), w: fw, h: fh };
  const sideWidth = liveWidth ?? panel.sideWidth;

  const box: React.CSSProperties = mode === 'full'
    ? { top: area.top, left: area.left, right: 0, bottom: 0, ...(shown ? {} : { visibility: 'hidden', pointerEvents: 'none' }) }
    : mode === 'side'
      ? { top: 0, right: 0, bottom: 0, width: sideWidth }
      : { left: win.x, top: win.y, width: win.w, height: win.h };

  // Both keep the window inside the browser window as it goes. A place left of the edge used to
  // be saved as a negative x, which is also how "not placed yet" is saved, so a window dragged
  // past the left edge jumped to the right-hand side.
  const moveWindow = (e: React.MouseEvent) => {
    let next = win;
    start(e, 'move', (dx, dy) => {
      next = { ...win, x: clamp(win.x + dx, MARGIN, vp.w - win.w - MARGIN), y: clamp(win.y + dy, MARGIN, vp.h - win.h - MARGIN) };
      setLive(next);
    }, () => { setPanel({ float: next }); setLive(null); });
  };
  const resizeWindow = (e: React.MouseEvent) => {
    let next = win;
    start(e, 'nwse-resize', (dx, dy) => {
      next = { ...win, w: clamp(win.w + dx, MIN_W, vp.w - win.x - MARGIN), h: clamp(win.h + dy, MIN_H, vp.h - win.y - MARGIN) };
      setLive(next);
    }, () => { setPanel({ float: next }); setLive(null); });
  };
  // The docked panel is resized from its left edge; the page is never squeezed under 30%.
  const resizeSide = (e: React.MouseEvent) => {
    let w = panel.sideWidth;
    start(e, 'col-resize', (dx) => { w = clamp(panel.sideWidth - dx, MIN_W, vp.w * 0.7); setLiveWidth(w); },
      () => { setPanel({ sideWidth: Math.round(w) }); setLiveWidth(null); });
  };

  const btn = 'p-1 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100 dark:hover:text-gray-100 dark:hover:bg-white/10';
  const chrome = mode === 'full' ? 'z-[140]'
    : mode === 'side' ? 'z-[140] border-l border-gray-200 dark:border-white/15'
      : 'z-[150] border border-gray-200 dark:border-white/15 rounded-xl overflow-hidden shadow-2xl';
  const stop = { onMouseDown: (e: React.MouseEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

  return (
    <div className={`fixed flex flex-col bg-white dark:bg-[#0d0d0d] ${chrome}`} style={box}>
      <div
        onMouseDown={mode === 'window' ? moveWindow : undefined}
        onDoubleClick={mode === 'window' ? dock : undefined}
        title={mode === 'window' ? `Drag to move; double-click to put it back ${prefs.layout === 'side' ? 'beside the page' : 'on its page'}` : undefined}
        className={`shrink-0 flex items-center gap-1 pl-3 pr-1.5 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] ${mode === 'window' ? 'cursor-move select-none' : ''}`}
        style={{ height: HEADER }}
      >
        <Plug className="w-3.5 h-3.5 text-gray-700 dark:text-gray-200 shrink-0" />
        {/* The switcher is the name itself, its mark right beside it: a dropdown stretched across
            the bar put its arrow next to the window buttons, where it read as one of them. */}
        {choices.length > 1 ? (
          <div className="relative min-w-0" {...stop}>
            <button
              type="button"
              onClick={() => setPicking(o => !o)}
              title="Switch to another plugin"
              aria-haspopup="menu"
              aria-expanded={picking}
              className={`max-w-full flex items-center gap-1 rounded px-1 py-0.5 text-xs font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-200/70 dark:hover:bg-white/10 ${picking ? 'bg-gray-200/70 dark:bg-white/10' : ''}`}
            >
              <span className="truncate">{plugin.name}</span>
              <ChevronsUpDown className="w-3 h-3 shrink-0 text-gray-400" />
            </button>
            {picking && (
              <div role="menu" className={`${MENU} left-0 w-56 max-h-64 overflow-y-auto`}>
                {choices.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    role="menuitem"
                    // Another plugin is shown its own way: a page is a page.
                    onClick={() => { if (modeFor({ ...panel, open: c.id, windowed: false }, c.id) === 'full') router.push(pluginPageHref(c.id)); else { setPanel({ open: c.id, windowed: false }); leavePage(); } setPicking(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
                  >
                    <Check className={`w-3.5 h-3.5 shrink-0 ${c.id === plugin.id ? '' : 'invisible'}`} />
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <span className="min-w-0 truncate px-1 text-xs font-semibold text-gray-700 dark:text-gray-200">{plugin.name}</span>
        )}
        <span className="flex-1" />
        <div className="flex items-center" {...stop}>
          {/* This plugin's check marks (PluginChoices): how it opens, and whether it may float. */}
          <div className="relative">
            <button type="button" className={`${btn} ${settingsOpen ? 'bg-gray-100 dark:bg-white/10' : ''}`} title="How this plugin opens" aria-haspopup="menu" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(o => !o)}>
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            {settingsOpen && (
              <div role="menu" className={`${MENU} right-0`}>
                <PluginChoices plugin={plugin} />
              </div>
            )}
          </div>
          {prefs.float && mode !== 'window' && (
            <button type="button" className={btn} title="Pop out into a window over the pages" onClick={popOut}><PictureInPicture2 className="w-3.5 h-3.5" /></button>
          )}
          {mode === 'window' && (
            <button type="button" className={btn} title={`Put it back ${prefs.layout === 'side' ? 'beside the page' : 'on its page'}`} onClick={dock}><PanelRightClose className="w-3.5 h-3.5" /></button>
          )}
          {/* A page is left through the nav, so it has no Close. */}
          {mode !== 'full' && (
            <button type="button" className={btn} title="Close" onClick={close}><X className="w-3.5 h-3.5" /></button>
          )}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <iframe
          key={plugin.id}
          src={frameSrc(plugin)}
          title={plugin.name}
          className="block w-full h-full border-none bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        />
      </div>

      {mode === 'window' && (
        <div onMouseDown={resizeWindow} title="Drag to resize" className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize" style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(99,102,241,0.5) 50%)' }} />
      )}
      {mode === 'side' && (
        <div onMouseDown={resizeSide} title="Drag to resize" className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent/40" />
      )}
      {overlay}
    </div>
  );
}
