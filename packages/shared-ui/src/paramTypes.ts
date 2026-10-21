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
 * A dict or a list is typed as text and stays text in the step (`{"offset": 1.5}`, or Python's
 * own `{'offset': 1.5}`): the edge parses it at the call and casts what is inside
 * (`cast_value`), the same way for a value typed in a step, a table cell or a Cloud field.
 * `containerProblem` reads it the same way, so what passes here runs.
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
  if (isNumericType(entry)) {
    if (typeof value === 'boolean' || value === '' || typeof value === 'object' || isNaN(Number(value))) return `is not a number (${entry.type})`;
    return null;
  }
  if (isBoolType(entry) && typeof value !== 'boolean' && !/^(true|false)$/i.test(String(value))) return 'is not true or false';
  if (Array.isArray(entry.options) && entry.options.length && !entry.options.map(String).includes(String(value))) {
    return `is not one of ${entry.options.map(String).join(', ')}`;
  }
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
