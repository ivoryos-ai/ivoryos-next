// A parameter's type, read exactly (paramTypes.ts). Each page used to ask whether the type's
// name contained "int", so a `Dict[str, int]` got a number box and could not be typed at all
// (GitHub issue 35), and `List[float]` a "expects a number" warning.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const { bareTypeName, isNumericType, isBoolType, containerKind, parseContainerText, containerProblem, containerExample } = await importSource('paramTypes');

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
  assert.match(containerProblem(COLORS, '["red", "green"]'), /item 2 \("green"\) is not one of red, blue/);
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
