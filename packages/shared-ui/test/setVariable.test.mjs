// The Set variable step on the authoring side: which names its value reads, that the variable it
// sets counts as one the run fills in (no Configure column, no search-space entry), and the
// Python it previews as. The edge's half is tests/automated/test_set_variable.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const flow = await importSource('flowControl');
const body = await importSource('workflowBody');
const codegen = await importSource('generatePythonCode');

const setVar = (variable_name, value, type) => ({
  instrument: 'Flow_Control', method: 'Set_Variable', params: { variable_name, value, ...(type ? { type } : {}) },
});
const pump = (volume) => ({ instrument: 'pump', method: 'dispense', params: { volume } });

test('an expression reads its bare names, not functions, keywords, constants or quoted text', () => {
  assert.deepEqual(flow.expressionNames('round(a / b, ndigits=2) + pi + max(c, 1)'), ['a', 'b', 'c']);
  assert.deepEqual(flow.expressionNames('x if flag and not done else 1e5'), ['x', 'flag', 'done']);
  assert.deepEqual(flow.expressionNames('"text #y" + label'), ['label']);
  assert.deepEqual(flow.expressionNames('f"vial_{i:02d}_{name!r}"'), ['i', 'name']);
  assert.deepEqual(flow.expressionNames('#x + 5 * (#y - 2)'), ['x', 'y']);
  assert.deepEqual(flow.expressionNames('spectrum[3] * 2.5'), ['spectrum']);
});

test('a # before a name is dropped from an expression, not from text or a lone reference', () => {
  assert.equal(flow.withoutReferenceMarks('#x + 5 * (#y - 2)'), 'x + 5 * (y - 2)');
  assert.equal(flow.withoutReferenceMarks('"#ff0000" + #tag'), '"#ff0000" + tag');
  assert.equal(flow.withoutReferenceMarks('#volume'), '#volume');
});

test('what a Set variable reads depends on what its value is', () => {
  assert.deepEqual(flow.setVariableReads({ value: '#volume' }), ['volume']);
  assert.deepEqual(flow.setVariableReads({ value: 'volume * 2' }), ['volume']);
  assert.deepEqual(flow.setVariableReads({ value: 'sample #i', type: 'str' }), []);
  assert.deepEqual(flow.setVariableReads({ value: 'abc', _vars: { value: 'col' } }), []);
  assert.deepEqual(flow.setVariableReads({ value: 3 }), []);
});

test('a variable it sets is one the run fills in, so later #name reads ask for nothing', () => {
  const main = [setVar('a', '1'), setVar('b', 'a * 2'), pump('#b'), pump('#a')];
  assert.deepEqual([...body.runtimeVarNames([], main, [])].sort(), ['a', 'b']);
  // Read before anything sets it: still an input, as for any other step.
  assert.ok(!body.runtimeVarNames([], [pump('#a'), setVar('a', '1')], []).has('a'));
  // A lone #name it copies from is an input when nothing set it first.
  assert.ok(!body.runtimeVarNames([], [setVar('a', '#volume'), pump('#a')], []).has('volume'));
  assert.deepEqual([...body.scanLiveInputVars({ script: [{ instrument: 'Flow_Control', action: 'Set_Variable', args: { variable_name: 'n', value: '2' } }] })], ['n']);
});

test('it previews as the assignment it is', () => {
  const steps = [
    setVar('a', '1'),
    setVar('b', '#a * 2', 'float'),
    setVar('label', 'vial #a', 'str'),
    setVar('copy', '#volume', 'int'),
    setVar('flag', 'b > 1 and a < 3'),
  ];
  const code = codegen.generatePythonCode([], steps, [], {});
  assert.match(code, /\n {4}a = 1\n/);
  assert.match(code, /\n {4}b = float\(a \* 2\)\n/);
  assert.match(code, /\n {4}label = f"vial \{a\}"\n/);
  assert.match(code, /\n {4}copy = int\(volume\)\n/);
  assert.match(code, /\n {4}flag = b > 1 and a < 3\n/);
});
