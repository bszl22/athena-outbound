// The 10 pinned showcase contacts, in story order: the four campaigns, then the fallbacks, the floor,
// the hired-title clash and two suppressed. Each row's expected outcome and card-specific behaviour
// is both a regression test and the CLI's drift check, and the same list orders showcase.md.

const sequenceIds = r => [...r.step1_snippet_ids, ...r.step2_snippet_ids, ...r.step3_snippet_ids];
const uses = (r, prefix) => sequenceIds(r).some(id => id.startsWith(prefix + '.'));
const sequenceText = r => [r.step1_body, r.step2_body, r.step3_body].join('\n');
const checkOk = (r, name) => r.checks.find(c => c.check === name).ok;
const traced = (r, pattern) => r.why.some(line => pattern.test(line));

// Each row: what it shows (the card heading), the expected routing fields, and [behaviour, holds(result, byId)] pairs.
export const PINNED = [
  {
    contact_id: 'C1031',
    story: 'Scaling Fast · Employee Requests · Practitioner, a trigger lead with HRIS support and the full 3-step sequence',
    expect: {
      outcome: 'Emailed', campaign: 'Scaling Fast', angle: 'Employee Requests', band: 'Practitioner',
      lead_signal: 'Trigger', supporting_signal: 'System of record', cta_type: 'Practitioner', held: false,
    },
    shows: [
      ['the supporting line names the HRIS', r => uses(r, 'support.sor.hris') && r.step1_body.includes('SuccessFactors')],
      ['the proof line is Athena\'s "up to 80%"', r => uses(r, 'proof.practitioner') && /Athena[^.]* up to 80%/.test(r.step1_body)],
      ['the show-me Practitioner CTA', r => uses(r, 'cta.practitioner')],
      ['all 3 steps, within 90 / 50 / 30 words', r => r.step1_words <= 90 && r.step2_words <= 50 && r.step3_words <= 30],
    ],
  },
  {
    contact_id: 'C1463',
    story: 'AI Moment · Governed AI · Exec, a trigger lead with AI maturity support',
    expect: {
      outcome: 'Emailed', campaign: 'AI Moment', angle: 'Governed AI', band: 'Exec',
      lead_signal: 'Trigger', supporting_signal: 'AI maturity', cta_type: 'Exec', held: false,
    },
    shows: [
      ['the supporting line names their first AI tool', r => uses(r, 'support.ai.tools') && r.step1_body.includes('Azure OpenAI')],
      ['the investor line as Proof, with no "up to" figure', r => uses(r, 'proof.exec') && /\bYC\b/.test(r.step1_body) && !/up to \d/.test(sequenceText(r))],
      ['the meeting CTA', r => uses(r, 'cta.exec')],
    ],
  },
  {
    contact_id: 'C1068',
    story: 'Operating Reset, an oblique trigger snippet that never names the efficiency mandate',
    expect: {
      outcome: 'Emailed', campaign: 'Operating Reset', angle: 'Employee Requests', band: 'Practitioner',
      lead_signal: 'Trigger', supporting_signal: 'System of record', cta_type: 'Practitioner', held: false,
    },
    shows: [
      ['the trigger snippet is the oblique operating-priority line', r => uses(r, 'trigger.ops_priority')],
      ['no step names the efficiency mandate', r => !/efficien|mandate/i.test(sequenceText(r))],
      ['the banned phrase check passes', r => checkOk(r, 'banned phrase')],
    ],
  },
  {
    contact_id: 'C1440',
    story: 'Evergreen · Exec, a Workday lead',
    expect: {
      outcome: 'Deprioritised', campaign: 'Evergreen', angle: 'Employee Requests', band: 'Exec',
      lead_signal: 'System of record', supporting_signal: 'Headcount trajectory', cta_type: 'Exec', held: false,
    },
    shows: [
      ['the Workday lead line names Workday', r => uses(r, 'lead.sor.workday') && r.step1_body.includes('Workday')],
      ['no trigger snippet', r => !uses(r, 'trigger')],
    ],
  },
  {
    contact_id: 'C1476',
    story: 'Linear is not an ITSM, so supporting drops to headcount trajectory',
    expect: {
      outcome: 'Emailed', campaign: 'Scaling Fast', angle: 'IT Service', band: 'Practitioner',
      lead_signal: 'Trigger', supporting_signal: 'Headcount trajectory', cta_type: 'Practitioner', held: false,
    },
    shows: [
      ['Linear is not a usable system of record', r => r.signals_missing.includes('System of record') && traced(r, /"Linear" is not a usable system of record/)],
      ['the supporting line is the Headcount line, and Linear is never named', r => uses(r, 'support.headcount') && !sequenceText(r).includes('Linear')],
    ],
  },
  {
    contact_id: 'C1964',
    story: 'A stale trigger (older than 365 days) routes to Evergreen',
    expect: {
      outcome: 'Deprioritised', campaign: 'Evergreen', angle: 'Scale Without Headcount', band: 'Practitioner',
      lead_signal: 'System of record', supporting_signal: 'Headcount trajectory', cta_type: 'Practitioner', held: false,
    },
    shows: [
      ['the 2023 funding round is older than 365 days, so it is not a trigger', r => traced(r, /older than 365 days → Evergreen/) && r.trigger === null],
      ['no trigger snippet, and the funding round is never named', r => !uses(r, 'trigger') && !/rais|funding/i.test(sequenceText(r))],
    ],
  },
  {
    contact_id: 'C1451',
    story: 'The floor: the CRO hire is not a trigger, Linear is not usable, headcount trajectory is flat',
    expect: {
      outcome: 'Deprioritised', campaign: 'Evergreen', angle: 'IT Service', band: 'Practitioner',
      lead_signal: 'Floor', supporting_signal: null, cta_type: 'Floor', held: false,
    },
    shows: [
      ['no usable signal', r => r.signals_used.length === 0 && traced(r, /Chief Revenue Officer" is not a trigger/) && traced(r, /Headcount trajectory flat/)],
      ['the floor opener, with no supporting line and no proof line', r => uses(r, 'floor.it_service') && !uses(r, 'support') && !uses(r, 'proof')],
      ['the soft floor CTA', r => uses(r, 'cta.floor')],
    ],
  },
  {
    contact_id: 'C1735',
    story: 'The hired-title clash: the new COO is not told about their own hire',
    expect: {
      outcome: 'Emailed', campaign: 'Operating Reset', angle: 'Scale Without Headcount', band: 'Exec',
      lead_signal: 'System of record', supporting_signal: null, cta_type: 'Exec', held: false,
    },
    shows: [
      ['the trigger sets the campaign but is skipped as Lead', r => r.signals_missing.includes('Trigger') && traced(r, /Chief Operating Officer: trigger skipped/)],
      ['no step mentions the COO hire', r => !uses(r, 'trigger') && !/Chief Operating Officer|\bCOO\b|new role/i.test(sequenceText(r))],
    ],
  },
  {
    contact_id: 'C1752',
    story: 'Suppressed: a 90-day restructuring hold',
    expect: { outcome: 'Suppressed', suppression_reason: 'restructuring hold', recheck_date: '2026-09-13' },
    shows: [['no email is rendered', r => r.step1_body === undefined]],
  },
  {
    contact_id: 'C1132',
    story: 'Suppressed: an IC shadowed by an IT Director+',
    expect: { outcome: 'Suppressed', suppression_reason: 'shadowed IC', shadowed_by: ['C1131'] },
    shows: [
      ['no email is rendered', r => r.step1_body === undefined],
      ['the VP IT who shadows them is emailed instead', (r, byId) => byId.get('C1131').outcome !== 'Suppressed'],
    ],
  },
];

// Every way the pinned contacts differ from what they pin, as "C1031: campaign is X, expected Y" lines. Empty when none drift.
export function pinnedDrift(results) {
  const byId = new Map(results.map(r => [r.contact_id, r]));
  return PINNED.flatMap(({ contact_id, expect, shows }) => {
    const r = byId.get(contact_id);
    if (!r) return [`${contact_id}: missing from the results`];
    const fields = Object.entries(expect)
      .filter(([key, value]) => JSON.stringify(r[key]) !== JSON.stringify(value))
      .map(([key, value]) => `${contact_id}: ${key} is ${JSON.stringify(r[key])}, expected ${JSON.stringify(value)}`);
    const behaviours = shows.filter(([, holds]) => !safely(() => holds(r, byId))).map(([behaviour]) => `${contact_id}: no longer shows ${behaviour}`);
    return [...fields, ...behaviours];
  });
}

// A behaviour that throws (say, a field gone missing) has drifted, not crashed the run.
function safely(holds) {
  try {
    return holds();
  } catch {
    return false;
  }
}
