// Behavioral tests run against the GENERATED variants (dist/variants.json,
// built by the test script), not the canonical source — what users paste is
// what gets tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const built = JSON.parse(readFileSync(new URL('../dist/variants.json', import.meta.url), 'utf8'));
const variants = built.variants;
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const ALL = 'inline.js.plain.ga4+umami+umami-shopify.pretty';

// vm-created objects have another realm's prototypes, which trips
// deepStrictEqual — normalize through JSON before comparing.
const plain = (x) => JSON.parse(JSON.stringify(x));

function makeStorage(backing = {}) {
  return {
    getItem: (k) => (k in backing ? backing[k] : null),
    setItem: (k, v) => {
      backing[k] = String(v);
    },
    backing,
  };
}

// Runs a variant in a vm context shaped like a browser page: window is the
// global object, setTimeout callbacks are captured for manual draining. Pass
// `window` in globals to override that — `{ window: undefined }` stands in for
// a server render.
function boot(key, { storage = makeStorage(), globals = {} } = {}) {
  let code = variants[key];
  assert.ok(code, `variant ${key} exists`);
  if (code.startsWith('<script>')) {
    code = code.replace(/^<script>\n/, '').replace(/<\/script>\n$/, '');
  } else {
    // module variants: strip import/export, stub useState for hook builds
    code = code
      .replace(/^import \{ useState \} from 'react';$/m, '')
      .replace(/^export \{.*\};$/m, '');
    code = "const useState = (init) => [typeof init === 'function' ? init() : init];\n" + code;
  }
  const timeouts = [];
  const sandbox = {
    localStorage: storage,
    setTimeout: (fn) => timeouts.push(fn),
    ...globals,
  };
  if (!('window' in globals)) sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, timeouts, storage };
}

test('buckets in range and sticks across calls and pageloads', () => {
  const { sandbox, storage } = boot(ALL);
  const v = sandbox.notamb('hero');
  assert.ok(v === 0 || v === 1);
  assert.equal(sandbox.notamb('hero'), v);
  assert.equal(storage.backing['notamb:hero'], String(v));

  // same storage, fresh window = new pageload → same bucket
  const second = boot(ALL, { storage: makeStorage({ ...storage.backing }) });
  assert.equal(second.sandbox.notamb('hero'), v);
});

test('multi-variant tests stay in range', () => {
  const { sandbox } = boot(ALL);
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    const v = sandbox.notamb(name, 3);
    assert.ok(v >= 0 && v < 3);
  }
});

test('one exposure per test per window, all trackers fire', () => {
  const published = [];
  const tracked = [];
  const { sandbox } = boot(ALL, {
    globals: {
      Shopify: { analytics: { publish: (name, data) => published.push([name, data]) } },
      umami: { track: (name, data) => tracked.push([name, data]) },
    },
  });
  const v = String(sandbox.notamb('hero'));
  sandbox.notamb('hero');
  sandbox.notamb('hero');

  assert.equal(sandbox.dataLayer.length, 1);
  assert.deepEqual(plain(sandbox.dataLayer[0]), {
    event: 'ab_assigned',
    notamb_test: 'hero',
    notamb_variant: v,
  });
  assert.deepEqual(plain(published), [['umami:ab', { test: 'hero', variant: v }]]);
  assert.deepEqual(plain(tracked), [['ab_assigned', { test: 'hero', variant: v }]]);
});

test('umami emitter polls until the script shows up', () => {
  const tracked = [];
  const { sandbox, timeouts } = boot('inline.js.plain.umami.pretty');
  const v = String(sandbox.notamb('hero'));
  assert.equal(tracked.length, 0);
  assert.ok(timeouts.length > 0, 'poll scheduled');

  sandbox.umami = { track: (name, data) => tracked.push([name, data]) };
  timeouts.splice(0).forEach((fn) => fn());
  assert.deepEqual(plain(tracked), [['ab_assigned', { test: 'hero', variant: v }]]);
});

test('blocked localStorage still returns a usable variant', () => {
  const throwing = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  const { sandbox } = boot(ALL, { storage: throwing });
  const v = sandbox.notamb('hero');
  assert.ok(v === 0 || v === 1);
});

test('out-of-range stored value rebuckets', () => {
  const { sandbox } = boot(ALL, { storage: makeStorage({ 'notamb:hero': '9' }) });
  const v = sandbox.notamb('hero');
  assert.ok(v === 0 || v === 1);
});

test('a failing tracker does not break notamb or the other trackers', () => {
  const { sandbox } = boot(ALL, {
    globals: {
      Shopify: {
        analytics: {
          publish: () => {
            throw new Error('boom');
          },
        },
      },
    },
  });
  const v = sandbox.notamb('hero');
  assert.ok(v === 0 || v === 1);
  assert.equal(sandbox.dataLayer.length, 1);
});

test('module variant exports work, hook buckets once', () => {
  const { sandbox } = boot('module.js.hook.ga4.pretty');
  const v = sandbox.useNotamb('hero');
  assert.equal(sandbox.notamb('hero'), v);
  assert.equal(sandbox.dataLayer.length, 1);
});

// Shapes a sandbox for the shopify-cart emitter: a session store, a fetch that
// records calls, and a timer queue that honours cancellation. A no-op
// clearTimeout would let every debounced callback fire and hide whether
// batching works at all.
function cartGlobals({ session = makeStorage(), ok = true } = {}) {
  const calls = [];
  const scheduled = new Map();
  let nextId = 1;
  return {
    calls,
    session,
    run: () => {
      const due = [...scheduled.values()];
      scheduled.clear();
      due.forEach((fn) => fn());
    },
    globals: {
      sessionStorage: session,
      setTimeout: (fn) => {
        const id = nextId++;
        scheduled.set(id, fn);
        return id;
      },
      clearTimeout: (id) => scheduled.delete(id),
      fetch: (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return Promise.resolve({ ok });
      },
    },
  };
}

