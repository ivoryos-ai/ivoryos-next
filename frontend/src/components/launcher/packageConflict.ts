import { chooseDialog, notify } from '@ivoryos/shared-ui';
import type { DesktopApi, PackageConflict } from '@/desktop';

/**
 * A deck's packages that cannot be installed (desktop/src/packageConflicts.js), with what can be
 * done about it. Only a conflict with another deck's packages ('shared') is fixed by the deck
 * having its own Python; for every kind, Copy puts a brief written for an AI coding agent on the
 * clipboard (more than the dialog shows: every deck's list, file paths, the rules for trying fixes).
 *
 * `own` gives the deck its own Python and tries again; it is offered only when given and only for
 * a 'shared' conflict. Resolves true when it ran, false otherwise.
 */
export async function packageConflictDialog(
  api: DesktopApi,
  conflict: PackageConflict,
  { own }: { own?: () => Promise<unknown> } = {},
): Promise<boolean> {
  const offerOwn = conflict.kind === 'shared' && !!own;
  const next = {
    shared: offerOwn ? 'It can have its own Python instead, beside the shared one.' : '',
    deck: 'One Python holds one version of each package, so these cannot be on one deck.',
    edge: 'IvoryOS itself needs other versions of these.',
  }[conflict.kind];
  const choice = await chooseDialog({
    title: conflict.title,
    message: [conflict.explanation, next].filter(Boolean).join('\n\n'),
    tone: 'error',
    actions: [
      { id: 'agent', label: 'Copy' },
      ...(offerOwn
        ? [{ id: 'cancel', label: 'Cancel', kind: 'cancel' as const }, { id: 'own', label: 'Give it its own Python', kind: 'primary' as const }]
        : [{ id: 'cancel', label: 'Close', kind: 'primary' as const }]),
    ],
  });
  if (choice === 'agent') {
    await api.copy(conflict.brief);
    await notify('The problem, every deck’s packages and how to try fixes safely, written for an AI coding agent. Paste it into Claude Code or another agent on this computer; if it changes the deck’s packages, Start installs them, checked the same way.', { title: 'Copied' });
    return false;
  }
  if (choice === 'own' && own) {
    await own();
    return true;
  }
  return false;
}
