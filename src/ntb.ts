/*!
 * ntb — sticky A/B bucketing that reports to your analytics
 * © 2026 NoTambourine — MIT license
 * https://ntb.notambourine.com · https://github.com/notambourine/ntb
 */
// Canonical source. `npm run build` slices the #region blocks below into
// every copy-paste variant served at https://ntb.notambourine.com — pick
// format, language, trackers, and minification there instead of vendoring
// this file wholesale.

// #region import:hook
import { useState } from 'react';
// #endregion

// #region decl
type Emitter = (test: string, variant: string) => void;

// One entry per tracker; ntb() fans each exposure out to all of them.
const emitters: Emitter[] = [];
// #endregion

// #region emitter:ga4
// GA4 — a plain dataLayer push, readable by gtag.js and GTM alike. Register
// ntb_test / ntb_variant as custom dimensions (or map them in GTM) to report
// on ab_assigned.
// https://developers.google.com/analytics/devguides/collection/ga4/integration
emitters.push((test, variant) => {
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({ event: 'ab_assigned', ntb_test: test, ntb_variant: variant });
});
// #endregion

// #region emitter:umami-shopify
// Shopify theme + the umami-shopify custom pixel: every 'umami:ab' publish
// becomes one ab_assigned event in Umami, sequenced after the pageview.
// https://github.com/notambourine/umami-shopify
emitters.push((test, variant) => {
  const s = (window as any).Shopify;
  if (s && s.analytics && s.analytics.publish) {
    s.analytics.publish('umami:ab', { test: test, variant: variant });
  }
});
// #endregion

// #region emitter:shopify-cart
// Shopify theme — stamps the variant onto the cart as a private attribute, so
// it rides through checkout onto the order. Read it back from the order's
// customAttributes for revenue per variant.
//
// The '__' prefix makes the attribute private: Shopify keeps it out of Liquid
// and out of the Ajax API, so there's nothing to hide in your theme and page
// caching still works. The cost is you can't read it back in the browser
// either, so this remembers what it sent in sessionStorage.
//
// Once per session rather than once per pageview: every cart write clears the
// browser's prefetch cache, which slows navigation on themes that prefetch.
// A session memo also re-stamps a visitor who comes back with a fresh cart,
// without the snippet having to know anything about cart tokens.
//
// This stamps whether or not a cart exists yet — the request creates an empty
// one. Waiting for a cart would miss everyone who lands, adds, and checks out
// on a single pageview, and that group is exactly the one a winning variant
// grows.
const cartWrites: Record<string, string> = {};
let cartTimer: ReturnType<typeof setTimeout> | undefined;

emitters.push((test, variant) => {
  // Read up front so a server render throws here and the caller skips this
  // emitter, rather than crashing later inside the timer.
  const s = (window as any).Shopify;
  const root = (s && s.routes && s.routes.root) || '/';

  try {
    if (sessionStorage.getItem('ntb:cart:' + test) === variant) return;
  } catch {
    // storage blocked — stamp every pageview rather than not at all
  }

  cartWrites[test] = variant;
  clearTimeout(cartTimer);
  // Collect every test bucketed on this pageview into a single request.
  cartTimer = setTimeout(() => {
    const attributes: Record<string, string> = {};
    for (const t in cartWrites) attributes['__ntb_' + t] = cartWrites[t];
    fetch(root + 'cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Attributes merge, so sending only ntb keys leaves your own alone.
      body: JSON.stringify({ attributes: attributes }),
    })
      .then((res) => {
        // A 4xx/5xx settles the promise too, so check before marking it sent.
        if (!res.ok) return;
        try {
          for (const t in cartWrites) sessionStorage.setItem('ntb:cart:' + t, cartWrites[t]);
        } catch {
          // best effort — a lost memo costs one redundant write next pageview
        }
      })
      .catch(() => {
        // network error — leave the memo unset so the next pageview retries
      });
  }, 0);
});
// #endregion

// #region emitter:umami
// Umami script tag — window.umami appears only once the (usually deferred)
// script runs, so poll briefly instead of assuming load order.
emitters.push((test, variant) => {
  let tries = 40;
  const send = () => {
    const u = (window as any).umami;
    if (u && u.track) u.track('ab_assigned', { test: test, variant: variant });
    else if (tries--) setTimeout(send, 250);
  };
  send();
});
// #endregion

// #region core
// One exposure per test per window: SPA route changes don't re-publish; a
// fresh page load does. Count unique visitors per variant when analyzing,
// not raw events.
const exposed = new Set<string>();

/**
 * Bucket this browser into a variant of `test` and report the exposure.
 * Uniform random, sticky via localStorage ('ntb:' + test). Returns the
 * 0-based variant index for your code to render against.
 */
function ntb(test: string, variants: number = 2): number {
  const key = 'ntb:' + test;
  let v = NaN;
  try {
    v = parseInt(localStorage.getItem(key) || '', 10);
  } catch {
    // storage blocked — fall through to a fresh (non-sticky) bucket
  }
  if (!(v >= 0 && v < variants)) {
    v = Math.floor(Math.random() * variants);
    try {
      localStorage.setItem(key, String(v));
    } catch {
      // best effort
    }
  }
  if (!exposed.has(test)) {
    exposed.add(test);
    for (const emit of emitters) {
      try {
        emit(test, String(v));
      } catch {
        // one tracker failing must not break the page or the other trackers
      }
    }
  }
  return v;
}
// #endregion

// #region hook
/** React hook — buckets once on first render, stable for the component's life. */
function useNtb(test: string, variants: number = 2): number {
  return useState(() => ntb(test, variants))[0];
}
// #endregion

// #region export
export { ntb, useNtb };
// #endregion
