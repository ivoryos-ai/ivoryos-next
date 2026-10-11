/**
 * Typing a step's arguments while its run waits: how a value is shown in a field, and what a
 * typed field means for the argument. Shared by the bench's step editor and Cloud's, so the same
 * text reaches a device as the same value from either (the edge's run_edits.py then checks it).
 */

/** A value as it is shown in a field. */
export function fieldText(value: any): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * What a typed field means for an argument: a `#name` stays a reference (read when the step runs),
 * a number for a numeric argument, True/False for a bool, JSON for a structured one, a choice as
 * the choice it names. `declared` is the argument's schema entry when there is one; without it the
 * value the argument had says what kind it is. Anything else goes as typed and the driver's own
 * casting has the last word.
 */
export function parseField(raw: string, declared: any, original: any): any {
  const text = raw.trim();
  if (text.startsWith('#')) return text;
  const type = String(declared?.type || '').toLowerCase();
  const options: any[] | undefined = Array.isArray(declared?.options) ? declared.options : undefined;
  if (options) return options.find((o) => String(o) === text) ?? text;
  if (type === 'bool' || typeof original === 'boolean') {
    if (/^(true|1|yes)$/i.test(text)) return true;
    if (/^(false|0|no)$/i.test(text)) return false;
    return text;
  }
  if (type.includes('int') || type.includes('float') || typeof original === 'number') {
    return text !== '' && !isNaN(Number(text)) ? Number(text) : text;
  }
  if (declared?.is_object || (original !== null && typeof original === 'object') || /^[[{]/.test(text)) {
    try { return JSON.parse(text); } catch { return raw; }
  }
  return raw;
}

/** The arguments whose field text differs from what they were, parsed: what to send. */
export function changedArguments(
  texts: Record<string, string>, before: Record<string, any>, declared: Record<string, any> = {},
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [name, text] of Object.entries(texts)) {
    if (text === fieldText(before[name])) continue;
    if (text === '' && before[name] === undefined) continue;
    out[name] = parseField(text, declared[name], before[name]);
  }
  return out;
}
