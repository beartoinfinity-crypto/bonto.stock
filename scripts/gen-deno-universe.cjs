#!/usr/bin/env node
/**
 * Regenerates supabase/functions/smart-money-scan/universe.ts from the two
 * browser-side membership sources so the daily edge fn and the app share one
 * source of truth (the fn can't import browser TS):
 *
 *   - src/lib/indexMembers.ts  -> SP500_MEMBERS / NASDAQ100_MEMBERS
 *   - src/lib/smartMoney.ts    -> UNIVERSE (the curated 41)
 *
 * Run after editing either file:
 *   node scripts/gen-deno-universe.cjs
 */
// (reads src/lib/indexMembers.ts + src/lib/smartMoney.ts).
//
// .cjs because package.json is "type": "module" and this script must run as
// CommonJS, same as the other scripts/*.cjs helpers.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

/** Parse `{ symbol: 'X', name: 'Y', sector: 'Z' }` rows out of a const array. */
function grabArray(src, name, label) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`missing ${name} in ${label}`);
  // Skip the type annotation — `readonly DenoMember[]` has a `[` before the
  // array literal does. Anchor on the `=` in `= [`, then find its `[`.
  const eq = src.indexOf('=', start);
  const open = src.indexOf('[', eq);
  const close = src.indexOf('];', open);
  const body = src.slice(open + 1, close);
  const out = [];
  const re = /\{\s*symbol:\s*'((?:\\'|[^'])*)',\s*name:\s*'((?:\\'|[^'])*)',\s*sector:\s*'((?:\\'|[^'])*)'/g;
  let m;
  while ((m = re.exec(body))) out.push({ symbol: m[1], name: m[2], sector: m[3] });
  if (!out.length) throw new Error(`no rows parsed for ${name}`);
  return out;
}

const membersSrc = fs.readFileSync(path.join(root, 'src/lib/indexMembers.ts'), 'utf8');
const smartSrc = fs.readFileSync(path.join(root, 'src/lib/smartMoney.ts'), 'utf8');

const sp = grabArray(membersSrc, 'SP500_MEMBERS', 'indexMembers.ts');
const ndx = grabArray(membersSrc, 'NASDAQ100_MEMBERS', 'indexMembers.ts');
const curated = grabArray(smartSrc, 'UNIVERSE', 'smartMoney.ts');
console.log(`parsed SP500=${sp.length} NDX=${ndx.length} curated=${curated.length}`);

const rows = (arr) =>
  arr.map(r => `  { symbol: ${q(r.symbol)}, name: ${q(r.name)}, sector: ${q(r.sector)} },`).join('\n');

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with scripts/gen-deno-universe.cjs
// (reads src/lib/indexMembers.ts + src/lib/smartMoney.ts).
// Membership for the daily smart-money-scan edge fn — the fn can't import
// browser TS, so these lists are duplicated here.

export interface DenoMember {
  symbol: string;
  name: string;
  sector: string;
}

export const SP500_MEMBERS: readonly DenoMember[] = [
${rows(sp)}
];

export const NASDAQ100_MEMBERS: readonly DenoMember[] = [
${rows(ndx)}
];

/** The hand-picked curated universe — scanned in full by its own leg so the
 *  page's default mode opens instantly (2 names, GME/RIVN, sit outside the
 *  index union, hence a separate universe key rather than a filtered view). */
export const CURATED_MEMBERS: readonly DenoMember[] = [
${rows(curated)}
];

/** Deduped S&P500 ∪ NASDAQ-100 (primary share classes only), sorted. */
export function buildIndexUnion(): DenoMember[] {
  const map = new Map<string, DenoMember>();
  for (const m of SP500_MEMBERS) map.set(m.symbol, { ...m });
  for (const m of NASDAQ100_MEMBERS) if (!map.has(m.symbol)) map.set(m.symbol, { ...m });
  return [...map.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}
`;

const dest = path.join(root, 'supabase/functions/smart-money-scan/universe.ts');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf8');
console.log(`wrote ${dest}`);
