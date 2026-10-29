// The run's fixed inputs, shared by `npm run render` and `npm run deck`, so both read the same run.
export const AS_OF = '2026-10-27';
export const SEED = 7;

// The hub links, shared by the deck's first slide, the README test and the dashboard footer.
// A blank link isn't recorded yet: the deck shows it as "coming" and test/readme.test.js marks it todo.
export const LINKS = {
  video: '',
  dashboard: 'https://bszl22.github.io/athena-outbound/',
  slides: 'https://docs.google.com/presentation/d/1grMQLCtlleTGF5JiLakV5w9gvDni4Es23rBoZ2cl-kU/edit?usp=sharing',
  pdf: 'https://github.com/bszl22/athena-outbound/blob/main/deck.pdf',
  repo: 'https://github.com/bszl22/athena-outbound',
};
