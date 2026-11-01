import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseContacts } from '../src/contacts.js';
import { parseLibrary } from '../src/library.js';
import { pipeline } from '../src/pipeline.js';
import { PINNED } from '../src/pinned.js';

// The 10 pinned showcase contacts. The same list drives showcase.md and the CLI's drift check,
// so a row that drifts fails here, in the CLI, and shows in the showcase diff.

const AS_OF = '2026-10-27';
const rows = parseContacts(readFileSync(new URL('../athena_exercise_contacts.csv', import.meta.url), 'utf8'));
const library = parseLibrary(readFileSync(new URL('../snippets.yaml', import.meta.url), 'utf8'));
const byId = new Map(pipeline(rows, library, { asOf: AS_OF }).map(r => [r.contact_id, r]));

test('the showcase pins 10 contacts in story order: four campaigns, fallbacks, floor, hired-title clash, two suppressed', () => {
  assert.deepEqual(
    PINNED.map(p => p.contact_id),
    ['C1031', 'C1463', 'C1068', 'C1440', 'C1476', 'C1964', 'C1451', 'C1735', 'C1752', 'C1132'],
  );
});

for (const [i, pinned] of PINNED.entries()) {
  test(`${i + 1}. ${pinned.contact_id}: ${pinned.story}`, () => {
    const r = byId.get(pinned.contact_id);
    const actual = Object.fromEntries(Object.keys(pinned.expect).map(key => [key, r[key]]));
    assert.deepEqual(actual, pinned.expect);
    for (const [behaviour, holds] of pinned.shows) assert.ok(holds(r, byId), behaviour);
  });
}
