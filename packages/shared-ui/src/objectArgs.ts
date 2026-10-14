/**
 * Arguments that take a structured value: a dataclass or a Pydantic model, `is_object` in the
 * schema with its `fields`. PyLabRobot's `post_mix: Optional[Mix] = None` and
 * `offset: Optional[Coordinate] = None` are the usual case.
 *
 * An optional one is left out of a step until someone adds it, and from then on the step holds it
 * as an object. The editor used to build every one from its fields' defaults when a step was
 * dropped, so an optional `Mix` read `post_mix.volume=?` (as if it had to be filled in), was
 * flagged as missing its volume, and went to the driver as a `Mix` with no volume, which cannot be
 * built. Left out, the driver's own default applies (for `post_mix`, no mixing).
 */

/** An object argument a step may leave out. */
export const isOptionalObject = (info: any): boolean =>
  !!info?.is_object && !!info?.fields && !info?.required;

/** Whether a step holds a value for an object argument. Anything but an object is "not given". */
export const objectGiven = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A new step's arguments, from its method's schema: each argument's default, or, with
 * `useVariables` (the toolbox's #auto switch), `#<name>` for every one, so a step dropped in for an
 * optimization is wired up at once. A required object argument is built from its fields the same
 * way; an optional one is left out (see above), so #auto does not ask for its fields either.
 */
export function defaultParams(schemaParams: Record<string, any> | undefined, useVariables: boolean): Record<string, any> {
  const result: Record<string, any> = {};
  if (!schemaParams) return result;
  for (const [key, param] of Object.entries(schemaParams)) {
    if (param?.is_object && param?.fields) {
      if (!isOptionalObject(param)) result[key] = defaultParams(param.fields, useVariables);
    } else if (useVariables) {
      result[key] = `#${key}`;
    } else if (param?.default !== undefined) {
      result[key] = param.default;
    }
  }
  return result;
}

/** An object argument as it is added to a step: its fields' defaults, ready to be filled in. */
export const addedObject = (info: any): Record<string, any> => defaultParams(info?.fields, false);
