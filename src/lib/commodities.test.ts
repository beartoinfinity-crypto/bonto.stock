import { describe, it, expect } from 'vitest';
import {
  COMMODITIES,
  GROUP_ORDER,
  exposureFor,
  groupedCommodities,
  filterCommodities,
} from './commodities';

describe('COMMODITIES universe', () => {
  it('has 30 commodities across all six groups', () => {
    expect(COMMODITIES.length).toBe(30);
    for (const group of GROUP_ORDER) {
      expect(COMMODITIES.some(c => c.group === group)).toBe(true);
    }
  });

  it('has unique Yahoo futures symbols', () => {
    const symbols = COMMODITIES.map(c => c.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('every symbol is a Yahoo continuous future (=F) and fields are populated', () => {
    for (const c of COMMODITIES) {
      expect(c.symbol.endsWith('=F')).toBe(true);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.unit.length).toBeGreaterThan(0);
      expect(GROUP_ORDER).toContain(c.group);
    }
  });

  it('the verified symbols match the probed Yahoo set', () => {
    const symbols = new Set(COMMODITIES.map(c => c.symbol));
    // symbols confirmed via v8 chart probes (LB=F/GE=F/EH=F were 404/stale)
    for (const s of ['CL=F', 'BZ=F', 'NG=F', 'TTF=F', 'HO=F', 'RB=F',
      'GC=F', 'SI=F', 'PL=F', 'PA=F', 'HG=F', 'ALI=F', 'HRC=F', 'ZNC=F',
      'ZC=F', 'ZS=F', 'ZW=F', 'ZM=F', 'ZL=F', 'ZO=F', 'ZR=F',
      'KC=F', 'CC=F', 'SB=F', 'CT=F', 'LBR=F', 'OJ=F',
      'LE=F', 'HE=F', 'GF=F']) {
      expect(symbols).toContain(s);
    }
    expect(symbols).not.toContain('LB=F');
    expect(symbols).not.toContain('GE=F');
    expect(symbols).not.toContain('EH=F');
  });
});

describe('exposureFor', () => {
  it('returns a non-empty helps/squeezes map for every commodity', () => {
    for (const c of COMMODITIES) {
      const exp = exposureFor(c.symbol);
      expect(exp, c.symbol).not.toBeNull();
      expect(exp!.helps.length).toBeGreaterThan(0);
      expect(exp!.squeezes.length).toBeGreaterThan(0);
    }
  });

  it('returns null for unknown symbols', () => {
    expect(exposureFor('NOPE=F')).toBeNull();
  });
});

describe('groupedCommodities', () => {
  it('returns sections in GROUP_ORDER with only non-empty groups', () => {
    const sections = groupedCommodities();
    expect(sections.map(s => s.group)).toEqual([...GROUP_ORDER]);
    const total = sections.reduce((sum, s) => sum + s.items.length, 0);
    expect(total).toBe(COMMODITIES.length);
  });

  it('filters a custom subset and drops empty groups', () => {
    const sections = groupedCommodities(COMMODITIES.filter(c => c.group === 'Softs'));
    expect(sections.map(s => s.group)).toEqual(['Softs']);
    expect(sections[0].items).toHaveLength(6);
  });
});

describe('filterCommodities', () => {
  it('matches symbol case-insensitively', () => {
    expect(filterCommodities('cl=f').map(c => c.symbol)).toEqual(['CL=F']);
  });

  it('matches name fragments', () => {
    const result = filterCommodities('coffee');
    expect(result.map(c => c.symbol)).toEqual(['KC=F']);
  });

  it('returns the full list for a blank query', () => {
    expect(filterCommodities('  ')).toHaveLength(COMMODITIES.length);
  });
});
