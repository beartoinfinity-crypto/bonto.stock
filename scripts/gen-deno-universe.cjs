#!/usr/bin/env node
/**
 * Regenerates supabase/functions/smart-money-scan/universe.ts from
 * src/lib/indexMembers.ts so the daily edge fn and the browser share one
 * membership source of truth (the fn can't import browser TS).
 *
 * Run after editing src/lib/indexMembers.ts (index rebalances):
 *   node scripts/gen-deno-universe.cjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/lib/indexMembers.ts'), 'utf8');

function grabArray(name) {
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const open = src.indexOf('[', start);
  const close = src.indexOf('];', open);
  const body = src.slice(open + 1, close);
  const out = [];
  const re = /\{\s*symbol:\s*'((?:\\'|[^'])*)',\s*name:\s*'((?:\\'|[^'])*)',\s*sector:\s*'((?:\\'|[^'])*)'\s*\}/g;
  let m;
  while ((m = re.exec(body))) {
    out.push({ symbol: m[1], name: m[2], sector: m[3] });
  }
  if (!out.length) throw new Error(`no rows parsed for ${name}`);
  return out;
}

const sp = grabArray('SP500_MEMBERS');
const ndx = grabArray('NASDAQ100_MEMBERS');
console.log(`parsed SP500=${sp.length} NDX=${ndx.length}`);

const q = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const rows = (arr) => arr.map(r => `  { symbol: ${q(r.symbol)}, name: ${q(r.name)}, sector: ${q(r.sector)} },`).join('\n');

const out = `// GENERATED FILE — do not edit by hand.
// Regenerate with scripts/gen-deno-universe.cjs (reads src/lib/indexMembers.ts).
// Full S&P 500 + NASDAQ-100 membership for the daily smart-money-scan edge fn.

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
