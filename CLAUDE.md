# CLAUDE.md

## Commands

- `npm test` — build (pretest hook), then `node --test` against `dist/variants.json`
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
