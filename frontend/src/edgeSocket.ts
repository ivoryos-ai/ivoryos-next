"use client";
import { useEffect, useRef } from 'react';
import { WS_BASE } from '@/config';

/**
 * The page's one socket to its edge (`/api/ws`, edge_server/ivoryos_edge/live.py).
 *
 * Every message is `{topic, data}`, and the edge sends every topic's current state as the socket
 * connects. One connection serves every part of the page that listens: each used to open its own
 * `/api/ws/queue` (ten or more at once), none of which reconnected, so a page in a browser stopped
 * updating for good the first time its edge restarted.
 *
 *   queue      the queue status (queue.py global_payload), after every step and queue change
 *   proposals  `{pending, version}` of the agent proposals waiting for a person (proposalFeed.ts)
 *
 * Listen with `useEdgeTopic`. A listener that arrives after a topic's last message is given that
 * message at once, as if it had just connected. The socket reconnects on its own (backing off up
 * to ten seconds), and is kept for a while after the last listener leaves, so moving between pages
 * does not reconnect.
 */
export type EdgeTopic = 'queue' | 'proposals';
type Listener = (data: any) => void;

const RETRY_MS = [500, 1000, 2000, 5000, 10000];
const KEEP_MS = 10_000;

const listeners = new Map<EdgeTopic, Set<Listener>>();
const latest = new Map<EdgeTopic, any>();
let socket: WebSocket | null = null;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let keepTimer: ReturnType<typeof setTimeout> | null = null;

const listening = () => [...listeners.values()].some(set => set.size > 0);

function connect() {
  if (socket || retryTimer || typeof window === 'undefined') return;
  const ws = new WebSocket(`${WS_BASE}/api/ws`);
  socket = ws;
  ws.onopen = () => { failures = 0; };
  ws.onmessage = event => {
    let message: any;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message || typeof message.topic !== 'string') return;
    const topic = message.topic as EdgeTopic;
    latest.set(topic, message.data);
    for (const fn of [...(listeners.get(topic) || [])]) {
      try { fn(message.data); } catch (e) { console.error(e); }
    }
  };
  ws.onclose = () => {
    if (socket !== ws) return; // closed on purpose
    socket = null;
    if (!listening()) return;
    const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures += 1;
    retryTimer = setTimeout(() => { retryTimer = null; if (listening()) connect(); }, wait);
  };
}

function disconnect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  const ws = socket;
  socket = null;
  ws?.close();
  // Reconnecting sends everything again; until then nothing here is current.
  latest.clear();
  failures = 0;
}

/** Call `fn` with each message on `topic`; returns the function that stops it. */
export function subscribeEdge(topic: EdgeTopic, fn: Listener): () => void {
  let set = listeners.get(topic);
  if (!set) listeners.set(topic, (set = new Set()));
  set.add(fn);
  if (keepTimer) { clearTimeout(keepTimer); keepTimer = null; }
  if (latest.has(topic)) {
    const data = latest.get(topic);
    queueMicrotask(() => { if (set!.has(fn)) fn(data); });
  }
  connect();
  return () => {
    set!.delete(fn);
    if (listening() || keepTimer) return;
    keepTimer = setTimeout(() => { keepTimer = null; if (!listening()) disconnect(); }, KEEP_MS);
  };
}

/**
 * Listen to `topic` while `enabled`. `onData` may change on every render; the latest one is
 * called, without resubscribing.
 */
export function useEdgeTopic(topic: EdgeTopic, onData: Listener, enabled = true) {
  const handler = useRef(onData);
  useEffect(() => { handler.current = onData; });
  useEffect(() => {
    if (!enabled) return;
    return subscribeEdge(topic, data => handler.current(data));
  }, [topic, enabled]);
}
