import { PINNED } from './pinned.js';
import { WORD_CAP } from './render.js';
import { midSentence } from './routing.js';

// Outputs: showcase.md, the suppression funnel table then the 10 pinned cards in story order.
// Each card: the inputs the route read → the route trace → subject and body → small print.
// Suppressed cards stop after the route and say why not, and what happens instead.

const SUPPRESSION_ORDER = ['no email', 'outside buyer set', 'restructuring hold', 'shadowed IC'];
const FUNNEL_LABEL = {
  'no email': 'No email address',
  'outside buyer set': 'Department outside the buyer set',
  'restructuring hold': 'Company restructuring: 90-day hold',
  'shadowed IC': 'IC with an emailable Director+ in the same department',
};

const thousands = x => x.toLocaleString('en-US');

// The funnel as [step, suppressed, contacts left] rows, shared with the deck. The last row's contacts left is the emailed count.
export function funnelRows(results) {
  let left = results.length;
  const rows = [['The contact list', '', thousands(left)]];
  for (const reason of SUPPRESSION_ORDER) {
    const here = results.filter(r => r.suppression_reason === reason).length;
    left -= here;
    rows.push([FUNNEL_LABEL[reason], thousands(here), reason === 'shadowed IC' ? `${thousands(left)} emailed` : thousands(left)]);
  }
  return rows;
}

function funnel(results) {
  const rows = funnelRows(results);
  const last = rows.length - 1;
  return [
    '| Step | Suppressed | Contacts left |',
    '| --- | ---: | ---: |',
    ...rows.map(([step, here, left], i) => `| ${step} | ${here ? `${here} ` : ''}| ${i === last ? `**${left}**` : left} |`),
  ].join('\n');
}

const value = v => (v === '' || v === undefined || v === null ? '_blank_' : v);

// The CSV columns this contact's route read, in the order it read them. It stops where Suppress stopped.
function inputsRead(result, row) {
  const read = [['email', row.email ? 'present' : '']];
  if (result.suppression_reason === 'no email') return read;
  read.push(['department', row.department]);
  if (result.suppression_reason === 'outside buyer set') return read;
  read.push(['trigger_event', row.trigger_event], ['trigger_event_date', row.trigger_event_date]);
  if (result.suppression_reason === 'restructuring hold') return read;
  read.push(['seniority', row.seniority]);
  if (result.suppression_reason === 'shadowed IC') return read;
  if (result.trigger) read.push(['title', row.title], ['exec_change_title', row.exec_change_title]);
  if (result.angle === 'IT Service') read.push(['itsm_tool', row.itsm_tool]);
  else if (result.angle === 'Governed AI') read.push(['ai_tooling', row.ai_tooling], ['open_roles_ai_ml', row.open_roles_ai_ml]);
  else read.push(['hris', row.hris]);
  read.push(['headcount_growth_12mo_pct', row.headcount_growth_12mo_pct]);
  if (row.headcount_growth_12mo_pct === '') {
    read.push(['employee_count', row.employee_count], ['employee_count_12mo_ago', row.employee_count_12mo_ago]);
  }
  return read;
}

const inputsTable = (result, row) =>
  ['| Column | Value |', '| --- | --- |', ...inputsRead(result, row).map(([column, v]) => `| \`${column}\` | ${value(v)} |`)].join('\n');

// Suppress in plain words, one step per rule in order, up to the rule that caught the contact (or all four passed).
function suppressSteps(result, row) {
  const passed = [
    ['no email', 'has an email'],
    ['outside buyer set', `${row.department} is in the buyer set`],
    ['restructuring hold', 'no restructuring at the company'],
    ['shadowed IC', 'not a shadowed IC'],
  ];
  const stop = passed.findIndex(([reason]) => reason === result.suppression_reason);
  if (stop < 0) return [`Not suppressed: ${passed.map(([, step]) => step).join(', ')}`];
  return [...passed.slice(0, stop).map(([, step]) => step[0].toUpperCase() + step.slice(1)), `${result.why.join('; ')} → Suppressed (${result.suppression_reason})`];
}

function routeTrace(result, row) {
  const steps = [...suppressSteps(result, row)];
  if (result.outcome !== 'Suppressed') {
    steps.push(
      ...result.why,
      `${result.outcome} · rank ${result.rank_in_company} at ${row.company} · Send wave ${result.send_wave} · variant ${result.variant} · Rep ${result.rep}`,
    );
  }
  return steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
}

