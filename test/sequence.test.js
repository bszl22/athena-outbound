import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContacts } from '../src/contacts.js';
import { parseLibrary } from '../src/library.js';
import { pipeline } from '../src/pipeline.js';

const AS_OF = '2026-10-27';
const rows = parseContacts(readFileSync(new URL('../athena_exercise_contacts.csv', import.meta.url), 'utf8'));
const libraryText = readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8');
const library = parseLibrary(libraryText);
const results = pipeline(rows, library, { asOf: AS_OF });

const emailed = results.filter(r => r.outcome !== 'Suppressed');
const byId = new Map(results.map(r => [r.contact_id, r]));

test('all 416 emailed contacts get step 2 within 50 words and step 3 within 30, with zero held', () => {
  assert.equal(emailed.length, 416);
  for (const r of emailed) {
    assert.match(r.step2_body, /^Hi \S+,\n\n/, r.contact_id);
    assert.match(r.step3_body, /^Hi \S+,\n\n/, r.contact_id);
    assert.ok(r.step2_words > 0 && r.step2_words <= 50, `${r.contact_id} step 2 ${r.step2_words} words`);
    assert.ok(r.step3_words > 0 && r.step3_words <= 30, `${r.contact_id} step 3 ${r.step3_words} words`);
  }
  assert.deepEqual(emailed.filter(r => r.held).map(r => r.contact_id), []);
});

const rowOf = new Map(rows.map(r => [r.contact_id, r]));
const steps = r => [r.step1_body, r.step2_body, r.step3_body];

test('every contact at a company has the same rep, from 3 to 5 placeholder reps', () => {
  const repsByCompany = new Map();
  for (const r of emailed) {
    const company = rowOf.get(r.contact_id).company;
    repsByCompany.set(company, (repsByCompany.get(company) ?? new Set()).add(r.rep));
  }
  for (const [company, reps] of repsByCompany) assert.equal(reps.size, 1, company);
  const reps = new Set(emailed.map(r => r.rep));
  assert.ok(reps.size >= 3 && reps.size <= 5, `${reps.size} reps`);
});

test("every step is signed by the rep, with title, Athena (by Humaans), a postal address and the reply-'no' line", () => {
  for (const r of emailed) {
    for (const body of steps(r)) {
      const signature = body.split('\n\n').slice(-2).join('\n\n');
      assert.match(signature, new RegExp(`^${r.rep}\\n.+, Athena \\(by Humaans\\)\\n.*\\d.*\\n\\nNot relevant\\? Reply 'no' and I won't follow up\\.$`), r.contact_id);
    }
  }
});

test('steps 2 and 3 are "Re:" the step 1 subject, so the sequence stays in one thread (C1031)', () => {
  const r = byId.get('C1031');
  assert.equal(r.subject, 'employee requests at Halcyon Stack');
  assert.equal(r.step2_subject, 'Re: employee requests at Halcyon Stack');
  assert.equal(r.step3_subject, 'Re: employee requests at Halcyon Stack');
  for (const r of emailed) assert.equal(r.step2_subject, `Re: ${r.subject}`, r.contact_id);
});

const failedChecks = r => r.checks.filter(c => !c.ok).map(c => c.check);
const freshLibrary = () => parseLibrary(libraryText);
const usesInStep1 = (r, id) => r.step1_snippet_ids.some(used => used.startsWith(id + '.v'));

test('at most one "up to" figure appears across any contact\'s whole sequence', () => {
  for (const r of emailed) assert.ok((steps(r).join('\n').match(/up to \d/gi) ?? []).length <= 1, r.contact_id);
});

test('an "up to" figure in step 2 for a contact whose step 1 proof line has one is held under the up to figure check', () => {
  const broken = freshLibrary();
  broken.snippets['followup_cta.practitioner'] = Array(2).fill('Athena closes up to 80% of these on its own: want a walkthrough?');
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => r.band === 'Practitioner' && usesInStep1(r, 'proof.practitioner'));
  assert.ok(affected.length > 0);
  for (const r of affected) {
    assert.equal(r.held, true, r.contact_id);
    assert.ok(failedChecks(r).includes('up to figure'), r.contact_id);
  }
});

test('no follow-up reuses a snippet ID from that contact\'s step 1, and every contact passes the no reuse check', () => {
  for (const r of emailed) {
    const step1 = new Set(r.step1_snippet_ids);
    for (const id of [...r.step2_snippet_ids, ...r.step3_snippet_ids]) assert.ok(!step1.has(id), `${r.contact_id} reuses ${id}`);
    assert.deepEqual(r.checks.find(c => c.check === 'no reuse'), { check: 'no reuse', ok: true, detail: '' }, r.contact_id);
  }
});

test('a follow-up CTA that reuses the "20 minutes" figure from the step 1 Exec CTA holds those contacts under the no reuse check', () => {
  const broken = freshLibrary();
  broken.snippets['followup_cta.exec'] = Array(2).fill('Still worth 20 minutes to compare notes?');
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => usesInStep1(r, 'cta.exec'));
  assert.ok(affected.length > 0);
  for (const r of affected) {
    assert.equal(r.held, true, r.contact_id);
    assert.deepEqual(r.checks.find(c => c.check === 'no reuse'), { check: 'no reuse', ok: false, detail: 'step 2: figure 20' }, r.contact_id);
  }
  // A Floor Exec gets the floor CTA in step 1, so the same follow-up reuses nothing.
  const floorExecs = out.filter(r => r.band === 'Exec' && r.lead_signal === 'Floor');
  assert.ok(floorExecs.length > 0);
  for (const r of floorExecs) assert.ok(!failedChecks(r).includes('no reuse'), r.contact_id);
});

test('step 3 names no signal and makes no referral ask', () => {
  for (const r of emailed) {
    const closing = r.step3_body.split('\n\n')[1];
    for (const value of [rowOf.get(r.contact_id).hris, r.system_of_record, r.ai_maturity, rowOf.get(r.contact_id).trigger_event]) {
      if (value) assert.ok(!closing.includes(value), `${r.contact_id} names ${value}`);
    }
    assert.doesNotMatch(closing, /this (spring|summer|fall)|earlier this year|late last year|grow/i, r.contact_id);
    assert.doesNotMatch(closing, /right person|someone else|point me|who (else|should I)/i, r.contact_id);
  }
});

test('a closing note that asks for a referral is held under the banned phrase check', () => {
  const broken = freshLibrary();
  broken.snippets['closing.it_service'] = Array(2).fill('If this is not for you, could you point me to the right person?');
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => r.angle === 'IT Service');
  assert.ok(affected.length > 0);
  for (const r of affected) assert.ok(failedChecks(r).includes('banned phrase'), r.contact_id);
});
