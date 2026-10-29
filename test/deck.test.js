import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContacts } from '../src/contacts.js';
import { parseLibrary } from '../src/library.js';
import { pipeline } from '../src/pipeline.js';
import { deck, DISCLOSURE } from '../src/deck.js';

const AS_OF = '2026-10-27';
const rows = parseContacts(readFileSync(new URL('../athena_exercise_contacts.csv', import.meta.url), 'utf8'));
const library = parseLibrary(readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8'));
const results = pipeline(rows, library, { asOf: AS_OF });

const LINKS = {
  video: 'https://example.com/video',
  dashboard: 'https://example.com/dashboard',
  slides: 'https://example.com/slides',
  pdf: 'https://example.com/deck.pdf',
  repo: 'https://example.com/repo',
};
const d = deck(results, rows, library, { asOf: AS_OF, links: LINKS, tests: { total: 97 } });

// Every string on a slide, flattened, so a test can look for a number or a phrase wherever the slide puts it.
const textOf = slide => JSON.stringify(slide);

test('the main deck is 9 slides in the video order, then the appendix and the Brief checklist', () => {
  assert.deepEqual(d.slides.map(s => s.id), ['answer', 'funnel', 'routing', 'signals', 'templates', 'cards', 'dashboard', 'trust', 'next']);
  assert.deepEqual(d.appendix.map(s => s.id), ['copy', 'sequence', 'built', 'assumptions', 'checklist']);
});

test('the first slide is the hub: it links the video, the dashboard, the Google Slides deck, the PDF and the repo', () => {
  const urls = d.slides[0].links.map(l => l.url);
  assert.deepEqual(urls, [LINKS.video, LINKS.dashboard, LINKS.slides, LINKS.pdf, LINKS.repo]);
});

test('the credit names Bryan Soo and the as_of date, and every slide is numbered 1–9 then A1–A5', () => {
  assert.equal(d.credit, 'Case study by Bryan Soo · 27 Oct 2026');
  assert.deepEqual([...d.slides, ...d.appendix].map(s => s.number), ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A1', 'A2', 'A3', 'A4', 'A5']);
});

const slide = id => [...d.slides, ...d.appendix].find(s => s.id === id);

test('the answer slide gives the headline numbers from the run: 416 emailed, 584 suppressed, 4 campaigns, 0 held', () => {
  assert.deepEqual(slide('answer').stats, [
    { value: '416', label: 'Contacts emailed, each with a 3-step sequence' },
    { value: '584', label: 'Suppressed, each with its reason' },
    { value: '4', label: 'Campaigns, chosen by the company’s trigger' },
    { value: '0', label: 'held by a render check' },
  ]);
});

test('the funnel slide shows each Suppression step and who is left: 57, 490, 19 and 18, then 416 emailed', () => {
  assert.deepEqual(slide('funnel').table.rows, [
    ['The contact list', '', '1,000'],
    ['No email address', '57', '943'],
    ['Department outside the buyer set', '490', '453'],
    ['Company restructuring: 90-day hold', '19', '434'],
    ['IC with an emailable Director+ in the same department', '18', '416 emailed'],
  ]);
});

test('the trust slide has both columns, and its numbers come from the run: the test count, 10 pinned, 6 render checks on 1,248 emails, 0 held', () => {
  const [decide, checks] = slide('trust').columns;
  assert.equal(decide.heading, 'Where I decide');
  assert.equal(checks.heading, 'What the machine checks');
  assert.equal(decide.items.length, 5);
  const machine = checks.items.join('\n');
  assert.match(machine, /97 tests, 10 of them pinned on the showcase contacts/);
  assert.match(machine, /6 render checks on every one of the 1,248 emails \(416 sequences × 3 steps\); 0 contacts held today/);
  assert.match(machine, /CI fails/);
  assert.match(machine, /allowlist/);
});

test('the one disclosure line sits on the trust slide and nowhere else in the deck', () => {
  assert.equal(DISCLOSURE, 'Claude wrote the code under my direction. I made every decision, approved every sendable sentence, and verified it with the checks on slide 8.');
  assert.equal(slide('trust').footnote, DISCLOSURE);
  assert.equal(textOf(d).split('Claude wrote the code').length - 1, 1);
  assert.equal(d.slides.indexOf(slide('trust')), 7, 'slide 8, as the line says');
});

test('the trust slide says render check, never guardrail or validation, for the checks on each email', () => {
  assert.doesNotMatch(textOf(slide('trust')), /guardrail|validation/i);
});

test('the routing slide shows the five decisions in order, and the campaigns table counts 78, 70, 61 and 207 in campaign order', () => {
  const s = slide('routing');
  assert.deepEqual(s.flow.map(step => step.name), ['Suppress', 'Campaign', 'Angle', 'Band', 'Lead Signal']);
  assert.deepEqual(s.table.rows.map(([campaign, , contacts, wave]) => [campaign, contacts, wave]), [
    ['Scaling Fast', '78', '1st'],
    ['AI Moment', '70', '2nd'],
    ['Operating Reset', '61', '3rd'],
    ['Evergreen', '207', '4th, deprioritised'],
  ]);
});

test('the templates slide builds an email in four steps beside the trigger skeleton: routing, skeleton, snippets, render', () => {
  const s = slide('templates');
  assert.ok(s.skeleton.includes('Hi {first_name},\n\n{trigger} {bridge}\n\n{mechanism} {support} {proof}\n\n{cta}\n\n{rep_name}'));
  assert.ok(s.skeleton.endsWith('{rep_name}'), 'the skeleton stops at the rep');
  assert.match(s.lead, /Nothing is written at send time/);
  assert.deepEqual(s.steps.map(step => step.name), ['Routing', 'Skeleton', 'Snippets', 'Render']);
  const [routing, skeleton, snippets, render] = s.steps.map(step => step.detail);
  assert.match(routing, /campaign, angle, band and lead signal/);
  assert.match(skeleton, /one of five skeletons/);
  assert.match(snippets, /trigger\.funding as the opener and the IT service mechanism line for practitioners/);
  assert.match(render, /contacts at the same company take turns/);
  assert.match(render, /a failure holds the contact/);
  assert.equal(s.example, undefined, 'no filled-in email: the cards slide shows those');
});

test('the cards slide features Marcus, Wesley and Jamal, showcase cards 3, 7 and 9, as they render', () => {
  const cards = slide('cards').cards;
  assert.deepEqual(cards.map(c => [c.number, c.contact_id, c.name]), [
    [3, 'C1068', 'Marcus Oyelaran'],
    [7, 'C1451', 'Wesley Sullivan'],
    [9, 'C1752', 'Jamal Halloran'],
  ]);
  const [marcus, wesley, jamal] = cards;
  assert.doesNotMatch(marcus.body, /efficien|mandate/i);
  assert.equal(wesley.route, 'Evergreen · IT Service · Practitioner · Floor, no usable signal');
  assert.equal(jamal.subject, undefined);
  assert.equal(jamal.route, 'Suppressed: restructuring hold');
  assert.match(jamal.body, /Caldera Software announced a restructuring on 2026-06-15/);
  assert.match(jamal.body, /recheck date of 2026-09-13/);
});

test('the dashboard slide splits the steps by who does them, with no simulated numbers, and links the dashboard', () => {
  const s = slide('dashboard');
  assert.deepEqual(s.columns.map(c => [c.heading, c.steps.map(x => x.name)]), [
    ['Runs on its own', ['Suppress', 'Route', 'Render', 'Send', 'Guardrail', 'Inbox rest', 'Reply sort']],
    ['Needs a person', ['Lift a hold', 'Fix a held contact', 'Spot-check', 'Un-pause', 'Handoff']],
  ]);
  assert.doesNotMatch(textOf(s), /Simulated|70,877|resting:/);
  assert.equal(s.link.url, LINKS.dashboard);
});

test('what’s next names the stack line: Clay → this logic → Smartlead/Instantly', () => {
  assert.match(textOf(slide('next')), /Clay → this logic → Smartlead\/Instantly/);
});

test('how I built it counts the list and the library: 100 companies, 943 with an email, 75 snippets', () => {
  const t = textOf(slide('built'));
  assert.match(t, /100 companies × 10 contacts, 943 with an email/);
  assert.match(t, /75 snippets/);
  assert.doesNotMatch(t, /Claude/, 'Claude is named once, on the trust slide');
});

test('the signals slide puts each signal on its fallback ladder rung and counts it as Lead and Supporting across the 416', () => {
  const s = slide('signals');
  assert.deepEqual(s.table.rows.map(([rung, signal, , lead, supporting]) => [rung, signal, lead, supporting]), [
    ['1', 'Trigger', '208', '–'],
    ['2', 'System of record', '114', '114'],
    ['2', 'AI maturity', '12', '33'],
    ['3', 'Headcount trajectory', '28', '72'],
    ['4', 'Floor', '54', '–'],
  ]);
  assert.match(textOf(s), /there is never a third/);
  assert.deepEqual(s.rejected.map(([field]) => field), ['months_in_role', 'recent_news_headline', 'Funding amount, lead investor', 'crm, marketing_automation, open_roles_revops', 'glassdoor_rating']);
});

test('the copy slide shows the five skeletons as src/skeleton.js builds them, and the snippet groups that fill them', () => {
  const s = slide('copy');
  assert.deepEqual(s.table.rows.map(([skeleton, , body]) => [skeleton, body]), [
    ['Trigger', '{trigger} {bridge} → {mechanism} {support} {proof} → {cta}'],
    ['Lead line', '{lead} {bridge} → {mechanism} {support} {proof} → {cta}'],
    ['Floor', '{floor} → {mechanism} → {cta}'],
    ['Step 2: follow-up', '{example} → {followup_cta}'],
    ['Step 3: closing note', '{closing}'],
  ]);
  assert.deepEqual(s.groups.map(g => g.name), ['Subject', 'Trigger line', 'Bridge', 'Lead line and supporting line', 'Mechanism line', 'Proof line', 'The rest']);
  assert.match(textOf(s), /up to 80%/);
  assert.match(s.note, /never a third/);
});

test('the sequence slide shows Elena’s steps 2 and 3 as they render, on days 0, 3 and 8, and 3,000 sends a day as 1,000 new contacts', () => {
  const s = slide('sequence');
  assert.deepEqual(s.table.rows, [['1', 'Day 0', 'First touch', '90'], ['2', 'Day 3', 'Example line and a smaller ask', '50'], ['3', 'Day 8', 'Closing note', '30']]);
  assert.deepEqual(s.followUps.map(f => f.subject), ['Re: employee requests at Halcyon Stack', 'Re: employee requests at Halcyon Stack']);
  assert.ok(s.followUps[0].body.includes('Athena checks SuccessFactors'));
  assert.ok(s.followUps[1].body.startsWith('Hi Elena,\n\nLast note from me.'));
  assert.match(textOf(s), /100 inboxes × 30 a day is 3,000 sends a day, so about 1,000 new contacts start each day/);
  assert.match(textOf(s), /219 of the 416 go last in their company/);
  assert.match(textOf(s), /Send wave 1: 266 · Send wave 2: 134 · Send wave 3: 16/);
});

test('the assumptions slide names the data traps and the stack line', () => {
  const t = textOf(slide('assumptions'));
  for (const trap of [/orchestration stack/, /news headlines/, /114 names/, /tech_stack_raw/]) assert.match(t, trap);
  assert.match(t, /Clay → this logic → Smartlead\/Instantly/);
});

test('the Brief checklist maps brief items 1–4, the bonus and the video to slides and repo files', () => {
  assert.deepEqual(slide('checklist').table.rows.map(([item, slides, files]) => [item, slides, files]), [
    ['1. Personalisation signals', '4', 'src/routing.js'],
    ['2. Routing logic', '2, 3', 'src/routing.js, output/rendered_contacts.csv'],
    ['3. Templates with variables', '5, A1', 'templates.md, snippets.yaml'],
    ['4. 10 rendered examples', '6', 'showcase.md'],
    ['Bonus: monitoring tool', '7', 'docs/index.html'],
    ['Video', '1', 'the link on slide 1'],
  ]);
});
