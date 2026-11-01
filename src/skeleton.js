// Skeleton: one routing result to the snippet ID for every place in the contact's sequence.
// Reads the routing result only. The step 1 skeleton is chosen by lead signal; the snippets by campaign, angle and band.

const slug = s => s.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');

// The lead line or supporting line for a signal other than trigger.
function signalSnippetId(kind, signal, result) {
  if (signal === 'System of record') {
    return `${kind}.sor.${result.workday ? 'workday' : result.angle === 'IT Service' ? 'itsm' : 'hris'}`;
  }
  if (signal === 'AI maturity') return `${kind}.ai.${result.ai_maturity_kind}`;
  return `${kind}.headcount`;
}

// Step 1, grouped into the three paragraphs: [opener + Bridge] / [Mechanism + Supporting + Proof] / [CTA].
// A Floor email has no bridge, supporting or Proof.
function firstTouch(result, angle, band) {
  const mechanism = `mechanism.${angle}.${band}`;
  const cta = `cta.${result.cta_type.toLowerCase()}`;
  if (result.lead_signal === 'Floor') return [[`floor.${angle}`], [mechanism], [cta]];

  const opener =
    result.lead_signal === 'Trigger'
      ? [`trigger.${result.trigger_subtype}`, `bridge.${slug(result.campaign)}.${angle}`]
      : [
          signalSnippetId('lead', result.lead_signal, result),
          result.lead_signal === 'Headcount trajectory' ? `bridge.scaling_fast.${angle}` : `bridge.evergreen.${angle}`,
        ];
  const support = result.supporting_signal ? [signalSnippetId('support', result.supporting_signal, result)] : [];
  const proof = band === 'exec' ? 'proof.exec' : angle === 'governed_ai' ? 'proof.practitioner.governed_ai' : 'proof.practitioner';
  return [opener, [mechanism, ...support, proof], [cta]];
}

// Step 2: [Example line] / [follow-up CTA]. The example line names the system of record when it is known;
// Governed AI has none, so its example line is generic already.
function followUp(result, angle, band) {
  const example = result.system_of_record || angle === 'governed_ai' ? `example.${angle}` : `example.${angle}.generic`;
  return [[example], [`followup_cta.${band}`]];
}

// Step 3: one closing note per angle, no signals.
const closingNote = angle => [[`closing.${angle}`]];

// The subject's snippet ID, and each email's paragraphs of snippet IDs in step order.
export function sequenceSkeleton(result) {
  const angle = slug(result.angle);
  const band = result.band.toLowerCase();
  return {
    subject: `subject.${angle}`,
    emails: [firstTouch(result, angle, band), followUp(result, angle, band), closingNote(angle)],
  };
}
