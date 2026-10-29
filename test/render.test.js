import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContacts } from '../src/contacts.js';
import { parseLibrary } from '../src/library.js';
import { pipeline } from '../src/pipeline.js';
import { runFailures } from '../src/run-failures.js';

const AS_OF = '2026-10-27';
const rows = parseContacts(readFileSync(new URL('../athena_exercise_contacts.csv', import.meta.url), 'utf8'));
const libraryText = readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8');
const library = parseLibrary(libraryText);
const results = pipeline(rows, library, { asOf: AS_OF });

const emailed = results.filter(r => r.outcome !== 'Suppressed');
const byId = new Map(results.map(r => [r.contact_id, r]));

test('all 416 emailed contacts get a subject and a first-touch body', () => {
  assert.equal(emailed.length, 416);
  for (const r of emailed) {
    assert.ok(r.subject, r.contact_id);
    assert.match(r.step1_body, /^Hi \S+,\n\n/, r.contact_id);
  }
  for (const r of results.filter(r => r.outcome === 'Suppressed')) assert.equal(r.step1_body, undefined, r.contact_id);
});

// A fresh copy of the real library to break on purpose, so each test starts from the frozen one.
const freshLibrary = () => parseLibrary(libraryText);

test('a snippet ID the router asks for that is missing from the library fails the run loudly', () => {
  const broken = freshLibrary();
  delete broken.snippets['cta.floor'];
  assert.throws(() => pipeline(rows, broken, { asOf: AS_OF }), /Snippet "cta\.floor" is missing/);
});

const failedChecks = r => r.checks.filter(c => !c.ok).map(c => c.check);
const sequenceIds = r => [...(r.step1_snippet_ids ?? []), ...(r.step2_snippet_ids ?? []), ...(r.step3_snippet_ids ?? [])];
const uses = (r, id) => sequenceIds(r).some(used => used.startsWith(id + '.v'));

test('a snippet with only one variant fails the run loudly', () => {
  const broken = freshLibrary();
  broken.snippets['cta.floor'] = ['Is this on your radar this year?'];
  assert.throws(() => pipeline(rows, broken, { asOf: AS_OF }), /Snippet "cta\.floor" has no v2/);
});

test('every snippet in the library has two variants: each is rendered at v2, and a variant 2 contact gets only v2 snippets', () => {
  const renderedAtV2 = new Set(emailed.flatMap(sequenceIds).filter(id => id.endsWith('.v2')));
  for (const id of Object.keys(library.snippets)) assert.ok(renderedAtV2.has(`${id}.v2`), id);
  for (const r of emailed.filter(r => r.variant === 2)) {
    for (const id of sequenceIds(r)) assert.match(id, /\.v2$/, r.contact_id);
  }
});

test('a banned phrase in a snippet holds every contact whose email uses it, naming the check', () => {
  const broken = freshLibrary();
  broken.snippets['bridge.scaling_fast.employee_requests'] = Array(2).fill('Congrats on the growth: more questions are landing on HR.');
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => uses(r, 'bridge.scaling_fast.employee_requests'));
  assert.ok(affected.length > 0);
  for (const r of affected) {
    assert.equal(r.held, true, r.contact_id);
    assert.ok(failedChecks(r).includes('banned phrase'), r.contact_id);
  }
  for (const r of out.filter(r => !uses(r, 'bridge.scaling_fast.employee_requests'))) {
    assert.ok(!failedChecks(r).includes('banned phrase'), r.contact_id);
  }
});

test('the run passes when no contact is held and no pinned contact drifts', () => {
  assert.deepEqual(runFailures(results), []);
});

test('an over-long snippet fails the run, naming each held contact and its failed render check', () => {
  const broken = freshLibrary();
  broken.snippets['cta.exec'] = Array(2).fill(`Worth 20 minutes${' to see if it fits'.repeat(20)}?`);
  const failures = runFailures(pipeline(rows, broken, { asOf: AS_OF }));
  const held = failures.filter(line => line.startsWith('held '));
  assert.ok(held.length > 0);
  for (const line of held) assert.match(line, /^held C\d+: .*word cap/);
});

test('an over-long snippet pushes every email that uses it over 90 words, held under the word cap check', () => {
  const broken = freshLibrary();
  broken.snippets['cta.exec'] = Array(2).fill(`Worth 20 minutes${' to see if it fits'.repeat(20)}?`);
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => uses(r, 'cta.exec'));
  assert.ok(affected.length > 0);
  for (const r of affected) {
    assert.ok(r.step1_words > 90, r.contact_id);
    assert.equal(r.held, true, r.contact_id);
    assert.ok(failedChecks(r).includes('word cap'), r.contact_id);
  }
});

test('a system of record with no display name leaves an empty slot, held under the empty slot check', () => {
  const broken = freshLibrary();
  delete broken.system_of_record_names.BambooHR;
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => r.system_of_record === 'BambooHR' && (uses(r, 'lead.sor.hris') || uses(r, 'support.sor.hris')));
  assert.ok(affected.length > 0);
  for (const r of affected) {
    assert.equal(r.held, true, r.contact_id);
    // Their step 2 example line names the system of record too.
    assert.deepEqual(r.checks.find(c => c.check === 'empty slot'), {
      check: 'empty slot',
      ok: false,
      detail: 'step 1: system_of_record; step 2: system_of_record',
    });
  }
});

