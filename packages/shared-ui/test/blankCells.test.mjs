// A cell that says "no value on purpose": None, or the driver's own default (runConfig.ts
// NONE_VALUE / DEFAULT_VALUE), chosen per row. An empty cell is still a missing value, and a row
// of nothing at all is still not a sample; a row of markers is one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const config = await importSource('runConfig');
const sheet = await importSource('spreadsheetRun');
const { NONE_VALUE, DEFAULT_VALUE, RunConfigError } = config;

const schema = {
  parameters: {
    volume: { type: 'float', required: true },
    rate: { type: 'Optional[float]', required: false, default: null },
    speed: { type: 'int', required: false, default: 5 },
    note: { type: 'Optional[str]', required: true },
  },
};
const dispense = { instrument: 'pump', method: 'dispense', params: { volume: '#volume', rate: '#rate', speed: '#speed', note: '#note' }, schema };
const variables = ['volume', 'rate', 'speed', 'note'];
const run = (rows, sequence = [dispense], vars = variables) =>
  sheet.expandSpreadsheet({ sequence, rows, variables: vars, batchSize: '' });

test('each row chooses for itself: a value, None, or the driver default', () => {
  const steps = run([
    { volume: '1', rate: '2.5', speed: '7', note: 'a' },
    { volume: '1', rate: NONE_VALUE, speed: DEFAULT_VALUE, note: NONE_VALUE },
  ]);
  assert.deepEqual(steps[0].params, { volume: 1, rate: 2.5, speed: 7, note: 'a' });
  // None is sent as null; the default leaves the argument out, so the driver's own (5) applies.
  assert.deepEqual(steps[1].params, { volume: 1, rate: null, note: null });
  assert.equal('speed' in steps[1].params, false);
});

test('an empty cell is still missing, and says what the column could have chosen', () => {
  assert.throws(() => run([{ volume: '1', rate: '', speed: '7', note: 'a' }]),
    (e) => e instanceof RunConfigError && /Missing value for 'rate' in row 1\. To leave it to the default or None/.test(e.message));
  // A required argument with no default offers nothing extra.
  assert.throws(() => run([{ volume: '', rate: '1', speed: '7', note: 'a' }]), (e) => e.message === "Missing value for 'volume' in row 1");
});

test('a choice the argument cannot take is refused before the run is built', () => {
  assert.throws(() => run([{ volume: NONE_VALUE, rate: '1', speed: '7', note: 'a' }]),
    /'volume' in row 1: this argument does not take None/);
  assert.throws(() => run([{ volume: DEFAULT_VALUE, rate: '1', speed: '7', note: 'a' }]),
    /'volume' in row 1: this argument has no default/);
  // Optional[str] with no default takes None but has no default to fall back on.
  assert.throws(() => run([{ volume: '1', rate: '1', speed: '7', note: DEFAULT_VALUE }]),
    /'note' in row 1: this argument has no default/);
});

test('typing None in a number column points at the choice', () => {
  assert.throws(() => run([{ volume: '1', rate: 'None', speed: '7', note: 'a' }]),
    /expects a number \(Optional\[float\]\), got 'None'\. To send None, choose None in the cell/);
});

test('a row of markers runs; a row of nothing does not', () => {
  const optionalOnly = { instrument: 'pump', method: 'dispense', params: { volume: 1, rate: '#rate', speed: '#speed' }, schema };
  const steps = run([
    { rate: NONE_VALUE, speed: DEFAULT_VALUE },
    { rate: DEFAULT_VALUE, speed: DEFAULT_VALUE },
    { rate: '', speed: '' },
  ], [optionalOnly], ['rate', 'speed']);
  assert.deepEqual(steps.map((s) => s.originalRow), [0, 1]);
  assert.deepEqual(steps.map((s) => s.params), [{ volume: 1, rate: null }, { volume: 1 }]);
  assert.throws(() => run([{ rate: '', speed: '' }], [optionalOnly], ['rate', 'speed']), /Fill in at least one row/);
});

test('a batch step taking one value per row in one call needs a value on every row', () => {
  const read = {
    instrument: 'reader', method: 'read', isBatchAction: true, params: { wells: '#well' },
    schema: { parameters: { wells: { type: 'List[str]', required: false, default: null, wells: { labware: ['plate'] } } } },
  };
  assert.throws(() => sheet.expandSpreadsheet({ sequence: [read], rows: [{ well: 'plate[A1]' }, { well: NONE_VALUE }], variables: ['well'], batchSize: 2 }),
    /'well' in row 2 needs a value: this step takes one from every row/);
});

test('fixed values take the same choices', () => {
  const step = config.resolveFixedBlock(dispense, { volume: '1', rate: NONE_VALUE, speed: DEFAULT_VALUE, note: 'x' });
  assert.deepEqual({ ...step.params, _vars: undefined }, { volume: 1, rate: null, note: 'x', _vars: undefined });
});

test('a column offers a choice only when every argument it feeds allows it', () => {
  const tare = { instrument: 'balance', method: 'tare', params: { wait: '#rate', speed: '#speed' },
    schema: { parameters: { wait: { type: 'float', required: false, default: 2 }, speed: { type: 'int', required: false, default: 5 } } } };
  const choices = config.blankChoicesFor([dispense, tare]);
  // rate: Optional with a None default in one step, a plain float defaulting to 2 in the other.
  assert.deepEqual(choices.rate, { none: false, default: true, defaults: [null, 2] });
  // speed: both default to 5, so the default can be named.
  assert.deepEqual(choices.speed, { none: false, default: true, defaults: [5] });
  assert.deepEqual(choices.volume, { none: false, default: false, defaults: [] });
  assert.deepEqual(choices.note, { none: true, default: false, defaults: [] });
});

test('None is taken where the type says Optional or the default is None', () => {
  // What the edge sends for Optional[Literal['fast', 'slow']]: the type has lost its None arm.
  assert.equal(config.acceptsNone({ type: 'Literal', optional: true, options: ['fast', 'slow'], required: false, default: 'slow' }), true);
  assert.equal(config.acceptsNone({ type: 'Optional[int]', required: true }), true);
  assert.equal(config.acceptsNone({ type: 'Union[int, str, NoneType]', required: true }), true);
  assert.equal(config.acceptsNone({ type: 'float', required: false, default: null }), true);
  assert.equal(config.acceptsNone({ type: 'float', required: false, default: 1 }), false);
  assert.equal(config.acceptsNone(null), false);
});

test('only the exact markers are markers', () => {
  assert.equal(config.blankChoiceOf(' <None> '), 'none');
  assert.equal(config.blankChoiceOf(DEFAULT_VALUE), 'default');
  // The text a Literal["default", "fast"] or a str column may really hold.
  assert.equal(config.blankChoiceOf('default'), null);
  assert.equal(config.blankChoiceOf('None'), null);
  const mode = { instrument: 'pump', method: 'prime', params: { mode: '#mode' },
    schema: { parameters: { mode: { type: "Literal['default', 'fast']", required: false, default: 'fast' } } } };
  assert.deepEqual(run([{ mode: 'default' }], [mode], ['mode'])[0].params, { mode: 'default' });
});
