// Outputs: the deck's content, slide by slide: titles, numbers, links and the four featured emails.
// The .pptx writer (src/deck-pptx.js) only lays this out, so the tests pin the deck here.
// The main deck follows the video and answers every brief item; the appendix reads on its own.

import { funnelRows, WHY_NOT } from './showcase.js';
import { counts } from './counts.js';
import { PINNED } from './pinned.js';
import { SPOT_CHECK_PER_CELL } from './dashboard.js';
import { RESTRUCTURING_HOLD_DAYS, midSentence } from './routing.js';
import { INBOXES, SENDS_PER_INBOX_PER_DAY, GUARDRAIL, INBOX_REST } from './simulate.js';
import { triggerSkeleton, skeletonBodies } from './templates.js';
import { WORD_CAP } from './render.js';

// The one disclosure line. It lives on the trust slide, and the README repeats it word for word.
export const DISCLOSURE =
  'Claude wrote the code under my direction. I made every decision, approved every sendable sentence, and verified it with the checks on slide 8.';

const thousands = n => n.toLocaleString('en-US');
const limit = n => `${+(n * 100).toFixed(1)}%`;
const day = iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function answer({ tally, links }) {
  return {
    id: 'answer',
    title: 'Who Athena should email, what each email says, and why',
    lead: `Every one of the ${thousands(tally.contacts)} contacts gets a decision. Each email is assembled from approved snippets around the signals its contact actually has, ` +
      'and the same CSV always gives the same emails.',
    stats: [
      { value: thousands(tally.emailed), label: 'Contacts emailed, each with a 3-step sequence' },
      { value: thousands(tally.contacts - tally.emailed), label: 'Suppressed, each with its reason' },
      { value: String(Object.keys(tally.campaign).length), label: 'Campaigns, chosen by the company’s trigger' },
      { value: thousands(tally.held), label: 'held by a render check' },
    ],
    links: [
      { label: 'Video', url: links.video },
      { label: 'Dashboard', url: links.dashboard },
      { label: 'Deck in Google Slides', url: links.slides },
      { label: 'Deck as a PDF', url: links.pdf },
      { label: 'Repo', url: links.repo },
    ],
  };
}

function funnel({ results }) {
  return {
    id: 'funnel',
    title: `Who I don’t email comes first: ${thousands(results.filter(r => r.outcome === 'Suppressed').length)} of ${thousands(results.length)}`,
    note: 'Suppressed always wins. Every suppressed contact keeps its reason in the rendered CSV, so nobody is dropped silently.',
    table: { head: ['Step', 'Suppressed', 'Contacts left'], rows: funnelRows(results) },
  };
}

function built({ rows, library }) {
  const companies = new Set(rows.map(r => r.company)).size;
  return {
    id: 'built',
    title: 'How I built it',
    items: [
      `I profiled the CSV first: ${companies} companies × ${rows.length / companies} contacts, ${thousands(rows.filter(r => r.email).length)} with an email, and the data traps hiding in it.`,
      'I settled each design question as its own ticket: who we don’t email, which signals, the campaigns, the fallback ladder, the copy voice, the sequence, sending volume.',
      'I prototyped the copy and the dashboard to test the ideas, then threw the prototypes away.',
      `I froze the copy as ${Object.keys(library.snippets).length} snippets in one library, so every email is assembled, not written.`,
      'Then I built one deterministic pipeline: the CSV, the snippet library and a pinned as_of date go in, and the same 1,000 routes and emails come out every time.',
    ],
  };
}

function trust({ results, library, tally, tests }) {
  const emailed = results.filter(r => r.outcome !== 'Suppressed');
  const checks = new Set(emailed.flatMap(r => r.checks.map(c => c.check))).size;
  return {
    id: 'trust',
    title: 'Why you can trust code Claude wrote',
    columns: [
      {
        heading: 'Where I decide',
        items: [
          'Every design decision was a ticket I settled before any code was written.',
          `Every sendable sentence is one of ${Object.keys(library.snippets).length} snippets I approved and froze, two variants each. No LLM writes anything at send time.`,
          'Nothing is pushed or closed until I say so.',
          'Each ticket ends with a two-axis code review: our coding standards, and the spec.',
          'Retros turn each mistake into a check, so it can’t happen twice.',
        ],
      },
      {
        heading: 'What the machine checks',
        items: [
          `${tests.total} tests, ${PINNED.length} of them pinned on the showcase contacts.`,
          `${checks} render checks on every one of the ${thousands(emailed.length * 3)} emails (${thousands(emailed.length)} sequences × 3 steps); ${thousands(tally.held)} contacts held today. A held contact is reported, never sent.`,
          'CI fails if a committed output is stale against the code.',
          'The public repo gets only what an allowlist names, and the export runs a leak check first.',
        ],
      },
    ],
    footnote: DISCLOSURE,
  };
}

