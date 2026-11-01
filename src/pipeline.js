import { routeAll } from './routing.js';
import { renderSequence } from './render.js';

// The Pipeline: the one seam the CLI and tests call.
// `library` is the snippet library; every emailed contact gets a rendered 3-step sequence from it.
export function pipeline(rows, library, { asOf }) {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  return routeAll(rows, { asOf }).map(result =>
    result.outcome === 'Suppressed' ? result : { ...result, ...renderSequence(result, rowOf.get(result.contact_id), library, { asOf }) },
  );
}
