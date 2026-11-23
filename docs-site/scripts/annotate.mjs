// Annotations for the documentation's screenshots: a thin teal ring round each thing a picture is
// about, and a plain note beside it saying what it is, joined by a curved arrow, so a reader gets
// the explanation from the picture itself. The look is deliberately quiet: flat navy notes, the
// app's own font, sentence case, no tilt, teal the only accent. Drawn in the page, over the real elements, then photographed with it: after
// an interface change the rings and notes follow the elements they name.
//
//   await annotate(page, [
//     { at: '[data-toolbox]', title: 'Toolbox', text: 'Drag a step onto the canvas.' },
//     { at: page.getByRole('button', { name: 'Run' }), title: 'Run', text: '…', side: 'above' },
//   ]);
//   await page.screenshot(...);
//   await clearAnnotations(page);
//
// A note:
//   at      what it points at: a selector, a Playwright locator, a {x, y, width, height} box, or
//           an array of those (one ring round them all). Omit for a note that points at nothing.
//   title   two or three words; text: one short sentence (optional).
//   side    where the note sits: 'right' | 'left' | 'above' | 'below' (tried in that order when
//           not given, first one with room wins), or 'inside' for a large region.
//   align   'start' | 'center' | 'end' along the ring's edge (all three are tried when not given).
//   dx, dy  nudge the note from where it was placed; xy: [x, y] puts its corner exactly there.
//   pad     space between the element and its ring (default 6); width: the note's width (246).
//   ring    false for a note with an arrow but no ring; bow: 1 or -1, which way its arrow curves.
//
// Options: { dim: true } darkens everything outside the rings; { keep: [targets] } leaves those
// undarkened too, without a ring (a dialog the picture is about); { bounds } keeps notes inside a
// clipped screenshot; { numbered } numbers the notes (default: when there is more than one).

const boxOf = async (page, at) => {
  if (!at) return null;
  if (Array.isArray(at)) {
    const boxes = (await Promise.all(at.map((a) => boxOf(page, a)))).filter(Boolean);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const r = Math.max(...boxes.map((b) => b.x + b.width));
    const bt = Math.max(...boxes.map((b) => b.y + b.height));
    return { x, y, width: r - x, height: bt - y };
  }
  if (typeof at === 'object' && typeof at.x === 'number') return at;
  const locator = typeof at === 'string' ? page.locator(at).first() : at.first();
  await locator.waitFor({ state: 'visible', timeout: 8000 });
  return locator.boundingBox();
};

export async function annotate(page, notes, opts = {}) {
  const resolved = [];
  for (const note of notes) {
    let box = null;
    try {
      box = await boxOf(page, note.at);
    } catch (e) {
      throw new Error(`annotation "${note.title}": nothing on the page matches its target (${String(e.message).split('\n')[0]})`);
    }
    if (note.at && !box) throw new Error(`annotation "${note.title}": its target is not visible`);
    const { at, ...rest } = note;
    resolved.push({ ...rest, box });
  }
  const keep = [];
  for (const k of [].concat(opts.keep || [])) {
    const b = await boxOf(page, k).catch(() => null);
    if (b) keep.push(b);
  }
  const problems = await page.evaluate(draw, {
    notes: resolved,
    keep,
    dim: opts.dim !== false,
    bounds: opts.bounds || null,
    numbered: opts.numbered ?? resolved.length > 1,
  });
  for (const p of problems) console.warn(`     note: ${p}`);
}

export const clearAnnotations = (page) => page.evaluate(() => document.getElementById('ivoryos-annotations')?.remove());

