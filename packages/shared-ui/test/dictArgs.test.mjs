// An argument that takes a dict is written as a table or as JSON (DictInput), held as an object, and
// a `#name` as one of its values is a reference like any other: a column on the Iterate page, typed
// by the dict's value type, and recorded in `_vars`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const dict = await importSource('dictArgs');
const config = await importSource('runConfig');
const sheet = await importSource('spreadsheetRun');
const body = await importSource('workflowBody');
const objects = await importSource('objectArgs');
const record = await importSource('runRecord');

const FLOATS = {
  type: 'Dict[str, float]', required: true, is_mapping: true,
  key_type: { type: 'str', required: true }, value_type: { type: 'float', required: true },
};

test('pasted text is read as JSON or as a Python literal, and a bare #name is a value', () => {
  assert.deepEqual(dict.readDictText('{"a": 1.5, "b": "#x"}'), { kind: 'dict', value: { a: 1.5, b: '#x' } });
  assert.deepEqual(dict.readDictText("{'a': 1, 'b': True, 'c': None, 'd': (1, 2),}"),
    { kind: 'dict', value: { a: 1, b: true, c: null, d: [1, 2] } });
  assert.deepEqual(dict.readDictText('{"a": #x, flow: 2, 3: 4}'), { kind: 'dict', value: { a: '#x', flow: 2, 3: 4 } });
  assert.deepEqual(dict.readDictText(`{"it's": 'a "b"'}`), { kind: 'dict', value: { "it's": 'a "b"' } });
});

test('text that is not a dict says why, a whole #name and a marker are words, nothing is blank', () => {
  assert.equal(dict.readDictText('{"a": 1').kind, 'error');
  assert.match(dict.readDictText('[1, 2]').error, /a list, not a dict/);
  assert.match(dict.readDictText('{a: fast}').error, /needs quotes/);
  assert.match(dict.readDictText('#').error, /variable name/);
  assert.deepEqual(dict.readDictText(' #settings '), { kind: 'word', value: '#settings' });
  assert.deepEqual(dict.readDictText('<None>'), { kind: 'word', value: '<None>' });
  assert.deepEqual(dict.readDictText('  '), { kind: 'blank' });
});

test('a cell means what its declared type says, and shows as what it was typed', () => {
  assert.equal(dict.cellValue('1.5', FLOATS.value_type), 1.5);
  assert.equal(dict.cellValue('#x', FLOATS.value_type), '#x');
  assert.equal(dict.cellValue('abc', FLOATS.value_type), 'abc');
  assert.equal(dict.cellValue('TRUE', { type: 'bool' }), true);
  assert.equal(dict.cellValue(' 5 ', { type: 'str' }), ' 5 ');
  assert.equal(dict.cellValue('FAST', { type: 'Speed', choices: [{ label: 'FAST', value: 3 }] }), 'FAST');
  // No type to go by: what the same value pasted as JSON would be.
  assert.equal(dict.cellValue('5', { type: 'Any' }), 5);
  assert.equal(dict.cellValue('"5"', { type: 'Any' }), '5');
  assert.equal(dict.cellValue('abc', undefined), 'abc');
  assert.deepEqual(dict.cellValue('[1, "#x"]', { type: 'List[float]' }), [1, '#x']);
  for (const [value, info] of [[5, { type: 'Any' }], ['5', { type: 'Any' }], ['abc', undefined], [true, { type: 'bool' }], [[1, 2], { type: 'List[int]' }]]) {
    assert.deepEqual(dict.cellValue(dict.cellText(value, info), info), value);
  }
});

