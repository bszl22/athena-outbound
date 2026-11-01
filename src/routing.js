import { createHash } from 'node:crypto';

// Routing: one whole-list pass from contact rows to a routing result per contact.
// Whole-list because the shadowed-IC rule and send waves need company context.

const BUYER_SET = {
  People: 'Employee Requests',
  IT: 'IT Service',
  Finance: 'Scale Without Headcount',
  Operations: 'Scale Without Headcount',
  'Data & AI': 'Governed AI',
};
const PER_COMPANY_PER_WAVE = 3;
const DIRECTOR_PLUS = ['Director', 'VP', 'C-Suite'];
const EXEC_SENIORITY = ['C-Suite', 'VP'];
const REAL_ITSM = ['ServiceNow', 'Jira Service Management', 'Freshservice'];
// Fallback ladder rung of each lead signal: lower is stronger. System of record and AI maturity share a rung.
const LADDER_RUNG = { Trigger: 1, 'System of record': 2, 'AI maturity': 2, 'Headcount trajectory': 3, 'Floor': 4 };
export const RESTRUCTURING_HOLD_DAYS = 90;

// A signal value as it reads mid-sentence: lowercase, apart from the AI in AI maturity.
export const midSentence = signal => (signal.startsWith('AI') ? signal : signal.toLowerCase());
const STALE_TRIGGER_DAYS = 365;

// Each trigger sub-type, with its campaign and the key of its trigger snippet. A company has at most one trigger.
// Anything else (rebrand, conference, CRM migration, new CRO, new VP RevOps) is Evergreen.
const TRIGGER_SUBTYPES = [
  ['funding', /^Raised /, 'Scaling Fast'],
  ['us_office', /new US office/, 'Scaling Fast'],
  ['acquisition', /^Acquired /, 'Scaling Fast'],
  ['ai_platform_blog', /AI platform engineering blog/, 'AI Moment'],
  ['caio', /Chief AI Officer/, 'AI Moment'],
  ['ai_adoption', /AI adoption program/, 'AI Moment'],
  ['ai_feature', /customer-facing AI feature/, 'AI Moment'],
  ['cdo', /Chief Data Officer/, 'AI Moment'],
  ['data_platform', /data platform consolidation/, 'AI Moment'],
  ['tool_consolidation', /GTM tooling/, 'Operating Reset'],
  ['ops_priority', /efficiency mandate/, 'Operating Reset'],
  ['coo', /Chief Operating Officer/, 'Operating Reset'],
];

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (from, to) => (new Date(to) - new Date(from)) / 864e5;

function campaignFor(row, asOf) {
  const trigger = row.trigger_event;
  if (!trigger) return { campaign: 'Evergreen', why: 'No trigger → Evergreen' };
  if (daysBetween(row.trigger_event_date, asOf) > STALE_TRIGGER_DAYS) {
    return { campaign: 'Evergreen', why: `"${trigger}" is older than 365 days → Evergreen` };
  }
  const match = TRIGGER_SUBTYPES.find(([, pattern]) => pattern.test(trigger));
  if (!match) return { campaign: 'Evergreen', why: `"${trigger}" is not a trigger → Evergreen` };
  const [subtype, , campaign] = match;
  return { campaign, trigger_subtype: subtype, why: `"${trigger}" → ${subtype} → ${campaign}` };
}

const departmentKey = row => row.company + '|' + row.department;

function suppression(row, directorsPlus) {
  if (!row.email) return { suppression_reason: 'no email', why: ['No email address'] };
  if (!BUYER_SET[row.department]) {
    return { suppression_reason: 'outside buyer set', why: [`${row.department} is outside the buyer set`] };
  }
  if (/restructuring|headcount reduction/i.test(row.trigger_event)) {
    const recheck = addDays(row.trigger_event_date, RESTRUCTURING_HOLD_DAYS);
    return {
      suppression_reason: 'restructuring hold',
      recheck_date: recheck,
      why: [`Company announced restructuring on ${row.trigger_event_date}: hold until ${recheck}`],
    };
  }
  if (row.seniority === 'IC' && directorsPlus.has(departmentKey(row))) {
    return {
      suppression_reason: 'shadowed IC',
      shadowed_by: directorsPlus.get(departmentKey(row)),
      why: ['IC with an emailable Director+ in the same company and department'],
    };
  }
  return null;
}

function headcountTrajectory(row) {
  let pct = row.headcount_growth_12mo_pct === '' ? null : Number(row.headcount_growth_12mo_pct);
  let derived = false;
  if (pct === null && row.employee_count && row.employee_count_12mo_ago) {
    pct = (Number(row.employee_count) / Number(row.employee_count_12mo_ago) - 1) * 100;
    derived = true;
  }
  if (pct === null) return { trajectory: null, derived };
  return { trajectory: pct >= 25 ? 'growing' : pct < 0 ? 'shrinking' : 'flat', pct: Math.round(pct), derived };
}

function systemOfRecord(row, angle) {
  if (angle === 'Governed AI') return null;
  if (angle === 'IT Service') return REAL_ITSM.includes(row.itsm_tool) ? row.itsm_tool : null;
  return row.hris || null;
}

// AI maturity is either the first AI tool in use (kind "tools") or heavy AI/ML hiring (kind "hiring").
function aiMaturity(row, angle) {
  const none = { ai: null, kind: null };
  if (angle !== 'Governed AI') return none;
  if (row.ai_tooling) return { ai: row.ai_tooling.split(';')[0].trim(), kind: 'tools' };
  if (Number(row.open_roles_ai_ml) >= 10) return { ai: `${row.open_roles_ai_ml} open AI/ML roles`, kind: 'hiring' };
  return none;
}