// Runs in the page.
function draw({ notes, keep, dim, bounds, numbered }) {
  document.getElementById('ivoryos-annotations')?.remove();
  const W = window.innerWidth;
  const H = window.innerHeight;
  const area = bounds ? { x: bounds.x, y: bounds.y, r: bounds.x + bounds.width, b: bounds.y + bounds.height } : { x: 0, y: 0, r: W, b: H };
  const EDGE = 14; // notes keep this far from the picture's edge
  const GAP = 38; // between a ring and its note, room for the arrow to curve
  const TEAL = '#45c4b5';
  const PANEL = '#1f2b3d';
  const FONT = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  const problems = [];

  const root = document.createElement('div');
  root.id = 'ivoryos-annotations';
  root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const style = document.createElement('style');
  style.textContent = `
    #ivoryos-annotations, #ivoryos-annotations * { box-sizing: border-box; }
    #ivoryos-annotations .note {
      position: absolute; padding: 10px 14px 11px 12px; color: #c5d0dc; background: ${PANEL};
      border-radius: 10px; box-shadow: 0 8px 22px -10px rgba(8,14,24,.55);
      font-family: ${FONT}; font-size: 16.5px; line-height: 1.34; font-weight: 400;
      letter-spacing: 0; text-align: left; white-space: normal; text-transform: none;
      display: flex; gap: 10px; align-items: flex-start;
    }
    #ivoryos-annotations .note .title { color: #ffffff; font-size: 17.5px; font-weight: 600; line-height: 1.25; }
    #ivoryos-annotations .note .text { margin-top: 3px; }
    #ivoryos-annotations .note .text b { font-weight: 600; color: #e6edf4; }
    #ivoryos-annotations .num {
      flex: none; min-width: 15px; color: ${TEAL}; font-size: 24px; font-weight: 500; line-height: 1;
      font-variant-numeric: tabular-nums; margin-top: -1px;
    }
  `;
  root.appendChild(style);
  document.body.appendChild(root);

  const hits = (a, b, grow = 0) => a.x - grow < b.x + b.w && a.x + a.w + grow > b.x && a.y - grow < b.y + b.h && a.y + a.h + grow > b.y;
  // Rings, a little larger than the elements they go round.
  const rings = notes.map((n) => {
    if (!n.box || n.ring === false) return null;
    const pad = n.pad ?? 6;
    return { x: n.box.x - pad, y: n.box.y - pad, w: n.box.width + 2 * pad, h: n.box.height + 2 * pad };
  });
  // Rings round neighbouring elements (two buttons side by side) would cross where their padding
  // meets: each gives up half the space between the two, so they sit apart.
  const contains = (a, b) => a.x <= b.x && a.y <= b.y && a.x + a.w >= b.x + b.w && a.y + a.h >= b.y + b.h;
  for (let i = 0; i < rings.length; i++) {
    for (let j = 0; j < rings.length; j++) {
      const a = rings[i];
      const b = rings[j];
      if (i === j || !a || !b || !hits(a, b, 2) || contains(a, b) || contains(b, a)) continue;
      const ba = notes[i].box;
      const bb = notes[j].box;
      if (ba.x + ba.width <= bb.x) {
        const mid = (ba.x + ba.width + bb.x) / 2;
        a.w = Math.max(ba.x + ba.width + 1, mid - 2) - a.x;
        const right = b.x + b.w;
        b.x = Math.min(bb.x - 1, mid + 2);
        b.w = right - b.x;
      } else if (ba.y + ba.height <= bb.y) {
        const mid = (ba.y + ba.height + bb.y) / 2;
        a.h = Math.max(ba.y + ba.height + 1, mid - 2) - a.y;
        const bottom = b.y + b.h;
        b.y = Math.min(bb.y - 1, mid + 2);
        b.h = bottom - b.y;
      }
    }
  }
  // Where the arrow lands: the ring, or the bare element when there is no ring.
  const targets = notes.map((n, i) => rings[i] || (n.box ? { x: n.box.x, y: n.box.y, w: n.box.width, h: n.box.height } : null));

  const inside = (r) => r.x >= area.x + EDGE && r.y >= area.y + EDGE && r.x + r.w <= area.r - EDGE && r.y + r.h <= area.b - EDGE;
  const clamp = (r) => ({
    ...r,
    x: Math.max(area.x + EDGE, Math.min(r.x, area.r - EDGE - r.w)),
    y: Math.max(area.y + EDGE, Math.min(r.y, area.b - EDGE - r.h)),
  });

  // The notes, made first so each can be measured, then placed one after another.
  const els = notes.map((n, i) => {
    const el = document.createElement('div');
    el.className = 'note';
    el.style.width = `${n.width ?? 246}px`;
    if (numbered) {
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = String(i + 1);
      el.appendChild(num);
    }
    const body = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = n.title;
    body.appendChild(title);
    if (n.text) {
      const text = document.createElement('div');
      text.className = 'text';
      // **bold** for the name of something on the page.
      for (const [k, part] of n.text.split('**').entries()) {
        const node = k % 2 ? document.createElement('b') : document.createTextNode(part);
        if (k % 2) node.textContent = part;
        text.appendChild(node);
      }
      body.appendChild(text);
    }
    el.appendChild(body);
    root.appendChild(el);
    return el;
  });

  const placed = [];
  notes.forEach((n, i) => {
    const el = els[i];
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const t = targets[i];
    let spot = null;
    if (n.xy) spot = { x: n.xy[0], y: n.xy[1], w, h };
    else if (!t) spot = clamp({ x: area.r - EDGE - w, y: area.y + EDGE, w, h });
    else if (n.side === 'inside') {
      const m = 16;
      const xs = { start: t.x + m, center: t.x + (t.w - w) / 2, end: t.x + t.w - m - w };
      const ys = { start: t.y + m, center: t.y + (t.h - h) / 2, end: t.y + t.h - m - h };
      const [ax, ay] = (n.align || 'end start').split(' ');
      spot = clamp({ x: xs[ax] ?? xs.end, y: ys[ay || 'start'] ?? ys.start, w, h });
    } else {
      const sides = n.side ? [].concat(n.side) : ['right', 'below', 'left', 'above'];
      const aligns = n.align ? [n.align] : ['start', 'center', 'end'];
      const candidates = [];
      for (const gap of [GAP, GAP * 2, GAP * 3.5, GAP * 6]) {
        for (const side of sides) {
          for (const align of aligns) {
            const along = (from, size, mine) => (align === 'start' ? from : align === 'center' ? from + (size - mine) / 2 : from + size - mine);
            if (side === 'right') candidates.push({ x: t.x + t.w + gap, y: along(t.y, t.h, h), w, h });
            if (side === 'left') candidates.push({ x: t.x - gap - w, y: along(t.y, t.h, h), w, h });
            if (side === 'below') candidates.push({ x: along(t.x, t.w, w), y: t.y + t.h + gap, w, h });
            if (side === 'above') candidates.push({ x: along(t.x, t.w, w), y: t.y - gap - h, w, h });
          }
        }
      }
      const free = (c) => inside(c) && !targets.some((o) => o && hits(c, o, 8)) && !placed.some((p) => p && hits(c, p, 12));
      // A note that would only fit by sliding along its side still beats one that covers something.
      spot = candidates.find(free) || candidates.map(clamp).find((c) => !targets.some((o) => o && hits(c, o, 8)) && !placed.some((p) => p && hits(c, p, 12)));
      if (!spot) {
        spot = clamp(candidates[0]);
        problems.push(`"${n.title}" has no free place; it may cover something (give it side, dx/dy or xy)`);
      }
    }
    spot = { ...spot, x: spot.x + (n.dx || 0), y: spot.y + (n.dy || 0) };
    placed.push(spot);
    el.style.left = `${Math.round(spot.x)}px`;
    el.style.top = `${Math.round(spot.y)}px`;
  });

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.style.cssText = 'position:absolute;inset:0;';
  const add = (name, attrs, parent = svg) => {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    parent.appendChild(node);
    return node;
  };
  const radius = (r) => Math.min(10, r.h / 2, r.w / 2);
  const defs = add('defs', {});
  const head = add('marker', { id: 'ivoryos-annotations-head', viewBox: '0 0 10 10', refX: 8.2, refY: 5, markerWidth: 7.5, markerHeight: 7.5, orient: 'auto-start-reverse' }, defs);
  add('path', { d: 'M 1.5 1.5 L 8.5 5 L 1.5 8.5', fill: 'none', stroke: TEAL, 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, head);
  if (dim) {
    const mask = add('mask', { id: 'ivoryos-annotations-holes' }, defs);
    add('rect', { x: 0, y: 0, width: W, height: H, fill: 'white' }, mask);
    for (const r of rings) if (r) add('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: radius(r), fill: 'black' }, mask);
    for (const k of keep) add('rect', { x: k.x, y: k.y, width: k.width, height: k.height, rx: 12, fill: 'black' }, mask);
    add('rect', { x: 0, y: 0, width: W, height: H, fill: 'rgba(22,32,50,0.54)', mask: 'url(#ivoryos-annotations-holes)' });
  }
  for (const r of rings) {
    if (!r) continue;
    add('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: radius(r), fill: 'none', stroke: TEAL, 'stroke-width': 2.5 });
  }
  // A curved arrow from each note to its ring.
  notes.forEach((n, i) => {
    const t = targets[i];
    const p = placed[i];
    if (!t || n.side === 'inside' || n.line === false) return;
    const mid = (a0, a1, b0, b1) => {
      const lo = Math.max(a0, b0);
      const hi = Math.min(a1, b1);
      return lo <= hi ? (lo + hi) / 2 : null;
    };
    // From the point of the note nearest the ring to the point of the ring nearest the note:
    // straight across where the two face each other, corner to edge where they do not.
    const overlapY = mid(p.y + 14, p.y + p.h - 14, t.y + 4, t.y + t.h - 4);
    const overlapX = mid(p.x + 18, p.x + p.w - 18, t.x + 4, t.x + t.w - 4);
    const clampTo = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    let from;
    let to;
    if (p.x >= t.x + t.w || p.x + p.w <= t.x) {
      const right = p.x >= t.x + t.w;
      const y = overlapY ?? clampTo(t.y + t.h / 2, p.y + 16, p.y + p.h - 16);
      from = { x: right ? p.x : p.x + p.w, y };
      to = { x: right ? t.x + t.w : t.x, y: overlapY ?? clampTo(y, t.y + Math.min(8, t.h / 2), t.y + t.h - Math.min(8, t.h / 2)) };
    } else {
      const below = p.y >= t.y + t.h;
      const x = overlapX ?? clampTo(t.x + t.w / 2, p.x + 22, p.x + p.w - 22);
      from = { x, y: below ? p.y : p.y + p.h };
      to = { x: overlapX ?? clampTo(x, t.x + Math.min(10, t.w / 2), t.x + t.w - Math.min(10, t.w / 2)), y: below ? t.y + t.h : t.y };
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 8) return;
    const ux = dx / len;
    const uy = dy / len;
    // Stop short of both ends, then bow the line to one side: one gentle arc.
    const a = { x: from.x + ux * 5, y: from.y + uy * 5 };
    const b = { x: to.x - ux * 5, y: to.y - uy * 5 };
    const bow = Math.min(26, Math.max(7, len * 0.2)) * (n.bow ?? (i % 2 ? -1 : 1));
    const c = { x: (a.x + b.x) / 2 - uy * bow, y: (a.y + b.y) / 2 + ux * bow };
    add('path', { d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`, fill: 'none', stroke: TEAL, 'stroke-width': 2.2, 'stroke-linecap': 'round', 'marker-end': 'url(#ivoryos-annotations-head)' });
  });
  root.insertBefore(svg, els[0] || null);
  return problems;
}
