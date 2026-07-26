// Slices src/notamb.ts #region blocks into every copy-paste variant and writes
// dist/ (configurator site + variants.json). The source file is the single
// truth; nothing generated is checked in.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(root + 'src/notamb.ts', 'utf8');
// package.json is the only place the version lives; bumping it is the release.
const VERSION = JSON.parse(readFileSync(root + 'package.json', 'utf8')).version;
// Order fixes the variant keys, so it must match TRACKERS in src/site/main.js.
const TRACKERS = ['ga4', 'umami', 'umami-shopify', 'shopify-cart'];

function region(name) {
  const re = new RegExp(`// #region ${name}\\n([\\s\\S]*?)// #endregion`);
  const m = SRC.match(re);
  if (!m) throw new Error(`region "${name}" missing from src/notamb.ts`);
  return m[1].trimEnd();
}

// Non-empty subsets, order fixed by TRACKERS.
function subsets(list) {
  const out = [];
  for (let mask = 1; mask < 1 << list.length; mask++) {
    out.push(list.filter((_, i) => mask & (1 << i)));
  }
  return out;
}

function header({ format, lang, hook, trackers, min }) {
  const bits = [format === 'module' ? 'es module' : 'inline script', lang, trackers.join(' + ')];
  if (hook) bits.push('react hook');
  if (min) bits.push('minified');
  return [
    '/*!',
    ` * notamb v${VERSION} — sticky A/B bucketing (${bits.join(' · ')})`,
    ' * © 2026 NoTambourine — MIT license',
    ' * generated at https://notamb.notambourine.com · source: https://github.com/notambourine/notamb',
    ' */',
    '',
  ].join('\n');
}

function wrapIife(body) {
  const indented = body
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n');
  return `(function () {\n${indented}\n\n  window.notamb = notamb;\n})();`;
}

async function buildVariant(opt) {
  const parts = [];
  if (opt.hook) parts.push(region('import:hook'));
  parts.push(region('decl'));
  for (const t of opt.trackers) parts.push(region('emitter:' + t));
  parts.push(region('core'));
  if (opt.hook) parts.push(region('hook'));

  let code = parts.join('\n\n');
  if (opt.format === 'module') {
    code += `\n\nexport { notamb${opt.hook ? ', useNotamb' : ''} };`;
  } else {
    code = wrapIife(code);
  }
  code += '\n';

  if (opt.lang === 'js') {
    code = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext },
    }).outputText;
  }
  if (opt.min) {
    code = (await transform(code, { loader: 'js', minify: true, legalComments: 'none' })).code;
  }

  code = header(opt) + code;
  if (opt.format === 'inline') code = `<script>\n${code}</script>\n`;
  return code;
}

const variants = {};
for (const format of ['module', 'inline']) {
  for (const lang of format === 'inline' ? ['js'] : ['js', 'ts']) {
    for (const hook of format === 'inline' ? [false] : [false, true]) {
      for (const trackers of subsets(TRACKERS)) {
        for (const min of lang === 'ts' ? [false] : [false, true]) {
          const key = [
            format,
            lang,
            hook ? 'hook' : 'plain',
            trackers.join('+'),
            min ? 'min' : 'pretty',
          ].join('.');
          variants[key] = await buildVariant({ format, lang, hook, trackers, min });
        }
      }
    }
  }
}

rmSync(root + 'dist', { recursive: true, force: true });
mkdirSync(root + 'dist', { recursive: true });
cpSync(root + 'src/site', root + 'dist', { recursive: true });
const json = JSON.stringify({ version: VERSION, variants });
writeFileSync(root + 'dist/variants.json', json);
console.log(
  `built ${Object.keys(variants).length} variants of v${VERSION} (${(json.length / 1024).toFixed(0)} KB) → dist/`,
);
