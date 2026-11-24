// The tutorial, beat by beat: each beat is one spoken line (voiceover.json, by id) and what the
// pointer does while it is said. The recorder holds a beat for as long as its line lasts, so the
// actions here only need to be in the right order, not timed.
//
// Selectors are the app's own titles, labels and texts. When the interface changes one of them,
// the recording stops at that beat and says which; fix it here and record again.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scroll under the pointer as a wheel does, a little at a time. */
async function wheel(page, dy, { step = 36, pause = 16 } = {}) {
  for (let done = 0; Math.abs(done) < Math.abs(dy); done += Math.sign(dy) * step) {
    await page.mouse.wheel(0, Math.sign(dy) * step);
    await sleep(pause);
  }
  await sleep(250);
}

/** Wait for something the app is doing, checking twice a second. */
async function until(check, { timeout = 600000, every = 500 } = {}) {
  const began = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - began > timeout) throw new Error('waited too long');
    await sleep(every);
  }
}

const profiles = (L) => L.evaluate(async () => (await window.ivoryosDesktop.snapshot()).profiles.map((p) => ({ name: p.name, state: p.status.state, message: p.status.message || '' })));
const ACTIVE = ['pending', 'running', 'waiting_input', 'paused', 'cancelling'];
const deckIdle = (T) => T.evaluate(async (active) => {
  const res = await (await fetch('/api/queue/runs?recent=5')).json();
  const runs = Array.isArray(res) ? res : res.runs || [];
  const status = await (await fetch('/api/status')).json();
  return !runs.some((r) => active.includes(r.status)) && !(status.active_tasks || []).length;
}, ACTIVE);

export const PLATFORM = 'SDL Education Package';
export const WORKFLOW = 'Analyze a vial';

