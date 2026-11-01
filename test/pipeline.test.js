import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContacts } from '../src/contacts.js';
import { parseLibrary } from '../src/library.js';
import { pipeline } from '../src/pipeline.js';

const AS_OF = '2026-10-27';
const rows = parseContacts(readFileSync(new URL('../athena_exercise_contacts.csv', import.meta.url), 'utf8'));
const library = parseLibrary(readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8'));
const results = pipeline(rows, library, { asOf: AS_OF });

const count = (xs, f) => xs.filter(f).length;
const emailed = results.filter(r => r.outcome !== 'Suppressed');

test('every one of the 1,000 contacts gets a result, with no silent drops', () => {
  assert.equal(rows.length, 1000);
  assert.equal(results.length, 1000);
  assert.deepEqual(new Set(results.map(r => r.contact_id)), new Set(rows.map(r => r.contact_id)));
  for (const r of results) assert.ok(['Suppressed', 'Emailed', 'Deprioritised'].includes(r.outcome), r.contact_id);
});

const byId = new Map(results.map(r => [r.contact_id, r]));

test('suppression funnel: no email 57, outside buyer set 490, restructuring hold 19, shadowed IC 18 → 416 emailed', () => {
  const by = reason => count(results, r => r.suppression_reason === reason);
  assert.equal(by('no email'), 57);
  assert.equal(by('outside buyer set'), 490);
  assert.equal(by('restructuring hold'), 19);
  assert.equal(by('shadowed IC'), 18);
  assert.equal(emailed.length, 416);
});

test('every one of the 40 contacts at a restructuring company is suppressed', () => {
  const atRestructuring = rows.filter(r => /restructuring/.test(r.trigger_event));
  assert.equal(atRestructuring.length, 40);
  assert.ok(atRestructuring.every(r => byId.get(r.contact_id).outcome === 'Suppressed'));
});

test('a restructuring hold stays after its recheck date passes: C1752 is still suppressed', () => {
  const c1752 = byId.get('C1752');
  assert.equal(c1752.recheck_date, '2026-09-13');
  assert.ok(c1752.recheck_date < AS_OF);
  assert.equal(c1752.suppression_reason, 'restructuring hold');
});

test('restructuring Suppressions carry a recheck date 90 days after the trigger date', () => {
  const held = results.filter(r => r.suppression_reason === 'restructuring hold');
  const dateOf = id => rows.find(r => r.contact_id === id).trigger_event_date;
  for (const r of held) {
    const days = (new Date(r.recheck_date) - new Date(dateOf(r.contact_id))) / 864e5;
    assert.equal(days, 90, r.contact_id);
  }
});

test('Campaigns: Scaling Fast 78, AI Moment 70, Operating Reset 61, Evergreen 207', () => {
  const by = c => count(emailed, r => r.campaign === c);
  assert.deepEqual(
    { 'Scaling Fast': by('Scaling Fast'), 'AI Moment': by('AI Moment'), 'Operating Reset': by('Operating Reset'), Evergreen: by('Evergreen') },
    { 'Scaling Fast': 78, 'AI Moment': 70, 'Operating Reset': 61, Evergreen: 207 },
  );
});

// The campaign follows from the trigger sub-type alone, as the spec sets it out: one campaign per sub-type.
const CAMPAIGN_BY_SUBTYPE = {
  funding: 'Scaling Fast', us_office: 'Scaling Fast', acquisition: 'Scaling Fast',
  ai_platform_blog: 'AI Moment', caio: 'AI Moment', ai_adoption: 'AI Moment',
  ai_feature: 'AI Moment', cdo: 'AI Moment', data_platform: 'AI Moment',
  tool_consolidation: 'Operating Reset', ops_priority: 'Operating Reset', coo: 'Operating Reset',
};

test('every emailed contact with a trigger has a trigger sub-type, and its campaign follows from it', () => {
  for (const r of emailed) {
    if (r.campaign === 'Evergreen') assert.equal(r.trigger_subtype, null, r.contact_id);
    else assert.equal(CAMPAIGN_BY_SUBTYPE[r.trigger_subtype], r.campaign, `${r.contact_id} ${r.trigger_subtype}`);
  }
});

test('C1031: a new US office is the us_office trigger sub-type, in Scaling Fast, with its trigger snippet in step 1', () => {
  const r = byId.get('C1031');
  assert.equal(r.trigger_subtype, 'us_office');
  assert.equal(r.campaign, 'Scaling Fast');
  assert.equal(r.step1_snippet_ids[1], 'trigger.us_office.v2');
});

test('C1463: AI maturity from an AI tool in use is the tools kind, and the supporting line names the tool', () => {
  const r = byId.get('C1463');
  assert.equal(r.ai_maturity, 'Azure OpenAI');
  assert.equal(r.ai_maturity_kind, 'tools');
  assert.ok(r.step1_snippet_ids.includes('support.ai.tools.v2'), r.step1_snippet_ids.join(' '));
});

test('Lead signals across the 416 emailed: trigger 208, system of record 114, AI maturity 12, Headcount 28, floor 54', () => {
  const by = lead => count(emailed, r => r.lead_signal === lead);
  assert.deepEqual(
    [by('Trigger'), by('System of record'), by('AI maturity'), by('Headcount trajectory'), by('Floor')],
    [208, 114, 12, 28, 54],
  );
  // Every emailed contact outside Evergreen has a usable trigger, so C1735 is the only one not leading with it.
  assert.deepEqual(emailed.filter(r => r.campaign !== 'Evergreen' && r.lead_signal !== 'Trigger').map(r => r.contact_id), ['C1735']);
});

test('Lead signals in Evergreen: system of record 113, AI maturity 12, Headcount 28, floor 54 across 19 companies', () => {
  const evergreen = emailed.filter(r => r.campaign === 'Evergreen');
  const by = lead => count(evergreen, r => r.lead_signal === lead);
  assert.deepEqual(
    [by('System of record'), by('AI maturity'), by('Headcount trajectory'), by('Floor')],
    [113, 12, 28, 54],
  );
  const companyOf = id => rows.find(r => r.contact_id === id).company;
  assert.equal(new Set(evergreen.filter(r => r.lead_signal === 'Floor').map(r => companyOf(r.contact_id))).size, 19);
});

test('Deprioritised (IC or Evergreen) is 219 of the 416 emailed', () => {
  assert.equal(count(emailed, r => r.outcome === 'Deprioritised'), 219);
  assert.equal(count(emailed, r => r.outcome === 'Emailed'), 197);
});

test('Send waves: 266 in wave 1, 134 in wave 2, 16 in wave 3', () => {
  const by = w => count(emailed, r => r.send_wave === w);
  assert.deepEqual([by(1), by(2), by(3)], [266, 134, 16]);
  assert.equal(count(emailed, r => r.send_wave > 3), 0);
});

test('no company has more than 3 contacts in any send wave', () => {
  const companyOf = new Map(rows.map(r => [r.contact_id, r.company]));
  const perCompanyWave = new Map();
  for (const r of emailed) {
    const key = companyOf.get(r.contact_id) + '|' + r.send_wave;
    perCompanyWave.set(key, (perCompanyWave.get(key) ?? 0) + 1);
  }
  assert.ok(Math.max(...perCompanyWave.values()) <= 3);
});

test('within a company, deprioritised ICs are picked after everyone else', () => {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  const byCompany = Map.groupBy(emailed, r => rowOf.get(r.contact_id).company);
  for (const list of byCompany.values()) {
    const ranked = list.toSorted((a, b) => a.rank_in_company - b.rank_in_company);
    assert.deepEqual(ranked.map(r => r.rank_in_company), ranked.map((_, i) => i + 1));
    const isIC = r => rowOf.get(r.contact_id).seniority === 'IC';
    const firstIC = ranked.findIndex(isIC);
    if (firstIC >= 0) assert.ok(ranked.slice(firstIC).every(isIC));
  }
});

test('within a company, Exec is picked before Practitioner, then the stronger lead signal first', () => {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  const byCompany = Map.groupBy(emailed, r => rowOf.get(r.contact_id).company);
  for (const list of byCompany.values()) {
    const ranked = list
      .filter(r => rowOf.get(r.contact_id).seniority !== 'IC')
      .toSorted((a, b) => a.rank_in_company - b.rank_in_company);
    for (let i = 1; i < ranked.length; i++) {
      const [prev, next] = [ranked[i - 1], ranked[i]];
      if (prev.band === next.band) assert.ok(prev.ladder_rung <= next.ladder_rung, `${prev.contact_id} before ${next.contact_id}`);
      else assert.equal(prev.band, 'Exec', `${prev.contact_id} before ${next.contact_id}`);
    }
  }
});

test('two runs give identical results', () => {
  assert.deepEqual(pipeline(rows, library, { asOf: AS_OF }), results);
  const shuffled = rows.toReversed();
  const again = new Map(pipeline(shuffled, library, { asOf: AS_OF }).map(r => [r.contact_id, r]));
  for (const r of results) assert.deepEqual(again.get(r.contact_id), r);
});
