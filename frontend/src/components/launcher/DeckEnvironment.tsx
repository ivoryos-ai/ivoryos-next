"use client";
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { confirmDialog } from '@ivoryos/shared-ui';
import type { DesktopApi, Profile } from '@/desktop';
import PythonEnvironment from './PythonEnvironment';
import { installFailed } from './ReportProblem';
import { Button, cardClass } from './ui';

/**
 * Which Python a deck runs in: the one the decks share, or its own (desktop/src/manager.js
 * setEnvironment, issue 82). Its own is for packages that cannot share with another deck's; the
 * install that found the conflict offers it too. The interpreter's path is here to paste into an
 * editor, as on the launcher's Settings.
 */
export default function DeckEnvironment({ api, profile }: { api: DesktopApi; profile: Profile }) {
  const own = profile.environment === 'own';
  const [python, setPython] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPython(null);
    api.profilePython(profile.id).then(p => { if (!cancelled) setPython(p); }).catch(() => {});
    return () => { cancelled = true; };
  }, [api, profile.id, profile.environment]);

  const move = async () => {
    const to = own ? 'shared' : 'own';
    const ok = await confirmDialog(to === 'own'
      ? `Give “${profile.name}” its own Python? Its packages are installed there now, and it runs from it at its next start.`
      : `Move “${profile.name}” back to the shared Python? Its packages are checked against the other decks’ first, and its own Python is removed.`,
    { title: to === 'own' ? 'Its own Python?' : 'Back to the shared Python?', confirmLabel: to === 'own' ? 'Set it up' : 'Move back' });
    if (!ok) return;
    setBusy(true);
    try {
      await api.setEnvironment(profile.id, to);
    } catch (e: any) {
      await installFailed(api, to === 'own' ? 'Could not set up its own Python' : 'Could not move it back', e, profile.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${cardClass} p-4 space-y-3`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Python</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{own ? 'Its own, apart from the other decks.' : 'Shared with the other decks.'}</p>
        </div>
        <Button small disabled={busy} onClick={move}>
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {own ? 'Use the shared Python' : 'Give it its own'}
        </Button>
      </div>
      {python && <PythonEnvironment api={api} python={python} />}
    </section>
  );
}
