"use client";

/**
 * How far controls pinned to the right edge of the window (the queue chip and run card,
 * GlobalQueueBar) move left, as `--ivoryos-dock-right` on <html>. More than one thing can sit at
 * that edge (the assistant panel, a plugin docked beside the page), so each reports its own width
 * under a key and the widest wins; a panel that closes reports null and the others still count.
 */
const widths = new Map<string, number>();

export function setDockRight(key: string, px: number | null) {
  if (px == null || px <= 0) widths.delete(key); else widths.set(key, px);
  const root = document.documentElement;
  const widest = Math.max(0, ...widths.values());
  if (widest > 0) root.style.setProperty('--ivoryos-dock-right', `${widest}px`);
  else root.style.removeProperty('--ivoryos-dock-right');
}
