/**
 * What a parameter's declared type says about the value a form should take.
 *
 * The schema names a type in Python's words (`float`, `Optional[int]`, `Dict[str, float]`,
 * `List[Color]`) and, for a dict or a list, says so apart: `is_mapping` with `key_type` and
 * `value_type`, `is_list` with `item_type` or `items`, each described as a parameter is
 * (edge_server/ivoryos_edge/introspection.py). Everything that decides "is this a number" or
 * "is this a dict" reads it through here. Each page used to ask whether the type's *name*
 * contained "int", so `Dict[str, int]` got a number box on the Instruments page and
 * `List[int]` an "expects a number" warning in the Designer: a dict could not be typed at all.
 *
 * A list is typed as text and stays text in the step (`[1, 2]`); a dict is written in its own
 * field (DictInput) and held as an object, so a `#name` as one of its values is a reference, and
 * text from a step written before that (`{"offset": 1.5}`, or Python's `{'offset': 1.5}`) still
 * reads. The edge parses text at the call and casts what is inside (`cast_value`), the same way
 * for a value typed in a step, a table cell or a Cloud field. `containerProblem` reads both the
 * same way, so what passes here runs.
 */

/** The type's name with the wrapping a form does not care about taken off: `<class 'float'>`
 *  (an old schema's spelling), `typing.`, and `Optional[...]` (None is chosen apart). */
export const bareTypeName = (type: unknown): string => {
  let name = String(type ?? '').trim().replace(/^<class '([^']+)'>$/, '$1').replace(/\btyping\./g, '');
  const optional = name.match(/^Optional\[(.*)\]$/);
  if (optional) name = optional[1].trim();
  return name;
};

type Info = Record<string, any>;

const asInfo = (info: unknown): Info | null => (info && typeof info === 'object' ? (info as Info) : null);

/** A field that takes a number: an int or a float, however written (`Optional[int]`), and
 *  nothing else. `Dict[str, int]` and `List[float]` hold numbers but are not one. Takes the
 *  parameter's schema entry, or just its type's name. */
export const isNumericType = (info: unknown): boolean => {
  const entry = asInfo(info);
  if (entry) {
    if (entry.numeric === true) return true;
    if (entry.is_mapping || entry.is_list || entry.is_object) return false;
    return isNumericType(entry.type);
  }
  const bare = bareTypeName(info);
  return bare === 'int' || bare === 'float';
};

/** `bool` or `Optional[bool]`, and not `List[bool]`. */
export const isBoolType = (info: unknown): boolean => {
  const entry = asInfo(info);
  if (entry) {
    if (entry.is_mapping || entry.is_list || entry.is_object) return false;
    return isBoolType(entry.type);
  }
  return bareTypeName(info) === 'bool';
};

/** `str` or `Optional[str]`, and not a list, a dict, an object or a field with choices: blank
 *  in a field is '' for it (docs/argument_casting_ground_truth.md T9). */
export const isTextType = (info: unknown): boolean => {
  const entry = asInfo(info);
  if (entry) {
    if (entry.is_mapping || entry.is_list || entry.is_object || entry.options || entry.choices) return false;
    return isTextType(entry.type);
  }
  return bareTypeName(info) === 'str';
};

/** True or False as the edge's cast reads them (`_cast_bool` in introspection.py): a boolean, or
 *  the text true/false in any case. Nothing else: 1 and "yes" are refused there. */
export const isBoolValue = (value: unknown): boolean =>
  typeof value === 'boolean' || (typeof value === 'string' && /^(true|false)$/i.test(value.trim()));

/** The bool a value stands for (a boolean, or True/False as text in any case), else undefined.
 *  Every page sends a bool argument as this JSON true or false, whatever was typed or picked. */
export const asBool = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const t = value.trim().toLowerCase();
  return t === 'true' ? true : t === 'false' ? false : undefined;
};

