// An optional object argument (a dataclass or model with a default, PyLabRobot's
// `post_mix: Optional[Mix] = None`) is left out of a new step: built from its fields' defaults it
// read as half-filled and went to the driver as a Mix with no volume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const { defaultParams, addedObject, isOptionalObject, objectGiven } = await importSource('objectArgs');

// flex_left.dispense's schema, as the running Flex deck publishes it (trimmed).
const MIX = {
  type: 'Mix', required: false, optional: true, is_object: true, default: null,
  fields: {
    volume: { type: 'float', required: true },
    repetitions: { type: 'int', required: true },
    flow_rate: { type: 'float', required: true },
    surface_following_distance: { type: 'float', required: false, default: 0.0 },
    auto_surface_following: { type: 'bool', required: false, default: false },
  },
};
const COORDINATE = {
  type: 'Coordinate', required: false, is_object: true, default: null,
  fields: { x: { type: 'float', default: 0 }, y: { type: 'float', default: 0 }, z: { type: 'float', default: 0 } },
};
const DISPENSE = {
  target: { type: 'str', required: true },
  volume: { type: 'float', required: true },
  flow_rate: { type: 'Optional[float]', required: false, default: null },
  offset: COORDINATE,
  post_mix: MIX,
};

test('a new step leaves its optional object arguments out, and a None default too', () => {
  assert.deepEqual(defaultParams(DISPENSE, false), {});
  assert.deepEqual(defaultParams({ ...DISPENSE, flow_rate: { type: 'float', default: 2.5 } }, false), { flow_rate: 2.5 });
});

test('#auto leaves them out too, so it asks for no fields of theirs', () => {
  assert.deepEqual(defaultParams(DISPENSE, true), { target: '#target', volume: '#volume', flow_rate: '#flow_rate' });
});

test('a required object argument is still built from its fields', () => {
  const required = { ...COORDINATE, required: true };
  assert.deepEqual(defaultParams({ offset: required }, false), { offset: { x: 0, y: 0, z: 0 } });
  assert.deepEqual(defaultParams({ offset: required }, true), { offset: { x: '#x', y: '#y', z: '#z' } });
});

test('adding one fills in its defaults and leaves the rest to the person', () => {
  assert.deepEqual(addedObject(MIX), { surface_following_distance: 0, auto_surface_following: false });
});

test('given means the step holds an object for it', () => {
  assert.equal(isOptionalObject(MIX), true);
  assert.equal(isOptionalObject({ ...MIX, required: true }), false);
  assert.equal(isOptionalObject(DISPENSE.volume), false);
  assert.equal(objectGiven(undefined), false);
  assert.equal(objectGiven(null), false);
  assert.equal(objectGiven([]), false);
  assert.equal(objectGiven({}), true);
});
