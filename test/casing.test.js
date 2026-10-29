import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CAMPAIGNS, ANGLES } from '../src/simulate.js';

// Glossary terms are lowercase mid-sentence and capitalised only where they start a sentence, heading,
// table cell, list item or label. The terms are the planning repo's GLOSSARY.md; add a term here when it gains one.
// Acronyms (IC, ITSM, AI maturity) keep their capitals, and Campaign and Angle names are names, not terms.
const TERMS = [
  'Contact', 'Department', 'Buyer set', 'Angle', 'Band', 'Campaign', 'Send wave', 'Evergreen',
  'Signal', 'Trigger', 'Trigger sub-type', 'System of record', 'Headcount trajectory', 'Fallback ladder', 'Usable',
  'Hired-title clash', 'Lead Signal', 'Supporting Signal', 'Floor',
  'Suppressed', 'Re-angled', 'Deprioritised',
  'Cell', 'Guardrail', 'Inbox rest', 'Spot-check', 'Handoff',
  'Skeleton', 'Snippet', 'Bridge', 'Mechanism line', 'Lead line', 'Proof line', 'Snippet library', 'Render check', 'Held', 'Example line',
  'Sequence', 'Rep', 'Company stop',
];
const NAMES = [...CAMPAIGNS, ...ANGLES];

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const js = dir => readdirSync(new URL(dir, root)).filter(f => f.endsWith('.js')).map(f => dir + f);
// Not exported (brand, export), or breaking the rule on purpose (this file's own examples).
const SKIP = ['test/brand.test.js', 'test/export.test.js', 'test/casing.test.js'];

// The files Humaans gets, as text. The dashboard is read as its visible text, one line per tag;
// the deck .pptx is built from src/deck.js, so its strings are checked there.
const visibleText = html => html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '\n');
const FILES = {
  'README.md': read('README.md'),
  'showcase.md': read('showcase.md'),
  'templates.md': read('templates.md'),
  'snippets.yaml': read('snippets.yaml'),
  'docs/index.html': visibleText(read('docs/index.html')),
  ...Object.fromEntries([...js('src/'), ...js('test/')].filter(f => !SKIP.includes(f)).map(f => [f, read(f)])),
};

const escape = s => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
// A capitalised term straight after a lowercase word, a number, a comma, a semicolon, a colon, a bracket, a × or a ${}
// is mid-sentence. A whole term is matched first, so a term's second word (the Signal in Lead Signal) is never a hit.
const MID_SENTENCE = new RegExp(
  `([a-z0-9,;:(}×] )?(${[...TERMS].sort((a, b) => b.length - a.length).map(escape).join('|')})(?:s|'s)?\\b`, 'g');

function midSentenceCapitals(text) {
  const lines = text.split('\n');
  const masked = NAMES.reduce((t, name) => t.replaceAll(name, 'x'.repeat(name.length)), text).split('\n');
  return masked.flatMap((line, i) => [...line.matchAll(MID_SENTENCE)].filter(m => m[1])
    .map(m => `${i + 1}: ${m[0].slice(m[1].length)} in “${lines[i].trim()}”`));
}

test('the check catches a glossary term capitalised mid-sentence and passes one at the start or inside a name', () => {
  assert.deepEqual(midSentenceCapitals('Every Contact gets a Lead Signal.'), ['1: Contact in “Every Contact gets a Lead Signal.”', '1: Lead Signal in “Every Contact gets a Lead Signal.”']);
  assert.deepEqual(midSentenceCapitals('Contacts get a lead signal.\n### Trigger\n| Floor |\nLead Signal'), []);
  assert.deepEqual(midSentenceCapitals('Campaign × Angle, missing: Floor'), ['1: Angle in “Campaign × Angle, missing: Floor”', '1: Floor in “Campaign × Angle, missing: Floor”']);
  assert.deepEqual(midSentenceCapitals('leads on the Evergreen Campaign, in IT Service'), ['1: Campaign in “leads on the Evergreen Campaign, in IT Service”']);
});

for (const [file, text] of Object.entries(FILES)) {
  test(`${file} writes glossary terms lowercase mid-sentence`, () => {
    assert.deepEqual(midSentenceCapitals(text), []);
  });
}
