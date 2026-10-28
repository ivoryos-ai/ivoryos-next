"use client";
import { API_BASE } from '@/config';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { openInPanel, setPluginPage } from '@/pluginPanel';
import Sidebar from '@/components/Sidebar';

/**
 * A plugin as a page of its own. The plugin itself is drawn by PluginPanel in the root layout,
 * which covers this page's area while the page is open and keeps the plugin mounted, hidden,
 * once it is left (pluginPanel.ts): this page only says which plugin it is, so the nav treats
 * the plugin as the current page, and draws the frame around it.
 */
function PluginContent() {
  const searchParams = useSearchParams();
  const pluginId = searchParams.get('id');

  const [found, setFound] = useState<boolean | null>(null);

  useEffect(() => {
    if (!pluginId) { setFound(false); return; }
    openInPanel(pluginId, undefined, 'full');
    setPluginPage(pluginId);
    return () => setPluginPage(null);
  }, [pluginId]);

  useEffect(() => {
    setFound(null);
    fetch(`${API_BASE}/api/plugins`)
      .then(res => res.json())
      .then(data => setFound(!!(data.plugins || []).find((p: any) => p.id === pluginId)))
      .catch(err => { console.error(err); setFound(false); });
  }, [pluginId]);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white font-sans overflow-hidden">
      <Sidebar />
      {/* The panel draws over this; what is here shows only while it loads or when there is nothing to draw. */}
      <main className="flex-1 flex items-center justify-center overflow-hidden bg-white dark:bg-[#0a0a0a]">
        {found === null
          ? <Loader2 className="w-8 h-8 animate-spin text-gray-700 dark:text-gray-200" />
          : found ? null : <div className="text-gray-500 dark:text-gray-400">Plugin not found or inactive.</div>}
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
