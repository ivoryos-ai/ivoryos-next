// Rows the browser kept from the last workflow carry that workflow's keys. Under this workflow's
// columns they are blank rows, not samples, whatever those keys hold: values, or the None /
// Default markers a person chose in them (a row of markers under the CURRENT columns is a sample).
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const config = await importSource('runConfig');
const sheet = await importSource('spreadsheetRun');
const { NONE_VALUE, DEFAULT_VALUE } = config;

const schema = {
  parameters: {
    volume: { type: 'float', required: true },
    surfactant: { type: 'Optional[str]', required: false, default: null },
  },
};
const step = { instrument: 'pump', method: 'dispense', params: { volume: '#vol_1', surfactant: '#surf_1' }, schema };
const columns = ['vol_1', 'surf_1'];
// What the last workflow left behind: its own columns, with what was chosen in them.
const stale = { volume_ml: NONE_VALUE, flow_rate_ml_min: DEFAULT_VALUE, rate: '', note: '', mode: '' };

test("a row is a sample by this workflow's columns, not by every key it holds", () => {
  assert.equal(sheet.isRowActive({ ...stale }, columns), false);
  assert.equal(sheet.isRowActive({ ...stale, vol_1: '', surf_1: '' }, columns), false);
  assert.equal(sheet.isRowActive({ ...stale, vol_1: '2' }, columns), true);
  // A row of markers under the current columns is still a sample.
  assert.equal(sheet.isRowActive({ vol_1: NONE_VALUE, surf_1: DEFAULT_VALUE }, columns), true);
  // Without columns the old rule stands: anything under any key.
  assert.equal(sheet.isRowActive({ ...stale }), true);
  assert.equal(sheet.isRowActive({ a: '' }), false);
});

test('a bare filter callback cannot hand the row index over as the columns', () => {
  // Array.prototype.filter calls back with (row, index, array); the index must not be read as columns.
  const rows = [{ a: '' }, { b: 'x' }, { c: '' }];
  assert.deepEqual(rows.filter(sheet.isRowActive), [{ b: 'x' }]);
});

test('stale rows do not run, do not count, and do not block the run', () => {
  const rows = [
    { vol_1: '2', surf_1: 'a' },
    { ...stale, vol_1: '', surf_1: '' },
    { ...stale },
    { ...stale },
  ];
  const steps = sheet.expandSpreadsheet({ sequence: [step], rows, variables: columns, batchSize: '' });
  assert.deepEqual(steps.map((s) => s.originalRow), [0]);
  assert.deepEqual(steps[0].params, { volume: 2, surfactant: 'a' });
  assert.deepEqual(sheet.buildSpreadsheetParameters({ variables: columns, rows, sequence: [step] }).rows, [rows[0]]);
  // Grouped, the stale rows make no batch of their own; judged by any key they would.
  assert.deepEqual(sheet.chunkRowGroups(rows, 2, columns).map((g) => g.number), [1]);
  assert.deepEqual(sheet.chunkRowGroups(rows, 2).map((g) => g.number), [1, 2]);
  // A table of nothing but stale rows has no sample in it.
  assert.throws(
    () => sheet.expandSpreadsheet({ sequence: [step], rows: [{ ...stale }, { ...stale }], variables: columns, batchSize: '' }),
    /Fill in at least one row/,
  );
});

test('rows are fitted to the columns: shared values kept, other keys dropped, new columns empty', () => {
  const fitted = sheet.fitRowsToColumns([
    { volume_ml: '1', vol_1: '2', note: NONE_VALUE },
    { ...stale },
    { vol_1: NONE_VALUE },
  ], columns);
  assert.deepEqual(fitted, [
    { vol_1: '2', surf_1: '' },
    { vol_1: '', surf_1: '' },
    { vol_1: NONE_VALUE, surf_1: '' },
  ]);
  // Fitted, a row carries nothing that any reading of the rule could mistake for a sample.
  assert.deepEqual(fitted.map((r) => sheet.isRowActive(r, columns)), [true, false, true]);
  assert.deepEqual(fitted.map((r) => sheet.isRowActive(r)), [true, false, true]);
  assert.deepEqual(sheet.fitRowsToColumns([null, undefined], ['x']), [{ x: '' }, { x: '' }]);
  assert.deepEqual(sheet.fitRowsToColumns([{ a: 1 }], []), [{}]);
});