// The fallback ladder: the first usable signal leads, the next supports, never a third.
// Each rung is [Signal, value or null when not usable].
function fallbackLadder({ trigger, angle, sor, ai, headcount }) {
  const rungs = [
    ['Trigger', trigger],
    angle === 'Governed AI' ? ['AI maturity', ai] : ['System of record', sor],
    ['Headcount trajectory', headcount.trajectory === 'growing' ? 'growing' : null],
  ];
  const usable = rungs.filter(([, value]) => value).map(([name]) => name);
  return {
    lead_signal: usable[0] ?? 'Floor',
    supporting_signal: usable[1] ?? null,
    signals_used: usable.slice(0, 2),
    signals_missing: rungs.filter(([, value]) => !value).map(([name]) => name),
  };
}

function route(row, asOf) {
  const angle = BUYER_SET[row.department];
  const band = EXEC_SENIORITY.includes(row.seniority) ? 'Exec' : 'Practitioner';
  const { campaign, trigger_subtype = null, why: campaignWhy } = campaignFor(row, asOf);
  const sor = systemOfRecord(row, angle);
  const { ai, kind: aiKind } = aiMaturity(row, angle);
  const headcount = headcountTrajectory(row);
  const trigger = campaign === 'Evergreen' ? null : row.trigger_event;
  // A Contact whose title is the one the company just hired for is not told about that hire:
  // the trigger still sets the campaign but is not usable on their fallback ladder.
  const hiredTitleClash = Boolean(trigger) && row.title === row.exec_change_title;
  const ladder = fallbackLadder({ trigger: hiredTitleClash ? null : trigger, angle, sor, ai, headcount });
  const deprioritised = row.seniority === 'IC' || campaign === 'Evergreen';

  const why = [campaignWhy, `${row.department} → ${angle}`, `${row.seniority} → ${band}`];
  if (angle === 'IT Service' && !sor) why.push(`ITSM "${row.itsm_tool || 'blank'}" is not a usable system of record`);
  if (hiredTitleClash) why.push(`Title matches the hired ${row.exec_change_title}: trigger skipped as a signal`);
  if (headcount.derived) why.push('Growth % blank: headcount trajectory derived from employee counts');
  if (!ladder.supporting_signal && headcount.trajectory !== 'growing') {
    why.push(headcount.trajectory ? `Headcount trajectory ${headcount.trajectory}, under 25% growth: not usable` : 'No headcount data: headcount trajectory not usable');
  }
  why.push(`Lead ${midSentence(ladder.lead_signal)}` + (ladder.supporting_signal ? ` · Supporting ${midSentence(ladder.supporting_signal)}` : ''));
  if (deprioritised) why.push(row.seniority === 'IC' ? 'IC → Deprioritised' : 'Evergreen → Deprioritised');

  return {
    contact_id: row.contact_id,
    outcome: deprioritised ? 'Deprioritised' : 'Emailed',
    campaign,
    angle,
    band,
    lead_signal: ladder.lead_signal,
    supporting_signal: ladder.supporting_signal,
    ladder_rung: LADDER_RUNG[ladder.lead_signal],
    cta_type: ladder.lead_signal === 'Floor' ? 'Floor' : band,
    deprioritised,
    trigger,
    trigger_subtype,
    system_of_record: sor,
    workday: sor === 'Workday',
    ai_maturity: ai,
    ai_maturity_kind: aiKind,
    headcount_trajectory: headcount.trajectory,
    signals_used: ladder.signals_used,
    signals_missing: ladder.signals_missing,
    why,
  };
}

// Stable tiebreak: the same contact_id always sorts the same way, whatever the input order.
const idHash = id => createHash('sha256').update(id).digest('hex');

// Pick order within a company: deprioritised ICs last, Exec before Practitioner,
// higher fallback ladder rung first, then the contact_id hash.
function pickOrderKey(result, row) {
  return [row.seniority === 'IC' ? 1 : 0, result.band === 'Exec' ? 0 : 1, result.ladder_rung, idHash(result.contact_id)];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function assignSendWaves(routed) {
  const byCompany = Map.groupBy(routed.filter(entry => entry.result.outcome !== 'Suppressed'), entry => entry.row.company);
  for (const list of byCompany.values()) {
    list
      .map(entry => ({ entry, key: pickOrderKey(entry.result, entry.row) }))
      .sort((a, b) => compareKeys(a.key, b.key))
      .forEach(({ entry }, i) => {
        // i is the 0-based pick position; rank_in_company is 1-based for readers.
        entry.result.rank_in_company = i + 1;
        entry.result.send_wave = Math.floor(i / PER_COMPANY_PER_WAVE) + 1;
      });
  }
}

export function routeAll(rows, { asOf }) {
  // The emailable Director+ Contacts in each company and department, by contact_id, so a shadowed IC names who shadows them.
  const directorsPlus = new Map(
    Map.groupBy(rows.filter(r => r.email && DIRECTOR_PLUS.includes(r.seniority)), departmentKey)
      .entries()
      .map(([key, list]) => [key, list.map(r => r.contact_id).sort()]),
  );
  const routed = rows.map(row => {
    const suppressed = suppression(row, directorsPlus);
    const result = suppressed ? { contact_id: row.contact_id, outcome: 'Suppressed', ...suppressed } : route(row, asOf);
    return { row, result };
  });
  assignSendWaves(routed);
  return routed.map(entry => entry.result);
}
