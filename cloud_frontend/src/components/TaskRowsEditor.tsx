"use client";

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { SpreadsheetTable, isRowActive, type SpreadsheetRow } from '@ivoryos/shared-ui';

/**
 * The samples still to come of a spreadsheet step running on a device, changed while it runs:
 * the bench's Iterate page does the same for its own runs. The samples the device has started are
 * locked (`editableFrom`, from the device's progress) and lock here as the run reaches them; the
 * rest can be changed, added or removed. Saving plans the task again from these rows and sends it
 * (api/cloud-workflows/rows); the device keeps what it has started and replaces the rest, or says
 * why not, and that answer is shown here.
 *
 * Drawn on <body>: inside the canvas a fixed box is placed by the zoomed node, not the window.
 */

const POLL_MS = 2000;

type Loaded = { variables: string[]; rows: SpreadsheetRow[]; batchSize: number; editableFrom: number | null;
  pending: { id: string } | null; lastResult: { id?: string; ok: boolean; error?: string } | null };

export default function TaskRowsEditor({ runId, nodeId, onClose }: { runId: string; nodeId: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rows, setRows] = useState<SpreadsheetRow[]>([]);
  const [locked, setLocked] = useState(0);
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const rowsRef = useRef<SpreadsheetRow[]>([]);
  const lockedRef = useRef(0);
  useEffect(() => { rowsRef.current = rows; lockedRef.current = locked; }, [rows, locked]);

  useEffect(() => {
    let gone = false;
    const load = async (first: boolean) => {
      try {
        const res = await fetch(`/api/cloud-workflows/rows?runId=${encodeURIComponent(runId)}&nodeId=${encodeURIComponent(nodeId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (gone) return;
        if (!res.ok) { if (first) setProblem(data.error || 'Could not read the samples.'); return; }
        setLoaded(data);
        const from: number | null = data.editableFrom;
        if (first) {
          setRows(data.rows.map((r: SpreadsheetRow) => ({ ...r })));
          setLocked(from ?? data.rows.length);
          return;
        }
        // Samples the device has started since: locked, with the values they started with.
        const now = from ?? Math.max(data.rows.length, rowsRef.current.length);
        if (now > lockedRef.current) {
          const next = rowsRef.current.map(r => ({ ...r }));
          const taken: number[] = [];
          for (let i = lockedRef.current; i < Math.min(now, data.rows.length); i++) {
            if (JSON.stringify(next[i]) !== JSON.stringify(data.rows[i])) taken.push(i + 1);
            next[i] = { ...data.rows[i] };
          }
          setRows(next);
          setLocked(now);
          if (from === null) setNote('No sample of this step can change any more.');
          else if (taken.length) setNote(`Sample${taken.length === 1 ? '' : 's'} ${taken.join(', ')} started before your change was sent, so ${taken.length === 1 ? 'it runs' : 'they run'} with the values ${taken.length === 1 ? 'it' : 'they'} had.`);
        }
      } catch {
        if (first && !gone) setProblem('Could not reach Cloud.');
      }
    };
    load(true);
    const timer = setInterval(() => load(false), POLL_MS);
    return () => { gone = true; clearInterval(timer); };
  }, [runId, nodeId]);

  // The device's answer to the change sent from here.
  const answer = waitingFor && loaded?.lastResult?.id === waitingFor ? loaded.lastResult : null;
  useEffect(() => {
    if (!answer) return;
    setWaitingFor(null);
    if (answer.ok) onClose();
    else setProblem(`The device did not take the change: ${answer.error}`);
  }, [answer, onClose]);

  const variables = loaded?.variables || [];

  const save = async () => {
    setProblem('');
    setNote('');
    try {
      const res = await fetch('/api/cloud-workflows/rows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Blank rows are left out, so each sample's place here is its place in the run.
        body: JSON.stringify({ runId, nodeId, rows: rows.filter(r => isRowActive(r, variables)) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setProblem(data.error || 'Could not send the change.'); return; }
      setWaitingFor(data.id);
    } catch {
      setProblem('Could not reach Cloud.');
    }
  };

  const blank = () => Object.fromEntries(variables.map(v => [v, '']));

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4" onMouseDown={e => { if (e.target === e.currentTarget && !waitingFor) onClose(); }}>
      <div role="dialog" aria-labelledby="task-rows-title" className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#151515]">
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-white/5">
          <div className="min-w-0 flex-1">
            <h2 id="task-rows-title" className="text-sm font-bold text-gray-900 dark:text-gray-100">Samples still to come</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {locked > 0 ? `Sample${locked === 1 ? '' : 's'} 1${locked > 1 ? `-${locked}` : ''} ${locked === 1 ? 'has' : 'have'} started on the device and ${locked === 1 ? 'is' : 'are'} locked. ` : ''}
              Change, add or remove the others; the run carries on with them.
            </p>
          </div>
          <button onClick={onClose} disabled={!!waitingFor} title="Close" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!loaded ? (
            problem ? <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>
              : <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the samples...</p>
          ) : (
            <SpreadsheetTable
              variables={variables}
              rows={rows}
              lockedRows={locked}
              batchSize={loaded.batchSize}
              showBatchGrouping={loaded.batchSize > 1}
              idPrefix={`task-${nodeId}`}
              onRowChange={(idx, v, value) => { if (idx >= locked) setRows(rs => rs.map((r, i) => (i === idx ? { ...r, [v]: value } : r))); }}
              onAddRow={() => setRows(rs => [...rs, blank()])}
              onRemoveRow={(idx) => { if (idx >= locked) setRows(rs => rs.filter((_, i) => i !== idx)); }}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-white/5">
          {(problem && loaded) || note ? (
            <p className={`mr-auto text-xs ${problem ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`}>{problem || note}</p>
          ) : null}
          {waitingFor && <span className="mr-auto flex items-center gap-1.5 text-xs text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sent · waiting for the device…</span>}
          <button onClick={onClose} disabled={!!waitingFor} className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/10">Cancel</button>
          <button onClick={save} disabled={!loaded || !!waitingFor || loaded.editableFrom === null}
            className="btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">Send changes</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
