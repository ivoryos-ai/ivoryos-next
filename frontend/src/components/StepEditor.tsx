"use client";
import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCcw, Save, Table2 } from 'lucide-react';
import { changedArguments, fieldText } from '@ivoryos/shared-ui';
import { loadStepEdit, saveStepEdit, type StepEditInfo, type StepEditScope } from '@/runEdits';
import { liveEditHref } from '@/queuedEdit';
import { withBase } from '@/config';

/**
 * One step's arguments, changed before it runs again: a failed step before its retry (so the
 * retry is not the same failure), or a step still to come.
 *
 * "This and every later run of it" also changes the same step on the samples, or in the
 * optimization trials, still to come. An argument a sample takes from its own table column stays
 * that sample's own on the later ones: the table says what each sample gets, and the samples still
 * to come are changed in the table (the link below opens it). The edge checks every change
 * (run_edits.py): an argument the method does not take, a value the safety guard refuses, a
 * '#name' nothing before the step saves.
 */
export default function StepEditor({ runId, stepId, run, retry, cancelLabel = 'Back', onDone, onCancel }: {
  runId: number;
  stepId: number;
  /** The run as the queue last sent it, for the link to its samples still to come. */
  run?: any;
  /** The step failed and waits for a decision: offer "Save and retry". */
  retry: boolean;
  cancelLabel?: string;
  onDone: (retried: boolean) => void;
  onCancel: () => void;
}) {
  const [info, setInfo] = useState<StepEditInfo | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<StepEditScope>('later');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    loadStepEdit(runId, stepId).then(found => {
      if (gone) return;
      setInfo(found);
      setTexts(Object.fromEntries(Object.entries(found.args).map(([k, v]) => [k, fieldText(v)])));
    }).catch(e => { if (!gone) setProblem(e.message); });
    return () => { gone = true; };
  }, [runId, stepId]);

  const declared: Record<string, any> = info?.schema?.parameters || {};
  // What it has, then what its method takes besides (left at their defaults until typed into).
  const names = useMemo(() => info ? Array.from(new Set([...Object.keys(info.args), ...Object.keys(declared)])) : [],
    [info]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Every later run" only reaches arguments a later sample does not take from its own column;
  // when every argument does, there is nothing for it to change and it is not offered.
  const repeats = !!info && (info.later > 0 || info.later_trials) && names.some(n => !info.columns[n]);
  const changes = () => changedArguments(texts, info!.args, declared);

  const save = async (then?: 'retry') => {
    const args = changes();
    if (!Object.keys(args).length) { setProblem('Nothing is changed yet.'); return; }
    setBusy(true);
    setProblem(null);
    try {
      const done = await saveStepEdit(runId, stepId, args, repeats ? scope : 'step', then);
      onDone(done.retried);
    } catch (e: any) {
      setProblem(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!info) {
    return problem
      ? <p className="text-sm text-red-600 dark:text-red-400">{problem}</p>
      : <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the step...</p>;
  }
  if (!info.editable) return <p className="text-sm text-gray-600 dark:text-gray-300">{info.reason}</p>;

  const fromColumns = names.filter(n => info.columns[n]);
  const rowsHref = liveEditHref(run);
  const field = 'w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 font-mono text-sm text-gray-900 outline-none focus:border-accent dark:border-white/10 dark:bg-black/40 dark:text-gray-100';
  const button = 'flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50';

  return (
    <div className="space-y-3">
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {names.length === 0 && <p className="text-sm text-gray-500">This step takes no arguments.</p>}
        {names.map(name => {
          const decl = declared[name] || {};
          const options: any[] | null = Array.isArray(decl.options) ? decl.options
            : String(decl.type || '').toLowerCase() === 'bool' ? ['True', 'False'] : null;
          const value = texts[name] ?? '';
          const changed = value !== fieldText(info.args[name]) && !(value === '' && info.args[name] === undefined);
          return (
            <label key={name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-2">
              <span className="min-w-0">
                <span className={`block truncate font-mono text-xs ${changed ? 'font-bold text-accent-fg' : 'text-gray-700 dark:text-gray-300'}`} title={name}>{name}</span>
                <span className="block truncate text-[10px] text-gray-400">
                  {[decl.type, decl.unit, info.columns[name] ? `from column ${info.columns[name]}` : '', info.edited.includes(name) ? 'changed during the run' : ''].filter(Boolean).join(' · ')}
                </span>
              </span>
              {options && !value.startsWith('#') ? (
                <select value={value} onChange={e => setTexts(t => ({ ...t, [name]: e.target.value }))} className={field}>
                  {value === '' && <option value="">{decl.default !== undefined ? `default: ${fieldText(decl.default)}` : 'choose'}</option>}
                  {!options.map(String).includes(value) && value !== '' && <option value={value}>{value}</option>}
                  {options.map(o => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
                </select>
              ) : (
                <input value={value} onChange={e => setTexts(t => ({ ...t, [name]: e.target.value }))}
                  placeholder={decl.default !== undefined ? `default: ${fieldText(decl.default)}` : decl.required ? 'required' : ''}
                  spellCheck={false} className={field} />
              )}
            </label>
          );
        })}
      </div>

      {repeats && (
        <fieldset className="space-y-1.5 rounded-lg border border-gray-200 p-2.5 text-sm dark:border-white/10">
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1 accent-accent" checked={scope === 'later'} onChange={() => setScope('later')} />
            <span>
              This step and every later run of it
              <span className="block text-xs text-gray-500 dark:text-gray-400">
                {info.later_trials ? 'In the trials still to come as well.' : `On the ${info.later} later sample${info.later === 1 ? '' : 's'} as well.`}
                {fromColumns.length > 0 && ` Later samples keep their own ${fromColumns.map(n => info.columns[n]).join(', ')}.`}
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" className="mt-1 accent-accent" checked={scope === 'step'} onChange={() => setScope('step')} />
            <span>This step only</span>
          </label>
        </fieldset>
      )}
      {fromColumns.length > 0 && rowsHref && (
        <a href={withBase(rowsHref)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent-fg hover:underline">
          <Table2 className="h-3.5 w-3.5" /> Change {fromColumns.map(n => info.columns[n]).join(', ')} for the samples still to come
        </a>
      )}

      {problem && <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{problem}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className={`${button} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10`}>{cancelLabel}</button>
        <button type="button" onClick={() => save()} disabled={busy}
          title={retry ? 'Keep the change; the step still waits for retry, skip or stop' : 'Keep the change'}
          className={`${button} border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10`}>
          <Save className="h-4 w-4" /> Save
        </button>
        {retry && (
          <button type="button" onClick={() => save('retry')} disabled={busy} className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}>
            <RefreshCcw className="h-4 w-4" /> Save and retry
          </button>
        )}
      </div>
    </div>
  );
}
