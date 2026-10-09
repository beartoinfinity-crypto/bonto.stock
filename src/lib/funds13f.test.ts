import { describe, expect, it } from 'vitest';
import {
  aggregatePortfolio,
  formatUsd,
  MANAGERS,
  parseInfoTable,
  pick13fFilings,
  pickInfoTableFile,
  valueScaleFor,
} from './funds13f';

describe('MANAGERS', () => {
  it('has 16 curated managers with unique CIKs', () => {
    expect(MANAGERS.length).toBe(16);
    expect(new Set(MANAGERS.map(m => m.cik)).size).toBe(16);
    expect(MANAGERS.every(m => m.cik > 0 && m.name.length > 0)).toBe(true);
  });
});

describe('pick13fFilings', () => {
  const submissions = {
    filings: {
      recent: {
        form: ['4', '13F-HR', '8-K', '13F-HR', '13F-HR/A', '13F-HR'],
        accessionNumber: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5'],
        filingDate: ['2026-09-01', '2026-08-14', '2026-07-01', '2026-05-15', '2026-04-01', '2026-02-17'],
        primaryDocument: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'],
      },
    },
  };

  it('returns the two newest original 13F-HR filings, skipping amendments', () => {
    const filings = pick13fFilings(submissions);
    expect(filings).toEqual([
      { accession: 'a1', filingDate: '2026-08-14', primaryDocument: 'p1' },
      { accession: 'a3', filingDate: '2026-05-15', primaryDocument: 'p3' },
    ]);
  });

  it('returns empty for missing/malformed submissions', () => {
    expect(pick13fFilings({})).toEqual([]);
    expect(pick13fFilings({ filings: { recent: { form: ['8-K'] } } })).toEqual([]);
    expect(pick13fFilings(null as never)).toEqual([]);
  });
});

describe('pickInfoTableFile', () => {
  it('picks the non-primary XML when names are opaque (Berkshire style)', () => {
    const index = {
      directory: {
        item: [
          { name: '0001193125-26-352200-index.html' },
          { name: '0001193125-26-352200.txt' },
          { name: '56757.xml' },
          { name: 'primary_doc.xml' },
        ],
      },
    };
    expect(pickInfoTableFile(index, 'xslForm13F_X02/primary_doc.xml')).toBe('56757.xml');
  });

  it('prefers a name that looks like an info table', () => {
    const index = {
      directory: {
        item: [{ name: 'other.xml' }, { name: 'infotable.xml' }, { name: 'form13f.xml' }],
      },
    };
    expect(pickInfoTableFile(index, 'form13f.xml')).toBe('infotable.xml');
  });

  it('returns null when there is no candidate XML', () => {
    expect(pickInfoTableFile({ directory: { item: [{ name: 'a.txt' }] } }, 'p.xml')).toBeNull();
    expect(pickInfoTableFile({}, 'p.xml')).toBeNull();
  });
});

describe('valueScaleFor', () => {
  it('dollars from 2023-01-03, thousands before', () => {
    expect(valueScaleFor('2026-08-14')).toBe(1);
    expect(valueScaleFor('2023-01-03')).toBe(1);
    expect(valueScaleFor('2023-01-02')).toBe(1000);
    expect(valueScaleFor('2021-05-14')).toBe(1000);
  });
});

describe('parseInfoTable', () => {
  const xml = `<?xml version="1.0"?>
    <informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">
      <infoTable>
        <nameOfIssuer>ALLY FINL INC</nameOfIssuer>
        <cusip>02005N100</cusip>
        <value>577,211,815</value>
        <shrsOrPrnAmt><sshPrnamt>12,561,737</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
      <infoTable>
        <nameOfIssuer>APPLE INC</nameOfIssuer>
        <cusip>037833100</cusip>
        <value>30000000</value>
        <shrsOrPrnAmt><sshPrnamt>150000</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
    </informationTable>`;

  it('parses namespaced rows, stripping commas', () => {
    const rows = parseInfoTable(xml);
    expect(rows).toHaveLength(2);
    expect(rows![0]).toEqual({
      cusip: '02005N100',
      issuer: 'ALLY FINL INC',
      value: 577211815,
      shares: 12561737,
    });
    expect(rows![1].issuer).toBe('APPLE INC');
  });

  it('returns null for unparseable XML', () => {
    expect(parseInfoTable('<not-xml')).toBeNull();
  });

  it('skips entries without a CUSIP', () => {
    const rows = parseInfoTable(
      '<informationTable><infoTable><nameOfIssuer>X</nameOfIssuer></infoTable></informationTable>',
    );
    expect(rows).toEqual([]);
  });
});

describe('aggregatePortfolio', () => {
  const rows = [
    { cusip: 'AAA', issuer: 'ALPHA INC', value: 600, shares: 100 },
    { cusip: 'BBB', issuer: 'BETA INC', value: 300, shares: 50 },
    { cusip: 'AAA', issuer: 'ALPHA INC', value: 100, shares: 20 }, // duplicate cusip
  ];

  it('sums duplicates, scales, and computes percent of total', () => {
    const summary = aggregatePortfolio(rows, { scale: 1000 });
    expect(summary.total).toBe(1000000); // (600+100+300) × 1000
    expect(summary.positions).toHaveLength(2);
    expect(summary.positions[0].cusip).toBe('AAA');
    expect(summary.positions[0].value).toBe(700000);
    expect(summary.positions[0].shares).toBe(120);
    expect(summary.positions[0].pctOfPortfolio).toBeCloseTo(70);
    expect(summary.positions[1].pctOfPortfolio).toBeCloseTo(30);
    expect(summary.positions[0].isNew).toBe(false);
    expect(summary.positions[0].shareDelta).toBeNull(); // no prior → deltas null
    expect(summary.newCount).toBe(0);
    expect(summary.exitedCount).toBe(0);
  });

  it('computes qoq deltas, new and exited positions', () => {
    const prior = [
      { cusip: 'AAA', issuer: 'ALPHA INC', value: 500, shares: 90 },
      { cusip: 'CCC', issuer: 'GAMMA INC', value: 100, shares: 40 },
    ];
    const summary = aggregatePortfolio(rows, { priorRows: prior });
    const alpha = summary.positions.find(p => p.cusip === 'AAA')!;
    expect(alpha.shareDelta).toBe(30); // 120 − 90
    expect(alpha.isNew).toBe(false);
    const beta = summary.positions.find(p => p.cusip === 'BBB')!;
    expect(beta.isNew).toBe(true);
    expect(beta.shareDelta).toBeNull();
    expect(summary.newCount).toBe(1);
    expect(summary.exitedCount).toBe(1); // CCC gone
  });

  it('handles an empty book without NaN', () => {
    const summary = aggregatePortfolio([]);
    expect(summary.total).toBe(0);
    expect(summary.positions).toEqual([]);
  });
});

describe('formatUsd', () => {
  it('scales to B/M/K', () => {
    expect(formatUsd(299253556246)).toBe('$299.3B');
    expect(formatUsd(577211815)).toBe('$577.2M');
    expect(formatUsd(12400)).toBe('$12.4K');
    expect(formatUsd(950)).toBe('$950');
  });
});
