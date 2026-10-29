// `npm run deck`: run the tests for slide 3's count, then build output/deck.pptx from the same run as `npm run render`.
// Refuses to build while any test fails, so the deck never shows numbers the tests disagree with.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseContacts } from './contacts.js';
import { parseLibrary } from './library.js';
import { pipeline } from './pipeline.js';
import { deck } from './deck.js';
import { deckPptx } from './deck-pptx.js';
import { AS_OF, LINKS } from './config.js';

const root = new URL('../', import.meta.url);

const run = spawnSync(process.execPath, ['--test'], { cwd: fileURLToPath(root), encoding: 'utf8' });
const tally = name => Number(run.stdout.match(new RegExp(`^ℹ ${name} (\\d+)$`, 'm'))?.[1]);
if (run.status !== 0 || tally('fail') !== 0) {
  process.stdout.write(run.stdout);
  console.error('npm test fails, so the deck was not built');
  process.exit(1);
}

const rows = parseContacts(readFileSync(new URL('athena_exercise_contacts.csv', root), 'utf8'));
const library = parseLibrary(readFileSync(new URL('snippets.yaml', root), 'utf8'));
const results = pipeline(rows, library, { asOf: AS_OF });
const d = deck(results, rows, library, { asOf: AS_OF, links: LINKS, tests: { total: tally('pass') } });

mkdirSync(new URL('output/', root), { recursive: true });
writeFileSync(new URL('output/deck.pptx', root), await deckPptx(d));
console.log(`wrote output/deck.pptx: ${d.slides.length} slides and ${d.appendix.length} appendix slides, ${tally('pass')} tests passing`);
const missing = Object.entries(LINKS).filter(([, url]) => !url).map(([name]) => name);
if (missing.length) console.warn(`not recorded yet in src/config.js, shown as "coming": ${missing.join(', ')}`);
