"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { SuggestInput } from './SuggestInput';
import { choiceSuggestions } from './runConfig';
import { isBoolType } from './paramTypes';
import { cellProblem, cellText, cellValue, readDictText, readDictValue, readPastedRows } from './dictArgs';

/**
 * An argument that takes a dict, written the way the dict reads, `{kp: 1.5, ki: #ki}`, or as JSON
 * to paste (dictArgs.ts says what each means). A spreadsheet cell is no place for a dict and a
 * one-line box no place to write one, so this is where one is written, and a value that should vary
 * is a `#name` in it, which is then a column of its own on the Iterate page, or a search-space entry.
 *
 * It sits on one line among a step's other arguments and wraps only when its entries do: a table
 * of a row per entry took more of a step's card than every other argument together.
 */

export type DictInputProps = {
  id?: string;
  /** The argument's name, as the surrounding form writes it, drawn before the dict. */
  label?: React.ReactNode;
  value: unknown;
  /** The argument's schema entry: `type`, and `key_type` / `value_type` when the driver said. */
  info: any;
  onChange: (next: any) => void;
  /** Offered in a value cell beside the type's own choices, e.g. '#variables' from earlier steps. */
  suggestions?: { value: string; label?: string }[];
  /** The form says itself what is wrong with the value (a Designer step's warnings). */
  quiet?: boolean;
};

type Row = { id: string; key: string; value: string };

let rowSeq = 0;
const newRow = (key = '', value = ''): Row => ({ id: `dict-${++rowSeq}`, key, value });

const rowsOf = (value: unknown, info: any): Row[] => {
  const read = readDictValue(value);
  const rows = read.kind === 'dict'
    ? Object.entries(read.value).map(([k, v]) => newRow(k, cellText(v, info?.value_type)))
    : [];
  return rows.length ? rows : [newRow()];
};

/** JSON on one line, `{"kp": 1.5, "ki": "#ki"}`: what is pasted keeps its own lines. */
const textOf = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ') : String(value);
};

const unchanged = (value: unknown) => JSON.stringify(value ?? null);

/** A cell as wide as what it holds (its placeholder while empty), within limits: the font is monospaced. */
const widthFor = (text: string, placeholder: string, max: number) =>
  ({ width: `calc(${Math.min(max, text ? Math.max(2, text.length) : placeholder.length) + 1}ch + 14px)` });

