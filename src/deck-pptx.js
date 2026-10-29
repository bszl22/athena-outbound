import { readFileSync } from 'node:fs';
import PptxGenJS from 'pptxgenjs';

// The .pptx writer: lays out deck(...)'s content and adds nothing to it, so every word and number is pinned by
// test/deck.test.js. One layout per slide id. Light tokens only, from the same tokens.css as the dashboard;
// orange once per slide, on the rule under the title.

const TOKENS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
const LIGHT = TOKENS.slice(TOKENS.indexOf(':root {'), TOKENS.indexOf('}', TOKENS.indexOf(':root {')));
const color = name => LIGHT.match(new RegExp(`--${name}:\\s*#([0-9A-Fa-f]{6})`))[1];
const C = Object.fromEntries(['bg', 'surface', 'surface-muted', 'border', 'border-strong', 'text', 'text-strong', 'text-body', 'text-secondary', 'accent'].map(n => [n, color(n)]));

const TRACKING_EM = Number(TOKENS.match(/--tracking-display:\s*(-?[\d.]+)em/)[1]);
const DISPLAY = 'Source Serif 4';
const UI = 'Geist';
const MONO = 'Menlo';
const W = 13.333, H = 7.5, X = 0.6, CW = W - 2 * X;
const TOP = 1.45; // where content starts, under the title

const body = (extra = {}) => ({ fontFace: UI, color: C['text-body'], fontSize: 14, valign: 'top', margin: 0, paraSpaceAfter: 6, ...extra });
const bullets = items => items.map(text => ({ text, options: { bullet: { indent: 14 }, breakLine: true } }));
const cardBox = (s, x, y, w, h) => s.addShape('roundRect', { x, y, w, h, rectRadius: 0.12, fill: { color: C.surface }, line: { color: C.border, width: 1 } });

function chrome(pptx, title, credit, number) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  if (title) {
    s.addText(title, { x: X, y: 0.4, w: CW, h: 0.75, fontFace: DISPLAY, fontSize: 28, color: C['text-strong'], charSpacing: TRACKING_EM * 28, valign: 'bottom', margin: 0 });
    s.addShape('rect', { x: X, y: 1.2, w: 0.6, h: 0.05, fill: { color: C.accent }, line: { type: 'none' } });
  }
  s.addText(credit, { x: X, y: H - 0.45, w: CW - 1, h: 0.3, fontFace: UI, fontSize: 9, color: C['text-secondary'], margin: 0 });
  s.addText(number, { x: W - X - 1, y: H - 0.45, w: 1, h: 0.3, fontFace: UI, fontSize: 9, color: C['text-secondary'], align: 'right', margin: 0 });
  return s;
}

function table(s, { head, rows }, { y, h, colW, fontSize = 12, x = X, w = CW }) {
  const cell = (text, opts = {}) => ({ text, options: { fontFace: UI, fontSize, color: C['text-body'], valign: 'middle', margin: [3, 6, 3, 6], ...opts } });
  const numeric = rows.map(r => r.map(v => /^[\d,.%–]+( emailed)?$/.test(v) || v === ''));
  s.addTable([
    head.map((t, i) => cell(t, { bold: true, color: C['text-strong'], align: numeric.every(r => r[i]) ? 'right' : 'left', border: [null, null, { pt: 1, color: C['border-strong'] }, null] })),
    ...rows.map((r, ri) => r.map((t, i) => cell(t, { align: numeric[ri][i] && numeric.every(rr => rr[i]) ? 'right' : 'left', border: [null, null, { pt: 0.75, color: C.border }, null] }))),
  ], { x, y, w, h, colW, autoPage: false });
}

function stats(s, items, { y, h = 1.25, valueSize = 34 }) {
  const gap = 0.25, w = (CW - gap * (items.length - 1)) / items.length;
  items.forEach(({ value, label }, i) => {
    const x = X + i * (w + gap);
    cardBox(s, x, y, w, h);
    s.addText(value, { x: x + 0.2, y: y + 0.12, w: w - 0.4, h: h * 0.5, fontFace: DISPLAY, fontSize: valueSize, color: C['text-strong'], margin: 0 });
    s.addText(label, { x: x + 0.2, y: y + h * 0.62, w: w - 0.4, h: h * 0.33, ...body({ fontSize: 11, color: C['text-secondary'] }) });
  });
}

// One email on a card: who, the route, the subject, then the email as it renders.
function email(s, { heading, sub, route, subject, text }, { x, y, w, h, fontSize = 9.5 }) {
  cardBox(s, x, y, w, h);
  const parts = [
    { text: heading, options: { bold: true, color: C['text-strong'], fontSize: fontSize + 2, breakLine: true } },
    ...(sub ? [{ text: sub, options: { color: C['text-secondary'], breakLine: true } }] : []),
    ...(route ? [{ text: route, options: { color: C['text-secondary'], italic: true, breakLine: true } }] : []),
    { text: ' ', options: { breakLine: true, fontSize: 4 } },
    ...(subject ? [{ text: `Subject: ${subject}`, options: { bold: true, breakLine: true } }] : []),
    { text, options: {} },
  ];
  s.addText(parts, { x: x + 0.18, y: y + 0.14, w: w - 0.36, h: h - 0.28, ...body({ fontSize, paraSpaceAfter: 0, lineSpacingMultiple: 1.05 }) });
}

