// Asymmetric Value Screener (AVS)
// Stage 1 Universe -> Stage 2 Insider clusters (SEC Form 4) -> Stage 3 Hidden asset value (XBRL)
// -> Stage 4 Composite scoring -> Stage 5 persisted output for the dashboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SEC_UA = "StockPulse AVS research bot (contact: research@stockpulse.app)";
const LOOKBACK_DAYS = 60;
const MIN_TRADE_VALUE = 100_000;
const MIN_CLUSTER = 3;
const MIN_CLUSTER_VALUE = 500_000;
const TIME_BUDGET_MS = 110_000;

// Stage 1 - universe (non-financial large caps from the screener universe)
const UNIVERSE: { symbol: string; name: string; sector: string }[] = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corporation", sector: "Technology" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Technology" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA Corporation", sector: "Technology" },
  { symbol: "META", name: "Meta Platforms Inc.", sector: "Technology" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Technology" },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology" },
  { symbol: "INTC", name: "Intel Corporation", sector: "Technology" },
  { symbol: "ORCL", name: "Oracle Corporation", sector: "Technology" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare" },
  { symbol: "PFE", name: "Pfizer Inc.", sector: "Healthcare" },
  { symbol: "MRK", name: "Merck & Co.", sector: "Healthcare" },
  { symbol: "ABBV", name: "AbbVie Inc.", sector: "Healthcare" },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Healthcare" },
  { symbol: "XOM", name: "Exxon Mobil Corporation", sector: "Energy" },
  { symbol: "CVX", name: "Chevron Corporation", sector: "Energy" },
  { symbol: "COP", name: "ConocoPhillips", sector: "Energy" },
  { symbol: "SLB", name: "Schlumberger", sector: "Energy" },
  { symbol: "CAT", name: "Caterpillar Inc.", sector: "Industrials" },
  { symbol: "BA", name: "Boeing Company", sector: "Industrials" },
  { symbol: "GE", name: "General Electric", sector: "Industrials" },
  { symbol: "F", name: "Ford Motor Company", sector: "Consumer" },
  { symbol: "GM", name: "General Motors", sector: "Consumer" },
  { symbol: "T", name: "AT&T Inc.", sector: "Communication" },
  { symbol: "VZ", name: "Verizon Communications", sector: "Communication" },
  { symbol: "WMT", name: "Walmart Inc.", sector: "Consumer" },
  { symbol: "TGT", name: "Target Corporation", sector: "Consumer" },
  { symbol: "KO", name: "Coca-Cola Company", sector: "Consumer" },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer" },
];

async function secFetch(url: string): Promise<Response> {
  return await fetch(url, {
    headers: { "User-Agent": SEC_UA, Accept: "application/json,*/*" },
  });
}

let tickerMap: Record<string, string[]> | null = null;
const resolvedCik: Record<string, string> = {};

async function getCik(symbol: string): Promise<string | null> {
  const key = symbol.toUpperCase();
  if (resolvedCik[key]) return resolvedCik[key];

  if (!tickerMap) {
    const res = await secFetch("https://www.sec.gov/files/company_tickers.json");
    if (!res.ok) return null;
    const json = await res.json();
    tickerMap = {};
    for (const k of Object.keys(json)) {
      const row = json[k];
      const ticker = String(row.ticker).toUpperCase();
      const cik = String(row.cik_str).padStart(10, "0");
      (tickerMap[ticker] ||= []).push(cik);
    }
  }

  const candidates = tickerMap[key] ?? [];
  const cik = candidates[0] ?? null;
  if (cik) resolvedCik[key] = cik;
  return cik;
}

// Some issuers reorganize under a new holding-company CIK that has no XBRL history yet,
// so fall back to the predecessor filer for balance-sheet facts.
const FACTS_FALLBACK_CIK: Record<string, string> = { XOM: "0000034088" };

