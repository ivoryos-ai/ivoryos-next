/**
 * An argument that takes a dict: `is_mapping` in the schema, with `key_type` and `value_type` when the
 * driver said what they are (`Dict[str, float]`; a bare `dict` says nothing, and values are read as
 * JSON). `DictInput` draws it as a table, or as JSON to paste; this is what both mean.
 *
 * A step holds the dict as an object, so a `#name` as one of its values is a reference like any
 * other: found by the run pages' scans, given a column or a search-space entry of its own, typed by
 * `value_type`, and substituted by the edge. Held as text, as it was, a `#name` inside it was
 * nothing but text. What cannot be read as a dict stays as typed, says why here, and is refused by
 * the edge before anything moves.
 *
 * Pasted text is read as JSON or as a Python literal (`{'a': 1, 'b': True}`, which is how a dict
 * looks in the driver's own code), and a bare `#name` is taken as a value (`{"a": #x}`), since that
 * is what a person means by it.
 */

import { blankChoiceOf, choiceLabels, NONE_VALUE } from './runConfig';
import { isBoolType, isNumericType, isTextType } from './paramTypes';

const isPlainObject = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isWholeReference = (text: string) => /^#\w+$/.test(text.trim());

/** A JSON or Python literal, as a JavaScript value. Throws a sentence saying where it stopped. */
export function parseLiteral(text: string): any {
  let i = 0;
  const fail = (what: string): never => { throw new SyntaxError(`${what} at character ${i + 1}`); };
  const skip = () => { while (i < text.length && /\s/.test(text[i])) i++; };

  const string = (): string => {
    const quote = text[i++];
    let out = '';
    while (i < text.length && text[i] !== quote) {
      if (text[i] !== '\\') { out += text[i++]; continue; }
      const next = text[i + 1];
      i += 2;
      if (next === 'u') { out += String.fromCharCode(parseInt(text.slice(i, i + 4), 16)); i += 4; }
      else out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next;
    }
    if (i >= text.length) fail('A quote is not closed');
    i++;
    return out;
  };

  const word = (): string => {
    const m = /^[#\w.+-]+/.exec(text.slice(i));
    if (!m) return fail(`Unexpected '${text[i] ?? 'end of text'}'`);
    i += m[0].length;
    return m[0];
  };

  const sequence = (close: string): any[] => {
    i++;
    const out: any[] = [];
    for (;;) {
      skip();
      if (text[i] === close) { i++; return out; }
      out.push(value());
      skip();
      if (text[i] === ',') i++;
      else if (text[i] !== close) fail(`Expected ',' or '${close}'`);
    }
  };

  const object = (): Record<string, any> => {
    i++;
    const out: Record<string, any> = {};
    for (;;) {
      skip();
      if (text[i] === '}') { i++; return out; }
      const key = text[i] === '"' || text[i] === "'" ? string() : word();
      skip();
      if (text[i] !== ':') fail("Expected ':' after a key");
      i++;
      out[key] = value();
      skip();
      if (text[i] === ',') i++;
      else if (text[i] !== '}') fail("Expected ',' or '}'");
    }
  };

  function value(): any {
    skip();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return sequence(']');
    if (c === '(') return sequence(')');
    if (c === '"' || c === "'") return string();
    const token = word();
    if (token.startsWith('#')) return token;
    if (/^(true|True)$/.test(token)) return true;
    if (/^(false|False)$/.test(token)) return false;
    if (/^(null|None)$/.test(token)) return null;
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(token)) return Number(token);
    i -= token.length;
    return fail(`'${token}' needs quotes`);
  }

  const out = value();
  skip();
  if (i < text.length) fail('Something follows the value');
  return out;
}

export type DictText =
  | { kind: 'blank' }
  | { kind: 'dict'; value: Record<string, any> }
  /** A whole `#name` (a dict an earlier step saved), or the `<None>` / `<default>` markers. */
  | { kind: 'word'; value: string }
  | { kind: 'error'; error: string };

/** What text typed or pasted for a dict means. */
export function readDictText(text: string): DictText {
  const t = text.trim();
  if (t === '') return { kind: 'blank' };
  if (isWholeReference(t) || blankChoiceOf(t)) return { kind: 'word', value: t };
  if (t === '#') return { kind: 'error', error: "'#' needs a variable name after it" };
  let parsed: any;
  try {
    try { parsed = JSON.parse(t); } catch { parsed = parseLiteral(t); }
  } catch (e: any) {
    return { kind: 'error', error: e.message };
  }
  if (!isPlainObject(parsed)) {
    return { kind: 'error', error: `That is ${Array.isArray(parsed) ? 'a list' : 'a single value'}, not a dict: write {"key": value}` };
  }
  return { kind: 'dict', value: parsed };
}

