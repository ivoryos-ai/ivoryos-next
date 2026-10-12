"use client";

import { useState } from 'react';
import { Pencil, Play, SkipForward, Square, Send } from 'lucide-react';
import { changedArguments, confirmDialog, fieldText } from '@ivoryos/shared-ui';

/**
 * What a person can do about a task stopped for them, wherever it is shown (the attention panel
 * on every page, and the node on the canvas): answer the question, or retry / skip / stop a failed
 * step -- the bench's own prompt and error bar, offered from Cloud.
 *
 * `cloud` items are Cloud's own User_Input steps, answered through their existing route; the rest
 * are stopped on a device and go through /api/cloud-workflows/control with the pause they were
 * looking at, so a decision about a question the bench already answered changes nothing.
 *
 * Callers key it by the pause: a new pause is a new question, and nothing typed or sent for the
 * last one may carry over.
 *
 * A failed step can be changed before it is retried (Change), as at the bench: its values come
 * with the pause (`edit`, the edge's step_edit_summary), and "this and every later run of it"
 * reaches the same step on the samples still to come. The device checks the change and answers
 * (`editResult`); a refused one leaves the step waiting and says why.
 */
export type PauseItem = {
  runId: string;
  nodeId: string;
  kind: 'input' | 'error';
  pause: string | null;
  prompt?: string;
  inputType?: string;
  error?: string;
  sent?: string | null;
  cloud?: boolean;
  /** The failed step and its values, when the device sent them: {step_id, method, args, columns, later}. */
  edit?: { step_id: number; instrument?: string; method?: string; args: Record<string, any>; columns?: Record<string, string>; later?: number } | null;
  /** The device's answer to the last change sent: {id, ok, error}. */
  editResult?: { id?: string; ok: boolean; error?: string } | null;
};

const SENT_LABEL: Record<string, string> = {
  input: 'Answer sent', retry: 'Retrying', skip: 'Skipping', stop: 'Stopping',
};

const btn = 'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50';

