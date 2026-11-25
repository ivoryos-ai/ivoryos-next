// The desktop app's pictures for the documentation (src/assets/annotated/launcher-*.webp), taken
// from the real app with the same annotations as the deck's pages (annotate.mjs, shots.mjs).
//
//   node scripts/desktop-shots.mjs                 every scene, from a new home (about 3 minutes)
//   node scripts/desktop-shots.mjs hub settings     only these scenes, on the home as it is
//
// The app runs in docs-site/.desktop-home/shots (ignored by git), never in a person's own IvoryOS
// folder. A full run empties that home's decks first and then tells one story in order: no decks
// (the welcome page), the Hub, a platform installed as a deck, the example lab, and a script that
// fails. Named scenes are run on the home as the last full run left it, so do a full run first.
// The first run downloads Python and the simulated lab's package; later ones take seconds.
//
// A picture of a deck open in a tab is two pages put together (desktop-app.mjs `shot`): for those
// the finished picture is laid over the launcher page and annotated there, with each note's place
// worked out from the page its target is on.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { launchApp, DEFAULT_HOME } from './desktop-app.mjs';
import { annotate, clearAnnotations } from './annotate.mjs';
import { saveShot, writeShot } from './shots.mjs';

const NOTES = 'notes.desktop.json';
const PLATFORM = 'SDL Education Package';
const DECK = PLATFORM; // the deck the platform is installed as
const EXAMPLE = 'Example lab (simulated)';
const BROKEN = 'Titration rig';
const only = new Set(process.argv.slice(2));
const full = only.size === 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (full) for (const name of ['profiles.json', 'profiles', 'logs', 'example', 'broken']) fs.rmSync(path.join(DEFAULT_HOME, name), { recursive: true, force: true });

const a = await launchApp({ profiles: [] });
const L = a.launcher;
L.setDefaultTimeout(12000);

const api = (fn, arg) => L.evaluate(fn, arg);
const profiles = () => api(async () => (await window.ivoryosDesktop.snapshot()).profiles.map((p) => ({ id: p.id, name: p.name, kind: p.kind, state: p.status.state, message: p.status.message || '' })));
const profile = async (name) => (await profiles()).find((p) => p.name === name);
const until = async (check, timeout = 600000) => {
  const began = Date.now();
  while (!(await check())) {
    if (Date.now() - began > timeout) throw new Error('waited too long');
    await sleep(500);
  }
};
const sidebarRow = (name) => L.locator('nav button').filter({ hasText: name }).first();
const gear = (name) => L.locator(`nav button[title^="${name}: instruments, log and settings"]`);
const tabButton = (name) => L.locator('main').getByRole('button', { name, exact: true });

/**
 * Paths as an installed app shows them. This home is a folder inside a checkout, under somebody's
 * user name; a reader's is the app's own folder. Text on the page only, for the picture.
 */
const APP_HOME = '/Users/you/Library/Application Support/IvoryOS';
const maskPaths = (page) => page.evaluate(([home, user, shown]) => {
  const fix = (text) => text.split(home).join(shown).split(user).join('/Users/you');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes(user)) n.nodeValue = fix(n.nodeValue);
  for (const el of document.querySelectorAll('input, textarea')) if (el.value.includes(user)) el.value = fix(el.value);
  for (const el of document.querySelectorAll('[title]')) if (el.title.includes(user)) el.title = fix(el.title);
  // A report writes the home folder as "~" and paths under the checkout relatively.
  const rel = home.split(user).join('~');
  const fixRel = (text) => text.split(rel).join('~/Library/Application Support/IvoryOS').split('.desktop-home/shots').join('IvoryOS');
  for (const el of document.querySelectorAll('textarea')) if (el.value.includes('.desktop-home')) el.value = fixRel(el.value);
}, [DEFAULT_HOME, os.homedir(), APP_HOME]);

/** The launcher page alone (no deck tab over it), annotated where its elements are. */
const shotLauncher = async (name, notes, opts = {}) => {
  await sleep(opts.wait ?? 500);
  await maskPaths(L);
  await saveShot(L, name, notes, { ...opts, notesFile: NOTES });
  console.log('  ', `${name}.webp`);
};