test('a second "up to" figure, or one not attributed to Athena, is held under the up to figure check', () => {
  const broken = freshLibrary();
  broken.snippets['cta.practitioner'] = Array(2).fill('Teams like yours save up to 10 hours a week: want a 2-minute video?');
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const twoFigures = out.filter(r => uses(r, 'cta.practitioner') && uses(r, 'proof.practitioner'));
  const unattributed = out.filter(r => uses(r, 'cta.practitioner') && !uses(r, 'proof.practitioner'));
  assert.ok(twoFigures.length > 0 && unattributed.length > 0);
  for (const r of [...twoFigures, ...unattributed]) {
    assert.equal(r.held, true, r.contact_id);
    assert.ok(failedChecks(r).includes('up to figure'), r.contact_id);
  }
});

test('a blank snippet that leaves an email with no subject is held under the no silent drop check', () => {
  const broken = freshLibrary();
  broken.snippets['subject.it_service'] = ['', ''];
  const out = pipeline(rows, broken, { asOf: AS_OF }).filter(r => r.outcome !== 'Suppressed');
  const affected = out.filter(r => r.angle === 'IT Service');
  assert.ok(affected.length > 0);
  for (const r of affected) {
    assert.equal(r.held, true, r.contact_id);
    assert.ok(failedChecks(r).includes('no silent drop'), r.contact_id);
  }
});

test('no rendered email has an empty slot, a banned phrase, headline text or more than one "up to" figure', () => {
  for (const r of emailed) {
    const text = `${r.subject}\n${r.step1_body}`;
    assert.doesNotMatch(text, /[{}]/, r.contact_id);
    assert.doesNotMatch(text, /congrat|restructur|layoff|efficiency mandate|orchestration stack/i, r.contact_id);
    const row = rows.find(row => row.contact_id === r.contact_id);
    if (row.recent_news_headline) assert.ok(!text.includes(row.recent_news_headline), r.contact_id);
    assert.ok((text.match(/up to \d/gi) ?? []).length <= 1, r.contact_id);
    for (const name of ['empty slot', 'banned phrase', 'up to figure', 'no silent drop']) {
      assert.ok(r.checks.find(c => c.check === name).ok, `${r.contact_id} ${name}`);
    }
  }
});

test('no contact is held: every first touch passes every render check, the 90-word cap included', () => {
  assert.deepEqual(emailed.filter(r => r.held).map(r => r.contact_id), []);
  for (const r of emailed) assert.ok(r.step1_words <= 90, `${r.contact_id} ${r.step1_words} words`);
});

test('C1031 and C1068, at 92 words in the prototype, are now at most 90 words', () => {
  for (const id of ['C1031', 'C1068']) {
    assert.equal(byId.get(id).band, 'Practitioner', id);
    assert.ok(byId.get(id).step1_words <= 90, `${id} ${byId.get(id).step1_words} words`);
  }
});

// Operating Reset copy stays oblique: never the efficiency mandate, layoffs or cost cuts. A stranger who names a
// company's cuts in a cold email reads as presumptuous, so the trigger shapes the angle without being spelled out.
const OPERATING_RESET_BANNED = /efficiency mandate|layoff|cost[- ]?cut|cut (spend|costs?)|restructur|headcount reduction/i;

test('no Operating Reset body names the efficiency mandate, layoffs or cost cuts', () => {
  const operatingReset = emailed.filter(r => r.campaign === 'Operating Reset');
  assert.equal(operatingReset.length, 61); // the Operating Reset campaign count pinned in pipeline.test.js
  for (const r of operatingReset) assert.doesNotMatch(`${r.subject}\n${r.step1_body}`, OPERATING_RESET_BANNED, r.contact_id);
});

test('an Operating Reset bridge that names cost cuts holds every contact whose email uses it', () => {
  const broken = freshLibrary();
  broken.snippets['bridge.operating_reset.it_service'] = Array(2).fill('That usually means cost cuts reach the IT queue.');
  const affected = pipeline(rows, broken, { asOf: AS_OF }).filter(r => uses(r, 'bridge.operating_reset.it_service'));
  assert.ok(affected.length > 0);
  for (const r of affected) assert.ok(failedChecks(r).includes('banned phrase'), r.contact_id);
});

test('colleagues adjacent in rank get different variants', () => {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  const byCompany = Map.groupBy(emailed, r => rowOf.get(r.contact_id).company);
  for (const list of byCompany.values()) {
    const ranked = list.toSorted((a, b) => a.rank_in_company - b.rank_in_company);
    for (let i = 1; i < ranked.length; i++) assert.notEqual(ranked[i].variant, ranked[i - 1].variant, ranked[i].contact_id);
  }
  // C1031 (rank 4) and C1440 (rank 2) have even ranks, so both get variant 2.
  assert.equal(byId.get('C1031').subject, 'employee requests at Halcyon Stack');
  assert.equal(byId.get('C1440').step1_snippet_ids[1], 'lead.sor.workday.v2');
});

test('a floor email has no bridge, supporting or proof line and ends on the floor CTA (C1451)', () => {
  const r = byId.get('C1451');
  assert.deepEqual(r.step1_snippet_ids, ['subject.it_service.v1', 'floor.it_service.v1', 'mechanism.it_service.practitioner.v1', 'cta.floor.v1']);
  assert.match(r.step1_body, /companies the size of Anvil People Group/);
});

test('{when} turns the trigger date into a loose phrase, never a date (C1031, trigger in early 2026)', () => {
  assert.match(byId.get('C1031').step1_body, /A new US office for Halcyon Stack earlier this year/);
  for (const r of emailed) assert.doesNotMatch(r.step1_body, /\b20\d\d\b/, r.contact_id);
});
