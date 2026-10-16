// A spreadsheet column of wells, filled from the picker: one well per row, or a whole column (or
// row) per row. The Flex's 8-channel takes a column at a time, and a table filled a well per row
// handed it one tip (tips[A1]), which PyLabRobot refused as a partial pickup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const { groupPositions, rowUnitOf, formatReference, compactWells } = await importSource('labware');

const ROWS = 'ABCDEFGH'.split('');
const plate = ROWS.map((r) => Array.from({ length: 12 }, (_, c) => `${r}${c + 1}`));
const tips = { name: 'flex_left:tips', label: 'tips', tray: { grid: plate } };
const reservoir = { name: 'flex_left:reservoir', label: 'reservoir', tray: { grid: [plate[0]] } };
const column = (c) => ROWS.map((r) => `${r}${c}`);

test('one row per column: each row gets the column, top to bottom', () => {
  // Picked row by row, as the picker visits them when told to: A1, A2, B1, B2, ...
  const picked = ROWS.flatMap((r) => [`${r}1`, `${r}2`]);
  const groups = groupPositions(picked, plate, 'column');
  assert.deepEqual(groups, [column(1), column(2)]);
  assert.deepEqual(groups.map((g) => formatReference(tips, g)), ['tips[A1:H1]', 'tips[A2:H2]']);
});

test('one row per plate row: each row gets the row, left to right', () => {
  const groups = groupPositions(['B3', 'A2', 'A1', 'B1'], plate, 'row');
  assert.deepEqual(groups, [['A1', 'A2'], ['B1', 'B3']]);
  assert.deepEqual(groups.map((g) => compactWells(g, plate)), ['A1:A2', 'B1, B3']);
});

test('one row per well is the order picked, as before', () => {
  assert.deepEqual(groupPositions(['A2', 'A1'], plate, 'well'), [['A2'], ['A1']]);
});

test('a part column stays what was picked', () => {
  assert.deepEqual(groupPositions(['C4', 'A4', 'B4'], plate, 'column').map((g) => formatReference(tips, g)), ['tips[A4:C4]']);
});

test('the picker reopens the way the column was filled', () => {
  assert.equal(rowUnitOf(['tips[A1:H1]', 'tips[A2:H2]', ''], [tips]), 'column');
  assert.equal(rowUnitOf(['tips[A1:A12]'], [tips]), 'row');
  assert.equal(rowUnitOf(['tips[A1]', 'tips[B1]'], [tips]), 'well');
  assert.equal(rowUnitOf(['tips[A1:H1]', 'tips[A3]'], [tips]), 'well');
  assert.equal(rowUnitOf(['tips[A1:H1]', 'tips[A1:A12]'], [tips]), 'well');
  assert.equal(rowUnitOf(['#tips', 'nothing[A1]'], [tips]), 'well');
  assert.equal(rowUnitOf([], [tips, reservoir]), 'well');
});
