// Configurator: reads the option inputs, looks the combination up in
// variants.json (pre-built by scripts/build.mjs), and renders it for copy.
const TRACKERS = ['ga4', 'umami', 'umami-shopify'];

const codeEl = document.getElementById('code');
const filenameEl = document.getElementById('filename');
const hintEl = document.getElementById('hint');
const copyBtn = document.getElementById('copy');

const inputs = {
  format: () => document.querySelector('input[name="format"]:checked').value,
  lang: () => document.querySelector('input[name="lang"]:checked').value,
  trackers: () =>
    TRACKERS.filter((t) => document.querySelector(`input[name="tracker"][value="${t}"]`).checked),
  hook: () => document.querySelector('input[name="hook"]').checked,
  min: () => document.querySelector('input[name="min"]').checked,
};

function set(name, value) {
  const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (el) el.checked = true;
}

// Inline scripts can't be TS or export a hook; TS ships readable (you own
// minification in your build). Enforce by disabling the dead combinations.
function enforce() {
  const inline = inputs.format() === 'inline';
  const tsRadio = document.querySelector('input[name="lang"][value="ts"]');
  const hookBox = document.querySelector('input[name="hook"]');
  const minBox = document.querySelector('input[name="min"]');

  if (inline && inputs.lang() === 'ts') set('lang', 'js');
  if (inline && hookBox.checked) hookBox.checked = false;
  tsRadio.disabled = inline;
  hookBox.disabled = inline;

  const ts = inputs.lang() === 'ts';
  if (ts && minBox.checked) minBox.checked = false;
  minBox.disabled = ts;
}

function render() {
  enforce();
  const format = inputs.format();
  const lang = inputs.lang();
  const trackers = inputs.trackers();
  const hook = inputs.hook();
  const min = inputs.min();

  if (!trackers.length) {
    codeEl.textContent = '// pick at least one tracker';
    hintEl.textContent = '';
    return;
  }

  const key = [format, lang, hook ? 'hook' : 'plain', trackers.join('+'), min ? 'min' : 'pretty'].join('.');
  codeEl.textContent = variants[key] || `// missing variant: ${key}`;

  if (format === 'inline') {
    filenameEl.textContent = 'inline <script>';
    hintEl.textContent =
      'Paste before </head>, or into a GTM Custom HTML tag. window.ntb is global.';
  } else {
    filenameEl.textContent = lang === 'ts' ? 'ntb.ts' : 'ntb.js';
    hintEl.textContent = `Save into your source tree, then: import { ntb${hook ? ', useNtb' : ''} } from './ntb';`;
  }

  location.hash = key;
}

function restoreFromHash() {
  const key = decodeURIComponent(location.hash.slice(1));
  const [format, lang, hook, trackers, min] = key.split('.');
  if (!format || !variants[key]) return;
  set('format', format);
  set('lang', lang);
  document.querySelector('input[name="hook"]').checked = hook === 'hook';
  document.querySelector('input[name="min"]').checked = min === 'min';
  for (const t of TRACKERS) {
    document.querySelector(`input[name="tracker"][value="${t}"]`).checked = trackers
      .split('+')
      .includes(t);
  }
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(codeEl.textContent);
  copyBtn.textContent = 'Copied ✓';
  setTimeout(() => (copyBtn.textContent = 'Copy'), 1200);
});

let variants = {};
fetch('variants.json')
  .then((r) => r.json())
  .then((data) => {
    variants = data;
    restoreFromHash();
    render();
  });

document.querySelectorAll('.options input').forEach((el) => el.addEventListener('change', render));
