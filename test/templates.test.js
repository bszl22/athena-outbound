import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLibrary } from '../src/library.js';
import { templates } from '../src/templates.js';

const libraryText = readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8');
const library = parseLibrary(libraryText);
const md = templates(library);
const shown = lines => assert.ok(md.includes(lines.join('\n')), md);

test('the trigger skeleton shows each snippet place in paragraph order', () => {
  shown(['Hi {first_name},', '', '{trigger} {bridge}', '', '{mechanism} {support} {proof}', '', '{cta}']);
});

test('the lead line and floor skeletons show their places in paragraph order, floor with no bridge, supporting or proof line', () => {
  shown(['Hi {first_name},', '', '{lead} {bridge}', '', '{mechanism} {support} {proof}', '', '{cta}']);
  shown(['Hi {first_name},', '', '{floor}', '', '{mechanism}', '', '{cta}']);
});

test('the step 2 and step 3 skeletons reply in the step 1 thread: example line then follow-up CTA, then a closing note', () => {
  shown(['Subject: Re: {subject}', '', 'Hi {first_name},', '', '{example}', '', '{followup_cta}']);
  shown(['Subject: Re: {subject}', '', 'Hi {first_name},', '', '{closing}']);
});

test('every skeleton starts from the step 1 subject and ends with the signature, slots in place', () => {
  assert.equal(md.match(/^Subject: \{subject\}$/gm).length, 3);
  assert.equal(md.match(/^\{rep_name\}$/gm).length, 5);
  shown(['{rep_title}, Athena (by Humaans)']);
});

test('every snippet type in the library has its own section, in library order', () => {
  const types = [...md.matchAll(/^### `\{(\w+)\}`/gm)].map(m => m[1]);
  assert.deepEqual(types, ['subject', 'trigger', 'bridge', 'lead', 'support', 'mechanism', 'proof', 'floor', 'cta', 'example', 'followup_cta', 'closing']);
});

test('each snippet is listed once with its first variant, slots in place, and not its second', () => {
  shown(["| `trigger.funding` | {company} raised again {when}, and a hiring push usually comes next. |"]);
  shown(['| `cta.floor` | Is this on your radar this year? |']);
  assert.ok(!md.includes('Something you are looking at this year?'));
  for (const id of Object.keys(library.snippets)) assert.equal(md.split(`| \`${id}\` |`).length, 2, id);
});

test('an edit to a snippet in snippets.yaml shows in templates.md', () => {
  const edited = parseLibrary(libraryText);
  edited.snippets['cta.floor'][0] = 'Worth a look before the year is out?';
  assert.ok(templates(edited).includes('| `cta.floor` | Worth a look before the year is out? |'));
});

test('the slots filled from the contact and its rep are named, apart from the snippet places', () => {
  for (const slot of ['{company}', '{when}', '{system_of_record}', '{ai_tool}', '{rep_name}']) assert.ok(md.includes(`\`${slot}\`,`) || md.includes(`\`${slot}\`.`), slot);
});

test('the word caps per step and the banned phrases are stated', () => {
  shown(['| Step 1: first touch | 90 |', '| Step 2: follow-up | 50 |', '| Step 3: closing note | 30 |']);
  for (const phrase of ['congrat', 'efficiency mandate', 'cut (spend|costs?)', 'who (else|should I)']) assert.ok(md.includes(`\`${phrase}\``), phrase);
  assert.ok(md.includes('Lovable'));
});