const CAMPAIGNS = [
  ['Scaling Fast', 'Headcount is up. People, IT and Finance requests grow with it; the back office shouldn’t have to.', '1st'],
  ['AI Moment', 'They already invest in AI. Governed internal agents are the next build, and they don’t have to build them.', '2nd'],
  ['Operating Reset', 'A new COO or an efficiency push means someone is looking hard at how back-office work gets done.', '3rd'],
  ['Evergreen', 'No live reason to write, so the email leads with the system of record or headcount trajectory.', '4th, deprioritised'],
];

function routing({ tally }) {
  return {
    id: 'routing',
    title: 'Five decisions per contact, first match wins',
    flow: [
      { name: 'Suppress', rule: 'No email, outside the buyer set, restructuring hold, shadowed IC' },
      { name: 'Campaign', rule: 'From the company’s trigger' },
      { name: 'Angle', rule: 'From the department' },
      { name: 'Band', rule: 'From seniority: Exec or Practitioner' },
      { name: 'Lead Signal', rule: 'The first usable rung of the fallback ladder' },
    ],
    table: {
      head: ['Campaign', 'Why now', 'Contacts', 'Campaign order'],
      rows: CAMPAIGNS.map(([campaign, thesis, order]) => [campaign, thesis, thousands(tally.campaign[campaign]), order]),
    },
  };
}

// A step's email up to the rep's name: the title, address and opt-out line are the same on every email.
function signed(result, step) {
  const body = result[`step${step}_body`];
  return body.slice(0, body.indexOf(`\n\n${result.rep}\n`)) + `\n\n${result.rep}`;
}

// Elena, the best case, fills in the skeleton on the templates slide. The cards slide shows judgement, degradation and restraint.
const ELENA = 'C1031';
const FEATURED = ['C1068', 'C1451', 'C1752'];

function card(contactId, { results, rows }) {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  const byId = new Map(results.map(r => [r.contact_id, r]));
  const result = byId.get(contactId);
  const row = rowOf.get(contactId);
  const who = { number: PINNED.findIndex(p => p.contact_id === contactId) + 1, contact_id: contactId, name: row.full_name, title: `${row.title} · ${row.company}` };
  if (result.outcome === 'Suppressed') {
    return { ...who, route: `Suppressed: ${result.suppression_reason}`, body: WHY_NOT[result.suppression_reason](result, row, rowOf, byId) };
  }
  const signals = result.lead_signal === 'Floor'
    ? 'Floor, no usable signal'
    : `Lead ${midSentence(result.lead_signal)}${result.supporting_signal ? `, supporting ${midSentence(result.supporting_signal)}` : ''}`;
  return { ...who, route: [result.campaign, result.angle, result.band, signals].join(' · '), subject: result.subject, body: signed(result, 1) };
}

function cards(ctx) {
  return { id: 'cards', title: 'Three more contacts, three more routes', cards: FEATURED.map(id => card(id, ctx)) };
}