export async function tutorial(rec, a, { resume = false } = {}) {
  const L = a.launcher;
  let T; // the deck's page, once it is open

  // --- 1. A lab from the Hub -----------------------------------------------------------------
  if (!resume) {
    rec.chapter('Set up a lab from the Hub');
    await rec.beat('01-intro', async () => {
      await sleep(2500);
      await rec.hover(L, L.getByRole('heading', { name: 'Welcome to IvoryOS' }), { dy: 60, ms: 1200 });
    });

    await rec.beat('02-hub', async () => {
      const hub = L.getByRole('button', { name: /Browse the Hub/ });
      await rec.hover(L, hub);
      await sleep(500);
      await rec.hover(L, L.getByRole('button', { name: /Add a deck/ }).last());
      await sleep(350);
      await rec.hover(L, L.getByRole('button', { name: /Try the example/ }));
      await sleep(500);
      await rec.click(L, hub);
      await L.getByText(/\d+ drivers/).waitFor();
    });

    await rec.beat('03-platform', async () => {
      await rec.click(L, L.getByRole('button', { name: /^Platforms/ }));
      await L.getByText(PLATFORM).first().waitFor();
      await sleep(900);
      await rec.hover(L, L.getByText(PLATFORM).first(), { dy: -70 });
      await sleep(2600);
      await rec.click(L, L.getByText(PLATFORM).first());
      await L.getByRole('button', { name: 'Create deck and install' }).waitFor();
    });

    await rec.beat('04-contents', async () => {
      await rec.hover(L, L.getByText('robotic_arm').or(L.locator('input[value="robotic_arm"]')).first(), { dx: 260 });
      await sleep(700);
      await wheel(L, 330);
      await rec.hover(L, L.getByText('SDL Simulation 3D').first());
      await sleep(900);
      await wheel(L, 260);
      await rec.hover(L, L.getByText('Analyze Vial Example').first());
      await sleep(900);
      await wheel(L, 400);
      await rec.click(L, L.getByLabel('Add BayBE'));
      await sleep(600);
    });

    await rec.beat('05-install', async () => {
      await rec.click(L, L.getByRole('button', { name: 'Create deck and install' }));
      await L.getByRole('button', { name: 'Install', exact: true }).waitFor();
      await sleep(900);
      await rec.click(L, L.getByRole('button', { name: 'Install', exact: true }));
    });
    // Installed, its workflows added, and the install page closed over the new deck's own page.
    await rec.skip(async () => {
      await until(async () => (await profiles(L)).some((p) => /Installed/.test(p.message)));
      await L.getByRole('button', { name: 'Start', exact: true }).waitFor({ timeout: 120000 });
      await L.getByRole('button', { name: /Create deck and install|Adding|Installing/ }).waitFor({ state: 'hidden', timeout: 120000 });
      await sleep(700);
    });
    await sleep(600);

    await rec.beat('06-deck', async () => {
      await rec.hover(L, L.getByText('robotic_arm').first(), { dx: 120 });
      await sleep(900);
      await rec.hover(L, L.getByText('solid_addition_station').first(), { dx: 120, ms: 1500 });
      await sleep(500);
      await rec.click(L, L.getByRole('button', { name: 'Start', exact: true }));
    }, { tail: 150 });
    // The deck opens by itself when it is ready; nothing is clicked meanwhile, or it would not.
    await rec.skip(async () => {
      await until(async () => (await profiles(L)).some((p) => p.state === 'running') && !!(await a.activeTab()));
      T = await rec.tab();
      // Its page as a new deck's: no canvas, no remembered place for the plugin's view.
      await T.evaluate(() => localStorage.clear());
      await T.reload();
      await T.locator('[data-rfd-droppable-id="toolbox"]').waitFor();
      await sleep(1500);
    });
  } else {
    // A deck from an earlier take: start it and open it, off camera.
    await rec.skip(async () => {
      if (!(await profiles(L)).some((p) => p.state === 'running')) await L.getByRole('button', { name: 'Start', exact: true }).click();
      await until(async () => (await profiles(L)).some((p) => p.state === 'running') && !!(await a.activeTab()), { timeout: 120000 });
      T = await rec.tab();
      // Its page as a new deck's: no canvas, no remembered place for the plugin's view.
      await T.evaluate(() => localStorage.clear());
      await T.reload();
      await T.locator('[data-rfd-droppable-id="toolbox"]').waitFor();
      await sleep(1500);
    });
  }
  const nav = (name) => T.locator('[data-ivoryos-nav-bar]').getByText(name, { exact: true });
  const runTab = (name) => T.getByRole('link', { name, exact: true }).last(); // Once / Iterate / Optimize on the Run page

  await rec.beat('07-opens', async () => {
    await sleep(1200);
    await rec.hover(T, nav('Library'));
    await rec.hover(T, nav('Safety'), { ms: 1800 });
    await sleep(1200);
    await rec.click(L, L.locator('button[title^="Hide the sidebar"], button[aria-label^="Hide the sidebar"]').first());
    await sleep(600);
  });

  // --- 2. A workflow ------------------------------------------------------------------------------
  rec.chapter('Design a workflow');
  const search = () => T.getByPlaceholder('Search steps...');
  const chip = (title) => T.locator('[data-rfd-droppable-id="toolbox"]').getByText(title, { exact: true });
  const canvas = () => T.locator('[data-rfd-droppable-id="canvas"]');
  const steps = () => canvas().locator('[data-rfd-draggable-id]');
  /** Find a step in the toolbox by a few letters and carry it to the end of the canvas. */
  const addStep = async (find, title) => {
    await rec.click(T, search());
    await T.keyboard.press('ControlOrMeta+a');
    await rec.type(T, find, { delay: 40 });
    await chip(title).waitFor();
    await sleep(350);
    const count = await steps().count();
    let to = canvas();
    let toOpts = {};
    if (count) {
      const last = await steps().last().boundingBox();
      const box = await canvas().boundingBox();
      to = { x: box.x + box.width / 2 - 80, y: Math.min(last.y + last.height + 26, box.y + box.height - 12) };
    } else toOpts = { dy: -40 };
    await rec.drag(T, chip(title), to, { toOpts });
    await until(async () => (await steps().count()) === count + 1, { timeout: 8000, every: 150 });
  };
  const closeStep = async () => { await T.keyboard.press('Escape'); await sleep(350); };

  await rec.beat('08-designer', async () => {
    await rec.hover(T, T.getByRole('button', { name: /^Logic/ }), { edge: 'left', dx: 60 });
    await sleep(500);
    await rec.hover(T, T.getByRole('button', { name: /^Instruments/ }), { edge: 'left', dx: 60, ms: 1300 });
    await sleep(600);
  });

  await rec.beat('09-step', async () => {
    await addStep('from tray', 'pick up vial from tray');
  });

  await rec.beat('10-variable', async () => {
    const field = steps().first().locator('input').first();
    await rec.zoomOn(T, steps().first(), { minWidth: 900 });
    await sleep(1800);
    await rec.click(T, field);
    await rec.type(T, '3', { delay: 170 });
    await sleep(1500);
    await T.keyboard.press('ControlOrMeta+a');
    await rec.type(T, '#vial', { delay: 170 });
    await sleep(1200);
    await closeStep();
  });
  rec.zoom(null);

  await rec.beat('11-more', async () => {
    await rec.skip(async () => {
      await addStep('in analysis', 'place vial in analysis station');
      await closeStep();
      await addStep('analyze', 'analyze');
    }, { speed: 2.2 });
  });

  await rec.beat('12-output', async () => {
    const card = steps().nth(2);
    await rec.zoomOn(T, card, { minWidth: 900 });
    const out = card.getByPlaceholder(/^(var_1|variable name)$/).first();
    await sleep(900);
    await rec.click(T, out);
    await rec.type(T, 'signal', { delay: 120 });
    await sleep(1400);
    await closeStep();
  });
  rec.zoom(null);

  await rec.beat('13-return', async () => {
    await rec.skip(async () => {
      await addStep('in analysis', 'pick up vial in analysis station');
      await closeStep();
      await addStep('in tray', 'place vial in tray');
      await rec.click(T, steps().last().locator('input').first());
      await rec.type(T, '#vial', { delay: 60 });
      await closeStep();
      await rec.click(T, search());
      await T.keyboard.press('ControlOrMeta+a');
      await T.keyboard.press('Backspace');
    }, { speed: 3 });
  });

  await rec.beat('14-save', async () => {
    await rec.click(T, T.getByPlaceholder('Sequence Name'));
    await rec.type(T, WORKFLOW, { delay: 60 });
    await sleep(400);
    await rec.click(T, T.locator('button[title="Save this workflow to the library"]'));
    // "Saved as v1."
    const ok = T.getByRole('button', { name: 'OK', exact: true });
    await ok.waitFor();
    await sleep(1700);
    await rec.click(T, ok);
  });

  await rec.beat('15-python', async () => {
    await rec.click(T, T.locator('button[title="Python and JSON: view, export, import"]'));
    await rec.click(T, T.getByRole('menuitem', { name: 'View as Python' }));
    await T.getByLabel('Python').waitFor();
    await sleep(2600);
  });
  await rec.click(T, T.getByLabel('Python').locator('button[title="Close"]'));
  await sleep(400);

  await rec.beat('16-library', async () => {
    await rec.click(T, nav('Library'));
    const mine = T.getByRole('heading', { name: WORKFLOW });
    await mine.waitFor();
    await sleep(700);
    await rec.hover(T, mine, { dy: 6 });
    await sleep(2200);
    await rec.hover(T, T.getByRole('heading', { name: 'analyze_vial' }), { dy: 6 });
    await sleep(1800);
    await rec.hover(T, T.getByRole('button', { name: 'Load to Designer' }).first(), { ms: 900 });
  });


  // --- 3. The lab, on screen ---------------------------------------------------------------------
  rec.chapter('See the lab');
  await rec.beat('17-view', async () => {
    await rec.click(T, nav('3D Sim'));
    await T.locator('button[title="Beside the page"]').waitFor();
    await sleep(2600);
    await rec.click(T, T.locator('button[title="Beside the page"]'));
    await sleep(800);
  });

  // A method's card on the Instruments page, and whether what was run from there has finished
  // (the Action Log marks a call Running until it answers).
  const method = (name) => T.locator('div.rounded-2xl').filter({ has: T.getByRole('heading', { name: new RegExp(`^${name}$`, 'i') }) });
  const methodDone = () => T.evaluate(() => ![...document.querySelectorAll('span')].some((el) => el.textContent.trim() === 'Running'));

  await rec.beat('18-instruments', async () => {
    await rec.click(T, nav('Instruments'));
    const card = method('pick up vial from tray');
    await card.waitFor();
    await sleep(600);
    await rec.click(T, card.locator('input').first());
    await rec.type(T, '3');
    await sleep(300);
    await rec.click(T, card.getByRole('button', { name: 'Execute' }));
  });
  await rec.skip(async () => { await sleep(1500); await until(methodDone); await sleep(500); }, { speed: 1.5 });
  // Put the vial back, so the workflow below starts from a full tray.
  await rec.skip(async () => {
    const back = method('place vial in tray');
    await rec.click(T, back.locator('input').first());
    await rec.type(T, '3');
    await rec.click(T, back.getByRole('button', { name: 'Execute' }));
    await sleep(1500);
    await until(methodDone);
    await sleep(500);
  }, { speed: 5 });

  // --- 4. Run it -----------------------------------------------------------------------------------
  rec.chapter('Run it once');
  await rec.beat('19-run-page', async () => {
    await rec.click(T, nav('Run'));
    await runTab('Once').waitFor();
    await sleep(700);
    await rec.click(T, runTab('Once'));
    await T.locator('#once-vial').waitFor();
    await sleep(600);
    await rec.hover(T, T.locator('#once-vial'));
  });

  await rec.beat('20-preview', async () => {
    await rec.fill(T, T.locator('#once-vial'), '3', { replace: true });
    await sleep(500);
    await rec.click(T, T.getByRole('button', { name: 'Preview' }));
    await sleep(2400);
  });
  await T.keyboard.press('Escape');
  await sleep(500);

  await rec.beat('21-run', async () => {
    await rec.click(T, T.getByRole('button', { name: /^Run$/ }));
    await sleep(1200);
    await rec.hover(T, T.locator('button[title="Show the steps"]'), { dx: -260, ms: 1200 });
  });

  await rec.beat('22-steps', async () => {
    await rec.click(T, T.locator('button[title="Show the steps"]'));
  });
  await rec.skip(async () => { await until(() => deckIdle(T)); await sleep(1200); }, { speed: 1.5 });
  await sleep(1200);

  // --- 5. Many samples ------------------------------------------------------------------------------
  rec.chapter('Run it over a table');
  await rec.beat('23-iterate', async () => {
    await rec.click(T, runTab('Iterate'));
    await T.locator('table').waitFor();
    await sleep(500);
    await rec.hover(T, T.locator('table input').first());
  });

  await rec.beat('24-rows', async () => {
    const cells = T.locator('table tbody input');
    for (const [i, v] of ['1', '2', '4'].entries()) {
      await rec.fill(T, cells.nth(i), v, { replace: true }); // the first row still holds the value from Once
    }
    await sleep(400);
    await rec.click(T, T.getByRole('button', { name: /^Run$/ }));
  });
  await rec.skip(async () => { await sleep(2500); await until(() => deckIdle(T)); await sleep(1200); }, { speed: 3.5 });
  await sleep(1000);

  // --- 6. The results --------------------------------------------------------------------------------
  rec.chapter('Read the results');
  await rec.beat('25-data', async () => {
    await rec.click(T, nav('Data'));
    const run = T.getByText(/Run #\d+/).first(); // newest first: the run over the table
    await run.waitFor();
    await sleep(500);
    await rec.click(T, run);
    await sleep(2500);
  });

  await rec.beat('26-row', async () => {
    await rec.click(T, T.getByText('Row 1', { exact: true }).last());
    await sleep(1200);
    await rec.hover(T, T.getByText('Row 1', { exact: true }).last(), { dx: 260, dy: 110, ms: 1400 });
  });

  await rec.beat('27-export', async () => {
    await rec.hover(T, T.locator('button[title^="Download the data table"]'));
  });

  // Said over the closing card, not over the app.
  rec.closing('28-docs');
}
