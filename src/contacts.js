import { parse } from 'csv-parse/sync';

// Contact rows as plain objects keyed by CSV header; every value stays a string.
export function parseContacts(text) {
  return parse(text, { columns: true, skip_empty_lines: true });
}
