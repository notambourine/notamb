# notamb

Sticky A/B bucketing for the browser, as a copy-paste snippet — not an npm install. `notamb('hero')` returns `0` or `1`, remembers the choice per browser, and reports the exposure to your analytics.

**Configure and copy at [notamb.notambourine.com](https://notamb.notambourine.com)**: ES module or inline `<script>`, JavaScript or TypeScript, optional React hook, your tracker mix, minified or readable. Every generated snippet carries its own attribution header, version stamp, and MIT license.

Sister project to [umami-shopify](https://github.com/notambourine/umami-shopify), whose custom pixel forwards `notamb`'s exposures from a Shopify theme to Umami.

## Usage

```js
const variant = notamb('hero');      // 0 or 1, sticky for this browser
if (variant === 1) document.body.classList.add('hero-b');

notamb('cta-copy', 3);               // three-way test → 0, 1, or 2
```

React (with the hook variant):

```jsx
const variant = useNotamb('hero');
```

## Semantics

- **Assignment** — uniform random over `variants` (default 2), persisted in `localStorage` under `notamb:<test>`. An out-of-range stored value (say the test shrank from 3 arms to 2) rebuckets; blocked storage falls back to a fresh bucket per pageload.
- **Exposure** — reported once per test per window. SPA route changes don't re-fire; a fresh page load does. Late-activating tests need nothing special: call `notamb()` at activation and the exposure fires then.
- **Analysis** — count unique visitors (GA4: users) per variant on `ab_assigned`, not raw events.
- **Isolation** — a throwing tracker never breaks the page or the other trackers.

## Trackers

| Tracker | What fires |
|---|---|
| GA4 | `dataLayer.push({event: 'ab_assigned', notamb_test, notamb_variant})` — readable by gtag.js and GTM; register the params as [custom dimensions](https://developers.google.com/analytics/devguides/collection/ga4/integration) |
| Umami | `umami.track('ab_assigned', {test, variant})`, with a short poll so a deferred Umami script still catches it |
| umami-shopify | `Shopify.analytics.publish('umami:ab', {test, variant})` — the [custom pixel](https://github.com/notambourine/umami-shopify) forwards each publish to Umami after the pageview settles |
| Shopify cart | `POST /cart/update.js` with a private `__notamb_<test>` attribute, so the variant rides onto the order and you can group revenue by it in the Admin API. Once per session, not per pageview. Express checkout (Buy It Now, Shop Pay) skips the cart, so those orders carry no attribute |

## Development

[`src/notamb.ts`](src/notamb.ts) is the single canonical source; `scripts/build.mjs` slices its `#region` blocks into all 120 format × language × tracker × minification variants and writes them, plus the configurator site, to `dist/`. The `version` in `package.json` is stamped into every snippet header — bumping it is the whole release.

```sh
npm ci
npm test          # builds, then runs node --test against the generated variants
npm run dev       # build + wrangler dev
npm run deploy    # build + deploy to Cloudflare Workers (notamb.notambourine.com)
```

## License

[MIT](LICENSE)
