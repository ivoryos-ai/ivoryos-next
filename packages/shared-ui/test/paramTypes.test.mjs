// A parameter's type, read exactly (paramTypes.ts). Each page used to ask whether the type's
// name contained "int", so a `Dict[str, int]` got a number box and could not be typed at all
// (GitHub issue 35), and `List[float]` a "expects a number" warning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const { bareTypeName, isNumericType, isBoolType, choiceProblem, containerKind, parseContainerText, containerProblem, containerExample } = await importSource('paramTypes');

// As the edge publishes them (introspection.py).
const OFFSETS = { type: 'Dict[str, float]', required: true, is_mapping: true, key_type: { type: 'str' }, value_type: { type: 'float', numeric: true } };
const CHANNELS = { type: 'dict[int, str]', required: true, is_mapping: true, key_type: { type: 'int', numeric: true }, value_type: { type: 'str' } };
const LEVELS = { type: 'List[float]', required: true, is_list: true, item_type: { type: 'float', numeric: true } };
const COLORS = { type: 'List[Color]', required: true, is_list: true, item_type: { type: 'Color', options: ['red', 'blue'] } };
const WINDOW = { type: 'Tuple[int, str]', required: true, is_list: true, items: [{ type: 'int', numeric: true }, { type: 'str' }] };
const ANY_DICT = { type: 'dict', required: true, is_mapping: true };

test('a number is an int or a float, not a type whose name merely contains one', () => {
  for (const yes of ['int', 'float', 'Optional[int]', "<class 'float'>", 'typing.Optional[float]', { type: 'int' }, { type: 'Any', numeric: true }]) {
    assert.equal(isNumericType(yes), true, JSON.stringify(yes));
  }
  for (const no of ['Dict[str, int]', 'List[float]', 'Literal["print"]', 'Point', 'str', 'Union[int, str]', '', undefined, OFFSETS, LEVELS, { type: 'int', is_object: true }]) {
    assert.equal(isNumericType(no), false, JSON.stringify(no));
  }
  assert.equal(isBoolType('bool'), true);
  assert.equal(isBoolType('Optional[bool]'), true);
  assert.equal(isBoolType('List[bool]'), false);
  assert.equal(bareTypeName("<class 'float'>"), 'float');
});

test('a dict or a list is known from its flag, or from its name on an older schema', () => {
  assert.equal(containerKind(OFFSETS), 'mapping');
  assert.equal(containerKind(LEVELS), 'list');
  assert.equal(containerKind(WINDOW), 'list');
  // An edge from before the flags publishes only the name.
  assert.equal(containerKind({ type: 'Dict[str, float]' }), 'mapping');
  assert.equal(containerKind({ type: 'Optional[dict[str, int]]' }), 'mapping');
  assert.equal(containerKind({ type: 'Sequence[str]' }), 'list');
  assert.equal(containerKind({ type: 'Mapping[str, int]' }), 'mapping');
  // A wells selection is text whatever its Python type, and so is anything with its own form.
  assert.equal(containerKind({ type: 'wells', wells: { labware: ['plate'] } }), null);
  assert.equal(containerKind({ type: 'Sequence[str]', wells: { labware: ['plate'] } }), null);
  assert.equal(containerKind({ type: 'Color', options: ['red'] }), null);
  assert.equal(containerKind({ type: 'Mix', is_object: true, fields: {} }), null);
  assert.equal(containerKind({ type: 'float' }), null);
  assert.equal(containerKind('str'), null);
});

test('text is read as JSON or as Python writes it', () => {
  assert.deepEqual(parseContainerText('{"a": 1.5, "b": 2}'), { a: 1.5, b: 2 });
  assert.deepEqual(parseContainerText("{'a': 1, 'on': True, 'off': None}"), { a: 1, on: true, off: null });
  assert.deepEqual(parseContainerText('[1, 2, 3,]'), [1, 2, 3]);
  assert.deepEqual(parseContainerText('(1, "two")'), [1, 'two']);
  assert.deepEqual(parseContainerText("['it\\'s', \"q\"]"), ["it's", 'q']);
  assert.equal(parseContainerText('plate[A1:H1]'), undefined);
  assert.equal(parseContainerText('abc'), undefined);
  assert.equal(parseContainerText('{"a": '), undefined);
  assert.equal(parseContainerText('42'), undefined);
});