/**
 * The window with a deck open in a tab. A note's `at` is a locator of the launcher page, or
 * `{ tab: locator }` for something on the deck's page.
 */
const shotWindow = async (name, notes, opts = {}) => {
  await sleep(opts.wait ?? 700);
  const tab = await a.activeTab();
  const T = await a.tabPage();
  const place = async (at) => {
    if (!at) return undefined;
    if (Array.isArray(at)) {
      const boxes = (await Promise.all(at.map(place))).filter(Boolean);
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
    }
    if (at.tab) {
      const b = await at.tab.first().boundingBox();
      if (!b) throw new Error(`${name}: a note's target is not on the deck's page`);
      return { x: b.x + tab.bounds.x, y: b.y + tab.bounds.y, width: b.width, height: b.height };
    }
    if (typeof at.x === 'number') return at;
    const b = await at.first().boundingBox();
    if (!b) throw new Error(`${name}: a note's target is not on the launcher page`);
    return b;
  };
  const placed = [];
  for (const n of notes) placed.push({ ...n, at: await place(n.at) });
  const picture = await a.shot();
  await L.evaluate((src) => {
    const img = document.createElement('img');
    img.id = 'ivoryos-window-picture';
    img.src = src;
    img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483646;';
    document.body.appendChild(img);
    return img.decode();
  }, `data:image/png;base64,${picture.toString('base64')}`);
  try {
    await annotate(L, placed, { dim: opts.dim, numbered: opts.numbered });
    await writeShot(name, await L.screenshot(), notes, NOTES);
  } finally {
    await clearAnnotations(L);
    await L.evaluate(() => document.getElementById('ivoryos-window-picture')?.remove());
  }
  console.log('  ', `${name}.webp`);
};

/** The launcher page of a profile (its gear in the sidebar), on the tab named. */
const openProfile = async (name, tab) => {
  await gear(name).click();
  await L.locator('main').getByRole('heading', { name }).waitFor();
  if (tab) await tabButton(tab).click();
  await sleep(400);
};
const closeDialogs = async () => { await L.keyboard.press('Escape'); await sleep(350); };

// --- what the story needs to exist -----------------------------------------------------------

async function ensurePlatformDeck() {
  if (await profile(DECK)) return;
  await L.locator('nav').getByText('Automation Hub').click();
  await L.getByRole('button', { name: /^Platforms/ }).click();
  await L.getByText(PLATFORM).first().click();
  await L.getByRole('button', { name: 'Create deck and install' }).click();
  await L.getByRole('button', { name: 'Install', exact: true }).click();
  await until(async () => /Installed/.test((await profile(DECK))?.message || ''));
  await sleep(800);
}

async function ensureExample() {
  if (!(await profile(EXAMPLE))) await api(() => window.ivoryosDesktop.createExample());
  if ((await profile(EXAMPLE)).state !== 'running') await api((id) => window.ivoryosDesktop.start(id), (await profile(EXAMPLE)).id);
  await until(async () => (await profile(EXAMPLE)).state === 'running', 400000);
  await sleep(1500);
}

/** A script profile whose script cannot start: what a failed deck looks like, and its report. */
async function ensureBroken() {
  if (await profile(BROKEN)) return;
  const dir = path.join(DEFAULT_HOME, 'broken');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'titration_rig.py');
  fs.writeFileSync(script, [
    'import ivoryos_edge',
    'from titrator_driver import Titrator  # a driver package that is not installed',
    '',
    'titrator = Titrator(port="COM4")',
    '',
    'ivoryos_edge.run(__name__)',
    '',
  ].join('\n'));
  await api((p) => window.ivoryosDesktop.createProfile(p), { name: BROKEN, kind: 'script', script, autoStart: false });
}

// --- the scenes ------------------------------------------------------------------------------------

