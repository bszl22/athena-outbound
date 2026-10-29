import { pinnedDrift } from './pinned.js';

// Why the CLI run fails: every held contact with its failed render checks, then every pinned-row drift.
// Empty means the run passes. Held contacts are flagged in the CSV, never dropped or sent.
export function runFailures(results) {
  const held = results.filter(r => r.held).map(r => {
    const failed = r.checks.filter(c => !c.ok).map(c => `${c.check} (${c.detail})`);
    return `held ${r.contact_id}: ${failed.join(', ')}`;
  });
  const drift = pinnedDrift(results).map(line => `pinned contact drifted: ${line}`);
  return [...held, ...drift];
}