/** A value as a page shows it: a bool as Python writes it (True, False), which is what its
 *  dropdown offers and what the call reads as, never JavaScript's `true`. Anything else as text. */
export const valueText = (value: unknown): string =>
  typeof value === 'boolean' ? (value ? 'True' : 'False') : String(value);

/**
 * Why one value is not what its field takes, judged as the edge's cast judges it, or null: True or
 * False for a bool, and for an Enum or a Literal one of its choices, by its label (what a workflow
 * stores), its value, its value's text, or as a number (`introspection.match_choice`). Null for a
 * field with neither, and for nothing given or a `#name`.
 *
 * A bool's `options` (True, False) are what a form offers, never choices to match as text: matched
 * that way, the `true` a step holds for one was "not one of its choices (True, False)", on every
 * bool argument.
 */
export const choiceProblem = (info: unknown, value: unknown): string | null => {
  const entry = asInfo(info);
  if (!entry || value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^#\w+$/.test(value.trim())) return null;
  if (isBoolType(entry)) return isBoolValue(value) ? null : 'is not True or False';
  const choices: { label: string; value: unknown }[] | null = Array.isArray(entry.choices)
    ? entry.choices.map((c: any) => ({ label: String(c.label), value: c.value }))
    : Array.isArray(entry.options) ? entry.options.map((o: unknown) => ({ label: String(o), value: o })) : null;
  if (!choices) return null;
  const asText = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const given = asText(value).trim();
  const number = given !== '' && typeof value !== 'boolean' ? Number(given) : NaN;
  const named = choices.some((c) => c.label === given || asText(c.value) === given
    || (typeof c.value === 'number' && c.value === number));
  return named ? null : `is not one of its choices (${choices.map((c) => c.label).join(', ')})`;
};

export type ContainerKind = 'mapping' | 'list';

/** A dict or a list field, from the schema's own flag, or from the type's name for a schema
 *  published by an edge from before the flags (Cloud mirrors whatever a device publishes). A
 *  wells argument (`plate[A1:H1]`) is text whatever its Python type says. */
export const containerKind = (info: unknown): ContainerKind | null => {
  const entry = asInfo(info);
  if (entry) {
    if (entry.is_mapping) return 'mapping';
    if (entry.is_list) return 'list';
    if (entry.is_object || entry.options || entry.wells || entry.per_well) return null;
    return containerKind(entry.type);
  }
  const bare = bareTypeName(info);
  if (!bare) return null;
  if (/^(dict|Dict|Mapping|MutableMapping|OrderedDict|DefaultDict)(\[|$)/.test(bare)) return 'mapping';
  if (/^(list|List|Sequence|MutableSequence|set|Set|frozenset|FrozenSet|tuple|Tuple|Iterable|Collection|Deque)(\[|$)/.test(bare)) return 'list';
  return null;
};

/** A dict or list written as text: JSON, or Python's own literal (`{'a': 1, 'on': True}`,
 *  which is what someone who writes drivers types). `undefined` when the text is neither.
 *  The edge reads text the same way (`parse_container_text`). */
export const parseContainerText = (text: string): unknown => {
  const t = String(text ?? '').trim();
  if (!t || !'{[('.includes(t[0])) return undefined;
  try { return JSON.parse(t); } catch { /* Python's spelling next */ }
  const asJson = t
    // '...' strings become "..." (a " inside is escaped by JSON.stringify).
    .replace(/'((?:[^'\\]|\\.)*)'/g, (_m, s: string) => JSON.stringify(s.replace(/\\'/g, "'")))
    .replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
    // A trailing comma, which Python allows.
    .replace(/,\s*([}\]])/g, '$1');
  // A tuple written with brackets: only when the whole text is one.
  const bracketed = asJson.startsWith('(') && asJson.endsWith(')') ? `[${asJson.slice(1, -1)}]` : asJson;
  try {
    const value = JSON.parse(bracketed);
    return value && typeof value === 'object' ? value : undefined;
  } catch { return undefined; }
};

