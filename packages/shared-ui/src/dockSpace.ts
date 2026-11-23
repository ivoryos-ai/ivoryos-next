import type { CSSProperties } from 'react';

/**
 * Room kept at the right edge of the window for a panel docked there: a plugin shown beside the
 * page, or the assistant. The edge app publishes its width as `--ivoryos-dock-right` on <html>
 * (frontend/src/dockRight.ts); Cloud docks nothing there, so the fallback is 0.
 *
 * A drawer on the right edge or a centred dialog below the dock's z-index (a docked plugin is
 * z-[140]) has to keep out of that room, or the dock covers it (issue 77: the Python drawer
 * opened under a docked plugin with its Close exactly under the plugin's, and the Preview dialog
 * was centred on the whole window, its right part hidden).
 */
export const DOCK_RIGHT = 'var(--ivoryos-dock-right, 0px)';

/** For a full-window overlay (`fixed inset-0`): ends where the dock begins, so what it centres is centred in what is left. */
export const besideDock: CSSProperties = { right: DOCK_RIGHT };

/** For a drawer on the right edge: opens to the left of the dock, and never wider than the window left of it. */
export function drawerBesideDock(maxWidth: string): CSSProperties {
  return { right: DOCK_RIGHT, maxWidth: `min(${maxWidth}, calc(100vw - ${DOCK_RIGHT}))` };
}
