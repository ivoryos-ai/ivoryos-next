/**
 * The `#variable` resolution rules, shared by every page that turns an authored sequence into a
 * dispatchable one.
 *
 * Three call sites used to carry three hand-written copies of the same tree walk — Configure's
 * `resolveArgs`, Optimize's `resolveFixedVarsInBlock`, and Optimize's `resolveGlobalBlock` — and
 * they already disagreed about numeric casting: Configure rejects a non-numeric value for an
 * int/float param, the other two silently pass the string through. That is the drift AGENTS.md
 * section 3 warns about, and it now matters twice over, because the Cloud orchestrator has to
 * resolve `#name`s exactly the way the edge does or a distributed run means something different
 * from the same sequence run at the bench.
 *
 * So: one walker, three policies, expressed as options rather than as three functions.
 */

import { takesRowList } from './labware';
import { isNumericType } from './paramTypes';

/** Thrown for a value that is missing or of the wrong shape. Message is user-facing verbatim. */
export class RunConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunConfigError';
  }
}

export interface ResolveOptions {
  /**
   * Supplies the value for a `#name`. Returning `undefined` means "no value here" and is handled
   * per `onMissing` below.
   */
  lookup: (varName: string) => any;
  /** How a `#name` is described in an error message, e.g. `'temperature' in row 3`. */
  describe: (varName: string) => string;
  /**
   * `throw` — a missing value aborts (Configure rows, Prep/Cleanup fixed values): the step is
   * about to run and an unresolved param would reach an instrument as the literal string.
   * `leave` — an unresolved `#name` stays in place (Optimize's search-space vars, which the
   * backend substitutes per trial).
   */
  onMissing: 'throw' | 'leave';
  /**
   * `strict` rejects a non-numeric value for an int/float param up front, which is the only
   * point where a typo is still cheap to fix. `lenient` casts when it can and passes the string
   * through otherwise, leaving the backend's own `cast_arguments` to have the last word.
   */
  numeric?: 'strict' | 'lenient';
  /** Names resolved elsewhere (e.g. live `User_Input` vars) — left as `#name` and never looked up. */
  skip?: (varName: string) => boolean;
  /**
   * A batch step's rows: the `#name`'s value on each row of its group, with how to describe each
   * in an error. Given, a parameter that takes one value per row (`takesRowList`: wells, a volume
   * per well) receives all of them as a list instead of the single value `lookup` returns. That is
   * what lets one row per sample and one call per column of eight be the same workflow.
   */
  rowValues?: (varName: string) => { value: any; where: string }[];
}

/**
 * A value that says "no value" on purpose, chosen per cell (one row can use the driver's default
 * while the next sets a number). An empty cell is not one: it is a value nobody has filled in yet,
 * refused as missing, and a row of nothing but empty cells is not a sample at all. A row of
 * these markers is a sample, and runs.
 *
 * - `NONE_VALUE`: the argument is sent as None (JSON null).
 * - `DEFAULT_VALUE`: the argument is left out of the call, so the driver's own default applies.
 *   That is not the same as None: a parameter's default is often something else.
 *
 * Bracketed so neither can be a real value: a `mode: Literal["default", "fast"]` column holds the
 * text `default`, and a `str` column may hold the text `None`.
 */
export const NONE_VALUE = '<None>';
export const DEFAULT_VALUE = '<default>';
export type BlankChoice = 'none' | 'default';

export const blankChoiceOf = (value: unknown): BlankChoice | null => {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === NONE_VALUE ? 'none' : v === DEFAULT_VALUE ? 'default' : null;
};

/**
 * Whether a declared parameter (or object field) takes None: the edge marks it `optional` when the
 * type had a None arm (an `Optional[Literal[...]]` is reported as `Literal`, so the type alone does
 * not say), else the type says so, else its default is None.
 */
