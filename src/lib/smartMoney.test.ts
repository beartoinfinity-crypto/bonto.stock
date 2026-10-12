import { describe, it, expect } from 'vitest';
import {
  UNIVERSE,
  computeInsiderScore,
  computeInstitutionalScore,
  computeCongressScore,
  computeSqueezeScore,
  totalScore,
  classify,
  normalizeIssuerName,
  matchUniverseByIssuer,
  parseForm4,
  edgarPrimaryDocPath,
  FAST_MANAGERS,
  INSIDER_MIN_TRADE,
  type InsiderBuy,
} from './smartMoney';

const buy = (over: Partial<InsiderBuy> = {}): InsiderBuy => ({
  owner: 'DOE JOHN',
  title: 'CEO',
  value: 250_000,
  date: '2026-09-01',
  senior: true,
  ...over,
});

describe('universe', () => {
  it('has 41 unique symbols across sectors', () => {
    expect(UNIVERSE.length).toBe(41);
    expect(new Set(UNIVERSE.map(u => u.symbol)).size).toBe(41);
  });

  it('covers at least 6 sectors and all cap tiers', () => {
    expect(new Set(UNIVERSE.map(u => u.sector)).size).toBeGreaterThanOrEqual(6);
    for (const tier of ['mega', 'large', 'mid', 'small']) {
      expect(UNIVERSE.some(u => u.capTier === tier)).toBe(true);
    }
  });
});

describe('computeInsiderScore', () => {
  it('scores 0 with no buys', () => {
    expect(computeInsiderScore([]).score).toBe(0);
  });

  it('scores 15 for a single qualifying buy', () => {
    const s = computeInsiderScore([buy({ value: INSIDER_MIN_TRADE })]);
    expect(s.score).toBe(15);
    expect(s.distinctBuyers).toBe(1);
    expect(s.totalValue).toBe(INSIDER_MIN_TRADE);
  });

  it('ignores buys below the $100K floor', () => {
    expect(computeInsiderScore([buy({ value: 50_000 })]).score).toBe(0);
  });

  it('scores 25 for a 3-buyer / $500K cluster', () => {
    const s = computeInsiderScore([
      buy({ owner: 'A', value: 200_000 }),
      buy({ owner: 'B', value: 200_000 }),
      buy({ owner: 'C', value: 200_000 }),
    ]);
    expect(s.score).toBe(25);
    expect(s.distinctBuyers).toBe(3);
    expect(s.totalValue).toBe(600_000);
  });

  it('does not count the same buyer twice toward the cluster', () => {
    const s = computeInsiderScore([
      buy({ owner: 'A', value: 300_000 }),
      buy({ owner: 'A', value: 300_000 }),
      buy({ owner: 'A', value: 300_000 }),
    ]);
    expect(s.distinctBuyers).toBe(1);
    expect(s.score).toBe(15);
  });

  it('needs both 3 buyers and $500K for the cluster score', () => {
    const s = computeInsiderScore([
      buy({ owner: 'A', value: 100_000 }),
      buy({ owner: 'B', value: 100_000 }),
      buy({ owner: 'C', value: 100_000 }),
    ]);
    expect(s.score).toBe(15); // 3 buyers but only $300K
  });
});

describe('computeInstitutionalScore', () => {
  it('scores by distinct manager count', () => {
    const h = (manager: string) => ({ manager, issuer: 'APPLE INC', value: 1e9, shares: 1e6 });
    expect(computeInstitutionalScore([]).score).toBe(0);
    expect(computeInstitutionalScore([h('Berkshire Hathaway')]).score).toBe(15);
    expect(computeInstitutionalScore([h('Berkshire Hathaway'), h('Scion')]).score).toBe(20);
    expect(
      computeInstitutionalScore([h('Berkshire Hathaway'), h('Scion'), h('Baupost')]).score,
    ).toBe(25);
  });
});

describe('computeCongressScore', () => {
  it('scores 0 with no trades', () => {
    expect(computeCongressScore([]).score).toBe(0);
  });

  it('scores 20 when any buy is disclosed', () => {
    const s = computeCongressScore([
      { type: 'SELL', date: '2026-08-01' },
      { type: 'BUY', date: '2026-07-01' },
    ]);
    expect(s.score).toBe(20);
    expect(s.buys).toBe(1);
    expect(s.sells).toBe(1);
    expect(s.latestDate).toBe('2026-08-01');
  });

  it('scores 8 for sells only', () => {
    expect(computeCongressScore([{ type: 'SELL', date: '2026-06-01' }]).score).toBe(8);
  });

  it('treats EXCHANGE/OTHER as no signal', () => {
    expect(computeCongressScore([{ type: 'OTHER', date: '2026-06-01' }]).score).toBe(0);
  });
});

describe('computeSqueezeScore', () => {
  it('applies the short-percent-of-float thresholds', () => {
    expect(computeSqueezeScore(null, null).score).toBe(0);
    expect(computeSqueezeScore(0, 0).score).toBe(0);
    expect(computeSqueezeScore(4.9, 3).score).toBe(0);
    expect(computeSqueezeScore(5, 3).score).toBe(10);
    expect(computeSqueezeScore(10, 5).score).toBe(20);
    expect(computeSqueezeScore(20, 8).score).toBe(30);
    expect(computeSqueezeScore(55.5, 12).score).toBe(30);
  });

  it('carries the raw stats through', () => {
    const s = computeSqueezeScore(12.4, 6.2);
    expect(s.shortPercentOfFloat).toBe(12.4);
    expect(s.shortRatio).toBe(6.2);
  });
});

