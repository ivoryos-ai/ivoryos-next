// The real desktop app, driven for the documentation: launched with Playwright against a home
// folder of its own (docs-site/.desktop-home, ignored by git), so the pictures and the tutorial
// video show the app people install and nothing here touches a person's own decks.
//
// A window that shows a deck is two pages: the launcher (sidebar and title bar) and, laid over it
// below the bar and right of the sidebar, the deck's own page (desktop/src/main.js layoutTabs).
// `shot()` photographs both and puts them together as the window shows them.
//
// Used by scripts/desktop-shots.mjs (annotated pictures) and video/record.mjs (the tutorial).

import { _electron as electron } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const DESKTOP = path.join(REPO, 'desktop');
// One home per use, so the pictures' decks and the video's never meet.
export const HOMES = path.join(REPO, 'docs-site', '.desktop-home');
export const DEFAULT_HOME = path.join(HOMES, 'shots');

const electronBinary = () => {
  const dist = path.join(DESKTOP, 'node_modules', 'electron', 'dist');
  if (process.platform === 'darwin') return path.join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  return path.join(dist, process.platform === 'win32' ? 'electron.exe' : 'electron');
};

/**
 * Start the app. `home` is its data folder (profiles, the Python environment, logs); `size` the
 * window's content size in CSS pixels; `env` extra environment for the app.
 */
export async function launchApp({ home = DEFAULT_HOME, size = { width: 1320, height: 800 }, env = {}, theme = 'light', profiles } = {}) {
  fs.mkdirSync(home, { recursive: true });
  // A new home starts with one empty deck, "My deck", as a new install does. `profiles: []`
  // starts with none instead (the welcome page); it is only written when the home has no
  // profiles file yet, so a second launch keeps what the first one made.
  const stored = path.join(home, 'profiles.json');
  if (profiles && !fs.existsSync(stored)) {
    fs.writeFileSync(stored, JSON.stringify({ version: 1, hubUrl: null, cloudUrl: null, autoUpdate: false, theme, profiles }, null, 2));
  }
  const app = await electron.launch({
    executablePath: electronBinary(),
    // Kept drawing while another window covers it: the pictures are taken from the pages, and a
    // covered window otherwise stops painting.
    args: [DESKTOP, '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
    env: { ...process.env, IVORYOS_DESKTOP_HOME: home, IVORYOS_CLOUD_COMING_SOON: '1', ...env },
  });
  const launcher = await app.firstWindow();
  await launcher.waitForLoadState('domcontentloaded');
  // The sidebar as a new install has it, whatever an earlier session here hid or resized.
  const reset = await launcher.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('launcher.'));
    for (const k of keys) localStorage.removeItem(k);
    return keys.length;
  }).catch(() => 0);
  if (reset) { await launcher.reload(); await launcher.waitForLoadState('domcontentloaded'); }
  // The window is kept off to the side of the screen and never brought forward: it is driven
  // through its pages, and a person working at this computer should not have it land on them.
  const scale = await app.evaluate(({ BrowserWindow, nativeTheme, screen }, { size, theme }) => {
    nativeTheme.themeSource = theme;
    const win = BrowserWindow.getAllWindows()[0];
    win.setContentSize(size.width, size.height);
    return screen.getPrimaryDisplay().scaleFactor;
  }, { size, theme });

  const main = (fn, arg) => app.evaluate(fn, arg);

  /** The active tab's id and where its view sits in the window, or null for the launcher page. */
  const activeTab = () => main(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const view = win.contentView.children.find((c) => c.webContents && c.webContents !== win.webContents);
    return view ? { bounds: view.getBounds(), url: view.webContents.getURL() } : null;
  });

  /** The Playwright page of the deck (or plugin) shown in the active tab. */
  const tabPage = async () => {
    const tab = await activeTab();
    if (!tab) return null;
    const origin = new URL(tab.url).origin;
    for (let i = 0; i < 40; i++) {
      const page = app.windows().find((p) => p !== launcher && p.url().startsWith(origin) && !p.isClosed());
      if (page) return page;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no page for the tab at ${tab.url}`);
  };

  /** One picture of the window as it shows: the launcher page with the active tab laid over it. */
  const shot = async () => {
    const base = await launcher.screenshot();
    const tab = await activeTab();
    if (!tab) return base;
    const page = await tabPage();
    const over = await page.screenshot();
    const meta = await sharp(base).metadata();
    const k = meta.width / size.width;
    const fitted = await sharp(over).resize(Math.round(tab.bounds.width * k), Math.round(tab.bounds.height * k), { fit: 'fill' }).toBuffer();
    return sharp(base).composite([{ input: fitted, left: Math.round(tab.bounds.x * k), top: Math.round(tab.bounds.y * k) }]).png().toBuffer();
  };

  const close = async () => {
    // Stop the decks first, as Quit does, and wait for them: a deck left running keeps its port.
    await launcher.evaluate(async () => {
      const api = window.ivoryosDesktop;
      const { profiles } = await api.snapshot();
      await Promise.all(profiles.filter((p) => p.status.state !== 'stopped').map((p) => api.stop(p.id).catch(() => {})));
    }).catch(() => {});
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    const pid = app.process().pid;
    await Promise.race([app.close().catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    // Anything of this home's still alive (an edge whose stop was cut short).
    try { execFileSync('pkill', ['-f', `${home}/`]); } catch { /* nothing left: what we want */ }
  };

  return { app, launcher, size, scale, main, activeTab, tabPage, shot, close };
}