/** A step's value for a dict argument, read the same way whether it holds an object or text. */
export function readDictValue(value: unknown): DictText {
  if (value === undefined || value === null) return { kind: 'blank' };
  if (isPlainObject(value)) return { kind: 'dict', value };
  return typeof value === 'string' ? readDictText(value) : { kind: 'error', error: `${JSON.stringify(value)} is not a dict` };
}

/** What a declared type leaves to the text: no type, `Any`, a list, a nested dict, an object. */
const readAsLiteral = (info: any): boolean =>
  !choiceLabels(info) && !isNumericType(info) && !isBoolType(info) && !isTextType(info);

/** A value as it is shown in a table cell. `cellValue` of this gives the value back. */
export function cellText(value: any, info: any): string {
  if (value === undefined) return '';
  if (value === null) return NONE_VALUE;
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'string' && readAsLiteral(info) && !isWholeReference(value) && !blankChoiceOf(value)) {
    // Text that would read as something else here keeps its quotes: an untyped "5" is not 5.
    try { if (typeof parseLiteral(value) !== 'string') return JSON.stringify(value); } catch { /* plain text */ }
  }
  return String(value);
}

/**
 * What a typed cell means, by the declared type: a number for a number, True/False for a bool, text
 * as typed for text and for a choice (a workflow stores an Enum member's name), a `#name` or a marker
 * as it is. Anything else (no type, a list, a nested dict) is read as a literal, which is what the
 * same value pasted as JSON would be. What the type cannot take stays as typed, for `cellProblem`
 * and the edge to refuse.
 */
export function cellValue(text: string, info: any): any {
  const t = text.trim();
  if (isWholeReference(t) || blankChoiceOf(t)) return t;
  if (choiceLabels(info)) return t;
  if (isBoolType(info)) return /^true$/i.test(t) ? true : /^false$/i.test(t) ? false : t;
  if (isNumericType(info)) return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
  if (isTextType(info)) return text;
  try { return parseLiteral(t); } catch { return t; }
}

const isWholeType = (info: any) => /^(Optional\[)?int\]?$/.test(String(info?.type || '').trim());

/** Why a typed key or value cannot be its declared type, or null. */
export function cellProblem(text: string, info: any): string | null {
  const t = text.trim();
  if (t === '#') return "needs a variable name after the '#'";
  if (isWholeReference(t) || blankChoiceOf(t)) return null;
  if (t === '') return isTextType(info) ? null : 'needs a value';
  const labels = choiceLabels(info);
  if (labels) {
    const values = (info?.options || []).map(String);
    return labels.includes(t) || values.includes(t) ? null : `is not one of its choices (${labels.join(', ')})`;
  }
  if (isBoolType(info)) return /^(true|false)$/i.test(t) ? null : 'is not True or False';
  if (isNumericType(info)) {
    if (!Number.isFinite(Number(t))) return `expects a number (${info.type})`;
    if (isWholeType(info) && !Number.isInteger(Number(t))) return `expects a whole number (${info.type})`;
  }
  return null;
}

/** What is wrong with a step's value for a dict argument, one sentence per problem. */
export function dictProblems(value: unknown, info: any): string[] {
  const read = readDictValue(value);
  if (read.kind === 'error') return [`cannot be read as a dict: ${read.error}`];
  if (read.kind !== 'dict') return [];
  const problems: string[] = [];
  for (const [key, item] of Object.entries(read.value)) {
    const keyProblem = cellProblem(key, info?.key_type);
    if (keyProblem) problems.push(`key '${key}' ${keyProblem}`);
    const itemProblem = cellProblem(cellText(item, info?.value_type), info?.value_type);
    if (itemProblem) problems.push(`'${key}' = ${cellText(item, info?.value_type)} ${itemProblem}`);
  }
  return problems;
}

/** A dict or a list on one line, as a folded step shows it: `{kp: 1.5, ki: #ki}`. */
export function compactValue(value: any): string {
  if (Array.isArray(value)) return `[${value.map(compactValue).join(', ')}]`;
  if (isPlainObject(value)) return `{${Object.entries(value).map(([k, v]) => `${k}: ${compactValue(v)}`).join(', ')}}`;
  return value === null ? 'None' : String(value);
}

/** Rows pasted from a spreadsheet: one key per line, its value after a tab. Null if it is not that. */
export function readPastedRows(text: string): { key: string; value: string }[] | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!text.includes('\t') && lines.length < 2) return null;
  return lines.map((line) => {
    const [key, ...rest] = line.split('\t');
    return { key: key.trim(), value: rest.join('\t').trim() };
  });
}
