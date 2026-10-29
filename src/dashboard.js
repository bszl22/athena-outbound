import { readFileSync } from 'node:fs';
import { CAMPAIGNS, ANGLES, LEAD_SIGNALS, INBOXES, SENDS_PER_INBOX_PER_DAY, GUARDRAIL, sum } from './simulate.js';

// Outputs: docs/index.html, the dashboard. One static page with no build step and no backend, which opens offline.
// The numbers are baked in from the seeded simulation; the page's only script is the metric picker.
// Order: the Needs-a-person queue, the KPIs, the campaign × angle grid, then campaign × lead signal.

const TOKENS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
export const SPOT_CHECK_PER_CELL = 5;

const total = xs => Object.fromEntries(
  ['contacts', 'started', 'sent', 'bounced', 'unsubscribed', 'replied', 'positive', 'meetings', 'floor'].map(k => [k, sum(xs, k)]),
);
const thousands = n => n.toLocaleString('en-US');
const pct = n => `${(n * 100).toFixed(1)}%`;
const limit = n => `${+(n * 100).toFixed(1)}%`;
const share = (n, d) => (d ? n / d : 0);
const day = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

// The grid's seven metrics. Bounce and unsubscribe rates are per email sent, as the guardrail judges them;
// the reply rates and floor share are per contact whose sequence started, so a reply to any step counts once.
const METRICS = [
  ['sent', 'Sent', x => x.sent, thousands],
  ['bounce', 'Bounce rate', x => share(x.bounced, x.sent), pct],
  ['unsubscribe', 'Unsubscribe rate', x => share(x.unsubscribed, x.sent), pct],
  ['reply', 'Reply rate', x => share(x.replied, x.started), pct],
  ['positive', 'Positive reply rate', x => share(x.positive, x.started), pct],
  ['meetings', 'Meetings booked', x => x.meetings, thousands],
  ['floor', 'Floor share', x => share(x.floor, x.started), pct],
];
const DEFAULT_METRIC = 'reply';

// The Needs-a-person queue as { title, detail, paused } items, then the inboxes resting.
function needsAPerson(sim) {
  const paused = sim.cells.filter(x => x.paused);
  const running = sim.cells.length - paused.length;
  const items = [
    ...paused.map(x => {
      const why = share(x.bounced, x.sent) > GUARDRAIL.bounce
        ? `Bounce ${pct(share(x.bounced, x.sent))} on ${thousands(x.sent)} sent (limit ${limit(GUARDRAIL.bounce)})`
        : `Unsubscribe ${pct(share(x.unsubscribed, x.sent))} on ${thousands(x.sent)} sent (limit ${limit(GUARDRAIL.unsubscribe)})`;
      return { paused: true, title: `Paused: ${x.campaign} × ${x.angle}`, detail: `${why}. ${thousands(x.contacts - x.started)} contacts wait. Check the list and copy, then restart or stop.` };
    }),
    { paused: false, title: 'Spot-check the next send wave', detail: `${SPOT_CHECK_PER_CELL * running} rendered emails, ${SPOT_CHECK_PER_CELL} per running cell. The wave holds until approved.` },
    { paused: false, title: `${sim.handoff_waiting} positive replies to hand off`, detail: 'Each goes to the company’s rep, who books the meeting.' },
  ];
  return { items, resting: sim.inboxes.filter(x => x.resting).length };
}

function queue(sim) {
  const { items, resting } = needsAPerson(sim);
  const li = items.map(x => `<li class="q${x.paused ? ' paused' : ''}"><b>${x.title}</b>${x.detail}</li>`);
  return `<section class="card queue" aria-labelledby="queue-h">
  <h2 id="queue-h">Needs a person</h2>
  <ul>${li.join('\n  ')}</ul>
  <p class="note">inboxes resting: ${resting} of ${INBOXES}, back on their own after 7 days. Everything else is running on its own.</p>
</section>`;
}

// The headline totals as [label, value] tiles.
function kpiTiles(sim) {
  const t = total(sim.cells);
  return [
    ['Sent', thousands(t.sent)],
    ['Reply rate', pct(share(t.replied, t.started))],
    ['Positive reply rate', pct(share(t.positive, t.started))],
    ['Meetings', thousands(t.meetings)],
  ];
}

function kpis(sim) {
  return `<section class="kpis" aria-label="Totals">${kpiTiles(sim).map(([l, v]) => `<div class="card kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</section>`;
}

function gridTable(sim, [key, label, f, fmt]) {
  const values = sim.cells.map(f);
  const max = Math.max(...values) || 1;
  const shade = v => `color-mix(in srgb, var(--series-2) ${Math.round(4 + 30 * (v / max))}%, var(--surface))`;
  const rows = CAMPAIGNS.map(campaign => {
    const xs = ANGLES.map(angle => sim.cells.find(x => x.campaign === campaign && x.angle === angle));
    const cells = xs.map(x => x.paused
      ? `<td><div class="cell paused">${fmt(f(x))}<small>${thousands(x.sent)} sent · paused</small></div></td>`
      : `<td><div class="cell" style="background:${shade(f(x))}">${fmt(f(x))}<small>${thousands(x.sent)} sent</small></div></td>`);
    return `<tr><th scope="row">${campaign}</th>${cells.join('')}<td class="n rollup">${fmt(f(total(xs)))}</td></tr>`;
  });
  return `<table data-metric="${key}"${key === DEFAULT_METRIC ? '' : ' hidden'}>
    <caption class="sr">${label} by campaign × angle</caption>
    <tr><th></th>${ANGLES.map(a => `<th scope="col">${a}</th>`).join('')}<th scope="col" class="n">Campaign</th></tr>
    ${rows.join('\n    ')}
  </table>`;
}

