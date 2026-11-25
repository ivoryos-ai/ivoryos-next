"use client";
import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { notify } from '@ivoryos/shared-ui';
import type { DesktopApi, Profile } from '@/desktop';
import { Button, cardClass } from './ui';

/** One module-level object of a script, as the running edge sorted it (edge script_objects.py). */
type ScriptObject = {
  name: string;
  /** Its class, `module.Qualname`. */
  type: string;
  /** On the deck in the process running now. */
  instrument: boolean;
  /** Why the edge's rules leave it off ("DataFrame, from pandas"), or null when they put it on. */
  why: string | null;
  /** What decided: the rules, the script's own exclude_names / include_names, or this app. */
  by: 'rule' | 'script' | 'launcher';
};

// What the running edge said: its objects; an edge too old to say; or a script that names its
// instruments itself (run(instruments=...)), which has no objects to choose among.
type Known = { kind: 'list'; objects: ScriptObject[] } | { kind: 'old' } | { kind: 'none' };

const muted = 'text-xs text-gray-500 dark:text-gray-400 truncate';
const later = 'text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 whitespace-nowrap';

/**
 * Which of a script's objects are instruments, with a switch for each (GitHub issue 88). The
 * edge's rules decide by default (data, plots, web objects, Python's own objects and objects with
 * nothing to call are left out); a switch here overrides them for this profile, saved and applied
 * at the next start, as a deck's switches are. Leaving an object off only keeps it off the deck:
 * the script still builds it. What the script itself says (exclude_names, include_names) wins and
 * is not offered.
 */
export default function ScriptObjects({ api, profile }: { api: DesktopApi; profile: Profile }) {
  const url = profile.status.state === 'running' ? profile.status.url : null;
  const [known, setKnown] = useState<Known | null>(null);
  const [showLeftOut, setShowLeftOut] = useState(false);
  const choices = profile.instrumentChoices || {};

  useEffect(() => {
    setKnown(null);
    if (!url) return;
    let cancelled = false;
    fetch(`${url}/api/status`).then(r => r.json()).then(s => {
      if (cancelled) return;
      if (!('script_objects' in s)) setKnown({ kind: 'old' });
      else if (!Array.isArray(s.script_objects)) setKnown({ kind: 'none' });
      else setKnown({ kind: 'list', objects: s.script_objects });
    }).catch(() => { /* the edge is restarting: the next start fetches again */ });
    return () => { cancelled = true; };
  }, [url]);

  const choose = async (name: string, choice: boolean | null) => {
    try { await api.setInstrumentChoice(profile.id, name, choice); }
    catch (e: any) { await notify(e.message, { title: 'Could not change the script’s instruments', tone: 'error' }); }
  };

  // Stopped: only what was switched here is known, kept so it can be undone.
  if (!url) {
    const names = Object.keys(choices);
    if (names.length === 0) return null;
    return (
      <Card title="Instruments">
        {names.map(name => (
          <li key={name} className="px-4 py-2.5 flex items-center gap-3">
            <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{name}</span>
            <span className={`${muted} flex-1`}>{choices[name] ? 'switched on here' : 'switched off here'}</span>
            <Button small tone="ghost" title="Forget this choice: the rules decide again" onClick={() => choose(name, null)}><X className="w-3.5 h-3.5" /></Button>
          </li>
        ))}
        <li className={`px-4 py-2.5 ${muted}`}>Start the script to see all its objects.</li>
      </Card>
    );
  }
  if (!known || known.kind === 'none') return null;
  if (known.kind === 'old') {
    return <p className={muted}>The IvoryOS this script runs is older than the app and does not list the objects it left out.</p>;
  }

  const row = (o: ScriptObject) => {
    const fixed = o.by === 'script';
    const ruleOn = o.why === null;
    const on = fixed ? o.instrument : (choices[o.name] ?? ruleOn);
    // A class the script defines itself is `__main__.Pump`: the module says nothing there.
    const type = o.type.replace(/^__main__\./, '');
    const detail = fixed ? 'set in the script' : on ? type : (o.why ?? 'switched off here');
    return (
      <li key={o.name} className={`px-4 py-2.5 flex items-center gap-3 ${on ? '' : 'opacity-60'}`}>
        <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{o.name}</span>
        <span className={`${muted} flex-1 min-w-0`} title={o.why && on ? `On the deck although: ${o.why}` : type}>{detail}</span>
        {on !== o.instrument && <span className={later}>{on ? 'loads at restart' : 'still loaded until restart'}</span>}
        <label
          className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${fixed ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          title={fixed ? 'The script decides this one (exclude_names or include_names).' : 'Off keeps it off the deck. The script still builds it.'}
        >
          <input
            type="checkbox" checked={on} disabled={fixed} className="accent-accent"
            // Back to what the rules say forgets the choice, so a later rule change still applies.
            onChange={e => choose(o.name, e.target.checked === ruleOn ? null : e.target.checked)}
          />
          on
        </label>
      </li>
    );
  };

  // Grouped by what the running deck has, so a row stays where it is until the restart.
  const onDeck = known.objects.filter(o => o.instrument);
  const leftOut = known.objects.filter(o => !o.instrument);
  return (
    <Card title="Instruments">
      {onDeck.length === 0 && <li className={`px-4 py-2.5 ${muted}`}>None of the script’s objects is an instrument.</li>}
      {onDeck.map(row)}
      {leftOut.length > 0 && (
        <li>
          <button type="button" onClick={() => setShowLeftOut(v => !v)} className="w-full px-4 py-2 flex items-center gap-1.5 text-left text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            {showLeftOut ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span className="truncate">{leftOut.length} left out{showLeftOut ? '' : `: ${leftOut.map(o => o.name).join(', ')}`}</span>
          </button>
          {showLeftOut && <ul className="divide-y divide-gray-100 dark:divide-white/5 border-t border-gray-100 dark:border-white/5">{leftOut.map(row)}</ul>}
        </li>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={`${cardClass} overflow-hidden`}>
      <h3 className="px-4 pt-3 pb-1 text-sm font-semibold">{title}</h3>
      <ul className="divide-y divide-gray-100 dark:divide-white/5">{children}</ul>
    </div>
  );
}
