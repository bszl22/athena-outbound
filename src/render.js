import { createHash } from 'node:crypto';
import { sequenceSkeleton } from './skeleton.js';

// Render: one routing result, its row and the snippet library to the 3-step sequence (subject and three bodies).
// Pure: no clock, no model calls. The skeleton names the snippets; render picks their variant and fills the slots.

// Body word cap per step. Body only: the greeting sits outside the count.
export const WORD_CAP = { 1: 90, 2: 50, 3: 30 };

// The greeting: the one piece of sendable text that lives in code, not the snippet library.
export const GREETING = 'Hi {first_name},';

// A loose phrase for when the trigger happened, never an exact date. Null when there is no phrase for it.
function whenPhrase(date, asOf) {
  const [year, month] = date.split('-').map(Number);
  const asOfYear = Number(asOf.slice(0, 4));
  if (year === asOfYear) return month <= 3 ? 'earlier this year' : month <= 6 ? 'this spring' : month <= 9 ? 'this summer' : 'this fall';
  return year === asOfYear - 1 ? 'late last year' : null;
}

// One rep per company, picked by a hash of the company name so it never depends on who else is emailed.
function repFor(company, reps) {
  return reps[parseInt(createHash('sha256').update(company).digest('hex').slice(0, 8), 16) % reps.length];
}

// Variant 1 or 2, alternating down the company's rank, so colleagues next to each other differ.
const variantOf = result => ((result.rank_in_company - 1) % 2) + 1;

export function renderSequence(result, row, library, { asOf }) {
  const variant = variantOf(result);
  const pick = id => {
    const variants = library.snippets[id];
    if (!variants) throw new Error(`Snippet "${id}" is missing from the library (asked for by ${result.contact_id})`);
    const text = variants[variant - 1];
    if (text === undefined) throw new Error(`Snippet "${id}" has no v${variant} (asked for by ${result.contact_id})`);
    return { id: `${id}.v${variant}`, text };
  };

  const skeleton = sequenceSkeleton(result);
  const subject = pick(skeleton.subject);
  const rep = repFor(row.company, library.reps);
  const slots = {
    first_name: row.first_name,
    company: row.company,
    system_of_record: result.system_of_record && library.system_of_record_names[result.system_of_record],
    ai_tool: result.ai_maturity_kind === 'tools' ? result.ai_maturity : null,
    when: result.trigger ? whenPhrase(row.trigger_event_date, asOf) : null,
    rep_name: rep.name,
    rep_title: rep.title,
  };
  // An unknown or empty slot is left as {name} so the empty-slot check can name it.
  const fill = text => text.replace(/\{(\w+)\}/g, (match, name) => slots[name] || match);
  slots.subject = fill(subject.text);

  const greeting = fill(GREETING);
  const signature = fill(library.signature);
  const emails = skeleton.emails.map((skeletonIds, i) => {
    const paragraphs = skeletonIds.map(ids => ids.map(pick));
    const body = paragraphs.map(snippets => snippets.map(s => fill(s.text)).join(' ')).join('\n\n');
    const first = i === 0;
    return {
      step: i + 1,
      // Follow-ups sit in the first touch's thread, so only the first touch lists the subject's snippet ID.
      subject: first ? slots.subject : fill(library.follow_up_subject),
      greeting,
      body,
      signature,
      words: body.split(/\s+/).filter(Boolean).length,
      snippetIds: [...(first ? [subject.id] : []), ...paragraphs.flat().map(s => s.id)],
    };
  });
  const checks = sequenceChecks(emails, row, library);

  return {
    variant,
    rep: rep.name,
    subject: slots.subject,
    ...Object.fromEntries(
      emails.flatMap(({ step, subject, body, snippetIds, words }) => [
        ...(step === 1 ? [] : [[`step${step}_subject`, subject]]),
        [`step${step}_body`, `${greeting}\n\n${body}\n\n${signature}`],
        [`step${step}_snippet_ids`, snippetIds],
        [`step${step}_words`, words],
      ]),
    ),
    checks,
    held: checks.some(c => !c.ok),
  };
}

// The render checks across a contact's whole sequence. The per-step checks run on every step and are recorded once,
// failing if any step fails, with the failing steps named in the detail. The "up to" figure check counts across the sequence.
function sequenceChecks(emails, row, library) {
  const perStep = emails.map(email => renderChecks(email, row, library));
  const merged = perStep[0].map(({ check }, i) => {
    const failed = perStep.flatMap((checks, s) => (checks[i].ok ? [] : [`step ${s + 1}: ${checks[i].detail}`]));
    return { check, ok: failed.length === 0, detail: failed.join('; ') };
  });
  const upTo = emails.flatMap(({ body }) => body.split(/(?<=[.?!])\s+/)).filter(sentence => /up to \d/i.test(sentence));
  const upToCheck = {
    check: 'up to figure',
    ok: upTo.length <= 1 && upTo.every(sentence => /\bAthena\b/.test(sentence)),
    detail: `${upTo.length} "up to" figure(s)`,
  };
  return [...merged.slice(0, 2), upToCheck, ...merged.slice(2), noReuseCheck(emails)];
}

// A figure is a standalone number in a body, such as the 80 in "up to 80%" or the 20 in "20 minutes".
// A number inside a word, like the 1 in "L1", is a label, not a figure.
const figuresIn = body => new Set(body.match(/\b\d+(?:[.,]\d+)?/g));

// Check 6: a follow-up never reuses a snippet ID or figure from step 1. The "Re:" subject is the thread, not a reuse.
function noReuseCheck([step1, ...followUps]) {
  const step1Figures = figuresIn(step1.body);
  const reused = followUps.flatMap(({ step, body, snippetIds }) => {
    const found = [
      ...snippetIds.filter(id => step1.snippetIds.includes(id)),
      ...[...figuresIn(body)].filter(figure => step1Figures.has(figure)).map(figure => `figure ${figure}`),
    ];
    return found.length ? [`step ${step}: ${found.join(', ')}`] : [];
  });
  return { check: 'no reuse', ok: reused.length === 0, detail: reused.join('; ') };
}

// The per-step render checks on one rendered email. Each is recorded pass or fail with a detail; any failure holds the contact.
// The signature is scanned for slots and banned phrases but sits outside the word cap and figure checks.
function renderChecks({ step, subject, greeting, body, signature, words }, row, library) {
  const text = `${subject}\n${greeting}\n${body}\n${signature}`;
  const emptySlots = [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))];
  const banned = library.banned_phrases.filter(phrase => new RegExp(phrase, 'i').test(text));
  if (row.recent_news_headline && text.includes(row.recent_news_headline)) banned.push('headline text');
  banned.push(...library.customer_names.filter(name => new RegExp(`\\b${name}\\b`).test(text)));
  return [
    { check: 'empty slot', ok: emptySlots.length === 0, detail: emptySlots.join(', ') },
    { check: 'banned phrase', ok: banned.length === 0, detail: banned.join(', ') },
    { check: 'word cap', ok: words <= WORD_CAP[step], detail: `${words} words` },
    { check: 'no silent drop', ok: Boolean(subject.trim() && body.trim()), detail: subject.trim() ? (body.trim() ? '' : 'no body') : 'no subject' },
  ];
}