// Who does each step, in pipeline order, for slide 7. The person's five: Lift a hold, Fix a held contact, spot-check, Un-pause and handoff.
const STEPS = [
  ['Suppress', false, 'No email, outside the buyer set, restructuring hold, shadowed ICs.'],
  ['Lift a hold', true, `Re-check a company on restructuring hold once its ${RESTRUCTURING_HOLD_DAYS}-day recheck date passes, then lift the hold or keep it.`],
  ['Route', false, 'Campaign from the trigger, angle from the department, band from seniority, lead signal from the fallback ladder.'],
  ['Render', false, 'Every email from approved snippets only, then the render checks. A failed check holds the contact.'],
  ['Fix a held contact', true, 'Fix the data or the snippet behind a failed render check, or drop the contact. Nothing held is sent.'],
  ['Spot-check', true, `Read ${SPOT_CHECK_PER_CELL} rendered emails per cell before each send wave. The wave holds until approved.`],
  ['Send', false, `Send waves of at most 3 contacts per company, ${INBOXES} inboxes at ${SENDS_PER_INBOX_PER_DAY} a day.`],
  ['Guardrail', false, `Pause a cell at bounce above ${limit(GUARDRAIL.bounce)} or unsubscribe above ${limit(GUARDRAIL.unsubscribe)}, once it has ${GUARDRAIL.minSends}+ sends.`],
  ['Inbox rest', false, `Rest an inbox for 7 days at bounce above ${limit(INBOX_REST.bounce)} over its last ${INBOX_REST.window} sends or complaints above ${limit(INBOX_REST.complaints)}.`],
  ['Un-pause', true, 'Look into a paused cell, then restart or stop it.'],
  ['Reply sort', false, 'Out-of-office, unsubscribes and bounces are handled automatically; any reply stops the sequence.'],
  ['Handoff', true, 'Read every other reply. A positive one goes to the company’s rep, who books the meeting; a referral becomes a new contact; “not now” gets a date to try again.'],
];

// The steps split by who does them. Rules, not the simulation's numbers.
function dashboard({ links }) {
  const steps = person => STEPS.filter(([, p]) => p === person).map(([name, , detail]) => ({ name, detail }));
  return {
    id: 'dashboard',
    title: 'What runs on its own, and the five things that need a person',
    columns: [
      { heading: 'Runs on its own', steps: steps(false) },
      { heading: 'Needs a person', steps: steps(true) },
    ],
    link: { label: 'Open the dashboard', url: links.dashboard },
  };
}

// The production stack this logic sits in. Clay isn't needed here because the CSV is already enriched.
export const STACK_LINE = 'Clay → this logic → Smartlead/Instantly';

function next({ tally }) {
  return {
    id: 'next',
    title: 'What I’d do next',
    items: [
      `Put it in the real stack: ${STACK_LINE}. Clay enriches and verifies each address, this logic routes and renders, and the sender handles inboxes and warm-up.`,
      'Swap the invented rates for real replies after the first send wave, then retire the snippet variant that loses in each pair.',
      `Find a live reason to write for the ${thousands(tally.campaign.Evergreen)} Evergreen contacts, so fewer emails start from the floor.`,
      `Re-check the ${thousands(tally.suppressed['restructuring hold'])} contacts on restructuring hold by hand, company by company.`,
    ],
  };
}

// The signals in fallback ladder order: the rung, the signal, and why it counts.
const RUNGS = [
  ['1', 'Trigger', 'A reason to write now: funding, a new office, an AI build, a new COO. Older than 365 days doesn’t count, and it is never told to the person whose own hire is the trigger.'],
  ['2', 'System of record', 'Where Athena acts: the HRIS, or the ITSM for IT Service. Linear and Zendesk aren’t ITSMs, so they count as blank. Workday gets its own line.'],
  ['2', 'AI maturity', 'Governed AI only, in place of the system of record: named AI tools or 10+ open AI/ML roles. It opens the build-or-buy conversation.'],
  ['3', 'Headcount trajectory', 'Growing 25%+ in 12 months: requests grow with headcount. Blank growth is worked out from the employee counts; flat or shrinking is never used.'],
  ['4', 'Floor', 'No usable signal: a plain opener about the angle and a soft CTA, with no claim about their company.'],
];

const REJECTED = [
  ['months_in_role', 'Only 23 emailable contacts, and “congrats on the new role” is a cliché.'],
  ['recent_news_headline', 'Templated, and wrong for 13 companies.'],
  ['Funding amount, lead investor', 'Already covered by the funding trigger.'],
  ['crm, marketing_automation, open_roles_revops', 'Outside Athena’s domain.'],
  ['glassdoor_rating', 'Unflattering, and creepy to bring up.'],
];

const leadTotal = (tally, signal) => Object.values(tally.lead_signal_by_campaign).reduce((n, bySignal) => n + bySignal[signal], 0);