async function getFactsCik(symbol: string, primaryCik: string): Promise<{ cik: string; facts: Facts | null }> {
  let facts = await getFacts(primaryCik);
  if (latestFact(facts, "us-gaap", ["Assets"]) !== null) return { cik: primaryCik, facts };

  const key = symbol.toUpperCase();
  const alternates = [...(tickerMap?.[key] ?? []).slice(1), FACTS_FALLBACK_CIK[key]].filter(Boolean) as string[];
  for (const alt of alternates) {
    facts = await getFacts(alt);
    if (latestFact(facts, "us-gaap", ["Assets"]) !== null) return { cik: alt, facts };
  }
  return { cik: primaryCik, facts: null };
}



// ── Stage 2: insider cluster detection ──────────────────────────────
interface InsiderBuy {
  owner: string;
  title: string;
  value: number;
  date: string;
  senior: boolean;
}

function textBetween(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : null;
}

function parseForm4(xml: string): InsiderBuy | null {
  const owner = textBetween(xml, "rptOwnerName") || "Unknown";
  const isOfficer = /<isOfficer>\s*(1|true)\s*<\/isOfficer>/i.test(xml);
  const isDirector = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(xml);
  const title = (textBetween(xml, "officerTitle") || (isDirector ? "Director" : "Insider")).slice(0, 60);

  let value = 0;
  let date = "";
  const txBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) || [];
  for (const block of txBlocks) {
    const code = block.match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/)?.[1];
    if (code !== "P") continue; // open-market purchases only
    const acq = block.match(/<transactionAcquiredDisposedCode>[\s\S]*?<value>\s*([AD])\s*<\/value>/)?.[1];
    if (acq !== "A") continue;
    const shares = Number(block.match(/<transactionShares>[\s\S]*?<value>\s*([\d.]+)\s*<\/value>/)?.[1] ?? 0);
    const price = Number(block.match(/<transactionPricePerShare>[\s\S]*?<value>\s*([\d.]+)\s*<\/value>/)?.[1] ?? 0);
    const d = block.match(/<transactionDate>[\s\S]*?<value>\s*([\d-]+)\s*<\/value>/)?.[1] ?? "";
    if (shares > 0 && price > 0) {
      value += shares * price;
      if (!date) date = d;
    }
  }
  if (value <= 0) return null;
  const senior = /chief|ceo|cfo|coo|president/i.test(title);
  return { owner, title, value, date, senior };
}

async function getInsiderBuys(cik: string, maxFilings: number): Promise<InsiderBuy[]> {
  const res = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!res.ok) return [];
  const json = await res.json();
  const recent = json.filings?.recent;
  if (!recent) return [];

  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const targets: { acc: string; doc: string }[] = [];
  for (let i = 0; i < (recent.form?.length ?? 0); i++) {
    if (recent.form[i] !== "4") continue;
    if (new Date(recent.filingDate[i]).getTime() < cutoff) continue;
    targets.push({ acc: String(recent.accessionNumber[i]).replace(/-/g, ""), doc: recent.primaryDocument[i] });
    if (targets.length >= maxFilings) break;
  }

  const cikNum = String(Number(cik));
  const buys: InsiderBuy[] = [];
  for (let i = 0; i < targets.length; i += 4) {
    const chunk = targets.slice(i, i + 4);
    const parsed = await Promise.all(
      chunk.map(async (t) => {
        try {
          const r = await secFetch(`https://www.sec.gov/Archives/edgar/data/${cikNum}/${t.acc}/${t.doc}`);
          if (!r.ok) return null;
          return parseForm4(await r.text());
        } catch {
          return null;
        }
      }),
    );
    for (const p of parsed) if (p && p.value >= MIN_TRADE_VALUE) buys.push(p);
  }
  return buys;
}

// ── Stage 3: hidden asset valuation (XBRL company facts) ────────────
type Facts = Record<string, Record<string, { units: Record<string, any[]> }>>;
const factsCache = new Map<string, Facts | null>();

