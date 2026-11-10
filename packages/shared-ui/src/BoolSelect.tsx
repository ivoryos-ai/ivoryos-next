"use client";

import React from 'react';
import { NONE_VALUE, blankChoiceOf } from './runConfig';
import { asBool, valueText } from './paramTypes';

const TRUE = 'True';
const FALSE = 'False';
const NONE = 'None';
const VARIABLE = '#';

/**
 * A bool argument, picked from True, False and None. What is kept is a JSON `true` / `false`, or
 * the `<None>` marker (runConfig.ts NONE_VALUE) that sends None whatever the type, so every page
 * gives the edge the same value for the same choice. Shown as Python writes it, as the dropdown
 * offers it.
 *
 * A bool is not a field with choices: the schema's `options` (True, False) only say what to offer,
 * and nothing matches a value against them as text (paramTypes.ts `choiceProblem`).
 *
 * Nothing picked is a blank: the driver's default, or None for an Optional with no default (the
 * edge's rule, `cast_arguments`). `onVariable`, when given, adds "#variable" for a value from the
 * table, the optimizer or an earlier step; the caller then draws a text field for the `#name`.
 * Text that is none of these (an old workflow's `yes`) is shown as it is, for the step's warning.
 */
export function BoolSelect({
  id,
  value,
  defaultValue,
  required = false,
  onChange,
  onVariable,
  className = '',
  title,
}: {
  id?: string;
  value: unknown;
  /** The parameter's default; undefined when it has none. */
  defaultValue?: unknown;
  required?: boolean;
  /** `true`, `false`, the `<None>` marker, or '' for nothing picked. */
  onChange: (value: boolean | string) => void;
  onVariable?: () => void;
  className?: string;
  title?: string;
}) {
  const parsed = asBool(value);
  const selected = parsed === true ? TRUE
    : parsed === false ? FALSE
      : value === null || blankChoiceOf(value) === 'none' ? NONE
        : value === undefined || value === '' ? ''
          : String(value);
  const known = selected === '' || selected === TRUE || selected === FALSE || selected === NONE;
  const hasDefault = defaultValue !== undefined;
  const blank = hasDefault
    ? `default (${defaultValue === null ? NONE : valueText(defaultValue)})`
    : required ? 'choose…' : `default (${NONE})`;

  return (
    <select
      id={id}
      value={selected}
      title={title}
      onChange={(e) => {
        const v = e.target.value;
        if (v === VARIABLE) onVariable?.();
        else if (v === TRUE) onChange(true);
        else if (v === FALSE) onChange(false);
        else if (v === NONE) onChange(NONE_VALUE);
        else if (v === '') onChange('');
      }}
      className={`cursor-pointer ${className}`}
    >
      <option value="" disabled={required && !hasDefault}>{blank}</option>
      <option value={TRUE}>{TRUE}</option>
      <option value={FALSE}>{FALSE}</option>
      <option value={NONE}>{NONE}</option>
      {!known && <option value={selected}>{selected}</option>}
      {onVariable && <option value={VARIABLE}>#variable…</option>}
    </select>
  );
}
