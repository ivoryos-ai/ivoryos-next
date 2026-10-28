"use client";
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Maximize2, PanelRight, PictureInPicture2, X } from 'lucide-react';
import { HOME_HREF } from '@/homePage';
import { isShowing, openInPanel, pluginPageHref, setPanel, usePanel } from '@/pluginPanel';

export type PluginMenuAt = { plugin: { id: string; name: string; placement?: string }; x: number; y: number };

/**
 * A plugin entry's right-click menu in the nav: where to show it, remembered for that plugin
 * (pluginPanel.ts). Any plugin can open as a page, beside the page or in a window over the pages.
 */
export default function PluginMenu({ at, onClose }: { at: PluginMenuAt; onClose: () => void }) {
  const router = useRouter();
  const panel = usePanel();
  const box = useRef<HTMLDivElement>(null);
  const { plugin } = at;
  const showing = isShowing(panel, plugin.id);
  const onPage = panel.onPage === plugin.id;

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const pick = (fn: () => void) => () => { fn(); onClose(); };
  // Leaving the plugin's page for another mode lands on the landing page, not an empty page.
  const leavePage = () => { if (onPage) router.push(HOME_HREF); };
  const item = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10';
  // Kept on screen near the right and bottom edges.
  const left = Math.min(at.x, window.innerWidth - 200);
  const top = Math.min(at.y, window.innerHeight - 150);

  return (
    <div
      ref={box}
      role="menu"
      style={{ left, top }}
      className="fixed z-[10002] w-48 py-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1a1a] shadow-xl"
    >
      <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{plugin.name}</div>
      <button type="button" role="menuitem" className={item} onClick={pick(() => router.push(pluginPageHref(plugin.id)))}>
        <Maximize2 className="w-3.5 h-3.5" /> Open as a page
      </button>
      <button type="button" role="menuitem" className={item} onClick={pick(() => { openInPanel(plugin.id, plugin.placement, 'side'); leavePage(); })}>
        <PanelRight className="w-3.5 h-3.5" /> Open beside the page
      </button>
      <button type="button" role="menuitem" className={item} onClick={pick(() => { openInPanel(plugin.id, plugin.placement, 'window'); leavePage(); })}>
        <PictureInPicture2 className="w-3.5 h-3.5" /> Open in a window
      </button>
      {showing && (
        <button type="button" role="menuitem" className={item} onClick={pick(() => { setPanel({ open: null }); leavePage(); })}>
          <X className="w-3.5 h-3.5" /> Close
        </button>
      )}
    </div>
  );
}
