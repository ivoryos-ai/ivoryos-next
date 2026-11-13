"use client";
import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, AlertTriangle, Download } from 'lucide-react';
import { confirmDialog, notify } from '@ivoryos/shared-ui';
import type { DesktopApi, PythonInfo } from '@/desktop';
import { Button, cardClass } from './ui';

/** The edge's own floor (edge_server/pyproject.toml `requires-python`). */
const MIN_PYTHON = [3, 10];

function tooOld(version?: string) {
  const [major, minor] = (version || '0.0').split('.').map(Number);
  return major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1]);
}

/**
 * Whether a Python can run IvoryOS: its version, and whether the edge is installed in it (with a
 * button to install it when not). `python` null means the launcher's own environment.
 *
 * `compact` is one status line, for under a profile's interpreter field. Otherwise it is a card
 * that also shows the interpreter's path with Copy path (the launcher's Settings), which is what
 * someone pastes into PyCharm or VS Code to get the same packages there.
 */
export default function PythonEnvironment({ api, python, compact }: {
  api: DesktopApi;
  python: string | null;
  compact?: boolean;
}) {
  const [info, setInfo] = useState<PythonInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [recheck, setRecheck] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      setInfo(null);
      api.inspectPython(python).then(i => { if (!cancelled) setInfo(i); })
        .catch((e: Error) => { if (!cancelled) setInfo({ ok: false, python: python || '', error: e.message }); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [api, python, recheck]);

  const installEdge = async () => {
    if (!info) return;
    const ok = await confirmDialog(`Install IvoryOS into\n${info.prefix || info.python}?\n\nIt adds the ivoryos-edge package and its requirements to that environment.`, { title: 'Install IvoryOS here?', confirmLabel: 'Install' });
    if (!ok) return;
    setInstalling(true);
    try { await api.installEdgeInto(info.python); setRecheck(n => n + 1); }
    catch (err) {
      const e = err as Error & { output?: string };
      notify(`${e.message}${e.output ? `\n\n${String(e.output).split('\n').slice(-10).join('\n')}` : ''}`, { title: 'Could not install IvoryOS', tone: 'error' });
    }
    finally { setInstalling(false); }
  };

  const status = info === null ? (
    <div className="flex items-center gap-1.5 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" /> Checking…</div>
  ) : !info.ok ? (
    <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> Not a working Python: {info.error}</div>
  ) : tooOld(info.version) ? (
    <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> Python {info.version}: IvoryOS needs {MIN_PYTHON.join('.')} or newer.</div>
  ) : info.edge ? (
    <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400"><CheckCircle2 className="w-3.5 h-3.5" /> Python {info.version}, IvoryOS {info.edge}</div>
  ) : (
    <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Python {info.version}, IvoryOS not installed.
      <Button small disabled={installing} onClick={installEdge}>{installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Install IvoryOS</Button>
    </div>
  );

  if (compact) return status;

  return (
    <div className={`${cardClass} p-3 space-y-2 text-sm`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 font-mono text-xs break-all text-gray-700 dark:text-gray-300 pt-1">{info?.python || python || 'Launcher Python'}</div>
        {info?.python && (
          <Button small tone="ghost" title="Copy the interpreter path, to paste into PyCharm or VS Code" onClick={() => api.copy(info.python)}><Copy className="w-3.5 h-3.5" /> Copy path</Button>
        )}
      </div>
      {status}
    </div>
  );
}
