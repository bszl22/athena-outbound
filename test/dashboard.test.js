import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContacts } from '../src/contacts.js';
import { parseLibrary } from '../src/library.js';
import { pipeline } from '../src/pipeline.js';
import { simulate } from '../src/simulate.js';
import { dashboard } from '../src/dashboard.js';

const AS_OF = '2026-10-27';
const rows = parseContacts(readFileSync(new URL('../athena_exercise_contacts.csv', import.meta.url), 'utf8'));
const library = parseLibrary(readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8'));
const results = pipeline(rows, library, { asOf: AS_OF });
const sim = simulate(results, { seed: 7 });

const cell = (campaign, angle) => sim.cells.find(x => x.campaign === campaign && x.angle === angle);

// The pipeline's emailed contacts per cell (416 in all), from output/counts.json's run.
const EMAILED = {
  'Scaling Fast': { 'Employee Requests': 9, 'IT Service': 22, 'Scale Without Headcount': 27, 'Governed AI': 20 },
  'AI Moment': { 'Employee Requests': 16, 'IT Service': 12, 'Scale Without Headcount': 27, 'Governed AI': 15 },
  'Operating Reset': { 'Employee Requests': 15, 'IT Service': 7, 'Scale Without Headcount': 30, 'Governed AI': 9 },
  Evergreen: { 'Employee Requests': 39, 'IT Service': 40, 'Scale Without Headcount': 90, 'Governed AI': 38 },
};

test('the simulation scales the pipeline to about 25k contacts, keeping each cell’s share of the 416 emailed', () => {
  assert.equal(sim.cells.length, 16);
  const total = sim.cells.reduce((s, x) => s + x.contacts, 0);
  assert.ok(Math.abs(total - 25000) <= 50, `total ${total}`);
  for (const [campaign, angles] of Object.entries(EMAILED)) {
    for (const [angle, n] of Object.entries(angles)) {
      assert.ok(Math.abs(cell(campaign, angle).contacts / total - n / 416) < 0.0005, `${campaign} × ${angle}`);
    }
  }
});

test('the same seed gives the same numbers, and another seed gives different ones', () => {
  assert.deepEqual(simulate(results, { seed: 7 }), sim);
  assert.notDeepEqual(simulate(results, { seed: 8 }).cells, sim.cells);
  assert.ok(sim.cells.every(x => x.sent > 0));
});

const overLimit = x => x.bounced / x.sent > 0.03 || x.unsubscribed / x.sent > 0.02;

test('the guardrail pauses at least one cell, at bounce above 3% or unsubscribe above 2% once it has 100+ sends', () => {
  const paused = sim.cells.filter(x => x.paused);
  assert.ok(paused.length >= 1);
  for (const x of paused) {
    assert.ok(x.sent >= 100 && overLimit(x), `${x.campaign} × ${x.angle}`);
    assert.ok(x.started < x.contacts, `${x.campaign} × ${x.angle} stops sending once paused`);
  }
  for (const x of sim.cells.filter(x => !x.paused)) {
    assert.equal(x.started, x.contacts);
    assert.ok(!overLimit(x), `${x.campaign} × ${x.angle} is over a limit but running`);
  }
});

const replyRate = xs => xs.reduce((s, x) => s + x.replied, 0) / xs.reduce((s, x) => s + x.started, 0);
const inCampaign = c => sim.cells.filter(x => x.campaign === c);

test('every trigger campaign replies above Evergreen', () => {
  for (const c of ['Scaling Fast', 'AI Moment', 'Operating Reset']) {
    assert.ok(replyRate(inCampaign(c)) > replyRate(inCampaign('Evergreen')), c);
  }
});

test('signal-led emails reply above the floor, reading along an angle', () => {
  // Employee Requests is left out: one emailed floor contact is too few to read.
  const SIGNALS_ON = {
    'IT Service': ['Trigger', 'System of record', 'Headcount trajectory'],
    'Scale Without Headcount': ['Trigger', 'System of record', 'Headcount trajectory'],
    'Governed AI': ['Trigger', 'AI maturity', 'Headcount trajectory'],
  };
  for (const [angle, signals] of Object.entries(SIGNALS_ON)) {
    const tally = sim.lead_signal_by_angle[angle];
    const floor = tally.Floor.replied / tally.Floor.started;
    for (const s of signals) assert.ok(tally[s].replied / tally[s].started > floor, `${angle} × ${s}`);
  }
});

// Seed 7's contacts whose sequence started, by lead signal, from the campaign × lead signal table this one replaced.
// Regrouping the rows moves no contact, so each column keeps its total.
const STARTED_BY_LEAD_SIGNAL = { Trigger: 11998, 'System of record': 6851, 'AI maturity': 721, 'Headcount trajectory': 1683, 'Floor': 3245 };
const STARTED = 24498;

test('the lead signals roll up by angle, and every started contact is counted once', () => {
  const byAngle = sim.lead_signal_by_angle;
  assert.deepEqual(Object.keys(byAngle), ['Employee Requests', 'IT Service', 'Scale Without Headcount', 'Governed AI']);
  for (const [signal, started] of Object.entries(STARTED_BY_LEAD_SIGNAL)) {
    assert.equal(Object.values(byAngle).reduce((s, tally) => s + tally[signal].started, 0), started, signal);
  }
  assert.equal(sim.cells.reduce((s, x) => s + x.started, 0), STARTED);
  assert.equal(sim.lead_signal_by_campaign, undefined);
});

test('routing keeps system of record off Governed AI and AI maturity on it alone', () => {
  const byAngle = sim.lead_signal_by_angle;
  assert.equal(byAngle['Governed AI']['System of record'].started, 0);
  assert.equal(byAngle['Governed AI']['AI maturity'].started, 721);
  for (const angle of ['Employee Requests', 'IT Service', 'Scale Without Headcount']) assert.equal(byAngle[angle]['AI maturity'].started, 0, angle);
});

test('the Reply rate counts a reply to any step of the sequence', () => {
  for (const x of sim.cells) assert.equal(x.replied_by_step.reduce((s, n) => s + n, 0), x.replied);
  for (const step of [0, 1, 2]) assert.ok(sim.cells.reduce((s, x) => s + x.replied_by_step[step], 0) > 0, `step ${step + 1}`);
});

test('100 inboxes: an inbox rests at bounce above 3% over its last 50 sends or spam complaints above 0.3%', () => {
  assert.equal(sim.inboxes.length, 100);
  for (const inbox of sim.inboxes) {
    const over = inbox.last_50_bounced / 50 > 0.03 || inbox.complaints / inbox.sent > 0.003;
    assert.equal(inbox.resting, over);
  }
  assert.equal(sim.inboxes.filter(x => x.resting).length, 2, 'seed 7 rests 2 inboxes');
});

test('the positive replies waiting for handoff are about one day’s worth at 3,000 sends a day', () => {
  // Seed 7: 652 positive replies over 70,877 sends, so 3,000 sends bring about 28.
  assert.equal(sim.cells.reduce((s, x) => s + x.positive, 0), 652);
  assert.equal(sim.cells.reduce((s, x) => s + x.sent, 0), 70877);
  assert.equal(sim.handoff_waiting, 28);
});

const HUB = 'https://example.com/repo';
const page = dashboard(sim, { asOf: AS_OF, hubUrl: HUB });
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the dashboard header says it is simulated and credits the case study, and the footer links back to the hub', () => {
  assert.match(page, /simulated: 100 inboxes × 30\/day, fully ramped/);
  assert.match(text(page), /Case study by Bryan Soo · 27 Oct 2026/);
  assert.ok(page.includes(`<footer`) && page.includes(`href="${HUB}"`));
  assert.doesNotMatch(page, /<img|logo/i);
});