test('a dict is held to its key and value types, a list to its items', () => {
  assert.equal(containerProblem(OFFSETS, '{"a": 1.5}'), null);
  assert.equal(containerProblem(OFFSETS, "{'a': 1}"), null);
  assert.equal(containerProblem(OFFSETS, { a: 1 }), null, 'a value already held as an object');
  assert.match(containerProblem(OFFSETS, '{"a": "x"}'), /value "x" of "a" is not a number \(float\)/);
  assert.match(containerProblem(OFFSETS, 'abc'), /expects a dict \(Dict\[str, float\]\), written like \{"name": 1\.5\}/);
  assert.match(containerProblem(OFFSETS, '[1, 2]'), /expects a dict/);
  assert.match(containerProblem(CHANNELS, '{"x": "a"}'), /key "x" is not a number \(int\)/);
  assert.equal(containerProblem(CHANNELS, '{"1": "a"}'), null, 'a JSON key is text; the edge casts it');
  assert.equal(containerProblem(LEVELS, '[1, 2.5]'), null);
  assert.match(containerProblem(LEVELS, '[1, "x"]'), /item 2 \("x"\) is not a number \(float\)/);
  assert.match(containerProblem(LEVELS, '{"a": 1}'), /expects a list/);
  assert.match(containerProblem(COLORS, '["red", "green"]'), /item 2 \("green"\) is not one of its choices \(red, blue\)/);
  assert.equal(containerProblem(WINDOW, '[1, "a"]'), null);
  assert.match(containerProblem(WINDOW, '["a", "a"]'), /item 1/);
  assert.equal(containerProblem(ANY_DICT, '{"anything": [1, 2]}'), null);
  // Nothing to judge: empty, a reference, or not a container field at all.
  assert.equal(containerProblem(OFFSETS, ''), null);
  assert.equal(containerProblem(OFFSETS, '#offsets'), null);
  assert.equal(containerProblem({ type: 'float' }, 'abc'), null);
});

test('an example is built from the types', () => {
  assert.equal(containerExample(OFFSETS), '{"name": 1.5}');
  assert.equal(containerExample(CHANNELS), '{"1": "text"}');
  assert.equal(containerExample(LEVELS), '[1.5, 1.5]');
  assert.equal(containerExample(COLORS), '["red", "red"]');
  assert.equal(containerExample(WINDOW), '[1, "text"]');
  assert.equal(containerExample(ANY_DICT), '{"name": 1}');
});

// A bool as the edge publishes it: `options` True and False, for a dropdown. Matched as choices,
// the `true` the Designer stores for one was "not one of its choices (True, False)".
const VERIFY = { type: 'bool', required: false, default: true, options: ['True', 'False'] };
const SPEED = { type: 'Speed', choices: [{ label: 'FAST', value: 3 }, { label: 'SLOW', value: 1.5 }], options: [3, 1.5] };

test('a bool is True or False as the cast reads it, not one of its options as text', () => {
  for (const ok of [true, false, 'True', 'true', 'FALSE', ' false ', '#verify']) {
    assert.equal(choiceProblem(VERIFY, ok), null, JSON.stringify(ok));
    assert.equal(choiceProblem({ ...VERIFY, type: 'Optional[bool]' }, ok), null, JSON.stringify(ok));
  }
  for (const no of ['maybe', 1, 'yes', { a: 1 }]) assert.equal(choiceProblem(VERIFY, no), 'is not True or False', JSON.stringify(no));
  const FLAGS = { type: 'List[bool]', is_list: true, item_type: VERIFY };
  assert.equal(containerProblem(FLAGS, '[true, "False"]'), null);
  assert.match(containerProblem(FLAGS, '[true, "maybe"]'), /item 2 \("maybe"\) is not True or False/);
  const NAMED = { type: 'Dict[str, bool]', is_mapping: true, key_type: { type: 'str' }, value_type: VERIFY };
  assert.equal(containerProblem(NAMED, { a: true, b: 'false' }), null);
});

test('a choice is named by its label, its value, its value as text, or as a number', () => {
  for (const ok of ['FAST', 3, '3', 1.5, '1.50', ' SLOW ', '', undefined, null, '#speed']) {
    assert.equal(choiceProblem(SPEED, ok), null, JSON.stringify(ok));
  }
  assert.equal(choiceProblem(SPEED, 'fast'), 'is not one of its choices (FAST, SLOW)');
  assert.equal(choiceProblem(SPEED, true), 'is not one of its choices (FAST, SLOW)');
  assert.equal(choiceProblem({ type: 'Literal', options: ['a', 'b'] }, 'c'), 'is not one of its choices (a, b)');
  // A tuple-valued Enum: the whole value is one choice.
  const PLATE = { type: 'Plate', choices: [{ label: 'WELL_96', value: [8, 12] }] };
  assert.equal(choiceProblem(PLATE, [8, 12]), null);
  assert.equal(choiceProblem(PLATE, 'WELL_96'), null);
  // A field with neither says nothing.
  assert.equal(choiceProblem({ type: 'str' }, 'anything'), null);
});

test("a step's bool field reads and shows True and False the way its dropdown offers them", async () => {
  const { fieldText, parseField, changedArguments } = await importSource('stepEdits');
  assert.equal(fieldText(true), 'True');
  assert.equal(fieldText(false), 'False');
  assert.equal(parseField('True', VERIFY, undefined), true, 'a bool, not the option kept as text');
  assert.equal(parseField('False', { ...VERIFY, type: 'Optional[bool]' }, undefined), false);
  assert.equal(parseField('FAST', SPEED, undefined), 'FAST');
  assert.deepEqual(changedArguments({ verify_weight: 'True' }, { verify_weight: true }, { verify_weight: VERIFY }), {});
  assert.deepEqual(changedArguments({ verify_weight: 'False' }, { verify_weight: true }, { verify_weight: VERIFY }), { verify_weight: false });
});