test('keys and values the type cannot take are named', () => {
  assert.deepEqual(dict.dictProblems({ a: 1, b: '#x', c: '<None>' }, FLOATS), []);
  assert.deepEqual(dict.dictProblems({ a: 'abc' }, FLOATS), ["'a' = abc expects a number (float)"]);
  assert.deepEqual(dict.dictProblems({ a: '#' }, FLOATS), ["'a' = # needs a variable name after the '#'"]);
  const ints = { is_mapping: true, key_type: { type: 'int' }, value_type: { type: 'int' } };
  assert.deepEqual(dict.dictProblems({ x: 2.5 }, ints), ["key 'x' expects a number (int)", "'x' = 2.5 expects a whole number (int)"]);
  assert.match(dict.dictProblems('{"a": ', FLOATS)[0], /cannot be read as a dict/);
  assert.deepEqual(dict.dictProblems(undefined, FLOATS), []);
  assert.deepEqual(dict.dictProblems('#settings', FLOATS), []);
  // A bare dict says nothing about its values.
  assert.deepEqual(dict.dictProblems({ a: 'anything', b: 1 }, { type: 'dict', is_mapping: true }), []);
});

test('rows pasted from a spreadsheet', () => {
  assert.deepEqual(dict.readPastedRows('a\t1\nb\t2\n'), [{ key: 'a', value: '1' }, { key: 'b', value: '2' }]);
  assert.equal(dict.readPastedRows('just one word'), null);
});

test('a folded step shows a dict on one line', () => {
  assert.equal(dict.compactValue({ kp: 1.5, ki: '#ki', on: true, off: null, list: [1, 2] }), '{kp: 1.5, ki: #ki, on: true, off: None, list: [1, 2]}');
});

const step = { instrument: 'pid', method: 'tune', params: { gains: { kp: 1.5, ki: '#ki' }, note: '#note' }, schema: { parameters: { gains: FLOATS, note: { type: 'str', required: true } } } };

test('a #name inside a dict is a column typed by the value type, and recorded', () => {
  const [run] = sheet.expandSpreadsheet({ sequence: [step], rows: [{ ki: '0.2', note: 'a' }], variables: ['ki', 'note'] });
  assert.deepEqual(run.params, { gains: { kp: 1.5, ki: 0.2 }, note: 'a' });
  assert.deepEqual(run.vars, { 'gains.ki': 'ki', note: 'note' });
  assert.throws(() => sheet.expandSpreadsheet({ sequence: [step], rows: [{ ki: 'abc', note: 'a' }], variables: ['ki', 'note'] }),
    /'ki' in row 1 expects a number \(float\)/);
  assert.equal(config.declaredChild(FLOATS, 'anything').type, 'float');
  assert.equal(config.holdsReference({ gains: { a: '#x' } }), true);
  assert.equal(config.holdsReference({ gains: { a: 1 } }), false);
});

test('a cell can say None for a value in a dict, and only that', () => {
  const blanks = config.blankChoicesFor([step]);
  assert.equal(blanks.ki.none, true);
  assert.equal(blanks.ki.default, false);
  const [run] = sheet.expandSpreadsheet({ sequence: [step], rows: [{ ki: config.NONE_VALUE, note: 'a' }], variables: ['ki', 'note'] });
  assert.equal(run.params.gains.ki, null);
});

test('a linked workflow asks for a #name inside a dict', () => {
  const saved = { name: 'tune', script: [{ instrument: 'pid', action: 'tune', args: { gains: { ki: '#ki' }, note: '#note' }, arg_types: { note: 'str' } }] };
  assert.deepEqual(Object.keys(body.scanDynamicParams(saved)).sort(), ['ki', 'note']);
});

test('#auto leaves a dict to its table: no column of whole dicts', () => {
  assert.deepEqual(objects.defaultParams({ gains: FLOATS, rate: { type: 'float', required: true } }, true), { rate: '#rate' });
  assert.deepEqual(objects.defaultParams({ gains: { ...FLOATS, required: false, default: { a: 1 } } }, true), { gains: { a: 1 } });
});

test('an optimization trial reads a value it suggested inside a dict', () => {
  const run = record.formatRun({
    id: 1, name: 'x', status: 'completed',
    parameters: {
      type: 'Optimization',
      parameter_space: [{ name: 'ki' }],
      objective_config: [],
      sequence_template: [{ instrument: 'pid', method: 'tune' }],
    },
    steps: [{ instrument: 'pid', method: 'tune', status: 'completed', parameters: { gains: { kp: 1, ki: 0.3 }, _vars: { 'gains.ki': 'ki' } } }],
  });
  assert.equal(run.rows[0].values[0], 0.3);
});
