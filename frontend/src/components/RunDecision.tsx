"use client";
import { useEffect, useState } from 'react';
import { AlertOctagon, Bot, Eraser, FastForward, Minimize2, Pencil, RefreshCcw, Square } from 'lucide-react';
import { notify } from '@ivoryos/shared-ui';
import { applyProposal, describeStepFix, dismissProposal, useRunProposals } from '@/runProposals';
import { useEdgeTopic } from '@/edgeSocket';
import { choicesFor, choiceWords, decideFailure, isDecisionMinimized, setDecisionMinimized, type Decision, type PendingDecision } from '@/runControl';
import { EDIT_FAILED_STEP_EVENT } from '@/runEdits';
import StepEditor from './StepEditor';

type Waiting = { run: any; step: any; decision: PendingDecision | null };

const ICONS: Record<Decision, typeof RefreshCcw> = { retry: RefreshCcw, skip: FastForward, cleanup: Eraser, stop: Square };

/**
 * A run waiting for a decision, on whatever page the person is on: a failed step, the optimizer
 * failing to suggest or to record a round, or a trial that gave no result when the run asks
 * about those. The run and the queue pause and wait (queue.py _await_choice), and the edge says
 * which choices apply (`status.decision`). Nothing is retried, skipped or ended on its own, and
 * plain Stop leaves the cleanup out: whether the deck is fit for it is the person's call, which
 * is what "Stop, run cleanup" is for. "Decide later" puts the pop-up away for this decision, on
 * every page until it is answered (isDecisionMinimized); the run stays paused and the run panel
 * and the floating run card keep the same choices.
 * A failed step can be changed before it is retried ("Change and retry", StepEditor): a retry of
 * the same values is usually the same failure. The run bar's Change button opens it here too.
 * A fix an agent proposed for this step (over MCP or the assistant panel) is shown here to apply
 * or dismiss: the agent only proposes it.
 * Mounted by the Sidebar beside the User input prompt, which works the same way.
 */
