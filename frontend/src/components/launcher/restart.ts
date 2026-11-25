import { confirmDialog } from '@ivoryos/shared-ui';
import type { DesktopApi, Profile } from '@/desktop';

const PENDING_WORDS: Record<string, string> = {
  deck: 'its instruments or plugins', script: 'its script', packages: 'installed packages', settings: 'its settings', cloud: 'the Cloud address',
};

/** What a running profile has not applied yet, in words, for the header's "Not applied yet" note. */
export function notAppliedTitle(profile: Pick<Profile, 'name' | 'status'>): string {
  const what = (profile.status.pending || []).map(kind => PENDING_WORDS[kind] || kind);
  return `Changed since ${profile.name} started: ${what.join(', ') || 'its setup'}. It goes on running what it started with until you restart it. Nothing restarts it for you.`;
}

/**
 * Restarting a deck ends whatever it is running, where it is. Every Restart in the launcher asks
 * here first, and none is pressed for the person: an edit, an install or a saved setting only
 * marks a running deck as not having applied it (status.needsRestart). With a run under way it
 * takes a second, deliberate yes.
 */
export async function okToRestart(api: DesktopApi, profile: { id: string; name: string }): Promise<boolean> {
  // The app knows the run from the deck's queue socket; if it cannot say, the click stands.
  const active = await api.activeRun(profile.id).catch(() => null);
  if (!active) return true;
  return confirmDialog(
    `${active.name ? `"${active.name}"` : 'A run'} is under way on ${profile.name}. Restarting ends it where it is: the rest of its steps, and its cleanup, do not run.`,
    { title: 'A run is under way', confirmLabel: 'Restart anyway', tone: 'danger' },
  );
}