const CART = 'inline.js.plain.shopify-cart.pretty';
const tick = () => new Promise((r) => setImmediate(r));

test('shopify-cart writes the variant as a private cart attribute', async () => {
  const { calls, globals, session, run } = cartGlobals();
  const { sandbox } = boot(CART, { globals });
  const v = String(sandbox.notamb('hero'));

  assert.equal(calls.length, 0, 'batched, not sent inline');
  run();
  await tick();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /cart\/update\.js$/);
  assert.deepEqual(plain(calls[0].body), { attributes: { __notamb_hero: v } });
  assert.equal(session.backing['notamb:cart:hero'], v);
});

test('shopify-cart writes once per session, not once per pageview', async () => {
  const first = cartGlobals();
  const { sandbox, storage } = boot(CART, { globals: first.globals });
  sandbox.notamb('hero');
  first.run();
  await tick();
  assert.equal(first.calls.length, 1);

  // fresh window, same localStorage + session store = a second pageview in the
  // same tab. localStorage has to carry over or the second pageview rebuckets
  // and the dedupe is correct to write again.
  const second = cartGlobals({ session: first.session });
  boot(CART, {
    globals: second.globals,
    storage: makeStorage({ ...storage.backing }),
  }).sandbox.notamb('hero');
  second.run();
  await tick();
  assert.equal(second.calls.length, 0, 'no second write this session');
});

test('shopify-cart batches several tests into one request', async () => {
  const { calls, globals, run } = cartGlobals();
  const { sandbox } = boot(CART, { globals });
  const hero = String(sandbox.notamb('hero'));
  const price = String(sandbox.notamb('price'));
  run();
  await tick();

  assert.equal(calls.length, 1, 'one POST, so one prefetch-cache clear');
  assert.deepEqual(plain(calls[0].body), {
    attributes: { __notamb_hero: hero, __notamb_price: price },
  });
});

test('shopify-cart retries next pageview when the write is rejected', async () => {
  const failed = cartGlobals({ ok: false });
  const { sandbox } = boot(CART, { globals: failed.globals });
  sandbox.notamb('hero');
  failed.run();
  await tick();
  assert.equal(failed.calls.length, 1);
  assert.deepEqual(failed.session.backing, {}, 'a 422 must not count as sent');

  const retry = cartGlobals({ session: failed.session });
  boot(CART, { globals: retry.globals }).sandbox.notamb('hero');
  retry.run();
  await tick();
  assert.equal(retry.calls.length, 1, 'sent again');
});

test('shopify-cart still stamps when sessionStorage is blocked', async () => {
  const blocked = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  const { calls, globals, run } = cartGlobals({ session: blocked });
  const { sandbox } = boot(CART, { globals });
  const v = String(sandbox.notamb('hero'));
  run();
  await tick();

  assert.deepEqual(plain(calls[0].body), { attributes: { __notamb_hero: v } });
});

test('shopify-cart is inert without a window (server render)', () => {
  const scheduled = [];
  const { sandbox } = boot('module.js.hook.shopify-cart.pretty', {
    globals: { window: undefined, setTimeout: (fn) => scheduled.push(fn) },
  });
  const v = sandbox.useNotamb('hero');
  assert.ok(v === 0 || v === 1, 'bucketing still works');
  // Bailing before the timer is the point: a scheduled callback would reach
  // for fetch on a server and take the render down.
  assert.equal(scheduled.length, 0, 'emitter skipped, nothing queued');
});

test('every variant carries attribution and license', () => {
  const keys = Object.keys(variants);
  assert.equal(keys.length, 120);
  for (const key of keys) {
    assert.match(variants[key], /NoTambourine/, key);
    assert.match(variants[key], /MIT license/, key);
    assert.match(variants[key], /notamb\.notambourine\.com/, key);
  }
});

test('the site documents and offers exactly the trackers that were built', () => {
  // Derive the tracker set from the variant keys rather than restating it, so
  // this can't drift the way the docs did.
  const built = [...new Set(Object.keys(variants).flatMap((k) => k.split('.')[3].split('+')))];
  const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

  const offered = [...html.matchAll(/name="tracker" value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...offered].sort(), [...built].sort(), 'configurator checkboxes');

  const list = html.match(/Where exposures land<\/h2>\s*<ul>([\s\S]*?)<\/ul>/);
  assert.ok(list, 'the "Where exposures land" list is still findable');
  const documented = [...list[1].matchAll(/<li>/g)].length;
  assert.equal(documented, built.length, `documented ${documented} of ${built.length} trackers`);
});

test('every variant is stamped with the package version', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(built.version, pkg.version);
  for (const key of Object.keys(variants)) {
    // Minified builds drop legal comments, but the header is prepended after
    // minification — so the stamp must survive there too.
    assert.match(variants[key], /notamb v\d+\.\d+\.\d+ — sticky A\/B bucketing/, key);
    assert.ok(variants[key].includes(`notamb v${pkg.version}`), key);
  }
});

test('language and minification actually differ', () => {
  assert.match(variants['module.ts.plain.ga4.pretty'], /: string/);
  assert.doesNotMatch(variants['module.js.plain.ga4.pretty'], /: string\b/);
  assert.ok(
    variants['module.js.plain.ga4.min'].length < variants['module.js.plain.ga4.pretty'].length,
  );
  // single-tracker build must not include the others
  assert.doesNotMatch(variants['module.js.plain.ga4.pretty'], /Shopify|umami/);
});