test('the dashboard opens on the Needs-a-person queue, with the paused cell, a spot-check and the handoff waiting', () => {
  const body = page.slice(page.indexOf('<main'));
  assert.ok(body.indexOf('Needs a person') < body.indexOf('Reply rate'), 'the queue comes before the KPIs');
  const queue = text(body.slice(0, body.indexOf('</section>')));
  // Seed 7 pauses one cell, on its aged list.
  assert.match(queue, /Paused: Scaling Fast × Employee Requests Bounce 7\.0% on 100 sent \(limit 3%\)/);
  assert.match(queue, /Spot-check the next send wave 75 rendered emails, 5 per running cell/);
  assert.match(queue, /28 positive replies to hand off/);
  assert.match(queue, /inboxes resting: 2 of 100/);
  assert.match(queue, /Everything else is running on its own/);
});

test('the dashboard ends on angle × lead signal, with no who-does-what section, which lives on the deck', () => {
  const main = page.slice(page.indexOf('<main'), page.indexOf('</main>'));
  const sections = [...main.matchAll(/<section[^>]*>/g)];
  assert.match(sections.at(-1)[0], /signal-h/);
  assert.doesNotMatch(page, /Who does what|class="steps"|class="tag/);
});

const signalSection = page.slice(page.indexOf('<section class="card" aria-labelledby="signal-h"'), page.indexOf('</main>'));
const signalRows = [...signalSection.matchAll(/<tr><th scope="row">([^<]+)<\/th>(.*)<\/tr>/g)].map(([, angle, cells]) => ({
  angle,
  cells: [...cells.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => text(m[1]).trim()),
}));
const startedIn = shown => (shown === '–' ? 0 : Number(shown.split(' ')[1].replace(',', '')));

test('the second table is reply rate by angle × lead signal: four angles down, five lead signals across', () => {
  assert.match(signalSection, /<h2 id="signal-h">Reply rate by angle × lead signal<\/h2>/);
  assert.deepEqual(signalRows.map(r => r.angle), ['Employee Requests', 'IT Service', 'Scale Without Headcount', 'Governed AI']);
  assert.deepEqual([...signalSection.matchAll(/<th scope="col" class="n">([^<]+)<\/th>/g)].map(m => m[1]), ['Trigger', 'System of record', 'AI maturity', 'Headcount trajectory', 'Floor']);
  for (const { angle, cells } of signalRows) assert.equal(cells.length, 5, angle);
  assert.doesNotMatch(page, /campaign × lead signal/);
});

test('a cell shows the reply rate over contacts started, and a dash where no contact started', () => {
  const row = angle => signalRows.find(r => r.angle === angle).cells;
  // All 721 AI maturity contacts are Evergreen × Governed AI, shown as 5.1% on the table this one replaced.
  assert.equal(row('Governed AI')[2], '5.1% 721');
  assert.equal(row('Governed AI')[1], '–', 'Governed AI has no system of record contacts');
  for (const angle of ['Employee Requests', 'IT Service', 'Scale Without Headcount']) assert.equal(row(angle)[2], '–', angle);
  assert.equal(signalRows.flatMap(r => r.cells).filter(c => c === '–').length, 4);
});

test('the started totals across the table match the started total across all cells', () => {
  Object.values(STARTED_BY_LEAD_SIGNAL).forEach((started, i) => {
    assert.equal(signalRows.reduce((s, r) => s + startedIn(r.cells[i]), 0), started);
  });
  assert.equal(signalRows.flatMap(r => r.cells).reduce((s, c) => s + startedIn(c), 0), STARTED);
});

test('the note under the table says to read along a row, and that a gap is a link, not a cause', () => {
  assert.match(signalSection, /<p class="note">Small figures are contacts whose sequence started\. Read along a row: the pitch stays the same and only the lead signal changes\. A gap shows a link with replies, not that the signal caused them\.<\/p>/);
});

test('the campaign × angle grid shows 16 cells, and the metric picker switches between all seven metrics', () => {
  const options = [...page.matchAll(/<option value="(\w+)"[^>]*>([^<]+)<\/option>/g)].map(m => m[2]);
  assert.deepEqual(options, ['Sent', 'Bounce rate', 'Unsubscribe rate', 'Reply rate', 'Positive reply rate', 'Meetings booked', 'Floor share']);
  const tables = [...page.matchAll(/<table data-metric="(\w+)"([^>]*)>([\s\S]*?)<\/table>/g)];
  assert.equal(tables.length, 7);
  assert.equal(tables.filter(t => !t[2].includes('hidden')).length, 1, 'one metric shows at a time');
  for (const [, , , body] of tables) {
    assert.equal((body.match(/class="cell/g) ?? []).length, 16);
    assert.equal((body.match(/class="n rollup"/g) ?? []).length, 4, 'a roll-up per campaign');
    assert.ok(body.includes('paused'), 'the paused cell shows on every metric');
  }
});
