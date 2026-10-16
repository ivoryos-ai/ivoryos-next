"use client";
import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/config';
import { pendingProposals, useProposalFeed } from '@/proposalFeed';

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

/**
 * The pending proposals about this run, while `runId` is set: read again whenever the page's socket
 * says the proposals changed (proposalFeed.ts), and when `recheck` is called.
 */
export function useRunProposals(runId: number | null): [RunProposal[], () => void] {
  const [found, setFound] = useState<RunProposal[]>([]);
  const [tick, setTick] = useState(0);
  const { version } = useProposalFeed(runId !== null);
  const seenTick = useRef(0);
  useEffect(() => {
    if (runId === null) { setFound([]); return; }
    if (version === null) return;
    let gone = false;
    const fresh = seenTick.current !== tick;
    seenTick.current = tick;
    pendingProposals(version, fresh).then(list => {
      if (!gone) setFound(list.filter((p: any) => (p.kind === 'step_edit' || p.kind === 'run_rows') && p.payload?.run_id === runId));
    }).catch(() => { /* the assistant is optional; a run goes on without it */ });
    return () => { gone = true; };
  }, [runId, version, tick]);
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