function grid(sim) {
  const options = METRICS.map(([key, label]) => `<option value="${key}"${key === DEFAULT_METRIC ? ' selected' : ''}>${label}</option>`);
  return `<section class="card" aria-labelledby="grid-h">
  <div class="head"><h2 id="grid-h">Campaign × angle</h2>
  <label>Metric <select id="metric">${options.join('')}</select></label></div>
  <div class="scroll">${METRICS.map(m => gridTable(sim, m)).join('\n')}</div>
  <p class="note">${sim.cells.length} cells. A red cell is paused by the guardrail and waits for a person. The last column rolls up each campaign.</p>
</section>`;
}

function leadSignals(sim) {
  const rows = CAMPAIGNS.map(campaign => {
    const tally = sim.lead_signal_by_campaign[campaign];
    const cells = LEAD_SIGNALS.map(s => tally[s].started
      ? `<td class="n">${pct(share(tally[s].replied, tally[s].started))}<small>${thousands(tally[s].started)}</small></td>`
      : '<td class="n none">–</td>');
    return `<tr><th scope="row">${campaign}</th>${cells.join('')}</tr>`;
  });
  return `<section class="card" aria-labelledby="signal-h">
  <h2 id="signal-h">Reply rate by campaign × lead signal</h2>
  <div class="scroll"><table>
    <tr><th></th>${LEAD_SIGNALS.map(s => `<th scope="col" class="n">${s}</th>`).join('')}</tr>
    ${rows.join('\n    ')}
  </table></div>
  <p class="note">Small figures are contacts whose sequence started. Trigger campaigns lead on a trigger; Evergreen leads on a company fact or the floor.</p>
</section>`;
}

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text-body); font: 14px/1.45 var(--font-ui); padding: var(--space-6) var(--space-4) var(--space-12); }
.wrap { max-width: 1100px; margin: 0 auto; }
header { margin-bottom: var(--space-6); }
h1 { font: var(--weight-display) 30px/1.15 var(--font-display); letter-spacing: var(--tracking-display); color: var(--text-strong); margin: 0 0 var(--space-1); }
h2 { font-size: 15px; font-weight: 600; color: var(--text-strong); margin: 0 0 var(--space-3); }
.sub, .note, .credit { color: var(--text-secondary); }
.sub { margin: 0; } .credit { margin: var(--space-1) 0 0; font-size: 12px; }
.note { font-size: 12px; margin: var(--space-3) 0 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-card); padding: var(--space-4); margin-bottom: var(--space-4); min-width: 0; }
.queue { border-left: 3px solid var(--accent); }
.queue ul { list-style: none; margin: 0; padding: 0; }
.q { border-left: 3px solid var(--warning); background: var(--surface-muted); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); margin-bottom: var(--space-2); }
.q.paused { border-color: var(--danger); }
.q b { display: block; color: var(--text-strong); }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-4); margin-bottom: var(--space-4); }
.kpis .card { margin: 0; }
.kpi .l { color: var(--text-secondary); font-size: 12px; } .kpi .v { font-size: 26px; font-weight: 500; color: var(--text-strong); font-variant-numeric: tabular-nums; }
.head { display: flex; flex-wrap: wrap; gap: var(--space-2); justify-content: space-between; align-items: baseline; }
select { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: var(--space-1) var(--space-2); margin-left: var(--space-1); }
.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 6px var(--space-2); border-bottom: 1px solid var(--gridline); vertical-align: top; }
th { color: var(--text-strong); font-weight: 500; font-size: 12px; white-space: nowrap; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
td small { display: block; color: var(--text-muted); font-size: 11px; }
td.none { color: var(--text-muted); }
.cell { text-align: center; border-radius: var(--radius-sm); padding: 10px var(--space-1); color: var(--text-strong); font-variant-numeric: tabular-nums; min-width: 84px; }
.cell small { display: block; color: var(--text-secondary); font-size: 11px; }
.cell.paused { background: color-mix(in srgb, var(--danger) 16%, var(--surface)); box-shadow: inset 0 0 0 1px var(--danger); }
.rollup { font-weight: 600; color: var(--text-strong); vertical-align: middle; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
footer { color: var(--text-secondary); font-size: 12px; margin-top: var(--space-6); }
a { color: var(--text-strong); }
`;

const PICKER = `
const select = document.getElementById('metric');
select.addEventListener('change', () => {
  for (const t of document.querySelectorAll('[data-metric]')) t.hidden = t.dataset.metric !== select.value;
});`;

export function dashboard(sim, { asOf, hubUrl }) {
  const contacts = sum(sim.cells, 'contacts');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Outbound monitor</title>
<!-- Generated by npm run render from src/dashboard.js; edit that, not this file. -->
<style>
${TOKENS}
${STYLE}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Outbound monitor</h1>
  <p class="sub">simulated: ${INBOXES} inboxes × ${SENDS_PER_INBOX_PER_DAY}/day, fully ramped · ${thousands(contacts)} contacts in the pipeline’s campaign × angle mix · seed ${sim.seed}</p>
  <p class="credit">Case study by Bryan Soo · ${day(asOf)}</p>
</header>
<main>
${queue(sim)}
${kpis(sim)}
${grid(sim)}
${leadSignals(sim)}
</main>
<footer>
  <p>Every number here is simulated from a fixed seed, so it is the same on every reload. Bounce and unsubscribe rates are per email sent; reply rates and floor share are per contact whose sequence started, counting a reply to any step.</p>
  <p><a href="${hubUrl}">Back to the repo and the deck</a></p>
</footer>
</div>
<script>${PICKER}
</script>
</body>
</html>
`;
}