function signals({ tally }) {
  const supporting = signal => (signal in tally.supporting_signal ? thousands(tally.supporting_signal[signal]) : '–');
  return {
    id: 'signals',
    title: 'Four signals on a fallback ladder: the first usable one leads',
    table: {
      head: ['Rung', 'Signal', 'Why it counts', 'As Lead', 'As Supporting'],
      rows: RUNGS.map(([rung, signal, why]) => [rung, signal, why, thousands(leadTotal(tally, signal)), supporting(signal)]),
    },
    items: [
      `Every one of the ${thousands(tally.emailed)} emails has exactly one lead signal. The next usable rung becomes the supporting line, and there is never a third.`,
      'The lead signal picks the opener; the campaign, angle and band pick the rest of the email (slide A1).',
    ],
    rejected: REJECTED,
  };
}

// How an email is built, step by step, beside the trigger-lead skeleton up to the rep's name.
function templatesSlide(ctx) {
  const skeleton = triggerSkeleton(ctx.library);
  const signedAt = skeleton.indexOf('{rep_name}') + '{rep_name}'.length;
  return {
    id: 'templates',
    title: 'How an email is built: routing, skeleton, snippets',
    lead: 'Nothing is written at send time: every email is assembled from approved snippets.',
    skeleton: skeleton.slice(0, signedAt),
    steps: [
      { name: 'Routing', detail: 'decides each contact’s campaign, angle, band and lead signal (slide 3).' },
      { name: 'Skeleton', detail: 'the step and the lead signal pick one of five skeletons, which sets the sentence order. On the left, the trigger skeleton.' },
      { name: 'Snippets', detail: 'each place takes an approved snippet, picked by the routing results. An IT practitioner at a company that just raised money gets ' +
        'trigger.funding as the opener and the IT service mechanism line for practitioners.' },
      { name: 'Render', detail: 'every snippet is written two ways, and contacts at the same company take turns, so colleagues never get the same email word for word. ' +
        'Render fills the slots, then the render checks run on the finished email: a failure holds the contact rather than sending it.' },
    ],
  };
}

// Appendix

// The five skeletons (bodies from src/skeleton.js, so the slide can't drift from what is sent), and the snippet groups that fill their places.
function copyPlaces() {
  const body = skeletonBodies();
  return [
    ['Trigger', 'First touch: the company has a recent trigger, such as funding or a new office', body.trigger],
    ['Lead line', 'First touch: no trigger, but a usable company fact: system of record, AI maturity or headcount trajectory', body.lead],
    ['Floor', 'First touch: no usable signal at all. No bridge, supporting line or proof line', body.floor],
    ['Step 2: follow-up', 'Day 3, a reply in the same thread', body.followUp],
    ['Step 3: closing note', 'Day 8, a reply in the same thread', body.closing],
  ];
}

const SNIPPET_GROUPS = [
  { name: 'Subject', detail: 'one per angle.' },
  { name: 'Trigger line', detail: 'one per trigger sub-type, such as a funding round, a new US office or a new Chief AI Officer.' },
  { name: 'Bridge', detail: 'links the campaign’s why now to the angle’s pain, one per campaign × angle.' },
  { name: 'Lead line and supporting line', detail: 'a fact about the company from its system of record, AI maturity or headcount trajectory.' },
  { name: 'Mechanism line', detail: 'what Athena does, one per angle × band.' },
  { name: 'Proof line', detail: 'practitioners get the “up to 80%” figure, execs get the investor line.' },
  { name: 'The rest', detail: 'the floor opener, the CTAs, and the step 2 and step 3 lines.' },
];

function copy() {
  return {
    id: 'copy',
    title: 'The five skeletons, and the snippets that fill them',
    table: { head: ['Skeleton', 'Used when', 'Body'], rows: copyPlaces() },
    groups: SNIPPET_GROUPS,
    note: 'All five share the same greeting, signature and “Reply ‘no’” opt-out line. Trigger and lead line differ only in the opening sentence; ' +
      'in both, {support} is filled only when the contact has a second usable signal, so there’s never a third.',
  };
}

// The sequence's business days, per step.
const SEQUENCE = [['1', 'Day 0', 'First touch'], ['2', 'Day 3', 'Example line and a smaller ask'], ['3', 'Day 8', 'Closing note']];

