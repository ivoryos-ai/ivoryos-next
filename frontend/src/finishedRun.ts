"use client";
import { useCallback, useEffect, useRef } from 'react';
import { parseServerTime } from '@ivoryos/shared-ui';

/** Statuses a run ends in. */
export const FINISHED = ['completed', 'cancelled', 'error'];

/**
 * A finished run stays on screen this long, long enough to see how it ended, then goes. (The run
 * bar used to keep it 15 minutes on purpose; the result is in Data History.)
 */
export const LINGER_MS = 5000;

type EndingRun = { id: number; status: string; end_time?: string | null };

/**
 * One rule for every live view of the run in progress (the run bar, LiveRun, and the floating run
 * card, GlobalQueueBar): a finished run leaves LINGER_MS after it ended, or after this page first
 * saw it finished when it has no end time. A run waiting on a failed step reads "error" but is not
 * over, so it stays until decided.
 *
 * Counted by a timer, `onGone(id)` when it is up: once the last run ends the edge sends nothing
 * more, so waiting for the next message to notice left a finished run looking under way for good.
 * The returned `keep` applies the same rule to a message as it arrives, so a late message carrying
 * the run does not bring it back.
 */
export function useFinishedRunLinger<R extends EndingRun>(
  run: R | null,
  awaiting: number | null,
  onGone: (id: number) => void,
): (next: R | null, waiting: number | null) => R | null {
  const firstSeen = useRef(new Map<number, number>());
  const gone = useRef(onGone);
  useEffect(() => { gone.current = onGone; });

  const goneAt = useCallback((r: EndingRun) => {
    if (!firstSeen.current.has(r.id)) {
      const ended = parseServerTime(r.end_time);
      firstSeen.current.set(r.id, isFinite(ended) ? ended : Date.now());
    }
    return firstSeen.current.get(r.id)! + LINGER_MS;
  }, []);

  const runId = run?.id;
  const endTime = run?.end_time;
  const over = !!run && FINISHED.includes(run.status) && run.id !== awaiting;
  useEffect(() => {
    if (!over || runId === undefined) return;
    const wait = Math.max(0, goneAt({ id: runId, status: 'completed', end_time: endTime }) - Date.now());
    const timer = setTimeout(() => gone.current(runId), wait);
    return () => clearTimeout(timer);
  }, [over, runId, endTime, goneAt]);

  return useCallback((next: R | null, waiting: number | null) => {
    if (!next || !FINISHED.includes(next.status) || next.id === waiting) return next;
    return Date.now() >= goneAt(next) ? null : next;
  }, [goneAt]);
}
