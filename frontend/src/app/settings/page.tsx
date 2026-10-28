"use client";
import React, { useEffect, useState } from 'react';
import { NavPlacementChoice, ThemeChoice, inDesktopApp, useNavPlacement, useThemePreference } from '@ivoryos/shared-ui';
import Sidebar from '@/components/Sidebar';
import { API_BASE } from '@/config';
import { askToNotify, notifyState, type NotifyState } from '@/browserNotify';
import { loadPanel, setPanelSettings, usePanel, type PanelLayout } from '@/pluginPanel';

/**
 * Theme and layout, for an edge opened in a browser, and how this deck's plugins open. Inside
 * the desktop app theme and layout follow the app (packages/shared-ui theme.tsx,
 * navPlacement.tsx), and the top bar links here only when the deck has plugins.
 */
export default function SettingsPage() {
  const [pref, setPref] = useThemePreference();
  const [nav, setNav] = useNavPlacement();
  // Read after hydration (AGENTS.md section 11): the server render cannot know.
  const [desktop, setDesktop] = useState(false);
  const [notify, setNotify] = useState<NotifyState>('unsupported');
  const [hasPlugins, setHasPlugins] = useState(false);
  const panel = usePanel();
  useEffect(() => {
    setDesktop(inDesktopApp());
    setNotify(notifyState());
    loadPanel();
    fetch(`${API_BASE}/api/plugins`).then(r => r.json()).then(d => setHasPlugins((d.plugins || []).length > 0)).catch(() => {});
  }, []);

  const row = 'flex items-center justify-between gap-4 py-3';
  const sub = 'block text-xs font-normal text-gray-500 dark:text-gray-400';
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white font-sans overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <section className="max-w-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl px-5 divide-y divide-gray-100 dark:divide-white/10">
          {desktop ? (
            <p className="py-4 text-sm text-gray-500 dark:text-gray-400">Theme and layout follow the IvoryOS app, which also sends the notifications.</p>
          ) : (
            <>
              <div className={row}><span className="text-sm font-medium">Theme</span><ThemeChoice value={pref} onChange={setPref} /></div>
              <div className={row}><span className="text-sm font-medium">Navigation</span><NavPlacementChoice value={nav} onChange={setNav} /></div>
              <div className={row}>
                <span className="text-sm font-medium">Notifications<span className={sub}>When a run waits for input or a step fails</span></span>
                {notify === 'granted' ? <span className="text-sm text-gray-500 dark:text-gray-400">On</span>
                  : notify === 'denied' ? <span className="text-sm text-gray-500 dark:text-gray-400">Blocked in this browser&apos;s site settings</span>
                  : notify === 'unsupported' ? <span className="text-sm text-gray-500 dark:text-gray-400">Not available here</span>
                  : <button type="button" onClick={async () => setNotify(await askToNotify())} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/10">Turn on</button>}
              </div>
            </>
          )}
          {hasPlugins && (
            <>
              {/* How a plugin opens from the nav (pluginPanel.ts). As a page it is a page like any
                  other; beside the page it stays in view while you move around. */}
              <div className={row}>
                <span className="text-sm font-medium">Plugins open<span className={sub}>From the nav; right-click an entry for the other way</span></span>
                <Choice<PanelLayout> value={panel.layout} onChange={layout => setPanelSettings({ layout })}
                  options={[{ value: 'full', label: 'As a page' }, { value: 'side', label: 'Beside the page' }]} />
              </div>
              <div className={row}>
                <span className="text-sm font-medium">Floating window<span className={sub}>Let a plugin pop out into a window over the pages</span></span>
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input type="checkbox" className="w-4 h-4 accent-accent" checked={panel.allowFloat} onChange={e => setPanelSettings({ allowFloat: e.target.checked })} />
                  Allowed
                </label>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

/** Two or three buttons, in the same shape as ThemeChoice and NavPlacementChoice. */
function Choice<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="inline-grid grid-flow-col auto-cols-fr gap-1 p-1 rounded-lg bg-gray-100 dark:bg-white/5">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap ${value === o.value ? 'bg-white text-accent-fg shadow-sm ring-1 ring-accent-tint/60 dark:bg-accent-soft dark:ring-0' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
