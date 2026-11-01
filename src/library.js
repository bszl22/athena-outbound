import { parse } from 'yaml';

// The snippet library, as read from snippets.yaml: { snippets, reps, signature, follow_up_subject, system_of_record_names, banned_phrases, customer_names }.
export function parseLibrary(text) {
  return parse(text);
}