// The why not, and what happens instead, for each Suppression reason.
export const WHY_NOT = {
  'no email': (result, row) =>
    `There is no address to send to. Instead: ${row.first_name} is reported here, not dropped, and is routed again once an address is found.`,
  'outside buyer set': (result, row) =>
    `Athena sells to People, Finance, IT, Operations and Data & AI, and ${row.department} is none of them. Instead: ${row.company} hears from its buyer set colleagues.`,
  'restructuring hold': (result, row) =>
    `${row.company} announced a restructuring on ${row.trigger_event_date}. An email about handling more work without new hires, ` +
    `that soon after a headcount reduction, would read badly, so every contact there is held. ` +
    `Instead: the hold carries a recheck date of ${result.recheck_date}, 90 days after the announcement. Lifting it is a person's call, ` +
    'not the router\'s, so every contact there stays suppressed until someone re-checks the company.',
  'shadowed IC': (result, row, rowOf, byId) => {
    const names = result.shadowed_by.map(id => {
      const colleague = rowOf.get(id);
      const wave = byId.get(id).send_wave;
      return `${colleague.full_name} (${id}, ${colleague.title}, send wave ${wave})`;
    });
    return (
      `${row.first_name} is an IC, and ${row.company}'s ${row.department} department has an emailable Director+. ` +
      `Writing to both would put two people from one department on the same email. Instead: ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} emailed, and ${row.first_name} is not.`
    );
  },
};

// A rendered email as a Markdown blockquote: blank lines split paragraphs, single newlines (the signature) stay hard breaks.
const quote = text =>
  text
    .replace(/[\\*_<]/g, c => `\\${c}`)
    .split('\n\n')
    .map(paragraph => paragraph.split('\n').map(line => `> ${line}`).join('\\\n'))
    .join('\n>\n');

const snippetIdList = list => list.map(id => `\`${id}\``).join(', ');

function email(result, step) {
  const subject = step === 1 ? result.subject : result[`step${step}_subject`];
  return [
    `**Step ${step}** · Subject: ${subject}`,
    quote(result[`step${step}_body`]),
  ].join('\n\n');
}

function smallPrint(result, steps) {
  const list = signals => (signals.length ? signals.map(midSentence).join(', ') : 'none');
  const checks = result.checks.map(c => `${c.check} ${c.ok ? 'ok' : `FAIL (${c.detail})`}`).join(' · ');
  return [
    ...steps.map(step => `- Step ${step} snippet IDs: ${snippetIdList(result[`step${step}_snippet_ids`])} · ${result[`step${step}_words`]} / ${WORD_CAP[step]} words`),
    `- Signals used: ${list(result.signals_used)} · missing: ${list(result.signals_missing)}`,
    `- Render checks: ${checks}${result.held ? ' · **held**' : ''}`,
  ].join('\n');
}

function card(pinned, i, rowOf, byId) {
  const result = byId.get(pinned.contact_id);
  const row = rowOf.get(pinned.contact_id);
  const parts = [
    `## ${i + 1}. ${row.full_name} (${row.contact_id})`,
    `_${pinned.story}._ ${row.title} · ${row.department} · ${row.company}`,
    '### Inputs the route read',
    inputsTable(result, row),
    '### Route',
    routeTrace(result, row),
  ];
  if (result.outcome === 'Suppressed') {
    parts.push('### Why not, and what happens instead', WHY_NOT[result.suppression_reason](result, row, rowOf, byId));
    return parts.join('\n\n');
  }
  // Only the first card shows the follow-ups, so the rest stay short.
  const steps = i === 0 ? [1, 2, 3] : [1];
  parts.push(i === 0 ? '### The sequence' : '### The first touch', ...steps.map(step => email(result, step)), '### Small print', smallPrint(result, steps));
  return parts.join('\n\n');
}

export function showcase(results, rows, { asOf }) {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  const byId = new Map(results.map(r => [r.contact_id, r]));
  return [
    '# Showcase',
    `Generated by \`npm run render\` with \`as_of\` ${asOf}: do not edit by hand. The 10 cards are the pinned contacts in \`src/pinned.js\`, ` +
      'which are also the regression tests, so a card that drifts fails both `npm test` and `npm run render`.',
    '## Suppression funnel',
    funnel(results),
    ...PINNED.map((pinned, i) => card(pinned, i, rowOf, byId)),
  ].join('\n\n') + '\n';
}
