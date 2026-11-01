// Outputs: the rendered CSV, one row per contact (all 1,000), in send order.
// Emailed contacts come first by send wave, then campaign wave order, company and rank;
// Suppressed contacts follow, by contact_id.

const CAMPAIGN_ORDER = ['Scaling Fast', 'AI Moment', 'Operating Reset', 'Evergreen'];

const COLUMNS = [
  'contact_id', 'full_name', 'title', 'company', 'department',
  'outcome', 'suppression_reason', 'recheck_date',
  'campaign', 'angle', 'band', 'lead_signal', 'supporting_signal', 'ladder_rung', 'cta_type', 'deprioritised',
  'rank_in_company', 'send_wave',
  'trigger', 'trigger_subtype', 'system_of_record', 'workday', 'ai_maturity', 'ai_maturity_kind', 'headcount_trajectory',
  'signals_used', 'signals_missing', 'why',
  'variant', 'rep',
  'subject', 'step1_body', 'step1_snippet_ids', 'step1_words',
  'step2_subject', 'step2_body', 'step2_snippet_ids', 'step2_words',
  'step3_subject', 'step3_body', 'step3_snippet_ids', 'step3_words',
  'checks', 'held',
];

// Render checks read as "word cap FAIL (91 words)", one per check.
const checkText = c => `${c.check} ${c.ok ? 'ok' : `FAIL (${c.detail})`}`;

function cell(value) {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.map(v => (typeof v === 'object' ? checkText(v) : v)).join('; ') : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sendOrder(a, b) {
  const suppressed = r => (r.outcome === 'Suppressed' ? 1 : 0);
  return (
    suppressed(a) - suppressed(b) ||
    (a.send_wave ?? 0) - (b.send_wave ?? 0) ||
    CAMPAIGN_ORDER.indexOf(a.campaign) - CAMPAIGN_ORDER.indexOf(b.campaign) ||
    (a.company < b.company ? -1 : a.company > b.company ? 1 : 0) ||
    (a.rank_in_company ?? 0) - (b.rank_in_company ?? 0) ||
    (a.contact_id < b.contact_id ? -1 : 1)
  );
}

export function renderedCsv(results, rows) {
  const rowOf = new Map(rows.map(r => [r.contact_id, r]));
  const records = results
    .map(result => {
      const { full_name, title, company, department } = rowOf.get(result.contact_id);
      return { full_name, title, company, department, ...result };
    })
    .sort(sendOrder);
  const lines = [COLUMNS.join(','), ...records.map(rec => COLUMNS.map(c => cell(rec[c])).join(','))];
  return lines.join('\n') + '\n';
}
