# CLAUDE.md

## Commands

- `npm test` — build, then `node --test` against `dist/variants.json` (build is inlined in the script; pretest lifecycle hooks don't fire reliably here)
- `npm run build` — slice `src/ntb.ts` into `dist/` (site + variants.json)
- `npm run lint` — eslint (flat config; typescript-eslint covers `src/ntb.ts`)
- `npm run dev` — build + `wrangler dev` (use `run_in_background: true`)
- `npm run deploy` — build + deploy to Cloudflare Workers

## Architecture

- `src/ntb.ts` is the **single canonical source**. `scripts/build.mjs` slices its `// #region` blocks into every copy-paste variant — never hand-edit generated output, and keep region markers intact when editing.
- Comments and types inside `src/ntb.ts` regions ship verbatim in user-facing snippets. Write them for the person pasting the code, not for this repo.
- Variant keys are `format.lang.hook|plain.trackers.min|pretty` — `scripts/build.mjs` and `src/site/main.js` must derive them identically (canonical tracker order: ga4, umami, umami-shopify).
- Excluded combos by design: inline+ts, inline+hook, ts+minified.
- The worker is assets-only (`wrangler.jsonc`, no `main`); `dist/` is gitignored and rebuilt on deploy.
- Tests run against the *generated* variants, not the source — what users paste is what's tested.

## Ecosystem

Sister repo `../umami-shopify` (same workspace): its custom pixel subscribes to `umami:ab` publishes, which `ntb`'s umami-shopify emitter produces. Its README references `window.ntb('hero')` — keep the API compatible (returns 0-based int, sticky, one exposure per window).

## Brand

`NoTambourine` in prose/headers, `notambourine` in slugs/URLs, `NoTambourine LLC` only in LICENSE. Never `Notambourine`.

Site styling follows the notambourine-design system (claude.ai/design project `4048ada7-2c33-491b-9230-618c8fe221b0`); `src/site/style.css` vendors a token subset of its `colors_and_type.css`. Rules that bite: dark by default (`#0B0B0C` canvas, `#141416` cards), pink `#E75A7C` is the only CTA accent (one per screen), mint `#58C9B9` is structural/success only, Roboto Black display + Montserrat accent/buttons + JetBrains Mono code, pill buttons, no gradients, no emoji in UI chrome, sentence case, no exclamation marks.
