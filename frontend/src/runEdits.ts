"use client";
import { API_BASE } from '@/config';
import { notify, promptDialog } from '@ivoryos/shared-ui';

/**
 * Changing a run while it runs, from the bench: one step's arguments before it is retried (or
 * before it runs), and, through the Iterate page (queuedEdit.ts), the samples still to come.
 * The rules are the edge's (run_edits.py); this only asks and says what it answered.
 */

export type StepEditScope = 'step' | 'later';

/** What the edge says about one step of a run as it can be changed (GET .../steps/{id}). */
export type StepEditInfo = {
  run_id: number;
  step: any;
  editable: boolean;
  reason: string | null;
  /** Its arguments as they stand. */
  args: Record<string, any>;
  /** `{argument: column}`: the arguments it takes from a table column (or the optimizer). */
  columns: Record<string, string>;
  /** Arguments already changed during the run. */
  edited: string[];
  /** How many later runs of the same step are still to come (later samples). */
  later: number;
  /** The same step in optimization trials not made yet. */
  later_trials: boolean;
  /** Its method's schema (parameters, types, choices), or null for a built-in step. */
  schema: any | null;
};

async function answer(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export async function loadStepEdit(runId: number, stepId: number): Promise<StepEditInfo> {
  return answer(await fetch(`${API_BASE}/api/queue/runs/${runId}/steps/${stepId}`));
}

/** Change a step's arguments; with `then: 'retry'`, a failed step is retried once they are in. */
export async function saveStepEdit(runId: number, stepId: number, args: Record<string, any>,
  scope: StepEditScope, then?: 'retry'): Promise<{ changed: Record<string, [any, any]>; later: number; retried: boolean }> {
  return answer(await fetch(`${API_BASE}/api/queue/runs/${runId}/steps/${stepId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args, scope, ...(then ? { then } : {}), by: 'bench' }),
  }));
}

/**
 * Change how many trials an optimization under way makes in all. Asks for the number (never fewer
 * than the trials it has begun, `trials_begun` on the run) and says what the edge answered.
 * Resolves true when it changed.
 */
export async function askBudget(run: any): Promise<boolean> {
  const begun = Number(run?.trials_begun) || 0;
  const typed = await promptDialog(
    `How many trials should this optimization make in all? ${begun} ${begun === 1 ? 'has' : 'have'} begun, so at least ${Math.max(1, begun)}. Fewer than planned ends it after the trials under way, with its cleanup.`,
    { title: 'Change the budget', defaultValue: String(run?.parameters?.budget ?? ''), confirmLabel: 'Change' },
  );
  if (typed === null) return false;
  try {
    await answer(await fetch(`${API_BASE}/api/queue/runs/${run.id}/budget`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budget: Number(typed), by: 'bench' }),
    }));
    return true;
  } catch (e: any) {
    await notify(e.message, { title: 'The budget was not changed', tone: 'error' });
    return false;
  }
}

/**
 * Open the failure pop-up's editor for the step it is about (RunDecision listens), from anywhere:
 * the run bar's Change button, or after the pop-up was put aside.
 */
export const EDIT_FAILED_STEP_EVENT = 'ivoryos:edit-failed-step';

export function openFailedStepEditor() {
  window.dispatchEvent(new CustomEvent(EDIT_FAILED_STEP_EVENT));
}