describe('totalScore / classify', () => {
  it('sums the four components and classifies', () => {
    const ins = computeInsiderScore([buy()]);            // 15
    const inst = computeInstitutionalScore([]);          // 0
    const cong = computeCongressScore([{ type: 'BUY', date: '2026-01-01' }]); // 20
    const sqz = computeSqueezeScore(12, 5);              // 20
    expect(totalScore(ins, inst, cong, sqz)).toBe(55);
    expect(classify(55)).toBe('Watch');
    expect(classify(0)).toBe('None');
    expect(classify(30)).toBe('Light');
    expect(classify(60)).toBe('Strong');
    expect(classify(100)).toBe('Strong');
  });

  it('caps at the documented max of 100', () => {
    const max = totalScore(
      computeInsiderScore([buy({ owner: 'A' }), buy({ owner: 'B' }), buy({ owner: 'C' })]),
      computeInstitutionalScore([
        { manager: 'A', issuer: 'X', value: 1, shares: 1 },
        { manager: 'B', issuer: 'X', value: 1, shares: 1 },
        { manager: 'C', issuer: 'X', value: 1, shares: 1 },
      ]),
      computeCongressScore([{ type: 'BUY', date: '2026-01-01' }]),
      computeSqueezeScore(25, 9),
    );
    expect(max).toBe(100);
  });
});

describe('issuer-name matching', () => {
  it('normalizes corporate suffixes and punctuation', () => {
    expect(normalizeIssuerName('APPLE INC')).toBe('APPLE');
    expect(normalizeIssuerName('MICROSOFT CORP.')).toBe('MICROSOFT');
    expect(normalizeIssuerName('THE COCA-COLA COMPANY')).toBe('COCA COLA');
    expect(normalizeIssuerName('PROCTER & GAMBLE CO')).toBe('PROCTER GAMBLE');
    expect(normalizeIssuerName('BERKSHIRE HATHAWAY INC CL A')).toBe('BERKSHIRE HATHAWAY');
  });

  it('matches 13F issuers to universe tickers', () => {
    expect(matchUniverseByIssuer('APPLE INC')).toBe('AAPL');
    expect(matchUniverseByIssuer('MICROSOFT CORP')).toBe('MSFT');
    expect(matchUniverseByIssuer('EXXON MOBIL CORP')).toBe('XOM');
    expect(matchUniverseByIssuer('COCA COLA CO')).toBe('KO');
    expect(matchUniverseByIssuer('ELI LILLY & CO')).toBe('LLY');
    expect(matchUniverseByIssuer('NVIDIA CORP')).toBe('NVDA');
  });

  it('returns null for unknown or too-short issuers', () => {
    expect(matchUniverseByIssuer('SOME RANDOM ETF')).toBeNull();
    expect(matchUniverseByIssuer('3M CO')).toBeNull(); // normalizes too short
  });
});

describe('parseForm4', () => {
  const xmlFor = (code: string, shares: string, price: string, acq = 'A') => `
    <ownershipDocument>
      <reportingOwner><reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship><isOfficer>1</isOfficer><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship>
      </reportingOwner>
      <nonDerivativeTable><nonDerivativeTransaction>
        <transactionDate><value>2026-09-01</value></transactionDate>
        <transactionCoding><transactionCode>${code}</transactionCode></transactionCoding>
        <transactionAmounts>
          <transactionShares><value>${shares}</value></transactionShares>
          <transactionPricePerShare><value>${price}</value></transactionPricePerShare>
          <transactionAcquiredDisposedCode><value>${acq}</value></transactionAcquiredDisposedCode>
        </transactionAmounts>
      </nonDerivativeTransaction></nonDerivativeTable>
    </ownershipDocument>`;

  it('extracts an open-market P purchase with value and senior flag', () => {
    const buyXml = xmlFor('P', '1000', '250');
    const parsed = parseForm4(buyXml);
    expect(parsed).not.toBeNull();
    expect(parsed!.value).toBe(250_000);
    expect(parsed!.owner).toBe('DOE JANE');
    expect(parsed!.senior).toBe(true);
    expect(parsed!.date).toBe('2026-09-01');
  });

  it('ignores non-P codes (grants, sales)', () => {
    expect(parseForm4(xmlFor('A', '1000', '250'))).toBeNull(); // grant
    expect(parseForm4(xmlFor('S', '1000', '250', 'D'))).toBeNull(); // sale
    expect(parseForm4(xmlFor('M', '1000', '0'))).toBeNull(); // vest, no price
  });
});

describe('edgarPrimaryDocPath', () => {
  it('strips the xsl viewer prefix that serves HTML instead of raw XML', () => {
    expect(edgarPrimaryDocPath('xslF345X06/form4.xml')).toBe('form4.xml');
    expect(edgarPrimaryDocPath('xslF345X05/wk-form4_1791242243.xml')).toBe('wk-form4_1791242243.xml');
    expect(edgarPrimaryDocPath('form4.xml')).toBe('form4.xml');
  });
});

describe('FAST_MANAGERS', () => {
  it('keeps exactly the 10 fast-scan managers', () => {
    expect(FAST_MANAGERS.length).toBe(10);
    expect(FAST_MANAGERS.some(m => m.name.includes('Vanguard'))).toBe(false);
    expect(FAST_MANAGERS.some(m => m.name.includes('Berkshire'))).toBe(true);
  });
});
