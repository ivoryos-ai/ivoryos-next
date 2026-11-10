// A bool argument is picked from True, False and None, sent as a JSON true / false (None as null
// or the <None> marker, as for every type), and shown as Python writes it. The Designer and the
// Instruments page sent `true`, the Iterate table the text "True", and the Designer showed `true`
// beside a dropdown offering `True`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const types = await importSource('paramTypes');
const config = await importSource('runConfig');
const sheet = await importSource('spreadsheetRun');
const record = await importSource('runRecord');
const { NONE_VALUE, DEFAULT_VALUE, RunConfigError } = config;

test('what a bool value stands for, and how it is shown', () => {
  for (const [given, expected] of [[true, true], [false, false], ['True', true], ['false', false], [' TRUE ', true]]) {
    assert.equal(types.asBool(given), expected, JSON.stringify(given));
  }
  for (const other of ['yes', '1', 1, 0, null, undefined, '', NONE_VALUE]) assert.equal(types.asBool(other), undefined, JSON.stringify(other));
  assert.equal(types.valueText(true), 'True');
  assert.equal(types.valueText(false), 'False');
  assert.equal(types.valueText(2.5), '2.5');
  assert.equal(types.valueText('true'), 'true', 'text is shown as typed: only a boolean is spelled for Python');
});

const schema = {
  parameters: {
    verify: { type: 'bool', required: false, default: true, options: ['True', 'False'] },
    check: { type: 'Optional[bool]', required: false, optional: true, default: null, options: ['True', 'False'] },
  },
};
const weigh = { instrument: 'balance', method: 'weigh', params: { verify: '#verify', check: '#check' }, schema };
const run = (rows) => sheet.expandSpreadsheet({ sequence: [weigh], rows, variables: ['verify', 'check'], batchSize: '' });

test("the table's True and False go out as JSON booleans, like the Designer's", () => {
  const steps = run([
    { verify: 'True', check: 'False' },
    { verify: 'false', check: NONE_VALUE },
    { verify: DEFAULT_VALUE, check: 'TRUE' },
  ]);
  assert.deepEqual(steps.map((s) => s.params), [
    { verify: true, check: false },
    { verify: false, check: null },
    { check: true },
  ]);
});

test('a bool cell that is not True or False is refused before anything runs', () => {
  assert.throws(() => run([{ verify: 'maybe', check: 'True' }]),
    (e) => e instanceof RunConfigError && /'verify' in row 1 expects True or False \(bool\), got 'maybe'/.test(e.message));
});

test('a finished run shows a bool as True and False, on screen and in the CSV', () => {
  assert.equal(record.cellText(true), 'True');
  assert.equal(record.cellText(false), 'False');
  assert.equal(record.csvField(true), '"True"');
  assert.equal(record.cellText(null), '');
});
