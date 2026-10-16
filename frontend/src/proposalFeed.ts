"use client";
import { useState } from 'react';
import { API_BASE } from '@/config';
import { useEdgeTopic } from '@/edgeSocket';

/**
 * Agent proposals waiting for a person, as the page's socket reports them (`proposals` in
 * edgeSocket.ts): how many, and a version that changes whenever any is filed, accepted or rejected.
 * The count needs no request at all; a list is fetched from /api/agent/proposals only when the
 * version is new, once however many parts of the page want it. Three parts of every page used to
 * ask for the list every five seconds, which was most of the deck's log.
 */
export function useProposalFeed(enabled = true): { pending: number; version: string | null } {
  const [feed, setFeed] = useState<{ pending: number; version: string | null }>({ pending: 0, version: null });
  useEdgeTopic('proposals', data => setFeed({ pending: Number(data?.pending) || 0, version: data?.version ?? null }), enabled);
  return enabled ? feed : { pending: 0, version: null };
}

let cached: { version: string; list: Promise<any[]> } | null = null;

/** The pending proposals as of `version`; `fresh` asks again even if that version was fetched. */
export function pendingProposals(version: string | null, fresh = false): Promise<any[]> {
  if (!fresh && version && cached?.version === version) return cached.list;
  const list = fetch(`${API_BASE}/api/agent/proposals?status=pending`)
    .then(res => res.json())
    .then(data => (data.proposals || []) as any[]);
  if (version) {
    const entry = { version, list };
    cached = entry;
    // A failed request is not kept: the next ask tries again.
    list.catch(() => { if (cached === entry) cached = null; });
  }
  return list;
}
