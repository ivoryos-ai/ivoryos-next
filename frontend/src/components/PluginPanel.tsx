"use client";
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Maximize2, PanelRight, PictureInPicture2, Plug, X } from 'lucide-react';
import { API_BASE } from '@/config';
import { setDockRight } from '@/dockRight';
import { allowedModes, loadPanel, modeFor, pluginPageHref, rememberPage, setMode, setPanel, usePanel, type PanelMode, type PanelPlugin, type PanelState } from '@/pluginPanel';
import { usePageArea } from '@/usePageArea';

type PluginInfo = PanelPlugin & { name: string; url: string };
type Rect = { x: number; y: number; w: number; h: number };

const MODE_BUTTONS: Record<PanelMode, { label: string; icon: React.ReactNode }> = {
  page: { label: 'As a page', icon: <Maximize2 className="w-3.5 h-3.5" /> },
  side: { label: 'Beside the page', icon: <PanelRight className="w-3.5 h-3.5" /> },
  window: { label: 'In a window', icon: <PictureInPicture2 className="w-3.5 h-3.5" /> },
};

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
  const pathname = usePathname() || '';
  const onLauncher = pathname.startsWith('/launcher');
  const panel = usePanel();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);

  useEffect(() => {
    loadPanel();
    if (onLauncher) return;
    // Nothing opens by itself: a plugin shows when its nav entry is clicked.
    fetch(`${API_BASE}/api/plugins`)
      .then(r => r.json())
      .then(d => setPlugins(d.plugins || []))
      .catch(() => {});
  }, [onLauncher]);

  useEffect(() => {
    if (!pathname.startsWith('/plugin')) rememberPage(window.location.pathname + window.location.search);
  }, [pathname]);

  const plugin = onLauncher ? undefined : plugins.find(p => p.id === panel.open);
  const mode = plugin ? modeFor(panel, plugin) : 'page';
  // As a page, only while its page is open; beside the page and in a window, always.
  const shown = !!plugin && (mode !== 'page' || panel.onPage === plugin.id);
  const docked = shown && mode === 'side';
  const padRight = docked ? panel.sideWidth : 0;
  // The queue chip and run card, pinned to the right edge, move left of a docked panel.
  useEffect(() => { setDockRight('plugin', padRight || null); }, [padRight]);

  return (
    <>
      <div className="h-screen w-full overflow-hidden" style={{ paddingRight: padRight }}>
        <div className="h-full w-full overflow-auto">{children}</div>
      </div>
      {plugin ? <Panel plugin={plugin} panel={panel} mode={mode} shown={shown} /> : null}
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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

function Panel({ plugin, panel, mode, shown }: {
  plugin: PluginInfo; panel: PanelState; mode: PanelMode; shown: boolean;
}) {
  const router = useRouter();
  const vp = useViewport();
  const area = usePageArea();
  const { start, overlay } = useDrag();
  // While dragging, the live geometry is held here and saved once, on release.
  const [live, setLive] = useState<Rect | null>(null);
  const [liveWidth, setLiveWidth] = useState<number | null>(null);

  // Leaving the page needs nothing here: the `/plugin` page sends itself back once it no longer
  // shows its plugin as a page.
  const switchTo = (next: PanelMode) => {
    setMode(plugin.id, next);
    if (next === 'page') router.push(pluginPageHref(plugin.id));
  };
  const modes = allowedModes(plugin);

  // The window, kept reachable: a place saved on a larger screen must not strand it.
  const f = live ?? panel.float;
  const fw = clamp(f.w, MIN_W, vp.w - 2 * MARGIN);
  const fh = clamp(f.h, MIN_H, vp.h - 2 * MARGIN);
  const win = { x: clamp(f.x < 0 ? vp.w - fw - 24 : f.x, MARGIN, vp.w - fw - MARGIN), y: clamp(f.y, MARGIN, vp.h - fh - MARGIN), w: fw, h: fh };
  const sideWidth = liveWidth ?? panel.sideWidth;

  const box: React.CSSProperties = mode === 'page'
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
  const chrome = mode === 'page' ? 'z-[140]'
    : mode === 'side' ? 'z-[140] border-l border-gray-200 dark:border-white/15'
      : 'z-[150] border border-gray-200 dark:border-white/15 rounded-xl overflow-hidden shadow-2xl';
  const stop = { onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };

  return (
    <div className={`fixed flex flex-col bg-white dark:bg-[#0d0d0d] ${chrome}`} style={box}>
      <div
        onMouseDown={mode === 'window' ? moveWindow : undefined}
        title={mode === 'window' ? 'Drag to move' : undefined}
        className={`shrink-0 flex items-center gap-1 pl-3 pr-1.5 border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.03] ${mode === 'window' ? 'cursor-move select-none' : ''}`}
        style={{ height: HEADER }}
      >
        <Plug className="w-3.5 h-3.5 text-gray-700 dark:text-gray-200 shrink-0" />
        <span className="min-w-0 truncate px-1 text-xs font-semibold text-gray-700 dark:text-gray-200">{plugin.name}</span>
        <span className="flex-1" />
        <div className="flex items-center gap-1" {...stop}>
          {/* The ways this plugin may be shown, the current one lit; nothing to choose from when
              its developer allows only one. */}
          {modes.length > 1 && (
            <div role="group" aria-label="How this plugin is shown" className="flex items-center gap-0.5">
              {modes.map(m => (
                <button
                  key={m}
                  type="button"
                  title={MODE_BUTTONS[m].label}
                  aria-label={MODE_BUTTONS[m].label}
                  aria-pressed={m === mode}
                  onClick={() => { if (m !== mode) switchTo(m); }}
                  className={m === mode ? 'p-1 rounded bg-accent-soft text-accent-fg' : btn}
                >
                  {MODE_BUTTONS[m].icon}
                </button>
              ))}
            </div>
          )}
          {/* A page is left through the nav, so it has no Close. */}
          {mode !== 'page' && (
            <button type="button" className={btn} title="Close" onClick={() => setPanel({ open: null })}><X className="w-3.5 h-3.5" /></button>
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
