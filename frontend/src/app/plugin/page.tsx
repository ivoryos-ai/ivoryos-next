"use client";
import { API_BASE } from '@/config';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { modeFor, pageToReturnTo, setMode, setPanel, setPluginPage, usePanel, type PanelPlugin } from '@/pluginPanel';
import Sidebar from '@/components/Sidebar';

/**
 * A plugin as a page of its own. The plugin itself is drawn by PluginPanel in the root layout,
 * which covers this page's area while the page is open and keeps the plugin mounted, hidden,
 * once it is left (pluginPanel.ts): this page only says which plugin it is, so the nav treats
 * the plugin as the current page, and draws the frame around it.
 */
function PluginContent() {
  const router = useRouter();
  const panel = usePanel();
  const searchParams = useSearchParams();
  const pluginId = searchParams.get('id');

  const [plugin, setPlugin] = useState<PanelPlugin | null | undefined>(undefined);

  useEffect(() => {
    if (!pluginId) { setPlugin(null); return; }
    // Being here is the choice: the plugin is a page from now on, if its developer allows one.
    setMode(pluginId, 'page');
    setPanel({ open: pluginId });
    setPluginPage(pluginId);
    return () => setPluginPage(null);
  }, [pluginId]);

  useEffect(() => {
    setPlugin(undefined);
    fetch(`${API_BASE}/api/plugins`)
      .then(res => res.json())
      .then(data => setPlugin((data.plugins || []).find((p: any) => p.id === pluginId) ?? null))
      .catch(err => { console.error(err); setPlugin(null); });
  }, [pluginId]);

  // This page exists only while its plugin is shown as a page: switched to the side or a window,
  // closed, replaced by another plugin, or not allowed to be a page, it goes back.
  useEffect(() => {
    if (!plugin || plugin.id !== pluginId) return;
    if (panel.open !== plugin.id || modeFor(panel, plugin) !== 'page') router.replace(pageToReturnTo());
  }, [plugin, pluginId, panel, router]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white font-sans overflow-hidden">
      <Sidebar />
      {/* The panel draws over this; what is here shows only while it loads or when there is nothing to draw. */}
      <main className="flex-1 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0a0a0a]">
        {plugin === undefined
          ? <Loader2 className="w-8 h-8 animate-spin text-gray-700 dark:text-gray-200" />
          : plugin ? null : <div className="text-gray-500 dark:text-gray-400">Plugin not found or inactive.</div>}
      </main>
    </div>
  );
}

export default function PluginPage() {
    return (
        <Suspense fallback={<div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-[#0a0a0a]"><Loader2 className="w-8 h-8 animate-spin text-gray-700 dark:text-gray-200" /></div>}>
            <PluginContent />
        </Suspense>
    );
}
