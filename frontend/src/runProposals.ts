"use client";
import { useEffect, useState } from 'react';
import { API_BASE } from '@/config';

/**
 * Changes an agent proposed to a run under way (the edge's agent routes, propose-step-fix and
 * propose-samples): new values for a step, or different samples still to come. Shown where the
 * person already is, the failure pop-up and the run bar, rather than only in the Designer's
 * assistant panel; nothing changes until they apply one.
 */

export type RunProposal = {
  id: number;
  kind: 'step_edit' | 'run_rows';
  name: string;
  summary: string;
  source: string;
  payload: any;
};

const POLL_MS = 5000;

/** The pending proposals about this run, polled while `runId` is set. */
export function useRunProposals(runId: number | null): [RunProposal[], () => void] {
  const [found, setFound] = useState<RunProposal[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (runId === null) { setFound([]); return; }
    let gone = false;
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/agent/proposals?status=pending`);
        const data = await res.json();
        if (gone) return;
        setFound((data.proposals || []).filter((p: any) =>
          (p.kind === 'step_edit' || p.kind === 'run_rows') && p.payload?.run_id === runId));
      } catch { /* the assistant is optional; a run goes on without it */ }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => { gone = true; clearInterval(timer); };
  }, [runId, tick]);
  return [found, () => setTick(t => t + 1)];
}

async function answer(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** Apply a proposed step fix (and retry, when it was proposed with one). */
export async function applyProposal(id: number): Promise<any> {
  return answer(await fetch(`${API_BASE}/api/agent/proposals/${id}/accept`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  }));
}

export async function dismissProposal(id: number, note?: string): Promise<void> {
  await answer(await fetch(`${API_BASE}/api/agent/proposals/${id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(note ? { note } : {}),
  }));
}

/** Where proposed samples are reviewed and saved: the run's table on the Iterate page. */
export function reviewSamplesHref(proposal: RunProposal): string {
  return `/execution?edit=${proposal.payload.run_id}&proposal=${proposal.id}`;
}

/** "volume 50 → 5" for each argument a step fix changes. */
export function describeStepFix(payload: any): string {
  const show = (v: any) => (v === undefined ? 'default' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return Object.entries(payload?.args || {})
    .map(([name, value]) => `${name} ${show(payload?.before?.[name])} → ${show(value)}`)
    .join(', ');
}
