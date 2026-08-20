import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CircleDot, TrendingUp, TrendingDown, DollarSign, Info, Check, X as XIcon, Bot } from 'lucide-react';
import { StockData } from '@/lib/stockData';

interface OptionsWheelProps {
  data: StockData[];
  symbol: string;
}

// Standard normal CDF (Abramowitz & Stegun approximation)
function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

// Black-Scholes premium
function bsPrice(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0) return Math.max(isCall ? S - K : K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return isCall
    ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2)
    : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

// Delta
function bsDelta(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0 || sigma <= 0) return isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return isCall ? normCdf(d1) : normCdf(d1) - 1;
}

interface WheelAnalysis {
  price: number;
  iv: number;
  hv: number;
  putStrike: number;
  putPremium: number;
  putDelta: number;
  putYield: number;
  putAnnualYield: number;
  callStrike: number;
  callPremium: number;
  callDelta: number;
  callYield: number;
  callAnnualYield: number;
  breakeven: number;
  capitalRequired: number;
  suitability: 'excellent' | 'good' | 'fair' | 'poor';
  suitabilityScore: number;
  reasons: string[];
}

function analyzeWheel(data: StockData[], dte: number, putDeltaTarget: number, callDeltaTarget: number): WheelAnalysis | null {
  if (data.length < 60) return null;

  const price = data[data.length - 1].close;
  // Realized (historical) volatility from last 30 daily log returns, annualized
  const window = data.slice(-30);
  const rets: number[] = [];
  for (let i = 1; i < window.length; i++) {
    rets.push(Math.log(window[i].close / window[i - 1].close));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const hv = Math.sqrt(variance * 252);
  // Approximate IV as HV * 1.15 (options typically trade at a small vol premium)
  const iv = hv * 1.15;

  const T = dte / 365;
  const r = 0.045;

  // Find strike matching target delta by search
  const findStrike = (targetDelta: number, isCall: boolean): number => {
    let lo = price * 0.5, hi = price * 1.5;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const d = Math.abs(bsDelta(price, mid, T, r, iv, isCall));
      if (d > targetDelta) {
        // delta too high -> for put, move strike lower; for call, move strike higher
        if (isCall) lo = mid; else hi = mid;
      } else {
        if (isCall) hi = mid; else lo = mid;
      }
    }
    return (lo + hi) / 2;
  };

  const putStrike = Math.round(findStrike(putDeltaTarget, false) * 2) / 2;
  const callStrike = Math.round(findStrike(callDeltaTarget, true) * 2) / 2;

  const putPremium = bsPrice(price, putStrike, T, r, iv, false);
  const callPremium = bsPrice(price, callStrike, T, r, iv, true);
  const putDelta = bsDelta(price, putStrike, T, r, iv, false);
  const callDelta = bsDelta(price, callStrike, T, r, iv, true);

  const putYield = (putPremium / putStrike) * 100;
  const callYield = (callPremium / price) * 100;
  const putAnnualYield = putYield * (365 / dte);
  const callAnnualYield = callYield * (365 / dte);
  const breakeven = putStrike - putPremium;
  const capitalRequired = putStrike * 100;

  // Suitability scoring
  let score = 50;
  const reasons: string[] = [];

  // IV: moderate is best (20%–50% annualized)
  if (iv >= 0.2 && iv <= 0.5) { score += 20; reasons.push(`Healthy IV ${(iv * 100).toFixed(0)}% supports premium`); }
  else if (iv > 0.5 && iv <= 0.8) { score += 10; reasons.push(`Elevated IV ${(iv * 100).toFixed(0)}% — high premium but higher assignment risk`); }
  else if (iv > 0.8) { score -= 15; reasons.push(`Very high IV ${(iv * 100).toFixed(0)}% — likely event-driven, avoid`); }
  else { score -= 10; reasons.push(`Low IV ${(iv * 100).toFixed(0)}% — premiums too thin`); }

  // Trend check: wheel prefers sideways / mild uptrend
  const priceSMA50 = data.slice(-50).reduce((a, b) => a + b.close, 0) / 50;
  const trend = (price - priceSMA50) / priceSMA50;
  if (Math.abs(trend) < 0.05) { score += 15; reasons.push('Price near 50-day average — ideal sideways regime'); }
  else if (trend > 0.05 && trend < 0.15) { score += 10; reasons.push('Mild uptrend — favourable for wheel'); }
  else if (trend < -0.1) { score -= 15; reasons.push('Downtrend — high assignment + drawdown risk'); }
  else if (trend > 0.2) { score -= 5; reasons.push('Strong uptrend — calls may be assigned early, capping gains'); }

  // Annualized yield check
  if (putAnnualYield > 15) { score += 10; reasons.push(`Attractive ${putAnnualYield.toFixed(1)}% annualized put yield`); }
  else if (putAnnualYield < 5) { score -= 10; reasons.push(`Low ${putAnnualYield.toFixed(1)}% annualized yield`); }

  score = Math.max(0, Math.min(100, score));
  const suitability: WheelAnalysis['suitability'] =
    score >= 75 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor';

  return {
    price, iv, hv,
    putStrike, putPremium, putDelta, putYield, putAnnualYield,
    callStrike, callPremium, callDelta, callYield, callAnnualYield,
    breakeven, capitalRequired,
    suitability, suitabilityScore: score, reasons,
  };
}

