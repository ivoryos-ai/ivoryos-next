"use client";
import React, { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Check, PictureInPicture2, X } from 'lucide-react';
import { HOME_HREF } from '@/homePage';
import { isShowing, openInPanel, pluginPageHref, prefsFor, setPanel, setPrefs, usePanel, type PanelLayout } from '@/pluginPanel';

export type PluginMenuAt = { plugin: { id: string; name: string; placement?: string }; x: number; y: number };

const ITEM = 'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10';

/**
 * A plugin's three check marks (pluginPanel.ts), drawn by the panel header's gear menu and by the
 * nav entry's right-click menu alike: how it opens (a page or beside the page, one of the two),
 * and whether it may be popped out into a window. Each takes effect at once on a plugin that is
 * showing: a docked plugin set to "As a page" goes to its page, and the window closes when it is
 * no longer allowed.
 */
export function PluginChoices({ plugin, onPick }: { plugin: { id: string; name: string }; onPick?: () => void }) {
  const router = useRouter();
  const panel = usePanel();
  const prefs = prefsFor(panel, plugin.id);
  const showing = panel.open === plugin.id;
  const onPage = panel.onPage === plugin.id;
  const setLayout = (layout: PanelLayout) => {
    setPrefs(plugin.id, { layout });
    if (!showing || panel.windowed) return;
    // Shown the old way right now: show it the new way.
    if (layout === 'full') router.push(pluginPageHref(plugin.id));
    else if (onPage) router.push(HOME_HREF);
    onPick?.();
  };
  const row = (checked: boolean, label: string, onClick: () => void, title: string) => (
    <button type="button" role="menuitemcheckbox" aria-checked={checked} title={title} className={ITEM} onClick={onClick}>
      <Check className={`w-3.5 h-3.5 shrink-0 ${checked ? '' : 'invisible'}`} />
      {label}
    </button>
  );
  return (
    <>
      {row(prefs.layout === 'full', 'As a page', () => setLayout('full'), 'A page of its own, like Instruments')}
      {row(prefs.layout === 'side', 'Beside the page', () => setLayout('side'), 'Docked on the right, in view while you move around')}
      {row(prefs.float, 'Floating window', () => {
        setPrefs(plugin.id, { float: !prefs.float });
        // Disallowed while popped out: it goes back where its check marks put it.
        if (prefs.float && showing && panel.windowed) { setPanel({ windowed: false }); if (prefs.layout === 'full') router.push(pluginPageHref(plugin.id)); onPick?.(); }
      }, prefs.float
        ? 'May be popped out into a window over the pages. Click to disallow.'
        : 'Allow popping it out into a window over the pages')}
    </>
  );
}

/**
 * A plugin entry's right-click menu in the nav: its check marks, then pop it out (while allowed)
 * or close it.
 */
export default function PluginMenu({ at, onClose }: { at: PluginMenuAt; onClose: () => void }) {
  const router = useRouter();
  const panel = usePanel();
  const box = useRef<HTMLDivElement>(null);
  const { plugin } = at;
  const showing = isShowing(panel, plugin.id);
  const onPage = panel.onPage === plugin.id;
  const prefs = prefsFor(panel, plugin.id);

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
  // Leaving the plugin's page for the window lands on the landing page, not an empty page.
  const leavePage = () => { if (onPage) router.push(HOME_HREF); };
  // Kept on screen near the right and bottom edges.
  const left = Math.min(at.x, window.innerWidth - 200);
  const top = Math.min(at.y, window.innerHeight - 190);

  return (
    <div
      ref={box}
      role="menu"
      style={{ left, top }}
      className="fixed z-[10002] w-48 py-1 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1a1a1a] shadow-xl"
    >
      <div className="px-3 pt-1 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 truncate">{plugin.name}</div>
      <PluginChoices plugin={plugin} onPick={onClose} />
      {(prefs.float || showing) && <div className="my-1 border-t border-gray-100 dark:border-white/10" />}
      {prefs.float && (
        <button type="button" role="menuitem" className={ITEM} onClick={pick(() => { openInPanel(plugin.id, plugin.placement, { window: true }); leavePage(); })}>
          <PictureInPicture2 className="w-3.5 h-3.5" /> Open in a window
        </button>
      )}
      {showing && (
        <button type="button" role="menuitem" className={ITEM} onClick={pick(() => { setPanel({ open: null }); leavePage(); })}>
          <X className="w-3.5 h-3.5" /> Close
        </button>
      )}
    </div>
  );
}
