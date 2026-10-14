/**
 * The designer's own built-in steps, described the same way an instrument's methods are.
 *
 * Flow control is not introspected from any driver, so it has no entry in `/api/status` — which
 * meant a block rebuilt from saved JSON (`toSequenceBlock`) found no schema and rendered with no
 * fields at all. The values were still in `params` and still ran correctly; they were simply
 * invisible and uneditable, so reopening a saved workflow lost the ability to change an `If`
 * condition or a `User_Input` prompt.
 *
 * Keyed by the method name that is actually *executed* and stored (`If`, `End_While`), not by the
 * toolbox entry a person drags in (`If_Else_Block`, which expands into three of these). The two
 * namespaces are easy to confuse and were exactly the reason the lookup silently missed.
 *
 * Mirrors `FLOW_CONTROL_METHODS` in `edge_server/ivoryos_edge/agent/deck.py`, which describes the
 * same steps to a language model, and `queue.py`, which executes them. Three copies of one
 * vocabulary is two too many, but they serve different runtimes; keep them in step.
 */

/** A Set variable's types: `auto` keeps what the value is; the rest convert it (queue.py). */
export const SET_VARIABLE_TYPES = ['auto', 'str', 'int', 'float', 'bool'];

const SET_VARIABLE_PARAMETERS = {
  variable_name: { type: 'str', required: true },
  value: { type: 'str', required: true },
  type: { type: 'str', required: false, default: 'auto', options: SET_VARIABLE_TYPES },
};

export const FLOW_CONTROL_INSTRUMENTS = ['Flow_Control', 'Flow Control'];

export const isFlowControlInstrument = (instrument: string | undefined): boolean =>
  FLOW_CONTROL_INSTRUMENTS.includes(String(instrument || ''));

export const FLOW_CONTROL_SCHEMAS: Record<string, any> = {
  If: {
    description: 'Run the following steps only when the condition holds.',
    parameters: { condition: { type: 'str', required: true } },
    return_type: 'None',
  },
  Else: {
    description: 'The alternative branch of the enclosing If.',
    parameters: {},
    return_type: 'None',
  },
  End_If: {
    description: 'Closes the enclosing If.',
    parameters: {},
    return_type: 'None',
  },
  While: {
    description: 'Repeat the following steps while the condition holds.',
    parameters: { condition: { type: 'str', required: true } },
    return_type: 'None',
  },
  End_While: {
    description: 'Closes the enclosing While.',
    parameters: {},
    return_type: 'None',
  },
  Sleep: {
    description: 'Pause execution for a number of seconds.',
    parameters: { duration_seconds: { type: 'float', required: true } },
    return_type: 'None',
  },
  User_Input: {
    // With no variable_name it only pauses: the message waits for Continue (the original `pause`).
    description: 'Pause for a person: show a message, and ask for a value if it is saved under a name (human-in-the-loop).',
    parameters: {
      prompt: { type: 'str', required: true },
      variable_name: { type: 'str', required: false },
      input_type: { type: 'str', required: false, default: 'str', options: ['str', 'int', 'float', 'bool'] },
    },
    return_type: 'None',
  },
  Comment: {
    description: "Add a note to the run log — like Python's print().",
    parameters: { message: { type: 'str', required: true } },
    return_type: 'None',
  },
  Set_Variable: {
    // The original IvoryOS's `variable` and `math` in one step.
    description: 'Save a value or a calculation under a name, for later steps to use as #name.',
    parameters: SET_VARIABLE_PARAMETERS,
    return_type: 'None',
  },
};

/** The schema for a built-in step, or undefined if `method` is not one. */
export function flowControlSchema(instrument: string | undefined, method: string | undefined): any {
  if (!isFlowControlInstrument(instrument)) return undefined;
  return FLOW_CONTROL_SCHEMAS[String(method || '')];
}

/**
 * What a designer's toolbox offers under Logic, keyed by the entry a person drags in (not what is
 * stored: `If_Else_Block` expands into If / Else / End_If on drop, see FLOW_CONTROL_SCHEMAS). The
 * edge Designer and Cloud's sequence editor both offer exactly this; they each kept a copy before,
 * and Cloud's had lost User input and Comment.
 */
