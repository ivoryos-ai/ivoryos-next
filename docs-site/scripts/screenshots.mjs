// Takes every screenshot the documentation uses, from the deck scripts/docs-deck.py serves on
// http://localhost:8090 (IVORYOS_DOCS_EDGE overrides it). Each scene is one documented state of
// the app; re-run this after an interface change and every picture in the docs is current.
//
//   uv run --project edge_server python docs-site/scripts/docs-deck.py   (in one terminal)
//   npm run screenshots                                                   (in docs-site/)
//   npm run screenshots -- designer library                                (only these scenes)
//
// It drives the Google Chrome already installed (Playwright's `chrome` channel), so nothing is
// downloaded. Screenshots are 1440x900 at 2x, light theme, sidebar navigation, saved as PNG under
// src/assets/screenshots/.

import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDGE = process.env.IVORYOS_DOCS_EDGE || 'http://localhost:8090';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'screenshots');
const only = new Set(process.argv.slice(2));
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
// Light theme and the sidebar navigation, whatever this browser profile last chose.
await context.addInitScript(() => {
  try {
    localStorage.setItem('ivoryos-theme', 'light');
    localStorage.removeItem('ivoryos-nav');
    localStorage.setItem('ivoryos_notify_declined', '1'); // no "notify me?" card over the run bar
  } catch {}
});
const page = await context.newPage();
page.setDefaultTimeout(15000);

const api = async (method, route, body) => {
  const res = await fetch(`${EDGE}${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
};

const go = async (route) => {
  await page.goto(`${EDGE}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
};

const settle = (ms = 500) => page.waitForTimeout(ms);

// Lossless, smallest PNG. (A palette PNG was a third the size, but banded the page's faint shadows.)
export const compress = async (file) => {
  const buf = await sharp(file).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  fs.writeFileSync(file, buf);
};

const shot = async (name, opts = {}) => {
  await settle(opts.wait ?? 300);
  const file = path.join(OUT, `${name}.png`);
  if (opts.clip) await page.screenshot({ path: file, clip: opts.clip });
  else if (opts.element) await opts.element.screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: !!opts.fullPage });
  await compress(file);
  console.log('  ', path.relative(process.cwd(), file));
};

// Every unfinished run is over (or none ever started), polled from the edge's own API.
const ACTIVE = new Set(['pending', 'running', 'waiting_input', 'paused', 'cancelling']);
const waitIdle = async (timeoutMs = 90000) => {
  const t0 = Date.now();
  for (;;) {
    const res = await api('GET', '/api/queue/runs?recent=5');
    const runs = Array.isArray(res) ? res : res.runs || [];
    if (!runs.some((r) => ACTIVE.has(r.status))) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('deck still busy');
    await settle(500);
  }
};

// The Designer keeps its canvas in localStorage; drop it so a scene starts from a clean page.
const resetDesigner = async () => {
  await page.goto(`${EDGE}/designer`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('ivoryos_') && !['ivoryos_cached_schema', 'ivoryos_notify_declined'].includes(k)) localStorage.removeItem(k);
  });
};

// The example workflow on the canvas, as the Library's "Load to Designer" leaves it.
const loadToDesigner = async () => {
  await resetDesigner();
  await go('/library');
  await page.getByRole('button', { name: 'Load to Designer' }).first().click();
  await page.waitForURL(/\/designer/);
  await page.waitForLoadState('networkidle');
  await settle(600);
};

const ONCE_VALUES = { vial_id: 'A1', boronic_acid_ml: '0.25', catalyst_ml: '0.3', temperature_c: '70', reaction_time_min: '60' };
const fillOnce = async (values = ONCE_VALUES) => {
  for (const [k, v] of Object.entries(values)) await page.locator(`#once-${k}`).fill(v);
};

const ITERATE_ROWS = [
  { vial_id: 'A1', boronic_acid_ml: '0.25', catalyst_ml: '0.2', temperature_c: '50', reaction_time_min: '60' },
  { vial_id: 'A2', boronic_acid_ml: '0.25', catalyst_ml: '0.3', temperature_c: '65', reaction_time_min: '60' },
  { vial_id: 'A3', boronic_acid_ml: '0.25', catalyst_ml: '0.4', temperature_c: '80', reaction_time_min: '60' },
  { vial_id: 'A4', boronic_acid_ml: '0.30', catalyst_ml: '0.3', temperature_c: '95', reaction_time_min: '60' },
];
const fillIterate = async (rows = ITERATE_ROWS) => {
  for (let i = 0; i < rows.length; i++) {
    for (const [k, v] of Object.entries(rows[i])) await page.locator(`input[placeholder^="Enter ${k}"]`).nth(i).fill(v);
  }
};

const runBarButton = (re) => page.locator('button').filter({ has: page.locator(`[title]`) }).filter({ hasText: re });

