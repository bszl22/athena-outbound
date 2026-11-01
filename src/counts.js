// Outputs: the tallies the tickets are written against, committed beside the rendered CSV
// so any rule change shows which counts moved in the diff.

function tally(results, key, order) {
  const counts = Object.fromEntries(order.map(k => [k, 0]));
  for (const r of results) counts[key(r)] = (counts[key(r)] ?? 0) + 1;
  return counts;
}

const CAMPAIGNS = ['Scaling Fast', 'AI Moment', 'Operating Reset', 'Evergreen'];
const CHECKS = ['empty slot', 'banned phrase', 'up to figure', 'word cap', 'no silent drop', 'no reuse'];
const LEAD_SIGNALS = ['Trigger', 'System of record', 'AI maturity', 'Headcount trajectory', 'Floor'];

export function counts(results) {
  const emailed = results.filter(r => r.outcome !== 'Suppressed');
  const suppressed = results.filter(r => r.outcome === 'Suppressed');
  return {
    contacts: results.length,
    emailed: emailed.length,
    suppressed: tally(suppressed, r => r.suppression_reason, ['no email', 'outside buyer set', 'restructuring hold', 'shadowed IC']),
    outcome: tally(emailed, r => r.outcome, ['Emailed', 'Deprioritised']),
    campaign: tally(emailed, r => r.campaign, CAMPAIGNS),
    lead_signal_by_campaign: Object.fromEntries(
      CAMPAIGNS.map(c => [c, tally(emailed.filter(r => r.campaign === c), r => r.lead_signal, LEAD_SIGNALS)]),
    ),
    supporting_signal: tally(emailed, r => r.supporting_signal ?? 'none', [...LEAD_SIGNALS.slice(1, 4), 'none']),
    ladder_rung: tally(emailed, r => String(r.ladder_rung), ['1', '2', '3', '4']),
    send_wave: tally(emailed, r => String(r.send_wave), ['1', '2', '3']),
    rep: tally(emailed, r => r.rep, [...new Set(emailed.map(r => r.rep))].sort()),
    held: emailed.filter(r => r.held).length,
    held_by_check: Object.fromEntries(CHECKS.map(c => [c, emailed.filter(r => r.checks.some(k => k.check === c && !k.ok)).length])),
  };
}
