// Behavioral tests run against the GENERATED variants (dist/variants.json,
// built by the pretest hook), not the canonical source — what users paste is
// what gets tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const variants = JSON.parse(
  readFileSync(new URL('../dist/variants.json', import.meta.url), 'utf8'),
);

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
// global object, setTimeout callbacks are captured for manual draining.
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
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { sandbox, timeouts, storage };
}

test('buckets in range and sticks across calls and pageloads', () => {
  const { sandbox, storage } = boot(ALL);
  const v = sandbox.ntb('hero');
  assert.ok(v === 0 || v === 1);
  assert.equal(sandbox.ntb('hero'), v);
  assert.equal(storage.backing['ntb:hero'], String(v));

  // same storage, fresh window = new pageload → same bucket
  const second = boot(ALL, { storage: makeStorage({ ...storage.backing }) });
  assert.equal(second.sandbox.ntb('hero'), v);
});

test('multi-variant tests stay in range', () => {
  const { sandbox } = boot(ALL);
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    const v = sandbox.ntb(name, 3);
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
  const v = String(sandbox.ntb('hero'));
  sandbox.ntb('hero');
  sandbox.ntb('hero');

  assert.equal(sandbox.dataLayer.length, 1);
  assert.deepEqual(plain(sandbox.dataLayer[0]), {
    event: 'ab_assigned',
    ntb_test: 'hero',
    ntb_variant: v,
  });
  assert.deepEqual(plain(published), [['umami:ab', { test: 'hero', variant: v }]]);
  assert.deepEqual(plain(tracked), [['ab_assigned', { test: 'hero', variant: v }]]);
});

test('umami emitter polls until the script shows up', () => {
  const tracked = [];
  const { sandbox, timeouts } = boot('inline.js.plain.umami.pretty');
  const v = String(sandbox.ntb('hero'));
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
  const v = sandbox.ntb('hero');
  assert.ok(v === 0 || v === 1);
});

test('out-of-range stored value rebuckets', () => {
  const { sandbox } = boot(ALL, { storage: makeStorage({ 'ntb:hero': '9' }) });
  const v = sandbox.ntb('hero');
  assert.ok(v === 0 || v === 1);
});

test('a failing tracker does not break ntb or the other trackers', () => {
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
  const v = sandbox.ntb('hero');
  assert.ok(v === 0 || v === 1);
  assert.equal(sandbox.dataLayer.length, 1);
});

test('module variant exports work, hook buckets once', () => {
  const { sandbox } = boot('module.js.hook.ga4.pretty');
  const v = sandbox.useNtb('hero');
  assert.equal(sandbox.ntb('hero'), v);
  assert.equal(sandbox.dataLayer.length, 1);
});

test('every variant carries attribution and license', () => {
  const keys = Object.keys(variants);
  assert.equal(keys.length, 56);
  for (const key of keys) {
    assert.match(variants[key], /NoTambourine/, key);
    assert.match(variants[key], /MIT license/, key);
    assert.match(variants[key], /ntb\.notambourine\.com/, key);
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