export function DictInput({ id, label, value, info, onChange, suggestions = [], quiet = false }: DictInputProps) {
  const keyInfo = info?.key_type;
  const valueInfo = info?.value_type;
  const uid = useId();
  const cellId = (rowId: string, part: 'k' | 'v') => `${uid}-${rowId}-${part}`;
  // A cell that is not drawn yet (a new entry) is focused as soon as it is.
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const focusCell = (elementId: string) => {
    const el = document.getElementById(elementId);
    if (el) el.focus(); else pendingFocus.current = elementId;
  };
  const focus = (rowId: string, part: 'k' | 'v') => focusCell(cellId(rowId, part));
  // A row exists before it has a key, and JSON being typed is not a dict yet, so both are held here
  // and only what they mean goes to the step (as in ExtraArguments).
  const [rows, setRows] = useState<Row[]>(() => rowsOf(value, info));
  const [text, setText] = useState(() => textOf(value));
  const [mode, setMode] = useState<'table' | 'json'>(() => {
    const read = readDictValue(value);
    return read.kind === 'dict' || read.kind === 'blank' ? 'table' : 'json';
  });
  // An optional dict with nothing in it reads `None` until Add, as an optional object does.
  const [adding, setAdding] = useState(false);
  // The value last sent, to tell the step changing under this (undo, a load) from our own echo.
  const sent = useRef(unchanged(value));
  useEffect(() => {
    if (unchanged(value) === sent.current) return;
    sent.current = unchanged(value);
    setRows(rowsOf(value, info));
    setText(textOf(value));
  }, [value, info]);

  const send = (next: any) => {
    sent.current = unchanged(next);
    onChange(next);
  };

  const changeRows = (next: Row[]) => {
    setRows(next);
    const out: Record<string, any> = {};
    for (const row of next) {
      const key = row.key.trim();
      if (key) out[key] = cellValue(row.value, valueInfo);
    }
    // No entries is no value: the driver's default, None for an Optional, or missing if required.
    send(Object.keys(out).length ? out : '');
  };

  const changeText = (next: string) => {
    setText(next);
    const read = readDictText(next);
    send(read.kind === 'dict' || read.kind === 'word' ? read.value : read.kind === 'blank' ? '' : next);
  };

  const readText = readDictText(text);
  const canShowTable = mode === 'table' || readText.kind === 'dict' || readText.kind === 'blank';

  const switchTo = (next: 'table' | 'json') => {
    if (next === mode) return;
    if (next === 'json') setText(textOf(sent.current === 'null' ? undefined : JSON.parse(sent.current)));
    else setRows(rowsOf(readText.kind === 'dict' ? readText.value : undefined, info));
    setMode(next);
  };

  const addRow = (after?: string) => {
    const row = newRow();
    const at = after ? rows.findIndex((r) => r.id === after) + 1 : rows.length;
    setRows([...rows.slice(0, at), row, ...rows.slice(at)]);
    focus(row.id, 'k');
  };

  const removeRow = (rowId: string) => {
    const left = rows.filter((r) => r.id !== rowId);
    if (!left.length) setAdding(false);
    changeRows(left.length ? left : [newRow()]);
  };

  // Paste a whole dict, or rows from a spreadsheet, into any cell: it becomes the entries.
  const onPaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text');
    const read = readDictText(pasted);
    if (read.kind === 'dict') {
      e.preventDefault();
      setRows(rowsOf(read.value, info));
      send(read.value);
      return;
    }
    const lines = readPastedRows(pasted);
    if (!lines) return;
    e.preventDefault();
    changeRows([...rows.filter((r) => r.key.trim() || r.value.trim()), ...lines.map((l) => newRow(l.key, l.value))]);
  };

  const keys = rows.map((r) => r.key.trim());
  const empty = mode === 'table' && !keys.some(Boolean) && !rows.some((r) => r.value.trim());
  const showNone = empty && !info?.required && !adding;
  const valueOffers = [
    ...(isBoolType(valueInfo) ? [{ value: 'True' }, { value: 'False' }] : choiceSuggestions(valueInfo)),
    ...suggestions,
  ];
  const cell = 'h-6 rounded-md border bg-white px-1.5 font-mono text-[12px] text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-accent dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-600';
  const fine = 'border-gray-200 dark:border-white/10';
  const wrong = 'border-red-400 dark:border-red-500/70';
  const mark = 'text-gray-400 dark:text-gray-500';
  const small = 'inline-flex h-5 shrink-0 items-center rounded px-1 font-sans text-[11px] text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-200';

  const modeSwitch = (
    <button
      type="button"
      tabIndex={-1}
      disabled={mode === 'json' && !canShowTable}
      title={mode === 'json'
        ? (canShowTable ? 'Back to entries' : 'Fix the text first: it cannot be read as a dict yet')
        : 'Write it as JSON, or paste a dict'}
      onClick={(e) => { e.stopPropagation(); switchTo(mode === 'json' ? 'table' : 'json'); }}
      className={`${small} ml-1`}
    >
      {mode === 'json' ? 'entries' : 'JSON'}
    </button>
  );

  // JSON as wide as its longest line (within limits) and as tall as it runs.
  const lines = text.split('\n');
  const columns = Math.min(60, Math.max(24, ...lines.map((l) => l.length + 1)));
  const textRows = Math.min(8, lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / columns)), 0));

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-1 font-mono text-[12px]">
      {label}
      {showNone ? (
        <>
          <span className={mark}>None</span>
          <button
            id={id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAdding(true);
              // The first key takes this button's id once it is drawn.
              pendingFocus.current = id || cellId(rows[0].id, 'k');
            }}
            title={`Give it entries${info?.type ? ` (${info.type})` : ''}. Left as None, the driver's default applies.`}
            className="inline-flex h-6 shrink-0 items-center gap-0.5 rounded-md border border-dashed border-gray-300 px-1.5 font-sans text-[11px] text-gray-500 hover:border-accent hover:text-accent-fg dark:border-white/15 dark:text-gray-400 dark:hover:border-accent"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </>
      ) : mode === 'json' ? (
        <textarea
          id={id}
          value={text}
          spellCheck={false}
          rows={textRows}
          style={{ width: `calc(${columns}ch + 14px)` }}
          placeholder={'{"key": 1.5, "other": "#variable"}'}
          title={readText.kind === 'error' ? readText.error : info?.type}
          onChange={(e) => changeText(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className={`max-w-full resize-none rounded-md border bg-white px-1.5 py-[3px] align-middle font-mono text-[12px] leading-[16px] text-gray-900 placeholder:text-gray-300 focus:outline-none focus:border-accent dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-600 ${readText.kind === 'error' ? wrong : fine}`}
        />
      ) : (
        <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-1" onPaste={onPaste} title={info?.type}>
          <span className={mark}>{'{'}</span>
          {rows.map((row, index) => {
            const key = row.key.trim();
            const keyProblem = !key
              ? (row.value.trim() ? 'needs a key' : null)
              : keys.indexOf(key) !== index ? 'is already in this dict: the last one wins' : cellProblem(key, keyInfo);
            const valueProblem = key ? cellProblem(row.value, valueInfo) : null;
            const last = index === rows.length - 1;
            return (
              // A named group: the step card around this is a `group` of its own.
              <span key={row.id} className="group/entry inline-flex items-center">
                <SuggestInput
                  id={index === 0 && id ? id : cellId(row.id, 'k')}
                  type="text"
                  value={row.key}
                  placeholder="key"
                  suggestions={keyInfo ? choiceSuggestions(keyInfo) : []}
                  title={keyProblem ? `This key ${keyProblem}` : undefined}
                  style={widthFor(row.key, 'key', 18)}
                  onChange={(e) => changeRows(rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focus(row.id, 'v'); } }}
                  className={`${cell} ${keyProblem ? wrong : fine}`}
                />
                <span className={`${mark} px-0.5`}>:</span>
                <SuggestInput
                  id={cellId(row.id, 'v')}
                  type="text"
                  value={row.value}
                  placeholder="value"
                  suggestions={valueOffers}
                  title={valueProblem ? `This value ${valueProblem}` : undefined}
                  style={widthFor(row.value, 'value', 24)}
                  onChange={(e) => changeRows(rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r)))}
                  // Enter goes on to the next entry, making one after the last.
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (last) addRow(row.id); else focus(rows[index + 1].id, 'k');
                  }}
                  className={`${cell} ${valueProblem ? wrong : fine} ${row.value.trim().startsWith('#') ? 'font-semibold' : ''}`}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  title="Remove this entry"
                  aria-label="Remove this entry"
                  onClick={(e) => { e.stopPropagation(); removeRow(row.id); }}
                  className="inline-flex h-5 w-4 shrink-0 items-center justify-center rounded text-gray-300 opacity-0 hover:text-red-500 focus:opacity-100 group-hover/entry:opacity-100 group-focus-within/entry:opacity-100 dark:text-gray-600"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          {/* Kept together, so a wrapped dict does not leave its brace or the switch on a line alone. */}
          <span className="inline-flex items-center">
            <button
              type="button"
              title="Add an entry (or press Enter in the last value)"
              aria-label="Add an entry"
              onClick={(e) => { e.stopPropagation(); addRow(); }}
              className={small}
            >
              <Plus className="h-3 w-3" />
            </button>
            <span className={mark}>{'}'}</span>
            {modeSwitch}
          </span>
        </span>
      )}
      {mode === 'json' && modeSwitch}
      {mode === 'json' && readText.kind === 'error' && !quiet && (
        <span className="basis-full font-sans text-[11px] text-red-600 dark:text-red-400">{readText.error}</span>
      )}
      {mode === 'json' && readText.kind === 'word' && text.trim().startsWith('#') && (
        <span className="basis-full font-sans text-[11px] text-gray-400 dark:text-gray-500">The whole dict comes from {text.trim()}.</span>
      )}
    </div>
  );
}