export function acceptsNone(declared: any): boolean {
  if (!declared) return false;
  if (declared.optional === true) return true;
  const type = String(declared.type || '');
  if (/^Optional\[/.test(type) || /\bNoneType\b/.test(type) || type === 'None') return true;
  return declared.required === false && 'default' in declared && declared.default === null;
}

/** Whether a declared parameter (or object field) has a default for the driver to fall back on. */
export const hasDefault = (declared: any): boolean => !!declared && declared.required === false;

/** Why a blank choice cannot be used for this parameter, or null when it can. */
function blankRefusal(choice: BlankChoice, declared: any): string | null {
  if (choice === 'default') {
    return hasDefault(declared) ? null : 'this argument has no default, so it needs a value';
  }
  return acceptsNone(declared) ? null : 'this argument does not take None, so it needs a value';
}

/** What a column offers instead of a value, from every argument it feeds. */
export interface BlankChoices {
  /** Every argument the column feeds takes None. */
  none: boolean;
  /** Every argument the column feeds has a default. */
  default: boolean;
  /** Those defaults, as the driver declared them (distinct), to show what "default" means. */
  defaults: any[];
}

/**
 * For each `#name` in a sequence, whether a cell may say None or "the driver's default" instead
 * of a value. A column feeding several arguments offers a choice only when every one of them
 * allows it, which is what `resolveBlockParams` checks again when the run is built.
 */
export function blankChoicesFor(sequence: any[], skip?: (name: string) => boolean): Record<string, BlankChoices> {
  const out: Record<string, BlankChoices> = {};
  const walk = (obj: any, schemaObj: any) => {
    Object.entries(obj || {}).forEach(([key, val]) => {
      if (key.startsWith('_')) return;
      const declared = schemaObj?.parameters?.[key] ?? schemaObj?.fields?.[key] ?? null;
      const m = typeof val === 'string' ? /^#(\w+)$/.exec(val.trim()) : null;
      if (m) {
        if (skip?.(m[1])) return;
        const seen = out[m[1]];
        const none = acceptsNone(declared);
        const dflt = hasDefault(declared);
        const defaults = dflt && 'default' in declared ? [declared.default] : [];
        out[m[1]] = seen
          ? {
              none: seen.none && none,
              default: seen.default && dflt,
              defaults: [...seen.defaults, ...defaults.filter((d) => !seen.defaults.some((s) => JSON.stringify(s) === JSON.stringify(d)))],
            }
          : { none, default: dflt, defaults };
      } else if (typeof val === 'object' && val !== null) {
        walk(val, declared);
      }
    });
  };
  sequence.forEach((block) => walk(block?.params, block?.schema));
  return out;
}

/**
 * Resolve every `#name` inside one block's params, returning a new params object.
 *
 * Walks nested objects against the matching slice of the schema (`parameters` at the top level,
 * `fields` inside a structured argument) so a `#name` buried in a dataclass argument gets the same
 * type checking as a top-level one.
 */
export function resolveBlockParams(block: any, opts: ResolveOptions): Record<string, any> {
  const args = JSON.parse(JSON.stringify(block?.params || {}));

  const walk = (obj: any, schemaObj: any) => {
    Object.keys(obj).forEach((key) => {
      const val = obj[key];
      const declared = schemaObj?.parameters?.[key] ?? schemaObj?.fields?.[key] ?? null;

      if (typeof val === 'string' && val.trim().startsWith('#')) {
        const varName = val.trim().slice(1).trim();
        if (varName === '') {
          throw new RunConfigError(
            "A parameter uses '#' with no variable name — fix it in the Designer before running.",
          );
        }
        if (opts.skip?.(varName)) return;

        if (opts.rowValues && takesRowList(declared)) {
          obj[key] = opts.rowValues(varName).map(({ value, where }) => {
            if (value === undefined || value === null || value === '') {
              throw new RunConfigError(`Missing value for ${where}`);
            }
            if (blankChoiceOf(value)) {
              // One call acts on every row's value: a row cannot leave its share to a default.
              throw new RunConfigError(`${where} needs a value: this step takes one from every row of its batch in one call`);
            }
            if (!isNumericType(declared)) return value;
            if (isNaN(Number(value))) {
              if (opts.numeric === 'strict') {
                throw new RunConfigError(`${where} expects a number (${declared?.type}), got '${value}'`);
              }
              return value;
            }
            return Number(value);
          });
          return;
        }

        let subVal = opts.lookup(varName);
        if (subVal === undefined || subVal === null || subVal === '') {
          if (opts.onMissing === 'leave') return;
          const offer = [hasDefault(declared) && 'the default', acceptsNone(declared) && 'None'].filter(Boolean);
          throw new RunConfigError(
            `Missing value for ${opts.describe(varName)}` +
              (offer.length ? `. To leave it to ${offer.join(' or ')}, choose that in the cell.` : ''),
          );
        }

        const blank = blankChoiceOf(subVal);
        if (blank) {
          const refused = blankRefusal(blank, declared);
          if (refused) throw new RunConfigError(`${opts.describe(varName)}: ${refused}`);
          if (blank === 'default') delete obj[key];
          else obj[key] = null;
          return;
        }

        if (isNumericType(declared)) {
          if (isNaN(Number(subVal))) {
            if (opts.numeric === 'strict') {
              const typedNone = String(subVal).trim() === 'None' && acceptsNone(declared);
              throw new RunConfigError(
                `${opts.describe(varName)} expects a number (${declared?.type}), got '${subVal}'` +
                  (typedNone ? '. To send None, choose None in the cell rather than typing it.' : ''),
              );
            }
          } else {
            subVal = Number(subVal);
          }
        }
        obj[key] = subVal;
      } else if (typeof val === 'object' && val !== null) {
        walk(val, declared);
      }
    });
  };

  walk(args, block?.schema);
  return args;
}

/** The wire shape `/api/queue/runs` and `/api/workflows/expand` both accept. */
export function toWireBlock(b: any) {
  return {
    instrument: b.instrument,
    method: b.method,
    params: b.params,
    returnVar: b.returnVar,
    ...(b.returnBindings?.length ? { returnBindings: b.returnBindings } : {}),
    batch_action: !!b.isBatchAction,
    ...linkKeysOf(b),
  };
}

/** One resolved step, ready to be posted as part of a run's `prep`/`sequence`/`cleanup`. */
export interface ResolvedStep {
  instrument: string;
  method: string;
  params: Record<string, any>;
  returnVar?: string;
  returnBindings?: any;
  /** A link's pinned version. Dropped, the edge ran the newest saved version instead. */
  ref?: any;
  /** Which of a linked workflow's phases this step stands for (splitRepeatedLinks). */
  phases?: string[];
}

/** A link's pin and phases, copied onto a step rebuilt from it. */
export const linkKeysOf = (b: any) => ({
  ...(b?.ref ? { ref: b.ref } : {}),
  ...(Array.isArray(b?.phases) ? { phases: b.phases } : {}),
});

/**
 * Which of a block's arguments are `#name` references, as `{argument: name}`.
 *
 * A step is recorded with its values already substituted, so without this a finished run cannot
 * say which of its arguments came from a spreadsheet column, a fixed value or the optimizer and
 * which were typed into the step itself. Carried on the submitted step as `_vars` — metadata the
 * edge never forwards to a driver (`cast_arguments` drops `_`-prefixed keys) — and read by Data
 * History to mark those arguments.
 */
export function dynamicArgumentsOf(block: any, skip?: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(block?.params || {})) {
    const m = typeof value === 'string' ? /^#(\w+)$/.exec(value.trim()) : null;
    if (m && !key.startsWith('_') && !skip?.(m[1])) out[key] = m[1];
  }
  return out;
}

