"use client";
import { useState } from 'react';
import { useEdgeTopic } from '@/edgeSocket';

/** Statuses of a run that is queued or under way, so a new one would wait behind it. */
const BUSY = new Set(['pending', 'running', 'paused', 'pausing', 'cancelling', 'waiting_input']);

/**
 * Whether a run started now would wait in the queue: anything queued or under way, including a
 * run waiting at a User input. One check for every page that starts a run (Designer, Once and
 * Iterate, Optimize), which each ask "Add to queue?" when it is true. The Optimize page had none,
 * and the copies on the others missed a run waiting for input.
 */
export function useQueueBusy(): boolean {
  const [busy, setBusy] = useState(false);
  // The current queue as soon as this listens, then every change.
  useEdgeTopic('queue', data => {
    if (Array.isArray(data.runs)) setBusy(data.runs.some((r: any) => BUSY.has(r.status)));
  });
  return busy;
}
