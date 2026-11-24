// A step saves a value for many reasons; being what the search is for is only one of them. An
// output set to "Don't optimize" (goal `none`) stays out of everything the optimizer is given.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importSource } from './tsImport.mjs';

const { buildOptimizationParameters, objectiveNames, isObjective, emptyOptimizeConfig } = await importSource('optimizerConfig');

const sequence = [
  { instrument: 'reactor', method: 'heat', params: { celsius: '#temperature' } },
  { instrument: 'hplc', method: 'analyze', params: {}, returnVar: 'yield, purity',
    returnBindings: [{ path: 'yield_percent', var: 'yield' }, { path: 'purity', var: 'purity' }] },
  { instrument: 'balance', method: 'weigh', params: {}, returnVar: 'mass_g' },
];
const returns = ['yield', 'purity', 'mass_g'];
const configWith = (objectives) => ({
  ...emptyOptimizeConfig(),
  optimizer: 'ax',
  bounds: { temperature: { min: '40', max: '90' } },
  objectives,
});
const build = (objectives) => buildOptimizationParameters({
  config: configWith(objectives), variables: ['temperature'], returns, sequence,
});

test('every saved number is an objective until it is set aside', () => {
  const config = configWith({ purity: { goal: 'minimize' } });
  assert.deepEqual(objectiveNames(config, returns), returns);
  assert.equal(isObjective(config, 'never_configured'), true);
  assert.deepEqual(build({ purity: { goal: 'minimize' } }).objective_config, [
    { name: 'yield', minimize: false },
    { name: 'purity', minimize: true },
    { name: 'mass_g', minimize: false },
  ]);
});

test("an output set to 'none' is not given to the optimizer, and its step still saves it", () => {
  const parameters = build({ purity: { goal: 'none' }, mass_g: { goal: 'none' } });
  assert.deepEqual(parameters.objective_config, [{ name: 'yield', minimize: false }]);
  // The steps are sent as authored: what they save is not the optimizer's business.
  assert.equal(parameters.sequence_template[1].returnVar, 'yield, purity');
  assert.deepEqual(parameters.sequence_template[1].returnBindings, sequence[1].returnBindings);
  assert.equal(parameters.sequence_template[2].returnVar, 'mass_g');
});

test('a target left on an output that is no longer optimized does not stop the run', () => {
  const parameters = build({
    yield: { goal: 'maximize', earlyStop: true, threshold: '90' },
    purity: { goal: 'none', earlyStop: true, threshold: '0.99' },
    // Would be refused as a missing target if it still counted.
    mass_g: { goal: 'none', earlyStop: true, threshold: '' },
  });
  assert.deepEqual(parameters.early_stop, { mode: 'any', criteria: [{ metric: 'yield', threshold: 90 }] });
});

test('with nothing left to optimize the run is refused, naming what could be', () => {
  assert.throws(
    () => build({ yield: { goal: 'none' }, purity: { goal: 'none' }, mass_g: { goal: 'none' } }),
    /Nothing is set to be optimized.*yield, purity, mass_g/,
  );
});