const valueProblem = (info: unknown, value: unknown): string | null => {
  const entry = asInfo(info);
  if (!entry || value === null || value === undefined) return null;
  // A `#name` inside a dict or a list is a reference, checked once the run puts a value there
  // (a dict's value that varies per sample or per trial, DictInput).
  if (typeof value === 'string' && /^#\w+$/.test(value.trim())) return null;
  if (isNumericType(entry)) {
    if (typeof value === 'boolean' || value === '' || typeof value === 'object' || isNaN(Number(value))) return `is not a number (${entry.type})`;
    return null;
  }
  // True or False for a bool (whose options are not matched as text), a choice by its label (an
  // Enum member's name, what a workflow stores) or by its value.
  if (isBoolType(entry) || Array.isArray(entry.choices) || Array.isArray(entry.options)) return choiceProblem(entry, value);
  return containerProblem(entry, value);
};

/** Why `value` is not the dict or list the field asks for, or null when it is (or when the
 *  field is not one, or the value is empty or a `#variable`). Keys, values and items are held
 *  to their own types: `{"a": "x"}` for a `Dict[str, float]` names the value. */
export const containerProblem = (info: unknown, value: unknown): string | null => {
  const kind = containerKind(info);
  const entry = asInfo(info) || {};
  if (!kind || value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && value.trim().startsWith('#')) return null;
  const given = typeof value === 'string' ? parseContainerText(value) : value;
  const typeText = bareTypeName(entry.type) || (kind === 'mapping' ? 'dict' : 'list');
  if (kind === 'mapping') {
    if (!given || typeof given !== 'object' || Array.isArray(given)) {
      return `expects a dict (${typeText}), written like ${containerExample(entry)}`;
    }
    for (const [key, item] of Object.entries(given as Record<string, unknown>)) {
      const keyProblem = valueProblem(entry.key_type, key);
      if (keyProblem) return `key ${JSON.stringify(key)} ${keyProblem}`;
      const itemProblem = valueProblem(entry.value_type, item);
      if (itemProblem) return `value ${JSON.stringify(item)} of ${JSON.stringify(key)} ${itemProblem}`;
    }
    return null;
  }
  if (!Array.isArray(given)) return `expects a list (${typeText}), written like ${containerExample(entry)}`;
  for (let i = 0; i < given.length; i++) {
    const sub = Array.isArray(entry.items) && i < entry.items.length ? entry.items[i] : entry.item_type;
    const problem = valueProblem(sub, given[i]);
    if (problem) return `item ${i + 1} (${JSON.stringify(given[i])}) ${problem}`;
  }
  return null;
};

/** What to write in the field, built from the types: `{"name": 1.5}` for a `Dict[str, float]`,
 *  `[1, 1]` for a `List[int]`. Shown as the placeholder and named in a refusal. */
export const containerExample = (info: unknown): string => {
  const kind = containerKind(info);
  const entry = asInfo(info) || {};
  const sample = (sub: unknown): string => {
    const s = asInfo(sub);
    if (!s) return '1';
    if (isNumericType(s)) return bareTypeName(s.type) === 'int' ? '1' : '1.5';
    if (isBoolType(s)) return 'true';
    if (Array.isArray(s.options) && s.options.length) return JSON.stringify(String(s.options[0]));
    if (containerKind(s)) return containerExample(s);
    if (s.is_object) return '{...}';
    return '"text"';
  };
  if (kind === 'mapping') {
    const key = entry.key_type && isNumericType(entry.key_type) ? '"1"' : '"name"';
    return `{${key}: ${sample(entry.value_type)}}`;
  }
  if (kind === 'list') {
    if (Array.isArray(entry.items)) return `[${entry.items.map(sample).join(', ')}]`;
    const item = sample(entry.item_type);
    return `[${item}, ${item}]`;
  }
  return '';
};
