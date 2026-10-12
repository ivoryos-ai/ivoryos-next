"use client";

import { useState } from 'react';
import { notify, promptDialog } from '@ivoryos/shared-ui';

/**
 * "Change budget" on an optimization task running on a device: how many trials it makes in all
 * (api/cloud-workflows/budget). The device never takes fewer than the trials it has begun, and
 * answers in its progress (`edit_result`); a refusal is said here.
 */
export default function BudgetControl({ runId, nodeId, progress }: { runId: string; nodeId: string; progress: any }) {
  const [sent, setSent] = useState<string | null>(null);
  const answer = sent && progress?.edit_result?.id === sent ? progress.edit_result : null;

  const change = async () => {
    const typed = await promptDialog(
      `How many trials should this optimization make in all? It is on trial ${progress.iteration}. Fewer than planned ends it after the trials under way, with its cleanup.`,
      { title: 'Change the budget', defaultValue: String(progress.budget ?? ''), confirmLabel: 'Change' },
    );
    if (typed === null) return;
    try {
      const res = await fetch('/api/cloud-workflows/budget', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, nodeId, budget: Number(typed) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send the change.');
      setSent(data.id);
    } catch (e: any) {
      await notify(e.message, { title: 'The budget was not changed', tone: 'error' });
    }
  };

  return (
    <div className="nodrag mt-1 text-[11px]">
      {sent && !answer ? (
        <span className="text-gray-500 dark:text-gray-400">Budget change sent · waiting for the device…</span>
      ) : (
        <button onClick={change} title="Change how many trials it makes in all" className="font-semibold text-accent-fg hover:underline">
          Change budget
        </button>
      )}
      {answer && !answer.ok && <div className="text-red-500">Not changed: {answer.error}</div>}
    </div>
  );
}