const suitabilityStyle = {
  excellent: 'bg-green-500/10 text-green-500 border-green-500/20',
  good: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  fair: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  poor: 'bg-red-500/10 text-red-500 border-red-500/20',
};

export function OptionsWheel({ data, symbol }: OptionsWheelProps) {
  const [dte, setDte] = useState(30);
  const [putDelta, setPutDelta] = useState(0.3);
  const [callDelta, setCallDelta] = useState(0.3);
  const [cash, setCash] = useState(20000);

  const analysis = useMemo(
    () => analyzeWheel(data, dte, putDelta, callDelta),
    [data, dte, putDelta, callDelta],
  );

  const expiryDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + dte);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [dte]);

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CircleDot className="h-5 w-5 text-primary" />
            Options Wheel Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Need at least 60 days of price history to analyze.</p>
        </CardContent>
      </Card>
    );
  }

  const fmt = (n: number, d = 2) => n.toFixed(d);
  const fmtCap = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <CircleDot className="h-5 w-5 text-primary" />
            Options Wheel — {symbol}
          </CardTitle>
          <Badge variant="outline" className={suitabilityStyle[analysis.suitability]}>
            {analysis.suitability.toUpperCase()} · {analysis.suitabilityScore}/100
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Sell cash-secured puts → get assigned → sell covered calls → repeat.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-3 rounded-lg bg-muted/40 border border-border">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Days to Expiry</span>
              <span className="font-medium">{dte}d <span className="text-muted-foreground">({expiryDate})</span></span>
            </div>
            <Slider value={[dte]} onValueChange={(v) => setDte(v[0])} min={7} max={90} step={1} />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Put Delta (target)</span>
              <span className="font-medium">{putDelta.toFixed(2)}</span>
            </div>
            <Slider value={[putDelta * 100]} onValueChange={(v) => setPutDelta(v[0] / 100)} min={10} max={50} step={1} />
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Call Delta (target)</span>
              <span className="font-medium">{callDelta.toFixed(2)}</span>
            </div>
            <Slider value={[callDelta * 100]} onValueChange={(v) => setCallDelta(v[0] / 100)} min={10} max={50} step={1} />
          </div>
          <div className="md:col-span-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">Cash on Hand (available capital)</span>
              <span className="font-medium">${cash.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <Slider
                value={[cash]}
                onValueChange={(v) => setCash(v[0])}
                min={1000}
                max={200000}
                step={1000}
                className="flex-1"
              />
              <input
                type="number"
                value={cash}
                min={0}
                step={500}
                onChange={(e) => setCash(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 h-8 rounded-md border border-border bg-background px-2 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Volatility summary */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Spot</p>
            <p className="text-lg font-semibold">${fmt(analysis.price)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">HV (30d)</p>
            <p className="text-lg font-semibold">{fmt(analysis.hv * 100, 1)}%</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">IV (est.)</p>
            <p className="text-lg font-semibold">{fmt(analysis.iv * 100, 1)}%</p>
          </div>
        </div>

        {/* Wheel legs */}
        <Tabs defaultValue="put" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="put" className="gap-1">
              <TrendingDown className="h-4 w-4" /> Step 1 · Sell Put
            </TabsTrigger>
            <TabsTrigger value="call" className="gap-1">
              <TrendingUp className="h-4 w-4" /> Step 2 · Sell Call
            </TabsTrigger>
          </TabsList>

          <TabsContent value="put" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Strike" value={`$${fmt(analysis.putStrike)}`} />
              <Metric label="Premium" value={`$${fmt(analysis.putPremium)}`} accent />
              <Metric label="Delta" value={fmt(Math.abs(analysis.putDelta), 2)} />
              <Metric label="Assign. Prob." value={`${fmt(Math.abs(analysis.putDelta) * 100, 0)}%`} />
              <Metric label="Cycle Yield" value={`${fmt(analysis.putYield, 2)}%`} />
              <Metric label="Annualized" value={`${fmt(analysis.putAnnualYield, 1)}%`} accent />
              <Metric label="Breakeven" value={`$${fmt(analysis.breakeven)}`} />
              <Metric label="Capital" value={fmtCap(analysis.capitalRequired)} />
            </div>
            <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 flex gap-2">
              <DollarSign className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Sell 1 put @ ${fmt(analysis.putStrike)} for ~${fmt(analysis.putPremium)} ({dte}d).
                Collect <b>${fmt(analysis.putPremium * 100)}</b> per contract. Assigned if {symbol} closes below ${fmt(analysis.putStrike)} at expiry.
              </span>
            </div>
          </TabsContent>

          <TabsContent value="call" className="space-y-3 mt-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Metric label="Strike" value={`$${fmt(analysis.callStrike)}`} />
              <Metric label="Premium" value={`$${fmt(analysis.callPremium)}`} accent />
              <Metric label="Delta" value={fmt(analysis.callDelta, 2)} />
              <Metric label="Assign. Prob." value={`${fmt(analysis.callDelta * 100, 0)}%`} />
              <Metric label="Cycle Yield" value={`${fmt(analysis.callYield, 2)}%`} />
              <Metric label="Annualized" value={`${fmt(analysis.callAnnualYield, 1)}%`} accent />
              <Metric label="Upside Cap" value={`$${fmt(analysis.callStrike)}`} />
              <Metric label="Max Gain" value={`${fmt(((analysis.callStrike - analysis.price + analysis.callPremium) / analysis.price) * 100, 2)}%`} />
            </div>
            <div className="text-xs text-muted-foreground bg-muted/40 rounded p-2 flex gap-2">
              <DollarSign className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                After put assignment, sell 1 call @ ${fmt(analysis.callStrike)} for ~${fmt(analysis.callPremium)} ({dte}d).
                Collect <b>${fmt(analysis.callPremium * 100)}</b>. Shares called away if {symbol} closes above ${fmt(analysis.callStrike)}.
              </span>
            </div>
          </TabsContent>
        </Tabs>

        {/* Suitability reasoning */}
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Info className="h-4 w-4 text-primary" /> Suitability factors
          </p>
          <ul className="text-xs text-muted-foreground space-y-1">
            {analysis.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Alpaca Wheel Strategy checklist */}
        <AlpacaWheelChecklist analysis={analysis} dte={dte} putDelta={putDelta} cash={cash} />

        <p className="text-xs text-muted-foreground italic">
          * Premiums estimated via Black-Scholes with IV ≈ 1.15 × 30-day realized vol and r = 4.5%.
          Not a substitute for a live options chain. Options trading carries substantial risk.
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold ${accent ? 'text-primary' : ''}`}>{value}</p>
    </div>
  );
}

interface AlpacaCriterion {
  label: string;
  pass: boolean;
  detail: string;
}

function AlpacaWheelChecklist({ analysis, dte, putDelta, cash }: { analysis: WheelAnalysis; dte: number; putDelta: number; cash: number }) {
  // Alpaca's published wheel-strategy screening rules
  // Ref: alpaca.markets/learn/options-wheel-strategy
  const price = analysis.price;
  const ivPct = analysis.iv * 100;
  const contractsAffordable = Math.floor(cash / analysis.capitalRequired);
  // Affordability is now relative to cash on hand: at least 1 contract, ideally underlying < ~25% of cash so risk isn't concentrated
  const affordable = contractsAffordable >= 1;
  const concentration = analysis.capitalRequired / Math.max(cash, 1);
  const criteria: AlpacaCriterion[] = [
    {
      label: 'Affordable vs. cash on hand (≥ 1 contract)',
      pass: affordable,
      detail: affordable
        ? `${contractsAffordable} contract${contractsAffordable > 1 ? 's' : ''} @ $${(analysis.capitalRequired / 1000).toFixed(1)}K each`
        : `Need $${(analysis.capitalRequired / 1000).toFixed(1)}K, have $${(cash / 1000).toFixed(1)}K`,
    },
    {
      label: 'Elevated IV (20–60% annualized)',
      pass: ivPct >= 20 && ivPct <= 60,
      detail: `IV ${ivPct.toFixed(1)}%`,
    },
    {
      label: 'Put delta near 0.30 (0.20–0.35 band)',
      pass: putDelta >= 0.2 && putDelta <= 0.35,
      detail: `Δ ${putDelta.toFixed(2)}`,
    },
    {
      label: 'DTE 30–45 days (Alpaca sweet spot)',
      pass: dte >= 30 && dte <= 45,
      detail: `${dte}d`,
    },
    {
      label: 'Annualized put yield ≥ 12%',
      pass: analysis.putAnnualYield >= 12,
      detail: `${analysis.putAnnualYield.toFixed(1)}%`,
    },
    {
      label: 'Not in strong downtrend (assignment cost)',
      pass: !analysis.reasons.some(r => r.toLowerCase().includes('downtrend')),
      detail: analysis.reasons.some(r => r.toLowerCase().includes('downtrend')) ? 'Downtrend flagged' : 'Neutral/up',
    },
    {
      label: 'Position concentration ≤ 50% of cash (diversification)',
      pass: concentration <= 0.5,
      detail: `${(concentration * 100).toFixed(0)}% of cash per contract`,
    },
  ];

  const passed = criteria.filter(c => c.pass).length;
  const total = criteria.length;
  const verdict =
    passed >= 6 ? { label: 'STRONG FIT', cls: 'bg-green-500/10 text-green-500 border-green-500/20' } :
    passed >= 4 ? { label: 'ACCEPTABLE', cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' } :
    passed >= 2 ? { label: 'MARGINAL', cls: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' } :
                  { label: 'POOR FIT', cls: 'bg-red-500/10 text-red-500 border-red-500/20' };

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Bot className="h-4 w-4 text-primary" /> Alpaca Wheel Strategy · Screening
        </p>
        <Badge variant="outline" className={verdict.cls}>
          {verdict.label} · {passed}/{total}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Alpaca's published wheel rules: affordable liquid names, moderate IV, ~0.30Δ puts, 30–45 DTE, avoid downtrends.
      </p>
      <ul className="text-xs space-y-1.5 mt-1">
        {criteria.map((c, i) => (
          <li key={i} className="flex items-start gap-2">
            {c.pass ? (
              <Check className="h-3.5 w-3.5 mt-0.5 text-green-500 shrink-0" />
            ) : (
              <XIcon className="h-3.5 w-3.5 mt-0.5 text-red-500 shrink-0" />
            )}
            <span className={c.pass ? 'text-foreground' : 'text-muted-foreground'}>
              {c.label}
              <span className="ml-1 text-muted-foreground">— {c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
