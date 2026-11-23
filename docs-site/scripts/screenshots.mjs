// Takes every annotated picture the documentation uses, from the deck scripts/docs-deck.py serves
// on http://localhost:8090 (IVORYOS_DOCS_EDGE overrides it). Each scene is one documented state of
// the app with its notes: what each ring goes round and what the note beside it says
// (annotate.mjs). Re-run this after an interface change and every picture in the docs is current.
//
//   uv run --project edge_server python docs-site/scripts/docs-deck.py   (in one terminal)
//   npm run screenshots                                                   (in docs-site/)
//   npm run screenshots -- designer library                                (only these scenes)
//
// It drives the Google Chrome already installed (Playwright's `chrome` channel), so nothing is
// downloaded. Pictures are 1180x760 at 2x, light theme, the top-bar navigation (what the desktop
// app shows), saved as WebP under src/assets/annotated/ with their notes' words in notes.json.
//
// Writing a note: a title of two or three words, then one short sentence in the words the
// interface uses. Two to five notes a picture. Sentence case, no full stop after a title.

import { chromium } from 'playwright';
import { saveShot, VIEW } from './shots.mjs';

const EDGE = process.env.IVORYOS_DOCS_EDGE || 'http://localhost:8090';
const only = new Set(process.argv.slice(2));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, colorScheme: 'light' });
// Light theme and the top bar, whatever this browser profile last chose.
await context.addInitScript(() => {
  try {
    localStorage.setItem('ivoryos-theme', 'light');
    localStorage.setItem('ivoryos-nav', 'top');
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

const shot = async (name, notes = [], opts = {}) => {
  await settle(opts.wait ?? 300);
  const file = await saveShot(page, name, notes, opts);
  console.log('  ', file.split('/src/')[1]);
};

// A box round several things, or part of the window, for a clip or a ring.
const box = async (...targets) => {
  const boxes = [];
  for (const t of targets) boxes.push(await (typeof t === 'string' ? page.locator(t).first() : t).boundingBox());
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};
const grow = (b, by) => ({ x: Math.max(0, b.x - by), y: Math.max(0, b.y - by), width: b.width + 2 * by, height: b.height + 2 * by });

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
const KEPT = ['ivoryos_cached_schema', 'ivoryos_notify_declined'];
const resetDesigner = async () => {
  await page.goto(`${EDGE}/designer`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((kept) => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('ivoryos_') && !kept.includes(k)) localStorage.removeItem(k);
  }, KEPT);
};

const SUZUKI = 'Suzuki coupling screen';
const FIRST = 'My first workflow';
// The top of the window, for a picture whose lower half would be empty page.
const TOP = { x: 0, y: 0, width: VIEW.width, height: 440 };
const libraryCard = (name) => page.locator('h3', { hasText: name }).locator('xpath=ancestor::div[.//button[contains(., "Load to Designer")]][1]');

// A saved workflow on the canvas, as the Library's "Load to Designer" leaves it.
const loadToDesigner = async (name = SUZUKI) => {
  await resetDesigner();
  await go('/library');
  await libraryCard(name).getByRole('button', { name: 'Load to Designer' }).click();
  await page.waitForURL(/\/designer/);
  await page.waitForLoadState('networkidle');
  await settle(600);
};

// The Designer's parts.
const toolbox = '[data-rfd-droppable-id="toolbox"]';
const canvas = '[data-rfd-droppable-id="canvas"]';
const steps = () => page.locator('[data-step-key^="canvas:"]');
const arg = (text) => page.locator(`[title="${text}. Click to edit."]`);
const phaseTab = (phase) => page.locator(`button[title^="${phase} runs"]`);
const headerButton = (title) => page.locator(`[title^="${title}"]`).first();

const runTab = (name) => page.getByRole('link', { name, exact: true });
const runBarButton = (title) => page.locator(`button[title^="${title}"]`).first();

// Pick a step up in the toolbox (by the start of its description) and carry it to the end of the
// canvas; `during` runs while it is held, for a picture of the drag itself.
const chip = (title) => page.locator(`${toolbox} div[title^="${title}"]`).first();
const drag = async (title, during) => {
  await chip(title).scrollIntoViewIfNeeded();
  const from = await chip(title).boundingBox();
  const onto = await page.locator(canvas).boundingBox();
  const last = await steps().last().boundingBox().catch(() => null);
  const to = { x: onto.x + onto.width / 2, y: last ? last.y + last.height + 24 : onto.y + onto.height / 2 };
  await page.mouse.move(from.x + 60, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await settle(250);
  if (during) await during();
  await page.mouse.up();
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
// A cell of the Iterate table, by row (from 0) and column name.
const cell = (row, column) => page.locator('tbody tr').nth(row).locator(`td:nth-child(${COLUMNS.indexOf(column) + 2}) input`).first();
const COLUMNS = Object.keys(ITERATE_ROWS[0]);
const fillIterate = async (rows = ITERATE_ROWS) => {
  for (let i = 0; i < rows.length; i++) for (const [k, v] of Object.entries(rows[i])) await cell(i, k).fill(v);
};

// While writing a scene: IVORYOS_DOCS_DUMP=1 prints what is on the page, to find what to point at.
const dump = async (label) => {
  if (!process.env.IVORYOS_DOCS_DUMP) return;
  const text = await page.evaluate((max) => {
    const out = [];
    for (const e of document.querySelectorAll('button,a,input,select,textarea,[title],h1,h2,h3,label,th')) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.y > innerHeight || r.bottom < 44) continue;
      const a = (n) => (e.getAttribute(n) ? ` ${n}=${JSON.stringify(e.getAttribute(n).slice(0, 60))}` : '');
      out.push(`${e.tagName.toLowerCase()} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}${a('title')}${a('aria-label')}${a('placeholder')} ${JSON.stringify((e.innerText || e.value || '').replace(/\s+/g, ' ').slice(0, 40))}`);
    }
    return out.slice(0, max).join('\n');
  }, Number(process.env.IVORYOS_DOCS_DUMP) > 1 ? Number(process.env.IVORYOS_DOCS_DUMP) : 40);
  console.log(`--- ${label}\n${text}\n---`);
};

// The limits, tray, state and rule the Safety pictures show (edge_server/ivoryos_edge/safety.py).
const SAFETY = {
  format: 'ivoryos-safety/1',
  enabled: true,
  trays: { vial_rack: { label: 'Vial rack', rows: 4, columns: 6, naming: 'A1', order: 'row', blocked: ['D6'] } },
  states: { vial: { label: 'Vial in the block', values: ['none', 'loaded'], set_by: [{ target: 'reactor', method: 'load_vial', value: 'loaded' }] } },
  limits: [
    { target: 'reactor', method: 'set_temperature', param: 'setpoint_c', min: 20, max: 120, unit: '°C' },
    { target: 'class:SyringePump', method: 'dispense', param: 'volume_ml', min: 0, max: 2, unit: 'mL' },
    { target: 'reactor', method: 'load_vial', param: 'vial_id', tray: 'vial_rack' },
  ],
  rules: [{
    id: 'hot', name: 'No dispensing into a hot vial', enabled: true,
    when: { target: 'class:SyringePump', method: 'dispense' },
    if: [],
    require: [{ left: { read: 'reactor.read_temperature' }, op: '<=', right: { value: 60 } }],
    message: 'Cool the reactor below 60 °C before dispensing.',
  }],
};

const SAFETY_NOTES = {
  Trays: () => [
    { at: [page.getByText('96-well plate'), page.getByText('Custom', { exact: true })], title: 'Add a tray', text: 'Start from a common plate or rack, or set your own size.', side: 'right', align: 'center' },
    { at: ['input[value="Vial rack"]', page.locator('select', { hasText: 'letter row' }).first()], title: 'Size and naming', text: 'Rows, columns, and how its positions are written: A1, A01 or numbers.', side: 'right', align: 'center' },
    { at: page.getByText('D6', { exact: true }).first(), title: 'Blocked position', text: 'Click a position to block it. It stays on the tray but may not be used.', side: 'right', align: 'center' },
    { at: page.getByText(/used by reactor/), title: 'Where it is used', text: 'The field that only takes this tray’s positions.', side: 'below', align: 'start' },
  ],
  States: () => [
    { at: 'input[value="Vial in the block"]', title: 'A state', text: 'A condition of the deck, in your lab’s own words.', side: 'above', align: 'start' },
    { at: [page.getByText('the calls that change it'), page.getByText('a reading of the instrument')], title: 'How it is known', text: 'From the calls that change it, or by asking an instrument each time.', side: 'above', align: 'start', dx: 120 },
    { at: [page.locator('select', { hasText: 'load vial' }).first(), page.locator('select', { hasText: 'always' }).first()], title: 'A call that changes it', text: 'After **reactor.load_vial** the state is **loaded**.', side: 'below', align: 'start' },
    { at: [page.getByText('Now', { exact: true }), page.locator('select', { hasText: 'it is' }).first()], title: 'Now', text: 'Its value at this moment. Set it by hand if it is unknown.', side: 'below', align: 'end' },
  ],
  Rules: () => [
    { at: [page.getByText(/^when$/i).first(), page.locator('select', { hasText: 'dispense' }).last()], title: 'When', text: 'The call the rule watches for.', side: 'above', align: 'start', dx: 300 },
    { at: [page.getByText(/^require$/i).first(), 'input[value="60"]'], title: 'Require', text: 'What must hold at that moment. A reading is taken from the instrument right then.', side: 'below', align: 'end', dy: 60 },
    { at: [page.getByText(/^otherwise$/i).first(), 'input[value^="Cool the reactor"]'], title: 'Otherwise', text: 'The call is blocked and the person is told this.', side: 'below', align: 'start' },
  ],
};

const scenes = {
  async 'designer'() {
    await resetDesigner();
    await go('/designer');
    await shot('designer-empty', [
      { at: toolbox, title: 'Toolbox', text: 'Everything this deck can do. Each instrument method is one step.', side: 'right', align: 'center' },
      { at: canvas, title: 'Canvas', text: 'Drag a step here. Steps run top to bottom.', side: 'inside', align: 'center center' },
      { at: 'button[title^="Turn on #auto"]', title: '#auto', text: 'On: a dropped step leaves every value open, to fill in at run time.', side: 'below' },
    ]);

    await loadToDesigner();
    await shot('designer-overview', [
      { at: toolbox, title: 'Toolbox', text: 'Logic steps, saved workflows, then every method of every instrument.', side: 'right', align: 'end' },
      { at: [phaseTab('Prep'), phaseTab('Cleanup')], title: 'Phases', text: 'Prep runs once first, **Main** for every sample, Cleanup once last.', side: 'below', align: 'start' },
      { at: steps().nth(5), title: 'A step', text: 'One line that reads like its call: instrument, method, arguments.', side: 'below', align: 'center' },
      { at: [headerButton('Fill in the #variables'), headerButton('Optimize this')], title: 'Run it', text: 'Configure asks for the open values. Optimize lets an optimizer choose them.', side: 'below', align: 'end' },
    ]);
    await shot('designer-header', [
      { at: 'input[value="Suzuki coupling screen"]', title: 'Name', text: 'How the workflow is saved and found.', side: 'below', align: 'start' },
      { at: headerButton('Start a new'), title: 'New', text: 'Start an empty workflow.', side: 'below', align: 'end', dx: -190 },
      { at: headerButton('Save this workflow'), title: 'Save', text: 'Adds a version to the Library.', side: 'below', align: 'center', dy: 110 },
      { at: headerButton('Python and JSON'), title: 'More', text: 'View as Python, export or import JSON.', side: 'below', align: 'start', dx: 60 },
    ], { clip: { x: 0, y: 40, width: VIEW.width, height: 400 } });
  },

  async 'once'() {
    await loadToDesigner();
    await go('/once');
    await fillOnce();
    await shot('run-once', [
      { at: [runTab('Once'), runTab('Stages')], title: 'Ways to run', text: 'Once is one sample. Iterate is a table of them. Optimize lets an optimizer choose.', side: 'right', align: 'start' },
      { at: ['label[title="vial_id"]', '#once-reaction_time_min'], title: 'One field per #variable', text: 'Typed as the driver declares it. An empty field offers **None** or the driver’s default.', side: 'right', align: 'center', pad: 10 },
      { at: page.getByRole('button', { name: 'Preview' }), title: 'Preview', text: 'Every call this run will make, before anything moves.', side: 'right', align: 'start' },
      { at: page.getByRole('button', { name: /^Run$/ }), title: 'Run', text: 'Starts now. Reads **Add to queue** while another run is going.', side: 'below', align: 'start' },
    ]);
    await page.getByRole('button', { name: 'Preview' }).click();
    await settle(900);
    await shot('run-preview', [
      { at: page.getByText('16 steps').first().locator('xpath=..'), title: 'What will run', text: 'Linked workflows are expanded: this is exactly what is queued.', side: 'right', xy: [900, 120], width: 250 },
      { at: page.getByText('Prep', { exact: true }).first().locator('xpath=..'), title: 'Prep, once', text: 'Before the first sample. Cleanup, at the end, also runs once.', xy: [14, 170], width: 180 },
      { at: page.locator('[title^="Runs once for each row"]').first(), title: 'Per sample', text: 'Main steps repeat for every row. A batch step shows ×1 per batch.', xy: [985, 470], width: 185 },
    ]);
    await page.keyboard.press('Escape');
    await settle(400);
    await page.getByRole('button', { name: /^Run$/ }).click();
    await waitIdle();
  },

  async 'live-run'() {
    // A long hold, so the run is still on it while the pictures are taken.
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'A2', reaction_time_min: '300' });
    await page.getByRole('button', { name: /^Run$/ }).click();
    await page.getByText(/reactor\.hold/).first().waitFor({ timeout: 30000 });
    const bar = { x: 0, y: 380, width: VIEW.width, height: VIEW.height - 380 };
    await shot('live-run', [
      { at: [page.locator('div[title*=" Run #"]').last(), page.locator('span[title$="steps"]').first()], title: 'What it is doing', text: 'The run’s name, the step it is on, and how far along.', side: 'above', align: 'start' },
      { at: runBarButton('Pause after'), title: 'Pause', text: 'After the current step. The same button resumes.', side: 'above', align: 'end', dx: -210 },
      { at: [runBarButton('Stop after this iteration'), runBarButton('Stop now')], title: 'Stop', text: 'The flag finishes this sample first. The square stops now, without cleanup.', side: 'above', align: 'end', dy: -110 },
      { at: [runBarButton('Queue'), runBarButton('Show the steps')], title: 'Queue and steps', text: 'What waits behind this run, and every step with its result.', side: 'above', align: 'end' },
    ], { clip: bar, wait: 100 });
    await runBarButton('Show the steps').click();
    await settle(700);
    await shot('live-run-steps', [
      { at: page.locator('[data-run-active]').first(), title: 'Running now', text: 'Finished steps are ticked. The list follows the step in progress.', side: 'above', align: 'start', dx: 40 },
      { at: page.locator('button[title="Change this step before it runs"]').first(), title: 'Change a step', text: 'Edit the values of a step that has not run yet.', side: 'above', align: 'end', dy: -40 },
      { at: page.locator('[title^="Drag to resize the steps"]'), title: 'Resize', text: 'Drag to make the list taller. Double-click to reset.', side: 'above', align: 'center', pad: 4 },
    ], { wait: 100 });
    await waitIdle();
  },

  async 'queue'() {
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'A3', reaction_time_min: '300' });
    await page.getByRole('button', { name: /^Run$/ }).click();
    await settle(800);
    const waiting = async () => (await api('GET', '/api/queue/runs?recent=10')).runs.filter((r) => r.status === 'pending').length;
    for (const [vial, temp] of [['A4', '80'], ['A5', '90']]) {
      const before = await waiting();
      await fillOnce({ ...ONCE_VALUES, vial_id: vial, temperature_c: temp });
      await page.getByRole('button', { name: /Add to Queue/i }).first().click();
      // Asked whether to queue behind the run under way.
      const confirm = page.getByRole('button', { name: 'Add to queue', exact: true }).last();
      for (let i = 0; i < 20 && (await waiting()) === before; i++) {
        if (await confirm.isVisible().catch(() => false)) await confirm.click().catch(() => {});
        await settle(250);
      }
    }
    await runBarButton('Queue').click();
    await settle(700);
    const section = (label) => page.getByText(label).last().locator('xpath=following::div[contains(@class,"rounded")][1]');
    await shot('queue-drawer', [
      { at: section(/^now$/i), title: 'Now', text: 'The run under way. The deck runs one at a time.', side: 'left', align: 'start' },
      { at: page.getByText(/^up next/i).last().locator('xpath=following::*[contains(@class,"rounded")][1]'), title: 'Up next', text: 'What waits, in order. Rename it, change its values, move it sooner or later, or remove it.', side: 'left', align: 'start', dy: 40 },
    ], { keep: page.getByText('Queue', { exact: true }).last().locator('xpath=ancestor::div[contains(@class,"fixed") or contains(@class,"absolute")][1]'), wait: 200 });
    await page.keyboard.press('Escape');
    await waitIdle(120000);
  },

  async 'library'() {
    await go('/library');
    const card = libraryCard(SUZUKI);
    await shot('library', [
      { at: card.locator('[title="Edit tags"]'), title: 'Tags', text: 'Add any number. Chips above the list filter by them.', side: 'right', align: 'center' },
      { at: card.locator('[title="Version history"]'), title: 'Version history', text: 'Every save is kept. Open any of them in the Designer.', side: 'below', align: 'start' },
      { at: card.getByRole('button', { name: 'Load to Designer' }), title: 'Load to Designer', text: 'Puts the workflow on the canvas to edit or run.', side: 'right', align: 'start' },
      { at: 'label[title^="List workflows that won"]', title: 'Working first', text: 'Workflows this deck can no longer run go last, with a badge.', side: 'below', align: 'end' },
    ]);
  },
  async 'iterate'() {
    await loadToDesigner();
    await go('/execution');
    await fillIterate();
    await shot('run-iterate', [
      { at: 'thead th:nth-child(5)', title: 'One column per #variable', text: 'With the type the driver expects under its name.', side: 'above', align: 'center', pad: 0 },
      { at: page.locator('tbody tr').nth(0), title: 'One row per sample', text: 'Rows run top to bottom. A row left empty is not a sample.', side: 'below', align: 'start', dx: 60, pad: 0 },
      { at: ['label:has-text("Import CSV")', page.getByRole('button', { name: 'Export CSV' })], title: 'CSV in and out', text: 'Bring samples from a spreadsheet, or save these.', side: 'right', align: 'end' },
      { at: [page.getByText('BATCH SIZE'), page.getByText('BATCH SIZE').locator('xpath=following::input[1]')], title: 'Batch size', text: 'How many rows share one once-per-batch step. 1 runs each row start to finish.', side: 'left', align: 'end' },
    ]);
    await page.getByRole('button', { name: /^Run$/ }).click();
    await page.getByText(/sample 2|row 2/i).first().waitFor({ timeout: 30000 }).catch(() => {});
    await runBarButton('Show the steps').click();
    await shot('live-run-iterate', [
      { at: page.locator('[data-run-active]').first(), title: 'Sample by sample', text: 'The badge says which sample the run is on. Each row runs the whole of Main.', side: 'above', align: 'start', dx: 60 },
      { at: runBarButton('Change, add or remove'), title: 'Change what is left', text: 'Edit, add or remove samples the run has not reached.', side: 'above', align: 'end', dx: -80 },
    ], { wait: 600 });
    await waitIdle(180000);
  },

  async 'batch'() {
    await loadToDesigner();
    // "Set Temperature" is the sixth step: mark it as once per batch.
    await page.locator('[title^="Runs for every sample"]').nth(5).click();
    await settle(300);
    const y = (await steps().nth(5).boundingBox()).y;
    await shot('designer-batch', [
      { at: steps().nth(5).locator('button[title*="per batch"], button[title*="batch"]').first(), title: 'Once per batch', text: 'Click the layers icon. Purple means the step runs once for a group of rows, not for each.', side: 'below', align: 'end' },
    ], { clip: { x: 250, y: y - 150, width: VIEW.width - 250, height: 360 } });
    await go('/execution');
    await fillIterate();
    await page.getByText('BATCH SIZE').locator('xpath=following::input[1]').fill('2');
    await page.keyboard.press('Tab');
    await shot('run-iterate-batch', [
      { at: page.getByText('1/batch').first(), title: 'Once per batch', text: 'This column feeds a batch step: one value for each group.', side: 'above', align: 'center' },
      { at: page.getByText('Batch 2').first(), title: 'Groups', text: 'A purple line starts each group of rows.', side: 'left', align: 'center', dx: 250, dy: 150 },
      { at: cell(1, 'temperature_c'), title: 'First row counts', text: 'Greyed cells are ignored: the group takes its first row’s value.', side: 'right', align: 'start' },
    ], { wait: 600 });
  },

  async 'run-decision'() {
    // A setpoint above the reactor's own limit: the driver raises, the run waits for a person.
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'B1', temperature_c: '200' });
    await page.getByRole('button', { name: /^Run$/ }).click();
    const retry = page.getByRole('button', { name: 'Retry step' });
    await retry.waitFor({ timeout: 30000 });
    const dialog = retry.locator('xpath=ancestor::div[contains(@class,"rounded")][last()]');
    await shot('run-decision', [
      { at: page.getByText('exceeds the block limit').first().locator('xpath=..'), title: 'What went wrong', text: 'The step and its error. The run and the queue wait for you.', side: 'right', align: 'center' },
      { at: page.getByRole('button', { name: /Change values/ }), title: 'Change and retry', text: 'Correct the step’s values, then run it again.', side: 'left', align: 'end' },
      { at: [retry, page.getByRole('button', { name: 'Skip step' })], title: 'Retry or skip', text: 'Run the step again as it is, or go on without it.', side: 'below', align: 'start', dx: -120 },
      { at: [page.getByRole('button', { name: /Stop, run/ }), page.getByRole('button', { name: 'Stop run' })], title: 'Stop', text: 'With cleanup first, or at once, leaving the deck as it is.', side: 'right', align: 'center' },
    ], { keep: dialog, wait: 500 });
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
    const answer = page.getByPlaceholder('Type your answer...');
    await shot('user-input-prompt', [
      { at: page.getByText('Swap in the next plate, then enter its barcode.'), title: 'The step’s message', text: 'Shown on whichever page you are on. The run waits.', side: 'left', align: 'center' },
      { at: [answer, page.getByRole('button', { name: 'Continue Workflow' })], title: 'Answer and continue', text: 'The answer is saved under the step’s variable name for later steps.', side: 'right', align: 'center' },
      { at: page.getByText('answer', { exact: true }).last(), title: 'Answer later', text: 'Minimised, the prompt waits here.', side: 'above', align: 'end' },
    ], { keep: answer.locator('xpath=ancestor::div[contains(@class,"rounded")][last()]'), wait: 500 });
    await api('POST', `/api/queue/runs/${runId}/input`, { value: 'PLATE-0042' });
    await waitIdle();
  },

  async 'optimize'() {
    await loadToDesigner();
    await go('/optimize');
    await page.locator('input[type="number"]').nth(0).fill('8');
    const row = (name) => page.locator(`span[title="${name}"]`).first();
    const kind = (name) => row(name).locator('xpath=following::select[1]');
    const field = (name, n) => row(name).locator(`xpath=following::input[${n}]`);
    if (process.env.IVORYOS_DOCS_DUMP) console.log(await kind('vial_id').evaluate((el) => [...el.options].map((o) => o.textContent).join(' | ')));
    for (const [name, value] of [['vial_id', 'C1'], ['boronic_acid_ml', '0.25'], ['reaction_time_min', '60']]) {
      await kind(name).selectOption({ label: 'Fixed' });
      await field(name, 1).fill(value);
    }
    await field('catalyst_ml', 1).fill('0.1');
    await field('catalyst_ml', 2).fill('0.5');
    await field('temperature_c', 1).fill('40');
    await field('temperature_c', 2).fill('100');
    await page.keyboard.press('Tab');
    await shot('run-optimize', [
      { at: [page.getByText('OPTIMIZER ENGINE'), page.getByText('OPTIMIZER ENGINE').locator('xpath=following::select[1]')], title: 'Engine', text: 'The optimizer that suggests each trial.', side: 'below', align: 'start', dy: 20 },
      { at: [page.getByText('EVALUATION BUDGET'), page.getByText('BATCH SIZE').locator('xpath=following::input[1]')], title: 'Budget and batch', text: 'How many trials in all, and how many are suggested at a time.', side: 'right', align: 'center' },
      { at: [row('temperature_c'), field('temperature_c', 3)], title: 'Search space', text: 'A range, a list of choices, or a fixed value for each #variable.', side: 'below', align: 'end', dx: 240, pad: 8 },
    ], { wait: 600 });
    const start = page.getByRole('button', { name: 'Start Optimization' });
    await page.locator('h3', { hasText: 'Objectives' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.mouse.move(600, 400);
    await page.mouse.wheel(0, -90);
    await settle(400);
    await shot('run-optimize-objectives', [
      { at: [row('yield_percent'), row('yield_percent').locator('xpath=following::select[1]')], title: 'Objective', text: 'Any number a step saves. Maximize or minimize it.', side: 'right', align: 'center', dx: 200, pad: 8 },
      { at: row('yield_percent').locator('xpath=following::label[1]'), title: 'Stop early', text: 'End the campaign once a trial reaches this value.', side: 'above', align: 'start', dx: 60 },
      { at: page.locator('h3', { hasText: 'Existing Data' }).locator('xpath=..'), title: 'Existing data', text: 'Start from earlier runs or a CSV instead of from nothing.', side: 'inside', align: 'end start' },
    ], { wait: 300 });
    await start.scrollIntoViewIfNeeded();
    await settle(300);
    await shot('run-optimize-start', [
      { at: start, title: 'Start', text: 'Prep runs once, then one trial after another until the budget is used.', side: 'above', align: 'end' },
      { at: page.getByRole('button', { name: 'Suggest only' }), title: 'Suggest only', text: 'Get suggestions to run by hand, and enter the results yourself.', side: 'left', align: 'end' },
    ], { clip: { x: 0, y: 380, width: VIEW.width, height: 380 }, wait: 200 });
    await start.click();
    await settle(400);
    const confirm = page.getByRole('button', { name: /^(Run|Start|Add to queue)/ }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.getByText(/iteration 3|trial 3/i).first().waitFor({ timeout: 120000 }).catch(() => {});
    await runBarButton('Show the steps').click().catch(() => {});
    await shot('live-run-optimize', [
      { at: page.getByText(/^iteration \d+\/\d+/).first().locator('xpath=ancestor::div[1]/..'), title: 'Trial by trial', text: 'Green trials are done. Each one runs the whole of Main with new values.', side: 'above', align: 'start', dx: 300 },
      { at: page.getByRole('button', { name: 'change budget' }), title: 'Change budget', text: 'Add trials or end sooner while it runs.', side: 'right', align: 'center', pad: 4 },
    ], { wait: 800 });
    await waitIdle(600000);
  },

  async 'data-history'() {
    // A run that ended in the last 10 s still shows as a floating card; let it go first.
    await settle(11000);
    await go('/data');
    await page.getByText(/Run #1\b/).first().click();
    await settle(1200);
    await shot('data-history-list', [
      { at: ['input[placeholder="Search runs..."]', page.getByRole('button', { name: 'Select' })], title: 'Search', text: 'By name, a value, an instrument or a method. **Select** deletes several at once.', side: 'right', align: 'start' },
      { at: ['select[title="Sort order"]', 'select[title^="Show only runs"]'], title: 'Sort and filter', text: 'Newest, oldest, by name or length, and by status.', side: 'right', align: 'start', dy: 120 },
      { at: page.getByText(/Run #1\b/).first().locator('xpath=ancestor::*[self::button or self::div][2]'), title: 'A run', text: 'Green finished, amber finished with issues, red failed. Click to open it.', side: 'right', align: 'center' },
    ], { clip: { x: 0, y: 44, width: 700, height: VIEW.height - 44 } });
    const section = (name) => page.locator('h3', { hasText: name }).first().locator('xpath=../..');
    await shot('data-history-run', [
      { at: section(/timeline/i), title: 'Timeline', text: 'One bar per step, to scale. Prep, each sample and cleanup are marked above.', side: 'left', align: 'start' },
      { at: section(/^data$/i), title: 'Data', text: 'One row per sample: the values it was given, then the values its steps saved.', side: 'left', align: 'start' },
      { at: [page.locator('button[title^="Download the data table"]'), page.locator('button[title^="Download the step log"]')], title: 'Export', text: '**Data** is this table as CSV. **Log** is every step.', side: 'left', align: 'start' },
    ]);
    await page.locator('span[title="reactor.load_vial"]').first().scrollIntoViewIfNeeded();
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 260);
    await settle(500);
    await shot('data-history-steps', [
      { at: page.getByText('ran once').first().locator('xpath=ancestor::*[self::button or self::div][1]'), title: 'Prep and cleanup', text: 'Each ran once. Click a line to open its steps.', side: 'left', align: 'start' },
      { at: page.locator('span[title^="setpoint_c=70"]').first(), title: 'From a #variable', text: 'A coloured value came from the run’s inputs.', side: 'left', align: 'center', dx: -250 },
      { at: page.getByText('absorbance_312').last().locator('xpath=..'), title: 'What a step saved', text: 'The result, under the name the workflow gave it.', side: 'below', align: 'end' },
    ]);
  },

  async 'instruments'() {
    await go('/instruments');
    const card = page.getByRole('button', { name: 'Execute' }).first().locator('xpath=ancestor::div[.//h3 or .//h2][1]');
    await shot('instruments', [
      { at: [page.locator('button', { hasText: 'Pump 1' }), page.locator('button', { hasText: 'Hplc' })], title: 'Instruments', text: 'Everything on the deck, each with its number of methods.', side: 'below', align: 'start' },
      { at: page.getByRole('button', { name: 'Execute' }).first(), title: 'Execute', text: 'Fill in the fields and run the method now, outside the queue.', side: 'right', align: 'center' },
      { at: page.getByLabel('Limit on cycles'), title: 'Limit', text: 'Set the range this field may take, or its unit.', side: 'below', align: 'end', pad: 3, dy: 130 },
      { at: [page.locator('button[title^="Restart the edge"]'), page.locator('button[title^="Recorded versions"]')], title: 'Restart and deck version', text: 'Restart reloads the drivers. The version changes when the instruments do.', side: 'left', align: 'start' },
    ]);
    await page.locator('main input[type="number"], input[placeholder="float"]').first().fill('1');
    await page.getByRole('button', { name: 'Execute' }).first().click();
    await settle(1500);
    await shot('instruments-execute', [
      { at: [page.locator('h3', { hasText: /action log/i }), page.getByText('vial_volume_ml').first(), page.getByText('SUCCESS').first()], title: 'Action log', text: 'Each call you make here, with what it returned or the error it raised.', side: 'above', align: 'center', pad: 8 },
    ], { clip: { x: 0, y: 250, width: VIEW.width, height: VIEW.height - 250 } });
  },

  async 'settings'() {
    await go('/settings');
    await shot('settings', [
      { at: [page.getByText('Theme', { exact: true }), page.getByRole('button', { name: 'Dark' })], title: 'Theme', text: 'Light, dark, or whatever the computer uses.', side: 'right', align: 'center' },
      { at: [page.getByText('Navigation', { exact: true }), page.getByRole('button', { name: 'Top bar' })], title: 'Navigation', text: 'Pages down the left, or along the top as in the desktop app.', side: 'right', align: 'center', dy: 40 },
      { at: [page.getByText('When a run waits for input or a step fails'), page.getByRole('button', { name: 'Turn on' })], title: 'Notifications', text: 'Tell me when a run waits for input or a step fails.', side: 'below', align: 'start' },
    ], { clip: { x: 0, y: 44, width: VIEW.width, height: 400 } });
  },

  async 'data-optimization'() {
    await go('/data');
    await page.getByText(/optimization/i).first().click();
    await settle(3000);
    const section = (name) => page.locator('h3', { hasText: name }).first().locator('xpath=../..');
    await shot('data-history-optimization', [
      { at: section(/configuration/i), title: 'Configuration', text: 'The engine, the budget, the search space and the objectives the run used.', side: 'left', align: 'start' },
      { at: section(/optimizer plots/i), title: 'Optimizer plots', text: 'Drawn by the optimizer itself, for the latest optimization since the deck started.', side: 'left', align: 'start' },
    ], { wait: 500 });
    await page.locator('h3', { hasText: /^data$/i }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -80);
    await settle(500);
    await shot('data-history-trials', [
      { at: section(/^data$/i), title: 'One row per trial', text: 'What the optimizer suggested, then the objectives the trial measured.', side: 'left', align: 'start' },
    ]);
  },

  async 'safety'() {
    await api('PUT', '/api/safety', { config: SAFETY });
    await go('/safety');
    await page.locator('button', { hasText: 'Reactor' }).first().click();
    await settle(400);
    const max = page.getByLabel('setpoint_c maximum');
    await max.scrollIntoViewIfNeeded();
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 140);
    await settle(400);
    const tabs = (name) => page.locator('button', { hasText: name }).first();
    await shot('safety-limits', [
      { at: [tabs('Limits'), tabs('Blocked')], title: 'Four kinds of guard', text: 'Limits on a field, trays of positions, deck states, and rules between instruments.', side: 'right', align: 'start' },
      { at: [page.getByLabel('setpoint_c minimum'), max.locator('xpath=following::select[1]')], title: 'A limit', text: 'The lowest and highest value this field may take, and the unit its numbers are in.', side: 'above', align: 'end', dx: 250 },
      { at: page.locator('button', { hasText: 'Reactor' }).first(), title: 'Per instrument', text: 'The number is how many limits it has.', side: 'below', align: 'start', dy: 110 },
      { at: page.getByRole('button', { name: 'Save' }), title: 'Save', text: 'Nothing changes until you save. Then it holds for every run and every manual call.', side: 'below', align: 'end' },
    ], { wait: 300 });
    for (const tab of ['Trays', 'States', 'Rules']) {
      await page.locator('button', { hasText: tab }).first().click();
      await settle(500);
      await dump(`safety ${tab}`);
      await shot(`safety-${tab.toLowerCase()}`, SAFETY_NOTES[tab]());
    }
    // A setpoint past the limit: marked as it is typed, and refused before anything moves.
    await loadToDesigner();
    await go('/once');
    await fillOnce({ ...ONCE_VALUES, vial_id: 'B2', temperature_c: '200' });
    await settle(400);
    await shot('run-once-guard-hint', [
      { at: ['#once-temperature_c', page.getByText('200 is above the maximum of 120 °C')], title: 'Marked as you type', text: 'A value past its limit turns red and says why.', side: 'right', align: 'center' },
      { at: page.getByText('0 to 2 mL').first(), title: 'The limit', text: 'Shown under the field, in its unit.', side: 'right', align: 'center' },
      { at: page.locator('#once-vial_id').locator('xpath=following::button[1]'), title: 'Pick a position', text: 'A field limited to a tray opens the tray to choose from.', side: 'right', align: 'center' },
    ]);
    await page.getByRole('button', { name: /^Run$/ }).click();
    await settle(1200);
    const refused = page.getByText('Could not start the run');
    await shot('run-refused', [
      { at: refused.locator('xpath=following::*[1]'), title: 'Refused before anything moves', text: 'The message names the step, the value and the limit it broke.', side: 'right', align: 'center' },
    ], { keep: refused.locator('xpath=ancestor::div[contains(@class,"rounded")][last()]') });
    await page.keyboard.press('Escape');
    await waitIdle();
  },

  async 'cloud-connect'() {
    await go('/cloud');
    await shot('cloud-connect', [
      { at: page.getByPlaceholder('This computer’s name').or(page.getByPlaceholder("This computer's name")), title: 'Device name', text: 'How this deck is listed in Cloud. You can change it when you approve.', side: 'left', align: 'center' },
      { at: page.getByRole('button', { name: 'Connect to Cloud' }), title: 'Connect', text: 'Shows a code. Enter it in Cloud to approve this deck.', side: 'right', align: 'center' },
    ]);
  },

  async 'assistant'() {
    await loadToDesigner();
    await page.locator('button[title^="Ask about your runs"]').click();
    await settle(900);
    await shot('assistant', [
      { at: [page.getByText('Ask', { exact: true }), page.getByText('Safety', { exact: true }).last()], title: 'Three modes', text: 'Ask about past runs, draft a workflow, or draft safety limits and rules.', side: 'left', align: 'start' },
      { at: page.getByText(/Nothing is saved, run or enforced/), title: 'You decide', text: 'A draft is only a proposal until you accept it.', side: 'left', align: 'start', dy: 70 },
      { at: [page.locator('textarea').last(), page.getByRole('button', { name: 'Send' })], title: 'Describe it', text: 'In your own words. The draft is checked against this deck’s real methods.', side: 'left', align: 'center' },
    ]);
  },

  async 'library-versions'() {
    await loadToDesigner();
    await page.locator('[title^="Runs for every sample"]').nth(5).click();
    await settle(300);
    await headerButton('Save this workflow').click();
    await settle(1200);
    const anyway = page.getByRole('button', { name: 'Save anyway' });
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await go('/library');
    await libraryCard(SUZUKI).locator('[title="Version history"]').click();
    await settle(900);
    const versions = page.getByRole('button', { name: 'Open' });
    await shot('library-versions', [
      { at: [page.getByText('v2', { exact: true }), versions.first()], title: 'Current', text: 'The version **Load to Designer** opens and a new link is pinned to.', side: 'right', align: 'end', dy: -60 },
      { at: versions.last(), title: 'Open an older one', text: 'It loads into the Designer. Save there to make it the newest.', side: 'right', align: 'start', dy: 20 },
    ], { keep: versions.first().locator('xpath=ancestor::div[contains(@class,"rounded")][last()]') });
    // Put the first version back as the newest, so later scenes meet the workflow as it was.
    await versions.last().click();
    await page.waitForURL(/\/designer/);
    await settle(800);
    await headerButton('Save this workflow').click();
    await settle(1200);
    if (await anyway.isVisible().catch(() => false)) await anyway.click();
    await go('/library');
    await libraryCard(SUZUKI).locator('[title="Edit tags"]').click();
    await page.keyboard.type('screening');
    await settle(400);
    const tag = page.getByPlaceholder('New tag, then Enter');
    await shot('library-tags', [
      { at: [tag, page.getByRole('button', { name: 'Add', exact: true })], title: 'Add a tag', text: 'Any word. A workflow can carry several.', side: 'right', align: 'center' },
      { at: page.getByRole('button', { name: 'Save', exact: true }), title: 'Save', text: 'Tags are labels only: no new version is made.', side: 'right', align: 'center' },
    ], { keep: tag.locator('xpath=ancestor::div[contains(@class,"rounded")][last()]') });
  },

  async 'designer-details'() {
    await loadToDesigner();
    await arg('wavelength_nm = 312').click();
    await settle(400);
    const open = steps().nth(8);
    const at = await open.boundingBox();
    await shot('designer-step', [
      { at: open.locator('input').nth(1), title: 'A value', text: 'Type it, or type **#name** to leave it open for the run.', side: 'below', align: 'start' },
      { at: open.locator('input[title^="Save the result"]').first(), title: 'Save the result', text: 'Later steps read it as **#absorbance_312**.', side: 'above', align: 'start' },
      { at: [open.locator('button[title^="Runs for every sample"], button[title*="once per batch"]').first(), open.locator('button[title="Delete this step"]')], title: 'Batch, more, delete', text: 'Run once per batch, disable or duplicate, or remove.', side: 'above', align: 'end' },
    ], { clip: { x: 250, y: at.y - 190, width: VIEW.width - 250, height: 430 } });
    await page.keyboard.press('Escape');

    await phaseTab('Prep').click();
    await settle(600);
    await shot('designer-prep', [
      { at: phaseTab('Prep'), title: 'Prep', text: 'Runs once, before the first sample: prime the pumps, blank the spectrometer.', side: 'below', align: 'start', dy: 190 },
      { at: phaseTab('Cleanup'), title: 'Cleanup', text: 'Runs once, after the last sample. Hold a dragged step over a tab to move it there.', side: 'below', align: 'start', dy: 190 },
    ], { clip: { x: 250, y: 44, width: VIEW.width - 250, height: 500 } });
    await phaseTab('Main').click();

    await headerButton('Python and JSON').click();
    await settle(300);
    await shot('designer-file-menu', [
      { at: page.getByRole('menu'), title: 'More', text: 'Read the workflow as Python, or move it as a JSON file.', side: 'left', align: 'start' },
    ], { clip: { x: 250, y: 44, width: VIEW.width - 250, height: 420 } });
    await page.getByRole('menuitem', { name: 'View as Python' }).click();
    await settle(900);
    await shot('designer-python', [
      { at: page.locator('.cm-editor, pre').first(), title: 'The script', text: 'Prep, main and cleanup as functions. It follows the canvas as you edit.', side: 'left', align: 'start' },
      { at: page.getByRole('button', { name: /Download/ }), title: 'Download', text: 'Save it as a .py file.', side: 'left', align: 'center', width: 190 },
    ]);
  },

  async 'designer-logic'() {
    await loadToDesigner('UV-Vis linearity check');
    await shot('designer-logic', [
      { at: ['div[title^="Wait:"]', 'div[title^="Add a note"]'], title: 'Logic steps', text: 'Wait, ask a person, set a variable, branch, loop, write a note.', side: 'right', align: 'start', pad: 8 },
      { at: [steps().nth(7), steps().nth(9)], title: 'If', text: 'The steps down to **End if** run only when the condition holds.', side: 'above', align: 'end' },
      { at: ['button[title^="Copy:"]', 'button[title^="Link:"]'], title: 'Copy or link', text: 'Drag a saved workflow in as your own steps, or as one step that follows the original.', side: 'below', align: 'start', dy: 40 },
    ]);
  },

  // A design made of two saved workflows, linked, as the Stages tab cuts it.
  async 'stages'() {
    await resetDesigner();
    await go('/designer');
    await page.locator('button[title^="Link:"]').click();
    await drag('Charge a vial');
    await page.keyboard.press('Escape');
    await drag('Blank, equilibrate');
    await page.keyboard.press('Escape');
    await settle(400);
    await shot('designer-links', [
      { at: 'button[title^="Link:"]', title: 'Link', text: 'With **Link** on, a saved workflow dragged in stays one step.', side: 'right', align: 'center', dy: 110 },
      { at: steps().nth(0), title: 'A linked workflow', text: 'One step, pinned to the saved version. Its open values are the step’s inputs.', side: 'below', align: 'start', dy: 110 },
      { at: [page.getByRole('button', { name: 'View steps' }).nth(1), page.getByRole('button', { name: 'Detach' }).nth(1)], title: 'View or detach', text: 'See the steps it will run, or turn it into steps of your own.', side: 'below', align: 'start', dy: 90 },
    ]);
    await go('/stages');
    await settle(800);
    await shot('run-stages', [
      { at: page.getByText(/Not set up yet/).first(), title: 'A stage', text: 'Each linked workflow is one. Its line says whether it is ready.', side: 'below', align: 'start', dy: 110 },
      { at: [page.getByRole('button', { name: 'Once' }).first(), page.getByRole('button', { name: 'Optimize' }).first()], title: 'How it runs', text: 'Pick one and it opens in place: a form, a table, or an optimizer.', side: 'above', align: 'end', dx: 40 },
      { at: page.getByRole('button', { name: /Run 2 stages/ }), title: 'Run', text: 'Offered once every stage is ready. Each is queued as its own run, in order.', side: 'left', align: 'center' },
    ], { clip: { x: 0, y: 0, width: VIEW.width, height: 500 } });
  },

  // The tour on "Try the example": a three-step workflow built by hand, saved, run and read back.
  // Last, and it removes what it made, so no other picture shows its workflow or its run.
  async 'first-workflow'() {
    await api('DELETE', `/api/workflows/${encodeURIComponent(FIRST)}`).catch(() => {});
    await resetDesigner();
    await go('/designer');
    const search = page.getByPlaceholder('Search steps...');

    await search.fill('load vial');
    await settle(300);
    await drag('Seat a fresh', () => shot('first-drag', [
      { at: search, title: 'Find a step', text: 'Type part of its name. Here: **load vial**, on the reactor.', side: 'below', align: 'start', dy: 90 },
      { at: canvas, title: 'Drop it on the canvas', text: 'Hold the step, carry it over, let go.', side: 'below', align: 'center' },
    ], { wait: 100, clip: TOP }));

    await search.fill('set temperature');
    await settle(300);
    await drag('Set the block setpoint');
    const setpoint = steps().nth(1).locator('input[placeholder="float"]').first();
    await setpoint.fill('#temperature_c');
    await settle(300);
    await shot('first-variable', [
      { at: setpoint, title: 'Leave a value open', text: 'Type **#temperature_c** instead of a number. You give the number when you run.', side: 'below', align: 'start' },
    ], { clip: TOP });
    await page.keyboard.press('Escape');

    await search.fill('read temperature');
    await settle(300);
    await drag('Internal vial temperature in C, as read');
    const result = steps().nth(2).locator('input[title^="Save the result"]').first();
    await result.fill('temperature');
    await settle(300);
    await shot('first-result', [
      { at: result, title: 'Save what it returns', text: 'Type a name after the arrow. The reading is kept under it.', side: 'below', align: 'start' },
    ], { clip: TOP });
    await page.keyboard.press('Escape');
    await search.fill('');

    await page.getByPlaceholder('Sequence Name').fill(FIRST);
    await headerButton('Save this workflow').click();
    await page.getByRole('button', { name: 'OK' }).click();
    await settle(500);
    await shot('first-save', [
      { at: page.getByPlaceholder('Sequence Name'), title: 'Name it', text: 'Click the name and type.', side: 'below', align: 'start' },
      { at: headerButton('Save this workflow'), title: 'Save', text: 'It is now in the Library.', side: 'below', align: 'end' },
      { at: headerButton('Fill in the #variables'), title: 'Configure', text: 'Opens the Run page, to give **temperature_c** a value.', side: 'below', align: 'end', dy: 90 },
    ], { clip: TOP });

    await headerButton('Fill in the #variables').click();
    await page.waitForURL(/\/(execution|once)/);
    await runTab('Once').click();
    await page.waitForURL(/\/once/);
    await page.locator('#once-temperature_c').fill('60');
    await shot('first-run', [
      { at: runTab('Once'), title: 'Once', text: 'One run, one value. The other tabs take a table or an optimizer.', side: 'right', align: 'start', dx: 260 },
      { at: ['label[title="temperature_c"]', '#once-temperature_c'], title: 'Give the value', text: 'The one thing you left open.', side: 'right', align: 'center' },
      { at: page.getByRole('button', { name: /^Run$/ }), title: 'Run', text: 'The reactor heats. The bar at the bottom follows it.', side: 'right', align: 'center' },
    ], { wait: 500, clip: TOP });
    await page.getByRole('button', { name: /^Run$/ }).click();
    await waitIdle();
    await settle(11000);
    await go('/data');
    await page.getByText(FIRST).first().click();
    await settle(1200);
    await shot('first-data', [
      { at: page.locator('table').first(), title: 'The result', text: 'The value you gave, and the temperature the step read back.', side: 'below', align: 'start' },
    ], { clip: { ...TOP, height: 520 } });
    const mine = (await api('GET', '/api/queue/runs?recent=10')).runs.filter((r) => String(r.name).startsWith(FIRST));
    for (const r of mine) await api('DELETE', `/api/queue/runs/${r.id}`).catch(() => {});
    await api('DELETE', `/api/workflows/${encodeURIComponent(FIRST)}`).catch(() => {});
  },

};

let failed = 0;
for (const [name, run] of Object.entries(scenes)) {
  if (only.size && !only.has(name)) continue;
  console.log(name);
  try {
    // Every scene starts with no safety configuration (the safety scene sets its own), so a scene
    // run by itself gives the picture it gives in a full run.
    await api('PUT', '/api/safety', { config: { format: 'ivoryos-safety/1', enabled: true, trays: {}, states: {}, limits: [], rules: [] } });
    await run();
  } catch (e) {
    failed++;
    console.error(`  failed: ${e.message.split('\n')[0]}`);
    // While writing a scene: what the page looked like when it failed.
    if (process.env.IVORYOS_DOCS_DEBUG_DIR) await page.screenshot({ path: `${process.env.IVORYOS_DOCS_DEBUG_DIR}/failed-${name}.png` }).catch(() => {});
  }
}
await browser.close();
if (failed) process.exit(1);