async function getFacts(cik: string): Promise<Facts | null> {
  if (factsCache.has(cik)) return factsCache.get(cik) ?? null;
  let facts: Facts | null = null;
  try {
    const r = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
    if (r.ok) {
      const j = await r.json();
      facts = (j?.facts ?? null) as Facts | null;
    } else {
      console.log(`companyfacts ${cik} -> ${r.status}`);
    }
  } catch (e) {
    console.log(`companyfacts ${cik} failed:`, e instanceof Error ? e.message : e);
  }
  factsCache.set(cik, facts);
  return facts;
}

function latestFact(facts: Facts | null, taxonomy: string, tags: string[]): number | null {
  if (!facts?.[taxonomy]) return null;
  for (const tag of tags) {
    const entry = facts[taxonomy][tag];
    if (!entry) continue;
    const units = Object.values(entry.units ?? {})[0] as any[];
    if (!Array.isArray(units)) continue;
    const dated = units.filter((u) => u.end).sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime());
    const val = Number(dated[0]?.val);
    if (!Number.isNaN(val) && dated.length > 0) return val;
  }
  return null;
}


async function getQuote(symbol: string, supabaseUrl: string, anonKey: string): Promise<number | null> {
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/stock-data?symbol=${symbol}&action=quote`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Number(j.price ?? j.c ?? null) || null;
  } catch {
    return null;
  }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const started = Date.now();
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let symbols: string[] | null = null;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body?.symbols)) {
        symbols = body.symbols.filter((s: unknown) => typeof s === "string" && /^[A-Z.]{1,6}$/.test(s));
      }
    }

    const universe = symbols?.length
      ? UNIVERSE.filter((u) => symbols!.includes(u.symbol))
      : UNIVERSE;

    const rows: Record<string, unknown>[] = [];
    let processed = 0;

    for (const stock of universe) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      try {
        const cik = await getCik(stock.symbol);
        if (!cik) continue;

        const [buys, factsInfo, price] = await Promise.all([
          // Large caps file dozens of Form 4s per window (mostly awards/sells); scan enough
          // of them that genuine open-market "P" purchases are not cut off by the cap.
          getInsiderBuys(cik, 60),
          getFactsCik(stock.symbol, cik),
          getQuote(stock.symbol, supabaseUrl, anonKey),
        ]);
        const facts = factsInfo.facts;
        const equity = latestFact(facts, "us-gaap", [
          "StockholdersEquity",
          "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
        ]);
        const assets = latestFact(facts, "us-gaap", ["Assets"]);
        const goodwill = latestFact(facts, "us-gaap", ["Goodwill"]);
        const intangibles = latestFact(facts, "us-gaap", [
          "IntangibleAssetsNetExcludingGoodwill",
          "FiniteLivedIntangibleAssetsNet",
        ]);
        const cash = latestFact(facts, "us-gaap", [
          "CashAndCashEquivalentsAtCarryingValue",
          "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
        ]);
        const shares =
          latestFact(facts, "dei", ["EntityCommonStockSharesOutstanding"]) ??
          latestFact(facts, "us-gaap", ["CommonStockSharesOutstanding", "CommonStockSharesIssued"]);


        // Stage 2 scoring
        const uniqueOwners = new Map<string, InsiderBuy>();
        for (const b of buys) {
          const prev = uniqueOwners.get(b.owner);
          if (prev) prev.value += b.value;
          else uniqueOwners.set(b.owner, { ...b });
        }
        const clusterBuys = Array.from(uniqueOwners.values());
        const insiderCount = clusterBuys.length;
        const insiderValue = clusterBuys.reduce((s, b) => s + b.value, 0);
        const seniorCount = clusterBuys.filter((b) => b.senior).length;
        const largest = clusterBuys.reduce((m, b) => Math.max(m, b.value), 0);

        const clusterQualifies = insiderCount >= MIN_CLUSTER && insiderValue >= MIN_CLUSTER_VALUE;
        const insiderScore = clamp(
          clamp((insiderCount / 5) * 30, 0, 30) +
            clamp((insiderValue / 5_000_000) * 30, 0, 30) +
            clamp(seniorCount * 10, 0, 20) +
            clamp((largest / 2_000_000) * 20, 0, 20),
          0,
          100,
        );

        // Stage 3 valuation
        // Negative book equity (e.g. ABBV) makes NAV/discount/P-B meaningless, so drop them.
        const usableEquity = equity !== null && equity > 0 ? equity : null;
        const marketCap = price && shares ? price * shares : null;
        const navPerShare = usableEquity && shares ? usableEquity / shares : null;
        const tangibleEquity = usableEquity !== null ? usableEquity - (goodwill ?? 0) - (intangibles ?? 0) : null;
        const tangibleNav = tangibleEquity !== null && tangibleEquity > 0 && shares ? tangibleEquity / shares : null;
        const navDiscount = navPerShare && price ? (navPerShare - price) / navPerShare : null;
        const pb = navPerShare && price ? price / navPerShare : null;
        const cashToMcap = cash && marketCap ? cash / marketCap : null;
        const assetQuality = assets && usableEquity ? usableEquity / assets : null;

        const valueScore = clamp(
          clamp(((navDiscount ?? -1) + 0.2) * 100, 0, 30) +
            clamp(pb ? (2.5 - pb) * 12 : 0, 0, 20) +
            clamp((cashToMcap ?? 0) * 100, 0, 20) +
            clamp((assetQuality ?? 0) * 60, 0, 30),
          0,
          100,
        );

        const momentumScore = clamp(
          (insiderValue > 0 ? 40 : 0) + (clusterQualifies ? 40 : 0) + (tangibleNav && price && tangibleNav > price ? 20 : 0),
          0,
          100,
        );

        const totalScore = Math.round(insiderScore * 0.5 + valueScore * 0.4 + momentumScore * 0.1);
        const classification =
          totalScore >= 80 ? "High Conviction" : totalScore >= 60 ? "Watch List" : totalScore >= 40 ? "Background" : "Ignore";
        const knowns = [equity, assets, shares, price].filter((v) => v !== null && v !== undefined).length;
        const confidence = knowns === 4 ? "High" : knowns >= 2 ? "Medium" : "Low";

        rows.push({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          price,
          market_cap: marketCap,
          insider_count: insiderCount,
          insider_value: Math.round(insiderValue),
          insider_score: Math.round(insiderScore),
          nav_per_share: navPerShare,
          tangible_nav_per_share: tangibleNav,
          nav_discount: navDiscount,
          pb_ratio: pb,
          cash_to_mcap: cashToMcap,
          value_score: Math.round(valueScore),
          momentum_score: Math.round(momentumScore),
          total_score: totalScore,
          classification,
          confidence,
          details: {
            clusterQualifies,
            seniorCount,
            insiders: clusterBuys
              .sort((a, b) => b.value - a.value)
              .slice(0, 6)
              .map((b) => ({ owner: b.owner, title: b.title, value: Math.round(b.value), date: b.date })),
            assetQuality,
            goodwill,
            intangibles,
            cash,
            equity,
            assets,
            shares,
          },
          computed_at: new Date().toISOString(),
        });
        processed++;
        factsCache.clear(); // XBRL fact payloads are multi-MB; free memory between tickers

      } catch (e) {
        console.error(`AVS failed for ${stock.symbol}:`, e instanceof Error ? e.message : e);
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase.from("avs_results").upsert(rows, { onConflict: "symbol" });
      if (error) console.error("AVS upsert error:", error.message);
    }

    return new Response(
      JSON.stringify({ success: true, processed, elapsedMs: Date.now() - started }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("AVS fatal:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: "Service temporarily unavailable" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
