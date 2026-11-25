// Records the desktop app for the tutorial: what each of the window's pages paints (the launcher,
// and the deck tab laid over it), where the pointer is, and when each spoken line starts. Nothing
// is put together here; compose.mjs makes the film from what this writes, so the picture can be
// recut (zooms, cards, the cursor's look) without recording again.
//
// A take is a folder: frames/<source>/<ms>.jpg as the pages painted them (Chrome's screencast, so
// a still page costs nothing and a moving one is captured as it moves), and take.json with the
// rest: the tab's place in the window over time, the pointer's path, clicks, beats (a spoken line
// and when it started), spans that are cut or played fast, zooms and chapter titles.

import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every second painted frame (30 a second from a page that moves), at a quality where text stays sharp.
const SCREENCAST = { format: 'jpeg', quality: 90, everyNthFrame: 2 };
const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

export class Recorder {
  constructor(app, dir, voice) {
    this.a = app; // from scripts/desktop-app.mjs launchApp()
    this.dir = dir;
    this.voice = voice; // {lineId: {seconds}}
    this.sources = new Map(); // page -> {name, cdp}
    this.frames = []; // {src, t, file}
    this.layout = []; // {t, src, bounds} | {t, src: null}
    this.pointer = []; // {t, x, y}
    this.clicks = []; // {t, x, y}
    this.beats = []; // {id, t, end}
    this.warps = []; // {t0, t1, speed} (speed 0 = cut)
    this.zooms = []; // {t, rect|null, ms}
    this.chapters = []; // {t, title}
    this.keys = []; // {t, text} shown as a key hint
    this.pos = { x: app.size.width / 2, y: app.size.height / 2 };
    this.warp = null;
    this.t0 = 0;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  }

  now() { return Date.now() - this.t0; }

  /** Film time since the take began: real time, less what is cut, with fast spans shortened. */
  filmNow() {
    let t = this.now();
    let film = t;
    for (const w of [...this.warps, ...(this.warp ? [{ ...this.warp, t1: t }] : [])]) {
      const span = w.t1 - w.t0;
      film -= span - (w.speed ? span / w.speed : 0);
    }
    return film;
  }