// A featured contact's card, as email(...) takes it.
const card = c => ({ heading: `${c.number}. ${c.name}`, sub: c.title, route: c.route, subject: c.subject, text: c.body });

const LAYOUT = {
  answer(s, d) {
    s.addText(d.lead, { x: X, y: TOP + 0.05, w: CW, h: 0.8, ...body({ fontSize: 17, color: C['text-body'] }) });
    stats(s, d.stats, { y: 2.55 });
    const links = d.links.flatMap(({ label, url }, i) => [
      { text: `${label}: `, options: { bold: true, color: C['text-strong'] } },
      url ? { text: url, options: { hyperlink: { url }, color: C['text-strong'], underline: { style: 'sng' } } } : { text: 'coming', options: { color: C['text-secondary'] } },
      { text: '', options: { breakLine: i < d.links.length - 1 } },
    ]);
    s.addText(links, { x: X, y: 4.2, w: CW, h: 2.4, ...body({ fontSize: 14, paraSpaceAfter: 8 }) });
  },
  built: (s, d) => s.addText(bullets(d.items), { x: X, y: TOP + 0.1, w: CW, h: 5.3, ...body({ fontSize: 18, paraSpaceAfter: 14 }) }),
  next: (s, d) => LAYOUT.built(s, d),
  assumptions: (s, d) => s.addText(bullets(d.items), { x: X, y: TOP + 0.1, w: CW, h: 5.4, ...body({ fontSize: 15, paraSpaceAfter: 9 }) }),
  trust(s, d) {
    const w = (CW - 0.4) / 2;
    d.columns.forEach(({ heading, items }, i) => {
      const x = X + i * (w + 0.4);
      cardBox(s, x, TOP + 0.05, w, 4.55);
      s.addText(heading, { x: x + 0.25, y: TOP + 0.2, w: w - 0.5, h: 0.45, fontFace: DISPLAY, fontSize: 19, color: C['text-strong'], margin: 0 });
      s.addText(bullets(items), { x: x + 0.25, y: TOP + 0.8, w: w - 0.5, h: 3.7, ...body({ fontSize: 13.5, paraSpaceAfter: 8 }) });
    });
    s.addText(d.footnote, { x: X, y: 6.25, w: CW, h: 0.55, ...body({ fontSize: 13, italic: true, color: C['text-strong'] }) });
  },
  funnel(s, d) {
    table(s, d.table, { y: TOP + 0.15, h: 3.6, colW: [7.6, 2, 2.53], fontSize: 17 });
    s.addText(d.note, { x: X, y: 5.6, w: CW, h: 0.8, ...body({ fontSize: 14, color: C['text-secondary'] }) });
  },
  routing(s, d) {
    const n = d.flow.length, gap = 0.3, w = (CW - gap * (n - 1)) / n;
    d.flow.forEach(({ name, rule }, i) => {
      const x = X + i * (w + gap);
      cardBox(s, x, TOP + 0.05, w, 1.35);
      s.addText([{ text: name, options: { bold: true, color: C['text-strong'], fontSize: 14, breakLine: true } }, { text: rule, options: { fontSize: 11 } }],
        { x: x + 0.15, y: TOP + 0.15, w: w - 0.3, h: 1.15, ...body({ paraSpaceAfter: 3 }) });
      if (i < n - 1) s.addText('→', { x: x + w, y: TOP + 0.45, w: gap, h: 0.5, fontFace: UI, fontSize: 16, color: C['text-secondary'], align: 'center', margin: 0 });
    });
    table(s, d.table, { y: 3.2, h: 3.2, colW: [2.1, 7.0, 1.2, 1.83], fontSize: 12.5 });
  },
  cards(s, d) {
    const gap = 0.3, w = (CW - gap * (d.cards.length - 1)) / d.cards.length;
    d.cards.forEach((c, i) => email(s, card(c), { x: X + i * (w + gap), y: TOP + 0.05, w, h: 5.35, fontSize: 10.5 }));
  },
  dashboard(s, d) {
    const w = (CW - 0.4) / 2;
    d.columns.forEach(({ heading, steps }, i) => {
      const x = X + i * (w + 0.4);
      cardBox(s, x, TOP + 0.05, w, 4.55);
      s.addText(heading, { x: x + 0.25, y: TOP + 0.2, w: w - 0.5, h: 0.45, fontFace: DISPLAY, fontSize: 19, color: C['text-strong'], margin: 0 });
      const items = steps.flatMap(({ name, detail }) => [{ text: `${name}. `, options: { bold: true, color: C['text-strong'], bullet: { indent: 14 } } }, { text: detail, options: { breakLine: true } }]);
      s.addText(items, { x: x + 0.25, y: TOP + 0.8, w: w - 0.5, h: 3.7, ...body({ fontSize: 12.5, paraSpaceAfter: 7 }) });
    });
    s.addText([{ text: `${d.link.label}: `, options: { bold: true, color: C['text-strong'] } }, { text: d.link.url, options: { hyperlink: { url: d.link.url }, underline: { style: 'sng' }, color: C['text-strong'] } }],
      { x: X, y: 6.25, w: CW, h: 0.4, ...body({ fontSize: 13 }) });
  },
  signals(s, d) {
    table(s, d.table, { y: TOP + 0.05, h: 2.85, colW: [0.7, 2.1, 7.03, 1.0, 1.3], fontSize: 11.5 });
    const left = 4.9;
    s.addText(bullets(d.items), { x: X, y: 4.65, w: left, h: 2.1, ...body({ fontSize: 12.5, paraSpaceAfter: 8 }) });
    s.addText('What I rejected', { x: X + left + 0.4, y: 4.6, w: CW - left - 0.4, h: 0.35, fontFace: DISPLAY, fontSize: 15, color: C['text-strong'], margin: 0 });
    table(s, { head: ['Field', 'Why not'], rows: d.rejected }, { x: X + left + 0.4, w: CW - left - 0.4, y: 5.0, h: 1.8, colW: [3.0, CW - left - 3.4], fontSize: 10 });
  },
  templates(s, d) {
    s.addText(d.lead, { x: X, y: TOP + 0.05, w: CW, h: 0.45, ...body({ fontSize: 17 }) });
    const w = 4.6, h = 3.7, y = TOP + 0.75, gap = 0.5;
    s.addShape('roundRect', { x: X, y, w, h, rectRadius: 0.12, fill: { color: C['surface-muted'] }, line: { color: C.border, width: 1 } });
    s.addText(d.skeleton, { x: X + 0.25, y: y + 0.2, w: w - 0.5, h: h - 0.4, fontFace: MONO, fontSize: 12.5, color: C['text-strong'], valign: 'top', margin: 0 });
    const steps = d.steps.flatMap(({ name, detail }) => [
      { text: `${name}: `, options: { bold: true, color: C['text-strong'], bullet: { type: 'number' } } },
      { text: detail, options: { breakLine: true } },
    ]);
    s.addText(steps, { x: X + w + gap, y, w: CW - w - gap, h: 4.4, ...body({ fontSize: 15.5, paraSpaceAfter: 14 }) });
  },
  copy(s, d) {
    table(s, d.table, { y: TOP + 0.05, h: 2.5, colW: [1.8, 5.5, 4.83], fontSize: 11 });
    s.addText('Snippet groups', { x: X, y: 4.45, w: CW, h: 0.35, fontFace: DISPLAY, fontSize: 15, color: C['text-strong'], margin: 0 });
    const half = Math.floor(d.groups.length / 2), w = (CW - 0.4) / 2;
    [d.groups.slice(0, half), d.groups.slice(half)].forEach((groups, i) => {
      const items = groups.flatMap(({ name, detail }) => [{ text: `${name}: `, options: { bold: true, color: C['text-strong'], bullet: { indent: 14 } } }, { text: detail, options: { breakLine: true } }]);
      s.addText(items, { x: X + i * (w + 0.4), y: 4.85, w, h: 1.4, ...body({ fontSize: 11, paraSpaceAfter: 4 }) });
    });
    s.addText(d.note, { x: X, y: 6.4, w: CW, h: 0.45, ...body({ fontSize: 11, color: C['text-secondary'] }) });
  },
  sequence(s, d) {
    const left = 6.6;
    table(s, d.table, { y: TOP + 0.05, h: 1.4, colW: [0.7, 1.0, 3.7, 1.2], w: left, fontSize: 11.5 });
    s.addText(bullets(d.items), { x: X, y: 3.05, w: left, h: 3.75, ...body({ fontSize: 11.5, paraSpaceAfter: 5 }) });
    const x = X + left + 0.35, w = CW - left - 0.35, h = 2.5;
    d.followUps.forEach(({ step, subject, body: text }, i) =>
      email(s, { heading: `Elena, step ${step}`, subject, text }, { x, y: TOP + 0.05 + i * (h + 0.2), w, h, fontSize: 10 }));
  },
  checklist: (s, d) => table(s, d.table, { y: TOP + 0.1, h: 3.8, colW: [3.6, 1.6, 6.93], fontSize: 14 }),
};

// The deck as a .pptx buffer.
export async function deckPptx(d) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Bryan Soo';
  pptx.title = d.slides[0].title;
  for (const slide of [...d.slides, ...d.appendix]) LAYOUT[slide.id](chrome(pptx, slide.title, d.credit, slide.number), slide);
  return pptx.write({ outputType: 'nodebuffer' });
}
