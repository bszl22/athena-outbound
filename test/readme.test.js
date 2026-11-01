import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STACK_LINE } from '../src/deck.js';
import { LINKS } from '../src/config.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

test('the README gives the stack line, the one command and how to run the tests', () => {
  assert.ok(readme.includes(STACK_LINE));
  assert.match(readme, /npm run render/);
  assert.match(readme, /npm test/);
});

// The README links only the dashboard and the repo.
for (const name of ['dashboard', 'repo']) {
  test(`the README links the ${name}`, () => {
    assert.ok(readme.includes(`](${LINKS[name]})`), `${name}: ${LINKS[name]}`);
  });
}
