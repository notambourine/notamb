// Slices src/ntb.ts #region blocks into every copy-paste variant and writes
// dist/ (configurator site + variants.json). The source file is the single
// truth; nothing generated is checked in.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = readFileSync(root + 'src/ntb.ts', 'utf8');
const TRACKERS = ['ga4', 'umami', 'umami-shopify'];

function region(name) {
  const re = new RegExp(`// #region ${name}\\n([\\s\\S]*?)// #endregion`);
  const m = SRC.match(re);
  if (!m) throw new Error(`region "${name}" missing from src/ntb.ts`);
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
    ` * ntb — sticky A/B bucketing (${bits.join(' · ')})`,
    ' * © 2026 NoTambourine — MIT license',
    ' * generated at https://ntb.notambourine.com · source: https://github.com/notambourine/ntb',
    ' */',
    '',
  ].join('\n');
}

function wrapIife(body) {
  const indented = body
    .split('\n')
    .map((line) => (line ? '  ' + line : line))
    .join('\n');
  return `(function () {\n${indented}\n\n  window.ntb = ntb;\n})();`;
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
    code += `\n\nexport { ntb${opt.hook ? ', useNtb' : ''} };`;
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
const json = JSON.stringify(variants);
writeFileSync(root + 'dist/variants.json', json);
console.log(`built ${Object.keys(variants).length} variants (${(json.length / 1024).toFixed(0)} KB) → dist/`);