/**
 * Which of a block's arguments are handed one value per row when the block is a batch step, as
 * `{argument: name}`: a `#name` on a parameter that takes a list per row (`takesRowList`).
 * The one rule both the walk and the table read, so a column is never drawn "first row only"
 * while the run takes every row of it.
 */
export function rowListArgumentsOf(block: any, skip?: (name: string) => boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, name] of Object.entries(dynamicArgumentsOf(block, skip))) {
    if (takesRowList(block?.schema?.parameters?.[key])) out[key] = name;
  }
  return out;
}

/**
 * Resolve a Prep/Cleanup block against the run's fixed values. These run once for the whole run,
 * so every `#name` in them must have a value before dispatch.
 */
export function resolveFixedBlock(
  block: any,
  values: Record<string, any>,
  opts: { numeric?: 'strict' | 'lenient'; describe?: (v: string) => string; skip?: (v: string) => boolean } = {},
): ResolvedStep {
  const params = resolveBlockParams(block, {
    lookup: (v) => values[v],
    describe: opts.describe ?? ((v) => `'${v}' in Fixed Values`),
    onMissing: 'throw',
    numeric: opts.numeric ?? 'strict',
    // A name the run fills in itself (runtimeVarNames) is left for the edge to substitute.
    skip: opts.skip,
  });
  const vars = dynamicArgumentsOf(block, opts.skip);
  return {
    instrument: block.instrument,
    method: block.method,
    params: Object.keys(vars).length ? { ...params, _vars: vars } : params,
    returnVar: block.returnVar,
    ...(block.returnBindings ? { returnBindings: block.returnBindings } : {}),
    ...linkKeysOf(block),
  };
}