export default function RunDecision() {
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [later, setLater] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The decision whose failed step is open for changing, if any.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editRequested, setEditRequested] = useState(false);

  useEdgeTopic('queue', data => {
    if (!data.status) return;
    const id = data.status.awaiting_decision ?? null;
    if (id === null) { setWaiting(null); return; }
    const run = data.active_run?.id === id ? data.active_run : (data.runs || []).find((r: any) => r.id === id);
    const decision: PendingDecision | null = data.status.decision ?? null;
    const step = decision && decision.kind !== 'step' ? null : (run?.steps || []).find((s: any) => s.status === 'error');
    setWaiting(run ? { run, step, decision } : null);
  });
  useEffect(() => {
    // The run bar's Change: bring the pop-up back, open on the step.
    const openEditor = () => setEditRequested(true);
    window.addEventListener(EDIT_FAILED_STEP_EVENT, openEditor);
    return () => window.removeEventListener(EDIT_FAILED_STEP_EVENT, openEditor);
  }, []);

  const key = waiting ? waiting.decision?.key ?? `${waiting.run.id}:${waiting.step?.id ?? ''}` : '';
  const [suggested, recheck] = useRunProposals(waiting?.step ? waiting.run.id : null);
  useEffect(() => {
    if (!editRequested || !key) return;
    setEditRequested(false);
    setLater(null);
    setDecisionMinimized('');
    setEditingKey(key);
  }, [editRequested, key]);
  // Read while rendering on purpose: nothing renders until a decision arrives over the socket,
  // so the first (hydrated) render never depends on storage.
  if (!waiting || later === key || isDecisionMinimized(key)) return null;
  const putAside = () => { setDecisionMinimized(key); setLater(key); };

  const decide = async (action: Decision) => {
    setBusy(true);
    await decideFailure(waiting.run.id, action);
    setBusy(false);
  };
  const kind = waiting.decision?.kind ?? 'step';
  const choices = choicesFor(waiting.decision, waiting.run.id);
  const error = String(waiting.step?.error || waiting.decision?.error || 'The step failed.');
  const headline = error.split('\n')[0];
  const button = 'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50';
  const look: Record<Decision, string> = {
    retry: 'bg-accent text-on-accent hover:bg-accent-hover',
    skip: 'border border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-white/10 dark:bg-white/5 dark:text-gray-200 dark:hover:bg-white/10',
    cleanup: 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/20',
    stop: 'bg-red-600 text-white hover:bg-red-700',
  };
  const columns = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[choices.length] || 'grid-cols-2';
  const canChange = kind === 'step' && !!waiting.step && choices.includes('retry');
  const changing = canChange && editingKey === key;
  const fixes = canChange ? suggested.filter(p => p.kind === 'step_edit' && p.payload?.step_id === waiting.step.id) : [];
  const settle = async (act: () => Promise<any>, failed: string) => {
    setBusy(true);
    try { await act(); } catch (e: any) { await notify(e.message, { title: failed, tone: 'error' }); }
    setBusy(false);
    recheck();
  };

  return (
    // Above the floating run card (GlobalQueueBar, z-9999) and the queue drawer (z-10000), which
    // otherwise covered its buttons; below the shared dialogs (z-10100), so an error still shows.
    // Dimmed but not blurred: the page behind (the run's steps, the workflow) stays readable.
    <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/25 p-4">
      <div role="alertdialog" aria-labelledby="run-decision-title" className="w-full max-w-xl bg-white dark:bg-[#1a1a1a] border border-red-200 dark:border-red-500/30 rounded-2xl shadow-2xl p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center shrink-0">
            <AlertOctagon className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="run-decision-title" className="text-sm font-bold text-gray-900 dark:text-gray-100">{waiting.decision?.title || 'A step failed'}</h2>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">The run and the queue are paused until you decide.</p>
          </div>
          <button onClick={putAside} title="Decide later: the run stays paused; the run panel has the same choices"
            className="shrink-0 p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-white/10">
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
        <div className="mb-1 text-xs text-gray-500 dark:text-gray-400 truncate" title={waiting.run.name}>{waiting.run.name}</div>
        {/* Method names have no spaces to break at; let them break anywhere rather than run off. */}
        {waiting.step && <div className="mb-3 font-mono text-[13px] text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">{waiting.step.instrument}.{waiting.step.method}</div>}
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-sm leading-snug text-red-700 dark:text-red-300 whitespace-pre-wrap [overflow-wrap:anywhere]">{headline}</p>
          {error.includes('\n') && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-red-700/80 dark:text-red-300/80">Details</summary>
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-white/70 dark:bg-black/40 p-2 font-mono text-[11px] text-gray-700 dark:text-gray-300 whitespace-pre-wrap [overflow-wrap:anywhere]">{error}</pre>
            </details>
          )}
        </div>
        {changing ? (
          <StepEditor runId={waiting.run.id} stepId={waiting.step.id} run={waiting.run} retry
            onDone={() => setEditingKey(null)} onCancel={() => setEditingKey(null)} />
        ) : (
          <>
            {fixes.map(p => (
              <div key={p.id} className="mb-3 rounded-lg border border-accent-tint bg-accent-soft p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-accent-fg"><Bot className="w-3.5 h-3.5" /> Suggested by {p.source || 'the assistant'}</div>
                <p className="mt-1 font-mono text-[12px] text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">
                  {describeStepFix(p.payload)}{p.payload?.scope === 'later' ? ', and for every later run of it' : ''}
                </p>
                {p.summary && <p className="mt-1 text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{p.summary}</p>}
                <div className="mt-2 flex gap-2">
                  <button disabled={busy} onClick={() => settle(() => applyProposal(p.id), 'The suggestion was not applied')}
                    className={`${button} bg-accent text-on-accent hover:bg-accent-hover`}>
                    {p.payload?.then === 'retry' ? <><RefreshCcw className="w-4 h-4" /> Apply and retry</> : 'Apply'}
                  </button>
                  <button disabled={busy} onClick={() => settle(() => dismissProposal(p.id), 'Could not dismiss it')}
                    className={`${button} text-gray-600 hover:bg-white/60 dark:text-gray-300 dark:hover:bg-white/10`}>Dismiss</button>
                </div>
              </div>
            ))}
            {canChange && (
              <button onClick={() => setEditingKey(key)} disabled={busy}
                title="Change this step's values, for it alone or for every later run of it too, then retry"
                className={`${button} mb-2 w-full border border-accent-tint bg-accent-soft text-accent-fg hover:bg-accent-tint/30`}>
                <Pencil className="w-4 h-4 shrink-0" /> Change values and retry
              </button>
            )}
            <div className={`grid ${columns} gap-2`}>
              {choices.map(choice => {
                const [label, title] = choiceWords(kind, choice);
                const Icon = ICONS[choice];
                return (
                  <button key={choice} disabled={busy} onClick={() => decide(choice)} title={title} className={`${button} ${look[choice]}`}>
                    <Icon className="w-4 h-4 shrink-0" /> {label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