export const FLOW_CONTROL_PALETTE: Record<string, any> = {
  If_Else_Block: { description: 'If / else: run the following steps only when the condition holds', parameters: { condition: { type: 'str', required: true } }, return_type: 'None' },
  While_Loop: { description: 'While loop: repeat the following steps while the condition holds', parameters: { condition: { type: 'str', required: true } }, return_type: 'None' },
  Sleep: { description: 'Wait: pause execution for a number of seconds', parameters: { duration_seconds: { type: 'float', required: true } }, return_type: 'None' },
  User_Input: { description: 'Pause for a person: show a message, and ask for a value if you name where to save it', parameters: { prompt: { type: 'str', required: true }, variable_name: { type: 'str', required: false }, input_type: { type: 'str', required: false, default: 'str', options: ['str', 'int', 'float', 'bool'] } }, return_type: 'None' },
  Set_Variable: { description: 'Set variable: save a value or a calculation (a = 1, b = a * 2) for later steps to use as #name', parameters: SET_VARIABLE_PARAMETERS, return_type: 'None' },
  Comment: { description: "Add a note to the run log, like Python's print()", parameters: { message: { type: 'str', required: true } }, return_type: 'None' },
};

export const isSetVariable = (block: any): boolean =>
  isFlowControlInstrument(block?.instrument) && (block?.method ?? block?.action) === 'Set_Variable';

/**
 * Words an expression may use that are not variables: Python's own, and the functions and
 * constants the edge allows (`FUNCTIONS`, `CONSTANTS` in edge_server/ivoryos_edge/expressions.py).
 */
export const EXPRESSION_FUNCTIONS = ['abs', 'round', 'min', 'max', 'sum', 'len', 'int', 'float', 'str', 'bool',
  'sqrt', 'exp', 'log', 'log10', 'sin', 'cos', 'tan', 'floor', 'ceil'];
const EXPRESSION_WORDS = new Set(['and', 'or', 'not', 'in', 'is', 'if', 'else', 'True', 'False', 'None', 'pi']);

/** A value that is one `#name` and nothing else: a reference, as in any step's argument. */
export const wholeReference = (value: unknown): string | null => {
  const m = typeof value === 'string' ? /^\s*#\s*([A-Za-z_]\w*)\s*$/.exec(value) : null;
  return m ? m[1] : null;
};

/**
 * `#x + 5` -> `x + 5`: in an expression a variable is written by name, as in an If condition. A
 * value that starts with '#' is a reference to one variable everywhere in the app (the Configure
 * columns, the optimizer, a link's arguments all read it so), so an expression must not.
 * Quoted text is left alone, and so is a lone `#name`.
 */
export function withoutReferenceMarks(expression: string): string {
  if (wholeReference(expression)) return expression;
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < expression.length) out += expression[++i];
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
    } else if (!(ch === '#' && /^\s*[A-Za-z_]/.test(expression.slice(i + 1)))) {
      out += ch;
    }
  }
  return out;
}

/**
 * The variables an expression reads, in order: every name that is not a word of Python's, a
 * function it calls, or a keyword argument. Read from the text, so it is the Designer's best
 * reading; the edge parses it properly (`expression_names`) and refuses a run that reads a name
 * nothing before it saves. Names inside an f-string's braces count; other quoted text does not.
 */