const scenes = {
  async welcome() {
    if ((await profiles()).length) return console.log('   (skipped: the welcome page shows only with no decks; do a full run)');
    await L.getByRole('heading', { name: 'Welcome to IvoryOS' }).waitFor({ timeout: 120000 });
    await shotLauncher('launcher-welcome', [
      { at: L.getByRole('button', { name: /Browse the Hub/ }), title: 'Browse the Hub', text: 'Drivers, whole labs and workflows that others have shared. The usual place to start.', side: 'below', align: 'center' },
      { at: L.getByRole('button', { name: /Add a deck/ }).last(), title: 'Add a deck', text: 'An empty deck, or a Python script you already run.', side: 'below', align: 'center' },
      { at: L.getByRole('button', { name: /Try the example/ }), title: 'Try the example', text: 'A simulated lab. Nothing to plug in.', side: 'below', align: 'center' },
      { at: [L.locator('nav').getByText('Add a deck'), L.locator('nav').getByText('Automation Hub')], title: 'Always here', text: 'The same choices stay in the sidebar once you have decks.', side: 'above', align: 'start' },
    ]);
    await L.locator('nav').getByText('Add a deck').click();
    const heading = L.getByRole('heading', { name: 'Add a deck' });
    await heading.waitFor();
    const dialog = L.locator('div').filter({ has: heading }).filter({ has: L.getByRole('button', { name: 'Cancel' }) }).last();
    await shotLauncher('launcher-add-deck', [
      { at: L.getByRole('button', { name: 'Empty deck' }), title: 'Empty deck', text: 'Starts with nothing. Add instruments from the Hub, or drivers already installed.', side: 'left' },
      { at: L.getByRole('button', { name: 'From a Python script' }), title: 'From a Python script', text: 'A script that ends in **ivoryos_edge.run()**, run as it is. Dropping a .py file on the window does the same.', side: 'right' },
    ], { keep: [dialog] });
    await closeDialogs();
  },

  async hub() {
    await L.locator('nav').getByText('Automation Hub').click();
    const kind = (name) => L.locator('div.fixed').getByRole('button', { name: new RegExp(`^${name}`) }).last();
    await kind('Instruments').click();
    await L.getByText(/\d+ drivers/).waitFor();
    await sleep(1800); // pictures of the instruments
    const search = L.getByPlaceholder(/Search by instrument/);
    const dialog = L.locator('div.fixed').filter({ has: search }).locator('> div').first();
    await shotLauncher('launcher-hub', [
      { at: [kind('Public'), kind('Private')], title: 'Public or private', text: 'Private is what only your organization can see. It needs an account.', xy: [372, 190] },
      { at: [kind('Instruments'), kind('Workflows')], title: 'Four kinds', text: 'A driver, a whole lab, a page added to a deck, or a ready-made workflow.', xy: [372, 318] },
      { at: search, title: 'Search', text: 'By instrument, vendor or package name.', xy: [800, 6] },
      { at: L.getByText('Tested', { exact: true }).nth(1), title: 'Tested', text: 'Its contributor has run it with IvoryOS.', side: 'below', align: 'start' },
    ], { keep: [dialog] });
    // One driver: what it needs before it is added.
    await L.getByText('IKA Magnetic Stirrer').first().click();
    const add = L.getByRole('button', { name: 'Add to deck' });
    await add.waitFor();
    await sleep(1500);
    const page = L.locator('div.fixed').filter({ has: add }).locator('> div').first();
    await shotLauncher('launcher-hub-driver', [
      { at: L.getByText(/pip install/).first(), title: 'What it installs', text: 'The package, and the class the deck will build from it.', side: 'right', align: 'start' },
      { at: L.locator('input[value="ika_magnetic_stirrer"]'), title: 'Instrument name', text: 'What steps call it. Two of the same instrument get two names.', xy: [20, 200] },
      { at: L.getByText('device_port', { exact: false }).first().locator('xpath=following::input[1]'), title: 'Settings', text: 'What the driver needs to connect, such as a port, typed as its author declared.', side: 'below', align: 'start' },
      { at: add, title: 'Add to deck', text: 'Installs the package and adds the instrument to the deck named in the title.', side: 'left', align: 'start', dy: 40 },
    ], { keep: [page] });
    await closeDialogs();
  },

  async platform() {
    if (await profile(DECK)) return console.log('   (skipped: the platform is already installed; do a full run)');
    await L.locator('nav').getByText('Automation Hub').click();
    await L.getByRole('button', { name: /^Platforms/ }).click();
    await L.getByText(PLATFORM).first().click();
    const install = L.getByRole('button', { name: 'Create deck and install' });
    await install.waitFor();
    await sleep(1200);
    const dialog = L.locator('div.fixed').filter({ has: install }).locator('> div').first();
    await shotLauncher('launcher-platform', [
      { at: L.getByText('As a new deck').locator('xpath=ancestor::label[1] | ancestor::div[2]').first(), title: 'Where it goes', text: 'A deck of its own. Opened from a deck\'s **Add from Hub**, it can join that deck instead.', side: 'left', align: 'start' },
      { at: L.locator('input[value="SDL Education Package"]'), title: 'Deck name', text: 'Shown in the sidebar. Change it now or later.', side: 'right', align: 'center' },
      { at: [L.locator('input[value="robotic_arm"]'), L.locator('input[value="stir_plate"]')], title: 'Instruments', text: 'Untick what you do not have. The name in the box is what steps call it.', side: 'left', align: 'center', pad: 10 },
    ], { keep: [dialog] });
    await install.scrollIntoViewIfNeeded();
    await sleep(500);
    await shotLauncher('launcher-platform-options', [
      { at: L.getByText('SDL Simulation 3D').first(), title: 'Plugins', text: 'Pages the platform adds to the deck, such as a live view of the lab.', side: 'left' },
      { at: L.getByText('Analyze Vial Example').first(), title: 'Workflows', text: 'Ready-made workflows, put in the new deck\'s Library.', side: 'left' },
      { at: [L.getByLabel('Add BayBE'), L.getByLabel('BayBE version')], title: 'Optimizers', text: 'For the Optimize page. Tick one and keep the recommended version.', side: 'right', align: 'center' },
      { at: install, title: 'Install', text: 'Everything ticked is installed together, after you confirm.', side: 'left' },
    ], { keep: [dialog] });
    await install.click();
    const confirm = L.getByRole('button', { name: 'Install', exact: true });
    await confirm.waitFor();
    const question = L.locator('div').filter({ has: L.getByRole('heading', { name: 'Install platform?' }) }).filter({ has: confirm }).last();
    await shotLauncher('launcher-platform-confirm', [
      { at: confirm, title: 'Read, then install', text: 'The packages, instruments, plugins and workflows about to be added. Drivers run on this computer.', side: 'right', align: 'end' },
    ], { keep: [question] });
    await confirm.click();
    await until(async () => /Installed/.test((await profile(DECK))?.message || ''));
    await install.waitFor({ state: 'hidden', timeout: 120000 });
    await sleep(800);
  },

  async deck() {
    await ensurePlatformDeck();
    await openProfile(DECK, 'Instruments');
    await shotLauncher('launcher-deck', [
      { at: [L.locator('main').getByRole('button', { name: /^(Start|Stop)$/ }), L.locator('main').getByRole('button', { name: 'Open', exact: true })], title: 'Start, then open', text: '**Start** runs the deck. **Open** shows its page in a tab; the arrow beside it, in your browser.', side: 'below', align: 'end' },
      { at: [tabButton('Instruments'), tabButton('Settings')], title: 'Three tabs', text: 'What is on the deck, what it printed, and how it runs.', side: 'right' },
      { at: [L.getByRole('button', { name: 'Add from Hub' }), L.getByRole('button', { name: 'Add installed driver' })], title: 'Add instruments', text: 'From the Hub, or a class the app\'s Python can already import.', side: 'right', dy: 26 },
      { at: L.getByText('stir_plate', { exact: true }).locator('xpath=ancestor::*[self::li or self::div][2]'), title: 'Each instrument', text: 'Switch it off without removing it, edit its arguments, or delete it.', side: 'below', align: 'center', pad: 2 },
    ]);
    await L.getByRole('button', { name: 'Add installed driver' }).click();
    const title = L.getByRole('heading', { name: 'Add an installed driver' });
    await title.waitFor();
    await sleep(600);
    const form = L.locator('div').filter({ has: title }).filter({ has: L.getByRole('button', { name: 'Save' }) }).last();
    await shotLauncher('launcher-add-driver', [
      { at: [L.getByPlaceholder('vendor_pumps.syringe'), L.getByPlaceholder('SyringePump')], title: 'Module and class', text: 'As in the import you would write: **from vendor_pumps.syringe import SyringePump**.', side: 'right', align: 'center' },
      { at: L.getByText('Add argument'), title: 'Arguments', text: 'What its constructor takes, such as a port.', side: 'right', align: 'center' },
      { at: L.getByText('Name', { exact: true }).locator('xpath=following::input[1]'), title: 'Name', text: 'What steps call this instrument.', side: 'left', align: 'center' },
    ], { keep: [form] });
    await closeDialogs();
  },

  async 'deck-settings'() {
    await ensurePlatformDeck();
    await api(() => window.ivoryosDesktop.showTab(null));
    await openProfile(DECK, 'Settings');
    const row = (text) => L.locator('main label').filter({ hasText: text });
    await shotLauncher('launcher-deck-settings', [
      { at: row('Start when the launcher opens'), title: 'Start with the app', text: 'Ticked, this deck starts whenever IvoryOS opens.', side: 'right', align: 'end', dy: -34 },
      { at: row('Reachable from other computers'), title: 'On the network', text: 'On, lab mates open this deck from their own browsers. Off, this computer only.', side: 'right', align: 'start', dy: 6 },
      { at: [L.getByRole('button', { name: 'Show deck file' }), L.getByRole('button', { name: 'Show data folder' })], title: 'On disk', text: 'The deck file, which lists its instruments, and the folder with its runs and workflows.', side: 'left', align: 'center' },
      { at: [L.locator('main').getByText('Ax', { exact: true }), L.locator('main').getByText('NIMO', { exact: true }).locator('xpath=following::select[1]')], title: 'Optimizers', text: 'Pick a version to add Ax, BayBE or NIMO to this deck, then **Apply**.', side: 'right', align: 'center', pad: 8 },
    ]);
  },

  async sidebar() {
    await ensurePlatformDeck();
    await ensureExample();
    await api((id) => window.ivoryosDesktop.open(id), (await profile(EXAMPLE)).id);
    await until(async () => /^http/.test((await a.activeTab())?.url || ''));
    const T = await a.tabPage();
    await T.locator('[data-rfd-droppable-id="toolbox"]').waitFor({ timeout: 30000 });
    await sleep(1200);
    await shotWindow('launcher-sidebar', [
      { at: sidebarRow(DECK), title: 'A stopped deck', text: 'Click it, then press **Start**.', xy: [312, 44] },
      { at: sidebarRow(EXAMPLE), title: 'A running deck', text: 'Green means running. Click the row to show its page; the gear shows its instruments, log and settings.', xy: [312, 150] },
      { at: [L.locator('nav').getByText('Add a deck'), L.locator('nav').getByText('Automation Hub')], title: 'More decks', text: 'Any number can run at once, each on its own port.', side: 'right', align: 'end' },
    ]);
    const bar = T.locator('[data-ivoryos-nav-bar]');
    await shotWindow('launcher-tab', [
      { at: [L.locator('button[title^="Hide the sidebar"]'), L.locator('button[title^="Close this page"]')], title: 'This page', text: 'Hide the sidebar, reload the page, or close it. A closed deck keeps running.', xy: [330, 112] },
      { at: [{ tab: bar.getByText('Library', { exact: true }) }, { tab: bar.getByText('Safety', { exact: true }) }], title: 'The deck\'s own pages', text: 'Everything in this bar belongs to the deck that is open.', xy: [650, 112], pad: 10 },
    ]);
    await api(() => window.ivoryosDesktop.showTab(null));
    await sleep(400);
  },

  async script() {
    await ensureExample();
    await api(() => window.ivoryosDesktop.showTab(null));
    await openProfile(EXAMPLE, 'Overview');
    const main = L.locator('main');
    await shotLauncher('launcher-script', [
      { at: [main.getByRole('button', { name: /^(Start|Stop)$/ }), main.getByRole('button', { name: 'Open', exact: true })], title: 'The same buttons', text: 'A script profile starts, stops and opens like a deck.', side: 'below', align: 'end' },
      { at: [tabButton('Overview'), tabButton('Configuration')], title: 'Four tabs', text: '**Code** edits the script here. Its settings are under **Configuration**.', side: 'right' },
      { at: main.getByText('example_lab.py').last().locator('xpath=ancestor::div[1]'), title: 'The script', text: 'The file this profile runs. The buttons open it for editing, or show it in its folder.', side: 'below', align: 'start', dy: 60 },
    ]);
    await tabButton('Code').click();
    await sleep(900);
    await shotLauncher('launcher-script-code', [
      { at: main.getByText('pump_1 = SyringePump').first(), title: 'Instruments', text: 'Every instrument object in the script becomes a device, named after its variable.', side: 'below', align: 'start', dx: 420 },
      { at: [main.getByRole('button', { name: 'Revert' }), main.getByRole('button', { name: /Save and (re)?start/ })], title: 'Save and restart', text: 'Changes apply when the script starts again.', side: 'below', align: 'end' },
    ], { dim: false });
    await tabButton('Log').click();
    await sleep(700);
    await shotLauncher('launcher-log', [
      { at: main.getByText('Follow', { exact: true }), title: 'Follow', text: 'Keeps the newest line in view.', side: 'below', align: 'start', dy: 18 },
      { at: [main.getByRole('button', { name: 'Copy', exact: true }), main.getByRole('button', { name: 'Log file' })], title: 'Copy, or the file', text: 'This session\'s lines, or the file that has every earlier session too.', side: 'below', align: 'end', dx: -280, dy: 18 },
      { at: main.getByRole('button', { name: /Send to IvoryOS/ }), title: 'Send to IvoryOS', text: 'A report with this log. You read all of it before anything is sent.', side: 'below', align: 'end', dy: 150 },
    ]);
    await tabButton('Configuration').click();
    await sleep(500);
    await main.locator('summary').filter({ hasText: 'Advanced' }).click();
    await main.getByRole('button', { name: 'Remove profile' }).scrollIntoViewIfNeeded();
    await sleep(500);
    const field = (label) => main.getByText(label, { exact: true }).first().locator('xpath=following::input[1]');
    await shotLauncher('launcher-script-settings', [
      { at: field('Python file'), title: 'Python file', text: 'The script this profile runs.', side: 'right', align: 'start' },
      { at: main.locator('details').first(), title: 'Advanced', text: 'Another Python interpreter, a working folder, environment variables. All of it can stay empty.', side: 'right', align: 'center' },
      { at: [field('Name'), field('Port')], title: 'Name and port', text: 'The port its page is served on. Change it if another program has it.', side: 'right', align: 'end' },
      { at: main.locator('label').filter({ hasText: 'Reachable from other computers' }), title: 'On the network', text: 'On, lab mates open this deck from their own browsers. Off, this computer only.', side: 'right', align: 'start', dy: 8 },
    ]);
  },

  async settings() {
    await api(() => window.ivoryosDesktop.showTab(null));
    await L.locator('nav button[title^="Settings"]').click();
    await L.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    const main = L.locator('main');
    await shotLauncher('launcher-settings', [
      { at: [main.getByRole('button', { name: 'System' }), main.getByRole('button', { name: 'Dark' })], title: 'One theme', text: 'The launcher, every deck\'s page and Cloud follow it.', side: 'right' },
      { at: [main.getByRole('button', { name: 'Report a problem' }), main.getByRole('button', { name: 'GitHub issues' })], title: 'Help', text: 'Send a report to the IvoryOS team, or ask on Discord.', side: 'right' },
      { at: [main.getByText('A run waits for your input'), main.getByText('A deck stopped unexpectedly')], title: 'Needs you', text: 'Told at once, with a sound: a run waiting, a failed step, a deck that stopped.', side: 'right', pad: 8 },
      { at: main.getByText('A run finished').locator('xpath=ancestor::label[1]'), title: 'Long runs only', text: 'A finished run is announced when it took at least this long.', side: 'right', align: 'start', dy: 30 },
    ]);
    await L.getByRole('heading', { name: 'Python', exact: true }).scrollIntoViewIfNeeded();
    await sleep(500);
    await shotLauncher('launcher-settings-python', [
      { at: main.getByText(/^IvoryOS \d/).first().locator('xpath=ancestor::div[2]'), title: 'Updates', text: 'The version installed. An installed app offers new ones here.', side: 'right', align: 'center' },
      { at: main.getByRole('button', { name: 'Copy path' }).locator('xpath=ancestor::div[2]'), title: 'The app\'s Python', text: 'Deck profiles run in it. **Copy path** gives it to PyCharm or VS Code as an interpreter.', side: 'right', align: 'start' },
      { at: main.getByRole('button', { name: 'Rebuild environment' }), title: 'Rebuild', text: 'Sets the environment up again from nothing, if it ever breaks.', side: 'right', align: 'center' },
      { at: main.getByRole('button', { name: 'Open folder' }).locator('xpath=ancestor::div[1]'), title: 'Everything on disk', text: 'Profiles, each deck\'s runs and workflows, and logs are in this one folder.', side: 'below', align: 'end', dy: 6 },
    ]);
  },

  async failed() {
    await ensureBroken();
    await api(() => window.ivoryosDesktop.showTab(null));
    await gear(BROKEN).click();
    const main = L.locator('main');
    await main.getByRole('heading', { name: BROKEN }).waitFor();
    if (!(await main.getByText('Could not start').count())) {
      await main.getByRole('button', { name: 'Start', exact: true }).click();
      await main.getByText('Could not start').first().waitFor({ timeout: 120000 });
    }
    // The app also says so in a note of its own; the picture is of what stays on the page.
    const ok = L.getByRole('button', { name: 'OK', exact: true });
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await sleep(800);
    const banner = main.getByText('The edge exited before it was ready').first().locator('xpath=ancestor::div[2]');
    await shotLauncher('launcher-failed', [
      { at: sidebarRow(BROKEN), title: 'Red in the list', text: 'A deck that could not start stays marked until it does.', side: 'right', align: 'start', dy: 60 },
      { at: banner, title: 'What went wrong', text: 'The reason in a line, with **See log** for the rest and **Send to IvoryOS** if you cannot fix it.', side: 'below', align: 'end', dy: -18 },
      { at: main.getByText(/ModuleNotFoundError/).first(), title: 'The log', text: 'Its last lines usually name the cause: here, a driver package that is not installed.', side: 'inside', align: 'center end' },
    ]);
    await main.getByRole('button', { name: /Send to IvoryOS/ }).first().click();
    await L.getByRole('heading', { name: 'Send to IvoryOS' }).waitFor();
    await sleep(3500); // the report is put together (the environment is read)
    const send = L.getByRole('button', { name: 'Send', exact: true });
    const report = L.locator('div.fixed').filter({ has: send }).locator('> div').first();
    await shotLauncher('launcher-report', [
      { at: L.getByPlaceholder(/What were you doing/), title: 'Say what happened', text: 'Optional, and the most useful part.', side: 'left', align: 'start' },
      { at: L.getByText('What will be sent', { exact: true }).locator('xpath=following::textarea[1]'), title: 'Read it first', text: 'The log, the deck\'s instrument names and the Python environment. Keys, emails and your home folder are masked. Edit anything.', side: 'left', align: 'center' },
      { at: send, title: 'Send', text: 'Goes to the IvoryOS team, with an id you keep as a reference.', side: 'right', align: 'end', width: 196 },
    ], { keep: [report] });
    await closeDialogs(); // never sent
  },
};

let failed = 0;
try {
  for (const [name, run] of Object.entries(scenes)) {
    if (only.size && !only.has(name)) continue;
    console.log(name);
    try {
      await run();
    } catch (e) {
      failed++;
      console.error(`  failed: ${String(e.message).split('\n').slice(0, 3).join(' | ')}`);
      await clearAnnotations(L).catch(() => {});
      await closeDialogs().catch(() => {});
    }
  }
} finally {
  await a.close();
}
if (failed) process.exit(1);