function sequence({ results, tally }) {
  const elena = results.find(r => r.contact_id === ELENA);
  const sends = INBOXES * SENDS_PER_INBOX_PER_DAY;
  return {
    id: 'sequence',
    title: 'The sequence, and sending at scale',
    table: { head: ['Step', 'When', 'What', 'Word cap'], rows: SEQUENCE.map(([step, when, what]) => [step, when, what, String(WORD_CAP[step])]) },
    followUps: [2, 3].map(step => ({ step, subject: elena[`step${step}_subject`], body: signed(elena, step) })),
    items: [
      'One thread from one inbox. Any reply, bounce or unsubscribe stops it; a positive reply goes to the company’s rep.',
      `At most 3 contacts per company per send wave: Exec before Practitioner, then the higher rung first. ICs and all of Evergreen are deprioritised: ${thousands(tally.outcome.Deprioritised)} of the ${thousands(tally.emailed)} go last in their company.`,
      Object.entries(tally.send_wave).map(([wave, n]) => `Send wave ${wave}: ${thousands(n)}`).join(' · '),
      `${INBOXES} inboxes × ${SENDS_PER_INBOX_PER_DAY} a day is ${thousands(sends)} sends a day, so about ${thousands(sends / SEQUENCE.length)} new contacts start each day.`,
      'New inboxes warm up for 2 weeks, then ramp 10 → 20 → 30 a day. Plain text, no links in the first touch, open tracking off.',
      'The guardrail pauses a cell at bounce above 3% or unsubscribe above 2%; inbox rest pauses a single inbox.',
    ],
  };
}

function assumptions() {
  return {
    id: 'assumptions',
    title: 'Assumptions and data traps',
    items: [
      `The stack: ${STACK_LINE}. Clay isn’t needed here because the CSV is already enriched.`,
      '13 companies ship AI “built on its internal orchestration stack”. I count that as positive AI maturity, and the phrase is never quoted.',
      'The news headlines are templated and sometimes wrong, so no email uses them.',
      '3 companies’ growth % disagrees with their headcounts, and some are blank: I work it out from the employee counts.',
      'tech_stack_raw repeats the structured fields, so I use the structured fields only.',
      '114 names repeat across companies, so everything keys on contact_id, never on name.',
      'No trigger is under 90 days old, so the copy refers to them loosely (“earlier this year”), never as news.',
      'Reps, the postal address and every simulated rate are placeholders.',
    ],
  };
}

// Brief item → the slide ids that answer it → the repo files.
const CHECKLIST = [
  ['1. Personalisation signals', ['signals'], 'src/routing.js'],
  ['2. Routing logic', ['funnel', 'routing'], 'src/routing.js, output/rendered_contacts.csv'],
  ['3. Templates with variables', ['templates', 'copy'], 'templates.md, snippets.yaml'],
  ['4. 10 rendered examples', ['cards'], 'showcase.md'],
  ['Bonus: monitoring tool', ['dashboard'], 'docs/index.html'],
  ['Video', ['answer'], 'the link on slide 1'],
];

function checklist(number) {
  return {
    id: 'checklist',
    title: 'Brief checklist',
    table: { head: ['Brief item', 'Slides', 'In the repo'], rows: CHECKLIST.map(([item, ids, files]) => [item, ids.map(id => number.get(id)).join(', '), files]) },
  };
}

export function deck(results, rows, library, { asOf, links, tests }) {
  const ctx = { results, rows, library, links, tests, tally: counts(results) };
  const slides = [answer(ctx), funnel(ctx), routing(ctx), signals(ctx), templatesSlide(ctx), cards(ctx), dashboard(ctx), trust(ctx), next(ctx)];
  const appendix = [copy(ctx), sequence(ctx), built(ctx), assumptions()];
  // Main slides are numbered 1–9, appendix slides A1, A2, …, with the Brief checklist last.
  const number = new Map([...slides.map((s, i) => [s.id, String(i + 1)]), ...[...appendix, { id: 'checklist' }].map((s, i) => [s.id, `A${i + 1}`])]);
  const withNumber = s => ({ ...s, number: number.get(s.id) });
  return {
    credit: `Case study by Bryan Soo · ${day(asOf)}`,
    slides: slides.map(withNumber),
    appendix: [...appendix, checklist(number)].map(withNumber),
  };
}
