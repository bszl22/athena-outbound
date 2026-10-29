// CLI: read the contacts, run the Pipeline, write the outputs. Exits non-zero if any pinned showcase contact drifts
// or any contact is held.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseContacts } from './contacts.js';
import { parseLibrary } from './library.js';
import { pipeline } from './pipeline.js';
import { renderedCsv } from './rendered-csv.js';
import { counts } from './counts.js';
import { showcase } from './showcase.js';
import { templates } from './templates.js';
import { runFailures } from './run-failures.js';
import { simulate } from './simulate.js';
import { dashboard } from './dashboard.js';
import { AS_OF, SEED, LINKS } from './config.js';

const root = new URL('../', import.meta.url);

const rows = parseContacts(readFileSync(new URL('athena_exercise_contacts.csv', root), 'utf8'));
const library = parseLibrary(readFileSync(new URL('snippets.yaml', root), 'utf8'));
const results = pipeline(rows, library, { asOf: AS_OF });

mkdirSync(new URL('output/', root), { recursive: true });
writeFileSync(new URL('output/rendered_contacts.csv', root), renderedCsv(results, rows));
writeFileSync(new URL('output/counts.json', root), JSON.stringify(counts(results), null, 2) + '\n');
writeFileSync(new URL('showcase.md', root), showcase(results, rows, { asOf: AS_OF }));
writeFileSync(new URL('templates.md', root), templates(library));
writeFileSync(new URL('docs/index.html', root), dashboard(simulate(results, { seed: SEED }), { asOf: AS_OF, hubUrl: LINKS.repo }));

const emailed = results.filter(r => r.outcome !== 'Suppressed').length;
console.log(`as_of ${AS_OF}: ${results.length} contacts, ${emailed} emailed, ${results.length - emailed} suppressed`);
console.log('wrote output/rendered_contacts.csv, output/counts.json, showcase.md, templates.md, docs/index.html');

// The outputs are still written, so drift and held contacts show in the diff, but the run fails.
const failures = runFailures(results);
for (const line of failures) console.error(line);
if (failures.length) process.exitCode = 1;
