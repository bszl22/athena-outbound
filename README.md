# athena-outbound

A case study by Bryan Soo: outbound for Athena by Humaans, built over `athena_exercise_contacts.csv` (1,000 contacts at 100 US companies). For every contact it decides whether they are suppressed (and why) or emailed. 416 are emailed, each with a 3-step sequence assembled only from approved snippets, and the other 584 are suppressed with a reason.

- **[The dashboard](https://bszl22.github.io/athena-outbound/)**: simulated at production volume. The same page is [`docs/index.html`](docs/index.html) and opens offline.
- **[The repo](https://github.com/bszl22/athena-outbound)**: this one.

In production this logic sits in the middle of the stack: Clay → this logic → Smartlead/Instantly. Clay isn't needed here because the CSV is already enriched.

## Run it

Requires Node 22+ (see `.nvmrc`).

```bash
npm install
npm run render
```

This writes every output from the CSV and `snippets.yaml`, with `as_of` pinned to 2026-10-27, so the same inputs always give the same files:

- `output/rendered_contacts.csv`: one row per contact in send order. Emailed contacts carry their campaign, angle, band, lead and supporting signal, CTA type, send wave, rep, all 3 steps and their render checks. A Contact that fails a check is `held` and reported, never dropped or sent.
- `output/counts.json`: the tallies.
- [`showcase.md`](showcase.md): the suppression funnel, then 10 example contacts, each with the inputs its route read, the route, the email and the render checks.
- [`templates.md`](templates.md): the skeletons with their `{variables}`, one variant of every snippet, the word caps and the banned phrases.
- [`docs/index.html`](docs/index.html): the dashboard, simulated from a fixed seed (25,000 contacts, 100 inboxes × 30/day) in the pipeline's campaign × angle mix.

All of them are committed, so a rule change shows in the diff which counts moved.


## Tests

```bash
npm test
```

The 10 showcase contacts are pinned in `src/pinned.js` as regression tests. If any of them drifts from its expected route or behaviour, `npm test` fails and `npm run render` exits non-zero, after still writing the outputs so the drift shows in the diff. The deck's numbers are pinned against the same run.
