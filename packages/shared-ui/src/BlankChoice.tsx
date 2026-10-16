"use client";

import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { DEFAULT_VALUE, NONE_VALUE, blankChoiceOf, type BlankChoices } from './runConfig';

const shownDefault = (d: any) => (d === null ? 'None' : typeof d === 'string' ? d : JSON.stringify(d));

/**
 * How a "no value on purpose" marker (runConfig.ts `NONE_VALUE` / `DEFAULT_VALUE`) reads: `None`,
 * or `default`, with what the default is when the column's arguments agree on one. Null for a
 * real value.
 */
export function blankLabel(value: unknown, choices?: BlankChoices | null): string | null {
  const blank = blankChoiceOf(value);
  if (blank === 'none') return 'None';
  if (blank === 'default') {
    const defaults = choices?.defaults || [];
    return defaults.length === 1 ? `default (${shownDefault(defaults[0])})` : 'default';
  }
  return null;
}

/**
 * A value field that can also say "no value on purpose", per cell.
 *
 * Holding a marker it shows it as a chip, with × to type a value instead. Empty, it offers the
 * choices the column allows (`blankChoicesFor`) beside the field while it is hovered or focused.
 * They are left out of the tab order so Tab still walks cell to cell; typing `<None>` or
 * `<default>` does the same from the keyboard (and is how a CSV carries them).
 *
 * The wrapper is drawn whenever the column offers a choice, typed value or not: switching between
 * a wrapped and a bare field would remount the input and lose focus mid-word.
 */
export function BlankChoiceField({
  value,
  choices,
  onChange,
  disabled = false,
  className = '',
  wrapperClassName = '',
  children,
}: {
  value: unknown;
  /** What the column allows (`blankChoicesFor`); null allows neither, undefined is not known. */
  choices?: BlankChoices | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Classes for the chip, so it sits where the field would (padding, size, border). */
  className?: string;
  /** Classes for the box around the field when choices are offered (its share of a flex row). */
  wrapperClassName?: string;
  children: React.ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const label = blankLabel(value, choices);

  if (label) {
    const blank = blankChoiceOf(value);
    // Known choices that do not include this one (a CSV can carry a marker anywhere): the run
    // will refuse it, so say so here. Unknown choices (undefined) are not judged.
    const refused = choices !== undefined && !(blank === 'none' ? choices?.none : choices?.default);
    return (
      <div ref={wrapper} className={`flex min-w-0 items-center justify-between gap-1 ${refused ? 'bg-amber-50 dark:bg-amber-900/20' : ''} ${className}`}>
        <span
          className={`truncate italic ${refused ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}
          title={refused
            ? (blank === 'none' ? 'This argument does not take None' : 'This argument has no default')
            : blank === 'none' ? 'Sent as None' : "Left out of the call: the driver's own default applies"}
        >
          {label}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => {
              // The field comes back in the chip's place; put the cursor in it. The chip is gone
              // by then, so its container is found first.
              const host = wrapper.current?.parentElement;
              onChange('');
              requestAnimationFrame(() => host?.querySelector<HTMLElement>('input, select')?.focus());
            }}
            title="Type a value instead"
            aria-label="Type a value instead"
            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  if (!choices || (!choices.none && !choices.default)) return <>{children}</>;
  const empty = value === undefined || value === null || value === '';
  const defaults = choices.defaults || [];
  const pill = 'rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 hover:border-accent-tint hover:bg-accent-soft hover:text-accent-fg dark:border-white/10 dark:bg-[#151515] dark:text-gray-400';
  return (
    <div className={`group/blank relative min-w-0 ${wrapperClassName}`}>
      {children}
      {empty && !disabled && (
        <span className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 gap-1 opacity-0 transition-opacity group-focus-within/blank:pointer-events-auto group-focus-within/blank:opacity-100 group-hover/blank:pointer-events-auto group-hover/blank:opacity-100">
          {choices.default && (
            <button
              type="button"
              tabIndex={-1}
              // Chosen before the field loses focus, so the choice is not lost with it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(DEFAULT_VALUE)}
              title={`Leave it out: the driver's own default applies${defaults.length === 1 ? ` (${shownDefault(defaults[0])})` : ''}`}
              className={pill}
            >
              Default
            </button>
          )}
          {choices.none && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange(NONE_VALUE)}
              title="Send None for this row"
              className={pill}
            >
              None
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** The two choices as `<option>`s, for a field drawn as a select (an enum column). */
export function BlankChoiceOptions({ choices }: { choices?: BlankChoices | null }) {
  if (!choices) return null;
  const defaults = choices.defaults || [];
  return (
    <>
      {choices.default && <option value={DEFAULT_VALUE}>{defaults.length === 1 ? `default (${shownDefault(defaults[0])})` : 'default'}</option>}
      {choices.none && <option value={NONE_VALUE}>None</option>}
    </>
  );
}