export function expressionNames(expression: string): string[] {
  const names: string[] = [];
  const scan = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const rest = text.slice(i);
      const quoted = /^([rRbBfF]{0,2})(['"])/.exec(rest);
      if (quoted && (quoted[1] === '' || !/\w/.test(text[i - 1] || ''))) {
        const q = quoted[2];
        let j = i + quoted[0].length;
        let body = '';
        while (j < text.length && text[j] !== q) {
          if (text[j] === '\\') { body += text[j] + (text[j + 1] || ''); j += 2; continue; }
          body += text[j++];
        }
        if (/f/i.test(quoted[1])) {
          // f"vial_{i:02d}": what is inside the braces (not `{{`) is an expression.
          body.replace(/\{\{|\}\}/g, '').replace(/\{([^{}]*)\}/g, (_m, inner: string) => {
            scan(inner.split(/[!:](?![=])/)[0]);
            return '';
          });
        }
        i = j + 1;
        continue;
      }
      const number = /^(\d[\w.]*|\.\d[\w.]*)/.exec(rest);
      if (number) { i += number[0].length; continue; }
      const word = /^[A-Za-z_]\w*/.exec(rest);
      if (word) {
        const name = word[0];
        const before = text.slice(0, i).trimEnd();
        const after = text.slice(i + name.length).trimStart();
        const isCall = after.startsWith('(') && EXPRESSION_FUNCTIONS.includes(name);
        const isKeyword = after.startsWith('=') && !after.startsWith('==');
        if (!before.endsWith('.') && !isCall && !isKeyword && !EXPRESSION_WORDS.has(name) && !names.includes(name)) {
          names.push(name);
        }
        i += name.length;
        continue;
      }
      i += 1;
    }
  };
  scan(withoutReferenceMarks(String(expression ?? '')));
  return names;
}

/**
 * What a Set variable step reads, the edge's `set_variable_reads`: the variable of a lone `#name`,
 * the names its expression uses, and nothing for text (`type` str), where a `#name` is filled in
 * when known and left as written when not.
 */
export function setVariableReads(params: any): string[] {
  const value = params?.value;
  if (typeof value !== 'string') return [];
  const ref = wholeReference(value);
  if (ref) return [ref];
  if (params?._vars?.value || String(params?.type || 'auto').trim().toLowerCase() === 'str') return [];
  return expressionNames(value);
}

type LegacyStep = { instrument: string; action: string; args: Record<string, any>; arg_types: Record<string, string> };

/** A saved value as the Python it stands for: what a Set variable's `value` holds. */
const pythonText = (value: unknown): string =>
  typeof value === 'boolean' ? (value ? 'True' : 'False') : value === null || value === undefined ? 'None' : String(value);

/**
 * The original IvoryOS's built-in pseudo-instruments as this app's Flow Control steps, in saved
 * shape, or null for any other step. `wait` is a Sleep, `pause` a User input with nothing to save,
 * and `variable` and `math_variable` (`{instrument: 'variable', action: <name>, args: {statement},
 * arg_types: {statement: <type>}}`) are one Set variable. Without this they arrived as a step on an
 * instrument called "variable", which no deck has.
 *
 * The old runner read a `str` variable as text, except a quoted or f-string statement, which it
 * evaluated; a math step it always evaluated, and never converted a `str` one. So those become
 * `auto` expressions here, and a math statement loses its `#`s (withoutReferenceMarks).
 *
 * Mirrored by `builtInStep` in desktop/src/hubCatalog.js (Hub templates; the desktop app cannot
 * import this package). Both are checked against tests/fixtures/legacy_steps.json.
 */
export function fromLegacyBuiltIn(saved: any): LegacyStep | null {
  const instrument = String(saved?.instrument || '');
  const statement = saved?.args?.statement;
  if (instrument === 'wait') {
    const seconds = Number(statement);
    return { instrument: 'Flow_Control', action: 'Sleep', args: { duration_seconds: Number.isFinite(seconds) ? seconds : statement }, arg_types: { duration_seconds: 'float' } };
  }
  if (instrument === 'pause') {
    return { instrument: 'Flow_Control', action: 'User_Input', args: { prompt: String(statement ?? 'Continue?') }, arg_types: { prompt: 'str' } };
  }
  if (instrument !== 'variable' && instrument !== 'math_variable') return null;
  const isMath = instrument === 'math_variable';
  const declared = String(saved?.arg_types?.statement || (isMath ? 'float' : 'str'));
  let type = SET_VARIABLE_TYPES.includes(declared) ? declared : 'auto';
  let value = pythonText(statement);
  if (!wholeReference(value)) {
    if (type === 'str' && (isMath || /^\s*[fF]?["']/.test(value))) type = 'auto';
    if (type !== 'str') value = withoutReferenceMarks(value).trim();
  }
  return {
    instrument: 'Flow_Control', action: 'Set_Variable',
    args: { variable_name: String(saved?.action || ''), value, type },
    arg_types: { variable_name: 'str', value: 'str', type: 'str' },
  };
}
