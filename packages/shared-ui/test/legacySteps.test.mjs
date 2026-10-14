// The original IvoryOS's built-in steps, as the Designer's JSON import reads them. The desktop app
// converts Hub templates with its own copy (desktop/src/hubCatalog.js builtInStep); both are held
// to tests/fixtures/legacy_steps.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { importSource } from './tsImport.mjs';

const { fromLegacyBuiltIn } = await importSource('flowControl');
const { toSequenceBlocks } = await importSource('workflowBody');
const fixtures = JSON.parse(readFileSync(new URL('../../../tests/fixtures/legacy_steps.json', import.meta.url), 'utf8'));

for (const c of fixtures.cases) {
  test(c.name, () => assert.deepEqual(fromLegacyBuiltIn(c.legacy), c.expected));
}

test('an imported legacy workflow opens with Set variable steps, batch flags kept', () => {
  const [count, total] = toSequenceBlocks([
    { instrument: 'variable', action: 'count', args: { statement: 3 }, arg_types: { statement: 'int' }, return: '' },
    { instrument: 'math_variable', action: 'total', args: { statement: '#count * 2' }, arg_types: { statement: 'float' }, return: '', batch_action: true },
  ]);
  assert.deepEqual([count.instrument, count.method, count.params], ['Flow_Control', 'Set_Variable', { variable_name: 'count', value: '3', type: 'int' }]);
  assert.deepEqual([total.method, total.params.value, total.isBatchAction], ['Set_Variable', 'count * 2', true]);
  // Its schema is the built-in step's, so the card has its fields.
  assert.deepEqual(Object.keys(total.schema.parameters), ['variable_name', 'value', 'type']);
});
