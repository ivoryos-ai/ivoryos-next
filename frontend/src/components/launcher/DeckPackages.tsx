"use client";
import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, Loader2, Package, RefreshCw, Trash2 } from 'lucide-react';
import { confirmDialog, notify } from '@ivoryos/shared-ui';
import type { Deck, DeckPackage, DesktopApi, PackageUpdate } from '@/desktop';
import { installFailed } from './ReportProblem';
import { Button, cardClass } from './ui';

/**
 * A deck's driver packages: the version installed, what on the deck needs each one, a newer
 * version to update to, and taking one off the deck's list. Nothing here uninstalls anything:
 * decks share one Python environment (desktop/src/deckPackages.js says how "needs" is worked out).
 */
export default function DeckPackages({ api, profileId, deck, running, onChanged }: {
  api: DesktopApi; profileId: string; deck: Deck | null; running: boolean; onChanged: () => void;
}) {
  const [rows, setRows] = useState<DeckPackage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, PackageUpdate> | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Read again whenever the deck file changes (an install, a removal, an update).
  useEffect(() => {
    if (!deck) return;
    let cancelled = false;
    api.deckPackages(profileId).then(r => {
      if (cancelled) return;
      setRows(r.rows);
      setError(r.error);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [api, profileId, deck]);

  const list = rows ?? (deck?.packages || []).map(requirement => ({
    requirement, key: requirement, name: requirement, spec: '', kind: 'name', version: null, optimizer: null, usedBy: [], status: 'unknown',
  }) as DeckPackage);
  if (!list.length) return null;
  const unused = list.filter(p => p.status === 'unused');

  const check = async () => {
    setChecking(true);
    try { setUpdates(await api.checkPackageUpdates(profileId)); } catch (e: any) { notify(e.message, { title: 'Could not check for updates', tone: 'error' }); } finally { setChecking(false); }
  };

  const update = async (p: DeckPackage, u: PackageUpdate) => {
    // An update replaces a package the running deck has open, and a deck is never stopped for
    // the person (manager.js _installFor refuses it too).
    if (running) {
      await notify(`Stop this deck, then update ${p.name}. An update replaces files a running deck has open, and the app never stops a deck for you.`, { title: 'Stop the deck first' });
      return;
    }
    const others = u.changes.map(c => `${c.change === '+' ? '' : 'removes '}${c.name} ${c.version}`);
    const ok = await confirmDialog([
      `Update ${p.name} from ${p.version || p.spec || 'its current version'} to ${u.latest}? The deck will ask for ${p.name}==${u.latest} from now on.`,
      ...(others.length ? [`This also installs or changes: ${others.join(', ')}.`] : []),
      'It installs now; the deck loads it when it starts.',
    ].join('\n\n'), { title: 'Update package?', confirmLabel: 'Update' });
    if (!ok) return;
    setBusy(p.key);
    try {
      await api.updatePackage(profileId, p.key, u.latest!);
      setUpdates(prev => { if (!prev) return prev; const next = { ...prev }; delete next[p.key]; return next; });
      onChanged();
    } catch (e: any) {
      await installFailed(api, `Could not update ${p.name}`, e, profileId, async () => {
        await api.setEnvironment(profileId, 'own');
        await api.updatePackage(profileId, p.key, u.latest!);
        onChanged();
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (items: DeckPackage[]) => {
    const used = items.filter(p => p.usedBy.length);
    const names = items.map(p => p.name).join(', ');
    const ok = await confirmDialog([
      `Take ${names} off this deck's package list? ${items.length === 1 ? 'It stays' : 'They stay'} installed: other decks may use ${items.length === 1 ? 'it' : 'them'}.`,
      ...(used.length ? [`Still used by: ${used.map(p => `${p.name} (${p.usedBy.join(', ')})`).join('; ')}. It keeps loading while installed, but a rebuilt Python environment would leave it out.`] : []),
    ].join('\n\n'), { title: items.length === 1 ? 'Remove package?' : `Remove ${items.length} packages?`, confirmLabel: 'Remove', tone: used.length ? 'danger' : undefined });
    if (!ok) return;
    try { await api.removePackages(profileId, items.map(p => p.key)); onChanged(); } catch (e: any) { notify(e.message, { title: 'Could not change the deck', tone: 'error' }); }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400"><Package className="w-3.5 h-3.5" /> Driver packages</div>
        <div className="ml-auto flex items-center gap-1.5">
          {unused.length > 0 && (
            <Button small tone="ghost" title="Take the packages nothing on this deck uses off its list. Nothing is uninstalled." onClick={() => remove(unused)}>
              Remove unused ({unused.length})
            </Button>
          )}
          <Button small onClick={check} disabled={checking} title="Look for newer versions that install with the rest of this deck's packages">
            {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} {checking ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>
      </div>
      {error && <div className="mb-1.5 text-xs text-amber-600 dark:text-amber-400">{error}</div>}
      <ul className={`${cardClass} divide-y divide-gray-100 dark:divide-white/5 overflow-hidden`}>
        {list.map(p => {
          const u = updates?.[p.key];
          const usage = p.optimizer ? `optimizer (${p.optimizer})`
            : p.usedBy.length ? `used by ${p.usedBy.join(', ')}`
            : p.status === 'unused' ? 'not used by anything on this deck'
            : p.version ? '' : 'not installed';
          return (
            <li key={p.key} className={`px-4 py-2 flex items-center gap-3 text-xs ${p.status === 'unused' ? 'opacity-70' : ''}`}>
              <div className="min-w-0 flex-1 flex items-baseline gap-2" title={p.requirement}>
                <span className="font-mono text-sm text-gray-900 dark:text-gray-100 truncate">{p.kind === 'path' ? 'private repository' : p.name}</span>
                {p.version && <span className="font-mono text-gray-500 dark:text-gray-400 shrink-0">{p.version}</span>}
                {!p.version && p.spec && <span className="font-mono text-gray-400 shrink-0">{p.spec}</span>}
                {usage && <span className={`truncate ${p.status === 'unused' ? 'italic text-gray-400' : 'text-gray-500 dark:text-gray-400'}`} title={usage}>{usage}</span>}
              </div>
              {p.optimizer ? (
                <span className="text-gray-400 shrink-0" title="Versions of an optimizer are chosen on the deck's Optimizers card (Settings), from those tested together.">Settings → Optimizers</span>
              ) : p.kind !== 'name' ? (
                updates && <span className="text-gray-400 shrink-0" title={p.kind === 'path' ? 'Import it again from the repository to move to a newer commit.' : 'Installed from a URL: change the requirement to move it.'}>not checked</span>
              ) : u?.error ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0" title={u.error}><AlertTriangle className="w-3.5 h-3.5" /> could not check</span>
              ) : u?.latest ? (
                <Button small tone="primary" disabled={busy !== null} onClick={() => update(p, u)} title={`Install ${u.latest} and pin the deck to it`}>
                  {busy === p.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpCircle className="w-3.5 h-3.5" />} Update to {u.latest}
                </Button>
              ) : u ? (
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> up to date</span>
              ) : null}
              {!p.optimizer && (
                <Button small tone="ghost" title="Take it off this deck's list (it stays installed)" disabled={busy !== null} onClick={() => remove([p])}>
                  <Trash2 className="w-3.5 h-3.5 text-red-500" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
