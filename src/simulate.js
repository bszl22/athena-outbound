// Dashboard data: a seeded simulation at production volume. It keeps the pipeline's campaign × angle × lead signal
// mix and scales it up; every outcome rate here is invented, so the dashboard says "simulated".

export const CAMPAIGNS = ['Scaling Fast', 'AI Moment', 'Operating Reset', 'Evergreen'];
export const ANGLES = ['Employee Requests', 'IT Service', 'Scale Without Headcount', 'Governed AI'];
export const LEAD_SIGNALS = ['Trigger', 'System of record', 'AI maturity', 'Headcount trajectory', 'Floor'];
const CONTACTS = 25000;

// Invented rates. A Contact's chance of replying to any step of their sequence, by lead signal:
// a trigger beats a company fact, which beats the floor.
const REPLY_BY_LEAD_SIGNAL = { Trigger: 0.07, 'System of record': 0.05, 'AI maturity': 0.05, 'Headcount trajectory': 0.045, 'Floor': 0.025 };
const REPLY_BY_STEP = [0.55, 0.28, 0.17]; // share of replies that come on each step
const STEPS = REPLY_BY_STEP.length;
// A bounce can only come on the first touch. One cell, picked by the seed, has an aged list: 10–13% of its first touches
// bounce, about 4% of its sends, so the guardrail has something to catch.
const AGED_LIST_BOUNCE = [0.10, 0.13];

// The guardrail: pause a cell at bounce above 3% or unsubscribe above 2%, judged once it has 100 or more sends.
export const GUARDRAIL = { bounce: 0.03, unsubscribe: 0.02, minSends: 100 };
// Sending: 100 inboxes at 30 a day, fully ramped. An inbox rests at bounce above 3% over its last 50 sends or spam
// complaints above 0.3% of its sends. Complaints are invented at 0.05% of sends.
export const INBOXES = 100;
export const SENDS_PER_INBOX_PER_DAY = 30;
export const INBOX_REST = { bounce: 0.03, window: 50, complaints: 0.003 };
const COMPLAINT_RATE = 0.0005;
const MEETING_SHARE = 0.55; // of positive replies

const overGuardrail = c =>
  c.sent >= GUARDRAIL.minSends && (c.bounced / c.sent > GUARDRAIL.bounce || c.unsubscribed / c.sent > GUARDRAIL.unsubscribe);

export const sum = (xs, key) => xs.reduce((s, x) => s + x[key], 0);

// mulberry32: a small seeded PRNG, so the same seed gives the same numbers.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Within a cell, contacts go out in a shuffled order of their lead signals.
function shuffled(xs, rnd) {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// One cell's sequences, contact by contact. A Sequence stops on any reply, bounce or unsubscribe.
// A paused cell sends nothing more, so its later contacts wait.
function runCell(leadSignals, agedList, rnd) {
  const lift = 0.85 + rnd() * 0.3;
  const [low, high] = agedList ? AGED_LIST_BOUNCE : [0.004, 0.016];
  const bounceRate = low + rnd() * (high - low);
  const unsubRate = 0.001 + rnd() * 0.003;
  const positiveShare = 0.35 + rnd() * 0.2;
  const c = { paused: false, started: 0, sent: 0, bounced: 0, unsubscribed: 0, replied: 0, positive: 0, meetings: 0, floor: 0, replied_by_step: Array(STEPS).fill(0) };
  const byLeadSignal = Object.fromEntries(LEAD_SIGNALS.map(s => [s, { started: 0, replied: 0 }]));
  for (const signal of leadSignals) {
    c.started++;
    byLeadSignal[signal].started++;
    if (signal === 'Floor') c.floor++;
    const reply = REPLY_BY_LEAD_SIGNAL[signal] * lift;
    for (let step = 0; step < STEPS; step++) {
      c.sent++;
      if (step === 0 && rnd() < bounceRate) { c.bounced++; break; }
      if (rnd() < reply * REPLY_BY_STEP[step]) {
        c.replied++;
        c.replied_by_step[step]++;
        byLeadSignal[signal].replied++;
        if (rnd() < positiveShare) {
          c.positive++;
          if (rnd() < MEETING_SHARE) c.meetings++;
        }
        break;
      }
      if (rnd() < unsubRate) { c.unsubscribed++; break; }
    }
    if (overGuardrail(c)) { c.paused = true; break; }
  }
  return { ...c, by_lead_signal: byLeadSignal };
}

// The total sends split evenly over the inboxes, each with its own last-50 bounces and complaints.
function runInboxes(sent, bounced, rnd) {
  const bounceRate = bounced / sent;
  return Array.from({ length: INBOXES }, (_, i) => {
    const inboxSent = Math.floor(sent / INBOXES) + (i < sent % INBOXES ? 1 : 0);
    let last50Bounced = 0, complaints = 0;
    for (let k = 0; k < INBOX_REST.window; k++) if (rnd() < bounceRate) last50Bounced++;
    for (let k = 0; k < inboxSent; k++) if (rnd() < COMPLAINT_RATE) complaints++;
    const resting = last50Bounced / INBOX_REST.window > INBOX_REST.bounce || complaints / inboxSent > INBOX_REST.complaints;
    return { sent: inboxSent, last_50_bounced: last50Bounced, complaints, resting };
  });
}

export function simulate(results, { seed }) {
  const rnd = prng(seed);
  const emailed = results.filter(r => r.outcome !== 'Suppressed');
  const scale = CONTACTS / emailed.length;
  const agedList = Math.floor(rnd() * CAMPAIGNS.length * ANGLES.length);
  const cells = [];
  for (const campaign of CAMPAIGNS) {
    for (const angle of ANGLES) {
      const here = emailed.filter(r => r.campaign === campaign && r.angle === angle);
      const leadSignals = LEAD_SIGNALS.flatMap(s =>
        Array(Math.round(here.filter(r => r.lead_signal === s).length * scale)).fill(s),
      );
      cells.push({ campaign, angle, contacts: leadSignals.length, ...runCell(shuffled(leadSignals, rnd), cells.length === agedList, rnd) });
    }
  }
  const leadSignalByCampaign = Object.fromEntries(CAMPAIGNS.map(campaign => [campaign, Object.fromEntries(
    LEAD_SIGNALS.map(s => {
      const here = cells.filter(x => x.campaign === campaign).map(x => x.by_lead_signal[s]);
      return [s, { started: sum(here, 'started'), replied: sum(here, 'replied') }];
    }),
  )]));
  const sent = sum(cells, 'sent');
  return {
    seed,
    cells,
    lead_signal_by_campaign: leadSignalByCampaign,
    inboxes: runInboxes(sent, sum(cells, 'bounced'), rnd),
    // Positive replies come in at the rate of one day's sends, and wait for a rep until handoff.
    handoff_waiting: Math.round(sum(cells, 'positive') * INBOXES * SENDS_PER_INBOX_PER_DAY / sent),
  };
}