export default function PauseActions({ item }: { item: PauseItem }) {
  const [value, setValue] = useState<string>('');
  const [sending, setSending] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [changing, setChanging] = useState(false);
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(item.edit?.args || {}).map(([k, v]) => [k, fieldText(v)])));
  const [scope, setScope] = useState<'step' | 'later'>('later');
  // The change sent from here, until the device answers it: a refusal leaves the same pause, so
  // the card has to take its controls back on the answer rather than on a new pause.
  const [sentChange, setSentChange] = useState<string | null>(null);
  const refused = !!sentChange && item.editResult?.id === sentChange && !item.editResult.ok;

  const sent = refused ? null : item.sent || sending;
  const send = async (action: string, answer?: any, edit?: any) => {
    if (sent) return;
    if (action === 'stop' && !(await confirmDialog(
      item.kind === 'error'
        ? 'Stop this run here? The failed step stays failed and nothing after it runs.'
        : 'Stop this run instead of answering? Nothing after this step runs.',
      { title: 'Stop the run', confirmLabel: 'Stop run', tone: 'danger' },
    ))) return;
    setSending(action);
    setSentChange(null);
    setProblem('');
    try {
      const res = item.cloud
        ? await fetch('/api/cloud-workflows/input', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: item.runId, nodeId: item.nodeId, value: answer }),
        })
        : await fetch('/api/cloud-workflows/control', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: item.runId, nodeId: item.nodeId, pause: item.pause, action, value: answer, ...(edit ? { edit } : {}) }),
        });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProblem(data.error || 'Could not send that.');
        setSending(null);
      } else if (data.id) {
        setSentChange(data.id);
      }
    } catch {
      setProblem('Could not reach Cloud.');
      setSending(null);
    }
  };

  const stop = !item.cloud && (
    <button onClick={() => send('stop')} disabled={!!sent} title="Stop the run here" className={`${btn} ml-auto text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10`}>
      <Square className="h-3 w-3" />Stop
    </button>
  );

  const columns = item.edit?.columns || {};
  const names = Object.keys(item.edit?.args || {});
  // "Every later run" reaches only what a later sample does not take from its own column.
  const repeats = (item.edit?.later || 0) > 0 && names.some(n => !columns[n]);
  const sendChange = () => {
    const args = changedArguments(texts, item.edit?.args || {});
    if (!Object.keys(args).length) { setProblem('Nothing is changed yet.'); return; }
    send('retry', undefined, { step_id: item.edit!.step_id, args, scope: repeats ? scope : 'step' });
  };

  let controls: React.ReactNode;
  if (item.kind === 'error' && changing && item.edit) {
    return (
      <div className="nodrag space-y-1.5">
        {refused && <div className="text-[11px] text-red-500">The change was not made: {item.editResult?.error}</div>}
        {names.map(name => (
          <label key={name} className="flex items-center gap-1.5 text-xs">
            <span className="w-24 shrink-0 truncate font-mono text-gray-600 dark:text-gray-300" title={columns[name] ? `${name} (from column ${columns[name]})` : name}>{name}</span>
            <input value={texts[name] ?? ''} disabled={!!sent} spellCheck={false}
              onChange={e => setTexts(t => ({ ...t, [name]: e.target.value }))}
              className="nodrag min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 font-mono text-xs outline-none focus:border-accent dark:border-white/15 dark:bg-black/30" />
          </label>
        ))}
        {repeats && (
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-300">
            <input type="checkbox" className="accent-accent" checked={scope === 'later'} onChange={e => setScope(e.target.checked ? 'later' : 'step')} />
            Also for the {item.edit.later} later sample{item.edit.later === 1 ? '' : 's'}
          </label>
        )}
        <div className="flex items-center gap-1.5">
          <button onClick={sendChange} disabled={!!sent} className={`${btn} bg-accent text-on-accent hover:bg-accent-hover`}>
            <Play className="h-3 w-3" />Change and retry
          </button>
          <button onClick={() => { setChanging(false); setProblem(''); }} disabled={!!sent} className={`${btn} hover:bg-gray-100 dark:hover:bg-white/5`}>Back</button>
        </div>
        {(sent || problem) && (
          <div className={`text-[11px] ${problem ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
            {problem || 'Change sent · waiting for the device…'}
          </div>
        )}
      </div>
    );
  }
  if (item.kind === 'error') {
    controls = (
      <>
        <button onClick={() => send('retry')} disabled={!!sent} className={`${btn} bg-accent text-on-accent hover:bg-accent-hover`}>
          <Play className="h-3 w-3" />Retry
        </button>
        {item.edit && (
          <button onClick={() => setChanging(true)} disabled={!!sent} title="Change this step's values, then retry" className={`${btn} border border-gray-300 hover:bg-gray-50 dark:border-white/15 dark:hover:bg-white/5`}>
            <Pencil className="h-3 w-3" />Change
          </button>
        )}
        <button onClick={() => send('skip')} disabled={!!sent} title="Mark the step skipped and carry on" className={`${btn} border border-gray-300 hover:bg-gray-50 dark:border-white/15 dark:hover:bg-white/5`}>
          <SkipForward className="h-3 w-3" />Skip
        </button>
        {stop}
      </>
    );
  } else if (item.inputType === 'bool') {
    controls = (
      <>
        <button onClick={() => send('input', true)} disabled={!!sent} className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}>Yes</button>
        <button onClick={() => send('input', false)} disabled={!!sent} className={`${btn} border border-gray-300 hover:bg-gray-50 dark:border-white/15 dark:hover:bg-white/5`}>No</button>
        {stop}
      </>
    );
  } else {
    const numeric = item.inputType === 'int' || item.inputType === 'float';
    const submit = () => {
      if (numeric && value.trim() === '') { setProblem('Enter a number.'); return; }
      send('input', numeric ? Number(value) : value);
    };
    controls = (
      <>
        <input
          type={numeric ? 'number' : 'text'} step={item.inputType === 'float' ? 'any' : undefined}
          value={value} disabled={!!sent} placeholder={numeric ? item.inputType : 'answer'}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          className="nodrag min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs outline-none focus:border-amber-500 dark:border-white/15 dark:bg-black/30"
        />
        <button onClick={submit} disabled={!!sent} className={`${btn} shrink-0 bg-amber-500 text-white hover:bg-amber-600`}>
          <Send className="h-3 w-3" />Send
        </button>
        {stop}
      </>
    );
  }

  return (
    <div className="nodrag">
      {item.kind === 'error' && refused && (
        <div className="mb-1 text-[11px] text-red-500">The change was not made: {item.editResult?.error}</div>
      )}
      <div className="flex items-center gap-1.5">{controls}</div>
      {(sent || problem) && (
        <div className={`mt-1 text-[11px] ${problem ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
          {problem || `${SENT_LABEL[sent as string] || 'Sent'} · waiting for ${item.cloud ? 'Cloud' : 'the device'}…`}
        </div>
      )}
    </div>
  );
}