const varSelect = (name) => page.getByText(name, { exact: true }).first().locator('xpath=following::select[1]');

const scenes = {
  async 'designer-empty'() {
    await resetDesigner();
    await go('/designer');
    await shot('designer-empty');
  },
  async 'library'() {
    await go('/library');
    await shot('library');
  },
  async 'designer-workflow'() {
    await loadToDesigner();
    await shot('designer-workflow');
  },
  async 'designer-step-open'() {
    await loadToDesigner();
    await page.locator('[title="vial_id = #vial_id. Click to edit."]').click();
    await shot('designer-step-open');
  },
  async 'designer-prep-cleanup'() {
    await loadToDesigner();
    await page.locator('button[aria-pressed]:has-text("Prep")').first().click();
    await shot('designer-prep-cleanup', { wait: 700 });
  },
  async 'designer-python'() {
    await loadToDesigner();
    await page.locator('[title="Python and JSON: view, export, import"]').click();
    await page.getByRole('menuitem', { name: 'View as Python' }).click();
    await shot('designer-python', { wait: 900 });
  },
  async 'designer-batch'() {
    await loadToDesigner();
    // "Set Temperature" is the sixth step: mark it as once per batch.
    await page.locator('[title^="Runs for every sample"]').nth(5).click();
    await settle(300);
    await shot('designer-batch-step');
    await go('/execution');
    await fillIterate();
    await page.locator('text=BATCH SIZE').locator('xpath=following::input[1]').fill('2');
    await page.keyboard.press('Tab');
    await shot('run-iterate-batch', { wait: 600 });
  },
  async 'designer-assistant'() {
    await loadToDesigner();
    await page.getByRole('button', { name: 'Assistant' }).click();
    await shot('designer-assistant', { wait: 900 });
  },
  async 'instruments'() {
    await go('/instruments');
    await shot('instruments');
    const volume = page.locator('main input[type="number"]').first();
    await volume.fill('1');
    await page.getByRole('button', { name: 'Execute' }).first().click();
    await shot('instruments-execute', { wait: 1500 });
  },
  async 'once'() {
    await loadToDesigner();
    await go('/once');
    await shot('run-once');
    await fillOnce();
    await shot('run-once-filled');
    await page.getByRole('button', { name: 'Preview' }).click();
    await shot('run-preview', { wait: 900 });
    await page.keyboard.press('Escape');
    await settle(400);
    await page.getByRole('button', { name: /^Run$/ }).click();
    await shot('live-run', { wait: 2500 });
    await page.locator('button[title="Show the steps"]').click();
    await shot('live-run-steps', { wait: 1200 });
    await waitIdle();
  },
  async 'queue'() {
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'A2' });
    await page.getByRole('button', { name: /^Run$/ }).click();
    await settle(800);
    await fillOnce({ ...ONCE_VALUES, vial_id: 'A3', temperature_c: '80' });
    await page.getByRole('button', { name: /Add to Queue|^Run$/ }).click();
    await settle(400);
    const confirm = page.getByRole('button', { name: 'Add to queue' }).last();
    if (await confirm.count()) await confirm.click();
    await settle(800);
    await page.locator('button[title^="Queue"]').first().click();
    await shot('queue-drawer', { wait: 900 });
    await page.keyboard.press('Escape');
    await waitIdle();
  },
  async 'iterate'() {
    await loadToDesigner();
    await go('/execution');
    await shot('run-iterate');
    await fillIterate();
    await shot('run-iterate-filled');
    await page.getByRole('button', { name: /^Run$/ }).click();
    await shot('live-run-iterate', { wait: 3500 });
    await waitIdle(180000);
  },
  async 'run-decision'() {
    // A setpoint above the reactor's own limit: the driver raises, the run waits for a person.
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'B1', temperature_c: '200' });
    await page.getByRole('button', { name: /^Run$/ }).click();
    await page.getByRole('button', { name: 'Retry step' }).waitFor({ timeout: 30000 });
    await shot('run-decision', { wait: 500 });
    await page.getByRole('button', { name: 'Stop run' }).click();
    await settle(600);
    const sure = page.getByRole('button', { name: /^Stop/ }).last();
    if (await sure.isVisible().catch(() => false)) await sure.click();
    await waitIdle();
    await api('POST', '/api/queue/resume');
  },
  async 'user-input'() {
    const res = await api('POST', '/api/queue/runs', {
      name: 'Plate swap',
      parameters: {},
      prep: [],
      sequence: [
        { instrument: 'Flow_Control', method: 'User_Input', params: { prompt: 'Swap in the next plate, then enter its barcode.', variable_name: 'plate_barcode', input_type: 'str' } },
        { instrument: 'balance', method: 'weigh', params: { settle_seconds: 1 } },
      ],
      cleanup: [],
    });
    const runId = res.run_id ?? res.id ?? res.run?.id;
    await go('/designer');
    await page.getByText('Swap in the next plate').waitFor({ timeout: 20000 });
    await shot('user-input-prompt', { wait: 500 });
    await api('POST', `/api/queue/runs/${runId}/input`, { value: 'PLATE-0042' });
    await waitIdle();
  },
  async 'safety'() {
    await go('/safety');
    await page.getByRole('button', { name: 'reactor' }).click();
    await page.getByLabel('setpoint_c minimum').fill('20');
    await page.getByLabel('setpoint_c maximum').fill('120');
    await page.getByLabel('setpoint_c maximum').locator('xpath=following::select[1]').selectOption('°C');
    await page.getByLabel('setpoint_c maximum').locator('xpath=ancestor::*[self::div][2]').screenshot({ path: path.join(OUT, 'safety-limit-row.png') }).catch(() => {});
    await shot('safety-limits');
    await page.getByRole('button', { name: 'Save' }).click();
    await settle(800);
    await page.getByRole('button', { name: 'Trays' }).click();
    await shot('safety-trays', { wait: 500 });
    await page.getByRole('button', { name: 'States' }).click();
    await shot('safety-states', { wait: 500 });
    await page.getByRole('button', { name: 'Rules' }).click();
    await shot('safety-rules', { wait: 500 });
    // The same bad setpoint again: now refused before anything moves.
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'B2', temperature_c: '200' });
    await shot('run-once-guard-hint', { wait: 400 });
    await page.getByRole('button', { name: /^Run$/ }).click();
    await shot('run-refused', { wait: 1200 });
    await page.keyboard.press('Escape');
    await waitIdle();
  },
  async 'library-versions'() {
    await loadToDesigner();
    await page.locator('[title^="Runs for every sample"]').nth(5).click();
    await settle(300);
    await page.locator('[title="Save this workflow to the library"]').click();
    await settle(1200);
    const anyway = page.getByRole('button', { name: 'Save anyway' });
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await go('/library');
    await page.locator('[title="Version history"]').first().click();
    await shot('library-versions', { wait: 900 });
    await go('/library');
    await page.locator('[title="Edit tags"]').first().click();
    await shot('library-tags', { wait: 600 });
  },
  async 'optimize'() {
    await loadToDesigner();
    await go('/optimize');
    await shot('run-optimize');
    await page.locator('input[type="number"]').nth(0).fill('8');
    await varSelect('vial_id').selectOption('Fixed');
    await varSelect('vial_id').locator('xpath=following::input[1]').fill('C1');
    await varSelect('boronic_acid_ml').selectOption('Fixed');
    await varSelect('boronic_acid_ml').locator('xpath=following::input[1]').fill('0.25');
    await varSelect('catalyst_ml').locator('xpath=following::input[1]').fill('0.1');
    await varSelect('catalyst_ml').locator('xpath=following::input[2]').fill('0.5');
    await varSelect('temperature_c').locator('xpath=following::input[1]').fill('40');
    await varSelect('temperature_c').locator('xpath=following::input[2]').fill('100');
    await varSelect('reaction_time_min').selectOption('Fixed');
    await varSelect('reaction_time_min').locator('xpath=following::input[1]').fill('60');
    await page.keyboard.press('Tab');
    await shot('run-optimize-filled', { wait: 600 });
    await page.getByRole('button', { name: 'Start Optimization' }).click();
    await settle(400);
    const confirm = page.getByRole('button', { name: /^(Run|Start|Add to queue)/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await shot('live-run-optimize', { wait: 9000 });
    await waitIdle(600000);
  },
  async 'data-history'() {
    // A run that ended in the last 10 s still shows as a floating card; let it go first.
    await settle(11000);
    await go('/data');
    await shot('data-history');
    await page.getByText(/Run #1\b/).first().click();
    await shot('data-history-run', { wait: 1200 });
    const opt = page.getByText(/^optimization$/i).first();
    if (await opt.isVisible().catch(() => false)) {
      await opt.click();
      await shot('data-history-optimization', { wait: 5000 });
      const plots = page.getByText(/optimizer plots/i).first();
      if (await plots.isVisible().catch(() => false)) {
        await plots.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 120);
        await shot('data-history-plots', { wait: 1500 });
      }
    }
  },
  async 'settings'() {
    await go('/settings');
    await shot('settings');
  },
  async 'cloud-connect'() {
    await go('/cloud');
    await shot('cloud-connect');
  },
};

let failed = 0;
for (const [name, run] of Object.entries(scenes)) {
  if (only.size && !only.has(name)) continue;
  console.log(name);
  try {
    await run();
  } catch (e) {
    failed++;
    console.error(`  failed: ${e.message.split('\n')[0]}`);
  }
}
await browser.close();
if (failed) process.exit(1);