  async watch(page, name) {
    if (this.sources.has(page)) return;
    const cdp = await page.context().newCDPSession(page);
    this.sources.set(page, { name, cdp, seen: 0 });
    fs.mkdirSync(path.join(this.dir, 'frames', name), { recursive: true });
    // The page believes it has the keyboard's attention (a caret in a field, focus rings) even
    // though the window is not the one in front.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (!this.t0) return;
      const t = Math.round(metadata.timestamp * 1000 - this.t0);
      // A page that redraws without changing (a 3D view at rest) sends the same picture again.
      const s = this.sources.get(page);
      s.seen = Date.now();
      s.settled = false;
      this.keep(s, data, t);
    });
    await cdp.send('Page.startScreencast', SCREENCAST);
  }

  keep(s, data, t) {
    if (s.last === data) return;
    s.last = data;
    const file = path.join('frames', s.name, `${String(Math.max(0, t)).padStart(8, '0')}.jpg`);
    fs.writeFile(path.join(this.dir, file), Buffer.from(data, 'base64'), () => {});
    this.frames.push({ src: s.name, t, file });
  }

  /**
   * The screencast drops a frame that is painted while an earlier one is still on its way here,
   * and a page that then stops changing never sends it again: the last picture of an animation
   * (a dialog closing, a spinner's final state) can be missing for as long as the page stays
   * still. So a page that has just gone quiet is photographed once, and a quiet page again every
   * second and a half in case it changed without a frame arriving at all.
   */
  async settle() {
    for (const [, s] of this.sources) {
      const quiet = Date.now() - (s.seen || 0);
      const due = (quiet > 220 && !s.settled) || (quiet > 1500 && Date.now() - (s.probed || 0) > 1500);
      if (!due || s.busy) continue;
      s.busy = true;
      s.settled = true;
      s.probed = Date.now();
      const t = this.now();
      s.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: SCREENCAST.quality })
        .then(({ data }) => { if (this.t0) this.keep(s, data, t); })
        .catch(() => {})
        .finally(() => { s.busy = false; });
    }
  }

  async start() {
    this.t0 = Date.now();
    this.pointer.push({ t: 0, ...this.pos });
    // A first frame for every page already watched: a still page sends none by itself.
    for (const [page] of this.sources) await this.nudge(page);
    this.poll = setInterval(() => this.readLayout().catch(() => {}), 60);
    this.settling = setInterval(() => this.settle().catch(() => {}), 110);
    await this.readLayout();
  }

  /** Make a page paint once, so there is a frame of it at about this moment. */
  async nudge(page) {
    const s = this.sources.get(page);
    if (!s) return;
    await s.cdp.send('Page.stopScreencast').catch(() => {});
    s.last = null;
    await s.cdp.send('Page.startScreencast', SCREENCAST).catch(() => {});
  }

  async readLayout() {
    const tab = await this.a.activeTab();
    let src = null;
    if (tab) {
      const page = await this.a.tabPage().catch(() => null);
      if (page) {
        if (!this.sources.has(page)) await this.watch(page, `tab${this.sources.size}`);
        src = this.sources.get(page).name;
      }
    }
    const key = JSON.stringify([src, tab && tab.bounds]);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.layout.push({ t: this.now(), src, bounds: tab ? tab.bounds : null });
  }

  /** The deck's page in the active tab (watched from now on), and its place in the window. */
  async tab() {
    const page = await this.a.tabPage();
    await this.readLayout();
    return page;
  }

  // --- the pointer ---------------------------------------------------------------------------

  /** Where a page's own coordinates start in the window. */
  async origin(page) {
    if (page === this.a.launcher) return { x: 0, y: 0 };
    const tab = await this.a.activeTab();
    return tab ? { x: tab.bounds.x, y: tab.bounds.y } : { x: 0, y: 0 };
  }

  /** The middle of a locator (or a point of the page), in window coordinates. */
  async at(page, target, { dx = 0, dy = 0, edge } = {}) {
    const o = await this.origin(page);
    if (target && typeof target.x === 'number') return { x: o.x + target.x, y: o.y + target.y };
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const b = await target.boundingBox();
    if (!b) throw new Error('nothing to point at');
    const x = edge === 'left' ? b.x + Math.min(18, b.width / 2) : b.x + b.width / 2;
    return { x: o.x + x + dx, y: o.y + b.y + b.height / 2 + dy };
  }

  /** Glide the pointer to a place in the window; the page under it sees a real mouse move. */
  async glide(page, to, { ms } = {}) {
    const from = { ...this.pos };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const dur = ms ?? Math.min(1100, 260 + dist * 0.9);
    const o = await this.origin(page);
    const steps = Math.max(2, Math.round(dur / 16));
    const began = Date.now();
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      const p = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      this.pos = p;
      this.pointer.push({ t: this.now(), ...p });
      await page.mouse.move(p.x - o.x, p.y - o.y).catch(() => {});
      const due = began + (dur * i) / steps;
      if (due > Date.now()) await sleep(due - Date.now());
    }
  }

  async hover(page, target, opts = {}) {
    await this.glide(page, await this.at(page, target, opts), opts);
  }

  async click(page, target, opts = {}) {
    await this.hover(page, target, opts);
    await sleep(opts.before ?? 140);
    this.clicks.push({ t: this.now(), ...this.pos });
    await page.mouse.down();
    await sleep(70);
    await page.mouse.up();
    await sleep(opts.after ?? 350);
  }

  /** Type as a person does, into whatever has the keyboard. */
  async type(page, text, { delay = 55 } = {}) {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await sleep(delay + Math.random() * 30);
    }
  }

  /** Click a field and type into it, replacing what it held when `replace` is set. */
  async fill(page, field, text, { replace = false, delay } = {}) {
    await this.click(page, field, { after: 180 });
    await field.focus().catch(() => {});
    if (replace) await page.keyboard.press('ControlOrMeta+a');
    await this.type(page, text, { delay });
  }

  async press(page, key, { show } = {}) {
    if (show) this.keys.push({ t: this.now(), text: show });
    await page.keyboard.press(key);
    await sleep(200);
  }

  /** Press on one thing, carry it to another, let go. */
  async drag(page, from, to, { fromOpts = {}, toOpts = {}, hold = 350 } = {}) {
    await this.hover(page, from, fromOpts);
    await sleep(160);
    this.clicks.push({ t: this.now(), ...this.pos });
    await page.mouse.down();
    await sleep(120);
    // A few small moves first: a drag only begins once the pointer has travelled a little.
    await this.glide(page, { x: this.pos.x + 14, y: this.pos.y + 8 }, { ms: 140 });
    const dest = await this.at(page, to, toOpts);
    await this.glide(page, dest, { ms: 900 });
    await this.glide(page, { x: dest.x + 3, y: dest.y + 2 }, { ms: 120 });
    await sleep(hold);
    await page.mouse.up();
    await sleep(450);
  }

  // --- the film's structure -------------------------------------------------------------------

  /**
   * One spoken line and what happens on screen while it is said. The beat lasts at least as long
   * as its line (plus a breath), however quick the actions were.
   */
  async beat(id, actions, { lead = 400, tail = 800 } = {}) {
    const line = this.voice[id];
    if (!line) throw new Error(`no narration recorded for "${id}"; run voice.py`);
    const beat = { id, t: this.now() };
    const film0 = this.filmNow();
    this.beats.push(beat);
    await sleep(lead);
    if (actions) await actions();
    const need = line.seconds * 1000 + tail;
    while (this.filmNow() - film0 < need) await sleep(40);
    beat.end = this.now();
  }

  /** A line said over the closing card, after the recording ends: nothing is held for it. */
  closing(id) {
    if (!this.voice[id]) throw new Error(`no narration recorded for "${id}"; run voice.py`);
    const t = this.now();
    this.beats.push({ id, t, end: t, closing: true });
  }

  /** Something long that the film skips (an install); `speed` plays it fast instead of cutting. */
  async skip(actions, { speed = 0 } = {}) {
    this.warp = { t0: this.now(), speed };
    try { await actions(); } finally {
      this.warps.push({ ...this.warp, t1: this.now() });
      this.warp = null;
      for (const [page] of this.sources) await this.nudge(page);
      await sleep(250);
    }
  }

  /** Move in on part of the window ({x, y, width, height} in window points), or back out (null). */
  zoom(rect, ms = 700) { this.zooms.push({ t: this.now(), rect, ms }); }

  /** Move in on a locator, with room around it. */
  async zoomOn(page, target, { pad = 60, minWidth = 760, ms } = {}) {
    const o = await this.origin(page);
    const b = await target.boundingBox();
    if (!b) return;
    const { width: W, height: H } = this.a.size;
    let w = Math.max(minWidth, b.width + 2 * pad);
    let h = (w * H) / W;
    if (h < b.height + 2 * pad) { h = b.height + 2 * pad; w = (h * W) / H; }
    w = Math.min(w, W); h = Math.min(h, H);
    const cx = o.x + b.x + b.width / 2;
    const cy = o.y + b.y + b.height / 2;
    const x = Math.max(0, Math.min(W - w, cx - w / 2));
    const y = Math.max(0, Math.min(H - h, cy - h / 2));
    this.zoom({ x, y, width: w, height: h }, ms);
  }

  chapter(title) { this.chapters.push({ t: this.now(), title }); }

  async stop() {
    clearInterval(this.poll);
    await sleep(500);
    clearInterval(this.settling);
    for (const [, s] of this.sources) await s.cdp.send('Page.stopScreencast').catch(() => {});
    await sleep(300);
    const take = {
      size: this.a.size,
      scale: this.a.scale,
      length: this.now(),
      frames: this.frames.sort((x, y) => x.t - y.t),
      layout: this.layout,
      pointer: this.pointer,
      clicks: this.clicks,
      beats: this.beats,
      warps: this.warps,
      zooms: this.zooms,
      chapters: this.chapters,
      keys: this.keys,
    };
    fs.writeFileSync(path.join(this.dir, 'take.json'), JSON.stringify(take));
    return take;
  }
}
