// Stock data utilities and mock data generator

export interface StockData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Stock {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap: string;
  pe: number;
  week52High: number;
  week52Low: number;
}

export const popularStocks: Stock[] = [
  // Technology
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', price: 178.72, change: 2.34, changePercent: 1.33, volume: 52400000, marketCap: '2.8T', pe: 28.5, week52High: 199.62, week52Low: 164.08 },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', price: 378.91, change: -1.23, changePercent: -0.32, volume: 22100000, marketCap: '2.8T', pe: 35.2, week52High: 420.82, week52Low: 309.45 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', price: 141.80, change: 0.95, changePercent: 0.67, volume: 18900000, marketCap: '1.8T', pe: 24.8, week52High: 155.54, week52Low: 115.83 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Technology', price: 178.25, change: 3.12, changePercent: 1.78, volume: 45600000, marketCap: '1.9T', pe: 62.3, week52High: 201.20, week52Low: 118.35 },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', price: 495.22, change: 12.45, changePercent: 2.58, volume: 41200000, marketCap: '1.2T', pe: 65.4, week52High: 502.66, week52Low: 222.97 },
  { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', price: 505.95, change: 8.23, changePercent: 1.65, volume: 15400000, marketCap: '1.3T', pe: 28.9, week52High: 531.49, week52Low: 274.38 },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Technology', price: 248.50, change: -5.67, changePercent: -2.23, volume: 98700000, marketCap: '790B', pe: 72.1, week52High: 299.29, week52Low: 152.37 },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology', price: 142.50, change: 3.21, changePercent: 2.31, volume: 35200000, marketCap: '230B', pe: 48.2, week52High: 164.46, week52Low: 93.12 },
  { symbol: 'INTC', name: 'Intel Corporation', sector: 'Technology', price: 44.25, change: -0.45, changePercent: -1.01, volume: 28500000, marketCap: '187B', pe: 12.8, week52High: 51.28, week52Low: 29.73 },
  { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', price: 268.50, change: 4.12, changePercent: 1.56, volume: 6800000, marketCap: '260B', pe: 42.5, week52High: 318.72, week52Low: 196.87 },
  { symbol: 'ORCL', name: 'Oracle Corporation', sector: 'Technology', price: 125.80, change: 1.95, changePercent: 1.57, volume: 8200000, marketCap: '345B', pe: 22.1, week52High: 140.37, week52Low: 99.26 },
  { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', price: 545.60, change: 7.85, changePercent: 1.46, volume: 3100000, marketCap: '244B', pe: 38.9, week52High: 638.25, week52Low: 433.97 },
  
  // Financial
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial', price: 195.45, change: 1.87, changePercent: 0.97, volume: 8900000, marketCap: '565B', pe: 11.2, week52High: 200.94, week52Low: 135.19 },
  { symbol: 'BAC', name: 'Bank of America Corp', sector: 'Financial', price: 35.80, change: 0.42, changePercent: 1.19, volume: 32400000, marketCap: '280B', pe: 10.5, week52High: 38.60, week52Low: 26.32 },
  { symbol: 'WFC', name: 'Wells Fargo & Company', sector: 'Financial', price: 52.40, change: 0.68, changePercent: 1.31, volume: 15600000, marketCap: '185B', pe: 11.8, week52High: 58.82, week52Low: 38.58 },
  { symbol: 'GS', name: 'Goldman Sachs Group', sector: 'Financial', price: 385.20, change: 5.45, changePercent: 1.44, volume: 2100000, marketCap: '128B', pe: 14.2, week52High: 405.92, week52Low: 289.36 },
  { symbol: 'MS', name: 'Morgan Stanley', sector: 'Financial', price: 92.75, change: 1.12, changePercent: 1.22, volume: 7800000, marketCap: '152B', pe: 13.1, week52High: 99.86, week52Low: 72.35 },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financial', price: 275.40, change: 2.35, changePercent: 0.86, volume: 6200000, marketCap: '565B', pe: 28.4, week52High: 290.96, week52Low: 227.54 },
  { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financial', price: 445.80, change: 3.92, changePercent: 0.89, volume: 2900000, marketCap: '420B', pe: 32.1, week52High: 472.83, week52Low: 359.77 },
  
  // Healthcare
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', price: 158.25, change: 0.85, changePercent: 0.54, volume: 7200000, marketCap: '382B', pe: 15.8, week52High: 175.97, week52Low: 143.13 },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare', price: 525.60, change: 6.25, changePercent: 1.20, volume: 3400000, marketCap: '485B', pe: 22.4, week52High: 554.98, week52Low: 445.68 },
  { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare', price: 28.45, change: -0.32, changePercent: -1.11, volume: 42800000, marketCap: '160B', pe: 10.2, week52High: 43.35, week52Low: 25.76 },
  { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare', price: 162.30, change: 1.45, changePercent: 0.90, volume: 5600000, marketCap: '287B', pe: 14.6, week52High: 175.91, week52Low: 130.96 },
  { symbol: 'MRK', name: 'Merck & Co.', sector: 'Healthcare', price: 118.75, change: 0.92, changePercent: 0.78, volume: 8100000, marketCap: '300B', pe: 16.8, week52High: 131.87, week52Low: 99.14 },
  { symbol: 'LLY', name: 'Eli Lilly and Company', sector: 'Healthcare', price: 598.40, change: 12.35, changePercent: 2.11, volume: 2800000, marketCap: '568B', pe: 58.2, week52High: 629.97, week52Low: 309.20 },
  
  // Consumer
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer', price: 165.20, change: 1.25, changePercent: 0.76, volume: 7500000, marketCap: '445B', pe: 27.3, week52High: 169.94, week52Low: 143.17 },
  { symbol: 'PG', name: 'Procter & Gamble Co', sector: 'Consumer', price: 152.80, change: 0.65, changePercent: 0.43, volume: 6200000, marketCap: '360B', pe: 25.1, week52High: 165.35, week52Low: 141.45 },
  { symbol: 'KO', name: 'Coca-Cola Company', sector: 'Consumer', price: 59.85, change: 0.28, changePercent: 0.47, volume: 12400000, marketCap: '258B', pe: 23.4, week52High: 64.99, week52Low: 54.02 },
  { symbol: 'COKE', name: 'Coca-Cola Consolidated', sector: 'Consumer', price: 1085.50, change: 12.35, changePercent: 1.15, volume: 42000, marketCap: '10.2B', pe: 22.1, week52High: 1150.00, week52Low: 680.00 },
  { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer', price: 172.40, change: 0.95, changePercent: 0.55, volume: 4800000, marketCap: '237B', pe: 24.8, week52High: 196.88, week52Low: 155.83 },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer', price: 585.20, change: 4.85, changePercent: 0.84, volume: 2100000, marketCap: '260B', pe: 42.6, week52High: 612.27, week52Low: 466.24 },
  { symbol: 'NKE', name: 'Nike Inc.', sector: 'Consumer', price: 98.45, change: 1.12, changePercent: 1.15, volume: 6800000, marketCap: '150B', pe: 28.9, week52High: 131.31, week52Low: 88.66 },
  { symbol: 'MCD', name: "McDonald's Corporation", sector: 'Consumer', price: 295.60, change: 2.15, changePercent: 0.73, volume: 3200000, marketCap: '215B', pe: 24.2, week52High: 302.39, week52Low: 245.73 },
  { symbol: 'SBUX', name: 'Starbucks Corporation', sector: 'Consumer', price: 98.25, change: 0.85, changePercent: 0.87, volume: 7500000, marketCap: '112B', pe: 22.8, week52High: 115.48, week52Low: 87.97 },
  
  // Energy
  { symbol: 'XOM', name: 'Exxon Mobil Corp', sector: 'Energy', price: 105.80, change: 1.45, changePercent: 1.39, volume: 15200000, marketCap: '425B', pe: 10.8, week52High: 120.70, week52Low: 95.77 },
  { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy', price: 152.40, change: 2.12, changePercent: 1.41, volume: 7800000, marketCap: '285B', pe: 11.2, week52High: 189.68, week52Low: 139.62 },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energy', price: 118.65, change: 1.85, changePercent: 1.58, volume: 5200000, marketCap: '140B', pe: 12.4, week52High: 134.89, week52Low: 96.24 },
  
  // Industrial
  { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrial', price: 285.40, change: 3.25, changePercent: 1.15, volume: 2800000, marketCap: '145B', pe: 15.6, week52High: 293.88, week52Low: 213.84 },
  { symbol: 'BA', name: 'Boeing Company', sector: 'Industrial', price: 215.80, change: -2.45, changePercent: -1.12, volume: 5400000, marketCap: '130B', pe: 0, week52High: 267.54, week52Low: 176.25 },
  { symbol: 'HON', name: 'Honeywell International', sector: 'Industrial', price: 198.65, change: 1.75, changePercent: 0.89, volume: 3100000, marketCap: '130B', pe: 21.4, week52High: 220.62, week52Low: 174.38 },
  { symbol: 'UPS', name: 'United Parcel Service', sector: 'Industrial', price: 152.30, change: 1.05, changePercent: 0.69, volume: 2900000, marketCap: '130B', pe: 17.2, week52High: 193.47, week52Low: 135.68 },
  { symbol: 'GE', name: 'General Electric Co', sector: 'Industrial', price: 118.45, change: 1.92, changePercent: 1.65, volume: 6200000, marketCap: '128B', pe: 18.5, week52High: 134.82, week52Low: 84.35 },
  
  // Telecom
  { symbol: 'VZ', name: 'Verizon Communications', sector: 'Telecom', price: 38.25, change: 0.15, changePercent: 0.39, volume: 18500000, marketCap: '161B', pe: 7.8, week52High: 43.42, week52Low: 32.85 },
  { symbol: 'T', name: 'AT&T Inc.', sector: 'Telecom', price: 17.85, change: 0.08, changePercent: 0.45, volume: 32400000, marketCap: '128B', pe: 6.5, week52High: 21.48, week52Low: 14.46 },
  { symbol: 'TMUS', name: 'T-Mobile US Inc.', sector: 'Telecom', price: 162.40, change: 1.25, changePercent: 0.78, volume: 4200000, marketCap: '190B', pe: 22.4, week52High: 172.88, week52Low: 129.04 },
  
  // Real Estate
  { symbol: 'AMT', name: 'American Tower Corp', sector: 'Real Estate', price: 198.75, change: 1.45, changePercent: 0.74, volume: 2100000, marketCap: '92B', pe: 42.8, week52High: 227.58, week52Low: 168.47 },
  { symbol: 'PLD', name: 'Prologis Inc.', sector: 'Real Estate', price: 128.40, change: 0.95, changePercent: 0.75, volume: 3800000, marketCap: '119B', pe: 38.2, week52High: 142.32, week52Low: 102.65 },

  // Defense & Aerospace
  { symbol: 'LMT', name: 'Lockheed Martin Corp', sector: 'Aerospace & Defense', price: 455.20, change: 3.85, changePercent: 0.85, volume: 1200000, marketCap: '113B', pe: 16.2, week52High: 502.30, week52Low: 390.82 },
  { symbol: 'RTX', name: 'RTX Corporation', sector: 'Aerospace & Defense', price: 92.45, change: 1.12, changePercent: 1.23, volume: 4500000, marketCap: '137B', pe: 18.4, week52High: 101.40, week52Low: 72.15 },
  { symbol: 'NOC', name: 'Northrop Grumman Corp', sector: 'Aerospace & Defense', price: 468.30, change: 5.20, changePercent: 1.12, volume: 850000, marketCap: '71B', pe: 15.8, week52High: 497.88, week52Low: 410.62 },
  { symbol: 'GD', name: 'General Dynamics Corp', sector: 'Aerospace & Defense', price: 265.80, change: 2.45, changePercent: 0.93, volume: 1100000, marketCap: '73B', pe: 17.5, week52High: 284.52, week52Low: 218.94 },

  // Fintech & Crypto
  { symbol: 'COIN', name: 'Coinbase Global Inc', sector: 'Financial', price: 148.25, change: 6.80, changePercent: 4.81, volume: 12500000, marketCap: '36B', pe: 0, week52High: 283.48, week52Low: 69.31 },
  { symbol: 'SOFI', name: 'SoFi Technologies Inc', sector: 'Financial', price: 9.85, change: 0.35, changePercent: 3.68, volume: 28000000, marketCap: '9.4B', pe: 0, week52High: 11.47, week52Low: 4.24 },
  { symbol: 'MSTR', name: 'MicroStrategy Inc', sector: 'Technology', price: 485.60, change: 22.40, changePercent: 4.83, volume: 8200000, marketCap: '8.5B', pe: 0, week52High: 542.00, week52Low: 215.86 },
  { symbol: 'SQ', name: 'Block Inc.', sector: 'Financial', price: 68.45, change: 1.95, changePercent: 2.93, volume: 9800000, marketCap: '41B', pe: 52.3, week52High: 89.80, week52Low: 39.89 },
  { symbol: 'HOOD', name: 'Robinhood Markets Inc', sector: 'Financial', price: 12.35, change: 0.48, changePercent: 4.04, volume: 15200000, marketCap: '11B', pe: 0, week52High: 17.68, week52Low: 7.57 },

  // Growth Tech
  { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology', price: 22.45, change: 1.25, changePercent: 5.89, volume: 42000000, marketCap: '47B', pe: 225.0, week52High: 27.50, week52Low: 13.68 },
  { symbol: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology', price: 185.60, change: 4.20, changePercent: 2.31, volume: 5400000, marketCap: '60B', pe: 0, week52High: 237.72, week52Low: 142.55 },
  { symbol: 'NET', name: 'Cloudflare Inc.', sector: 'Technology', price: 82.30, change: 2.15, changePercent: 2.68, volume: 6100000, marketCap: '27B', pe: 0, week52High: 120.77, week52Low: 55.12 },
  { symbol: 'DDOG', name: 'Datadog Inc.', sector: 'Technology', price: 118.90, change: 3.45, changePercent: 2.99, volume: 4200000, marketCap: '38B', pe: 285.0, week52High: 132.58, week52Low: 81.30 },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', sector: 'Technology', price: 265.40, change: 5.80, changePercent: 2.23, volume: 3600000, marketCap: '63B', pe: 0, week52High: 298.48, week52Low: 140.00 },
  { symbol: 'UBER', name: 'Uber Technologies Inc', sector: 'Technology', price: 62.50, change: 1.40, changePercent: 2.29, volume: 18500000, marketCap: '128B', pe: 105.0, week52High: 82.14, week52Low: 40.09 },
  { symbol: 'ABNB', name: 'Airbnb Inc.', sector: 'Technology', price: 148.20, change: 3.10, changePercent: 2.13, volume: 5800000, marketCap: '95B', pe: 22.8, week52High: 170.10, week52Low: 110.20 },
  { symbol: 'SHOP', name: 'Shopify Inc.', sector: 'Technology', price: 78.50, change: 2.25, changePercent: 2.95, volume: 11200000, marketCap: '100B', pe: 0, week52High: 91.57, week52Low: 45.50 },

  // Semiconductors
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology', price: 920.50, change: 15.20, changePercent: 1.68, volume: 2800000, marketCap: '425B', pe: 28.5, week52High: 950.30, week52Low: 610.42 },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', sector: 'Technology', price: 105.80, change: 2.40, changePercent: 2.32, volume: 15800000, marketCap: '548B', pe: 18.2, week52High: 118.72, week52Low: 84.06 },
  { symbol: 'MU', name: 'Micron Technology', sector: 'Technology', price: 78.90, change: 2.65, changePercent: 3.47, volume: 14200000, marketCap: '86B', pe: 0, week52High: 91.61, week52Low: 56.42 },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', sector: 'Technology', price: 148.20, change: 3.10, changePercent: 2.14, volume: 5600000, marketCap: '165B', pe: 18.8, week52High: 170.43, week52Low: 104.33 },
  { symbol: 'ARM', name: 'Arm Holdings plc', sector: 'Technology', price: 72.40, change: 3.85, changePercent: 5.62, volume: 18500000, marketCap: '75B', pe: 0, week52High: 77.53, week52Low: 46.50 },
];

// Generate 10 years of historical data
export function generateHistoricalData(basePrice: number, volatility: number = 0.02): StockData[] {
  const data: StockData[] = [];
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 10);
  
  let currentPrice = basePrice * 0.4; // Start at 40% of current price for realistic growth
  
  while (startDate <= new Date()) {
    // Skip weekends
    if (startDate.getDay() !== 0 && startDate.getDay() !== 6) {
      const dailyVolatility = volatility * (0.5 + Math.random());
      const trend = 0.0003; // Slight upward bias
      const change = (Math.random() - 0.5 + trend) * dailyVolatility * currentPrice;
      
      const open = currentPrice;
      const close = currentPrice + change;
      const high = Math.max(open, close) * (1 + Math.random() * 0.01);
      const low = Math.min(open, close) * (1 - Math.random() * 0.01);
      
      data.push({
        date: startDate.toISOString().split('T')[0],
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: Math.floor(20000000 + Math.random() * 80000000),
      });
      
      currentPrice = close;
    }
    startDate.setDate(startDate.getDate() + 1);
  }
  
  return data;
}

// Technical indicators
export function calculateSMA(data: StockData[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    const sum = slice.reduce((acc, d) => acc + d.close, 0);
    return parseFloat((sum / period).toFixed(2));
  });
}

export function calculateEMA(data: StockData[], period: number): (number | null)[] {
  const multiplier = 2 / (period + 1);
  const ema: (number | null)[] = [];
  
  data.forEach((d, i) => {
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const sum = data.slice(0, period).reduce((acc, d) => acc + d.close, 0);
      ema.push(parseFloat((sum / period).toFixed(2)));
    } else {
      const prevEma = ema[i - 1]!;
      const newEma = (d.close - prevEma) * multiplier + prevEma;
      ema.push(parseFloat(newEma.toFixed(2)));
    }
  });
  
  return ema;
}

export function calculateRSI(data: StockData[], period: number = 14): (number | null)[] {
  const rsi: (number | null)[] = [];
  let gains: number[] = [];
  let losses: number[] = [];
  
  data.forEach((d, i) => {
    if (i === 0) {
      rsi.push(null);
      return;
    }
    
    const change = d.close - data[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    
    gains.push(gain);
    losses.push(loss);
    
    if (i < period) {
      rsi.push(null);
      return;
    }
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(parseFloat((100 - 100 / (1 + rs)).toFixed(2)));
    }
  });
  
  return rsi;
}

export function calculateMACD(data: StockData[]): { macd: (number | null)[], signal: (number | null)[], histogram: (number | null)[] } {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  
  const macd = ema12.map((e12, i) => {
    if (e12 === null || ema26[i] === null) return null;
    return parseFloat((e12 - ema26[i]!).toFixed(2));
  });
  
  // Calculate signal line (9-period EMA of MACD)
  const validMacd = macd.filter(m => m !== null) as number[];
  const signalPeriod = 9;
  const multiplier = 2 / (signalPeriod + 1);
  const signal: (number | null)[] = [];
  let ema: number | null = null;
  let validCount = 0;
  
  macd.forEach((m, i) => {
    if (m === null) {
      signal.push(null);
    } else {
      validCount++;
      if (validCount < signalPeriod) {
        signal.push(null);
      } else if (validCount === signalPeriod) {
        ema = validMacd.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
        signal.push(parseFloat(ema.toFixed(2)));
      } else {
        ema = (m - ema!) * multiplier + ema!;
        signal.push(parseFloat(ema.toFixed(2)));
      }
    }
  });
  
  const histogram = macd.map((m, i) => {
    if (m === null || signal[i] === null) return null;
    return parseFloat((m - signal[i]!).toFixed(2));
  });
  
  return { macd, signal, histogram };
}

export function calculateBollingerBands(data: StockData[], period: number = 20, stdDev: number = 2): { upper: (number | null)[], middle: (number | null)[], lower: (number | null)[] } {
  const sma = calculateSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  
  data.forEach((_, i) => {
    if (i < period - 1 || sma[i] === null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    
    const slice = data.slice(i - period + 1, i + 1);
    const mean = sma[i]!;
    const squaredDiffs = slice.map(d => Math.pow(d.close - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);
    
    upper.push(parseFloat((mean + stdDev * std).toFixed(2)));
    lower.push(parseFloat((mean - stdDev * std).toFixed(2)));
  });
  
  return { upper, middle: sma, lower };
}

export interface Signal {
  type: 'buy' | 'sell' | 'hold';
  strength: 'strong' | 'moderate' | 'weak';
  strategy: string;
  reason: string;
  date: string;
  confidence: number; // 0-100
  entryLevel?: number; // suggested entry price
  stopLoss?: number; // suggested stop-loss
  takeProfit?: number; // suggested take-profit
}

export function generateSignals(data: StockData[]): Signal[] {
  const signals: Signal[] = [];
  if (data.length < 50) return signals;

  const sma20 = calculateSMA(data, 20);
  const sma50 = calculateSMA(data, 50);
  const sma200 = calculateSMA(data, 200);
  const rsi = calculateRSI(data);
  const { macd, signal } = calculateMACD(data);
  const { upper, middle, lower } = calculateBollingerBands(data, 20, 2);
  
  const latestIdx = data.length - 1;
  const latest = data[latestIdx];
  const prev = data[latestIdx - 1];
  const prev2 = data[latestIdx - 2];
  const currentPrice = latest.close;

  const pctAbove = (sma: number | undefined) => sma ? ((currentPrice - sma) / sma) * 100 : 0;

  // === 1. MA TREND & CROSSOVER ===
  if (sma20[latestIdx] && sma50[latestIdx]) {
    const sma20Val = sma20[latestIdx]!;
    const sma50Val = sma50[latestIdx]!;
    const prevSma20 = sma20[latestIdx - 1];
    const prevSma50 = sma50[latestIdx - 1];
    const above200 = sma200[latestIdx] ? currentPrice > sma200[latestIdx]! : undefined;
    const dist20 = pctAbove(sma20Val);

    if (prevSma20 && prevSma50) {
      if (sma20Val > sma50Val && prevSma20 <= prevSma50) {
        signals.push({
          type: 'buy', strength: 'strong', strategy: 'MA Crossover',
          reason: `Golden Cross: 20-SMA crossed above 50-SMA${above200 ? ' (above 200-SMA)' : ''}`,
          date: latest.date, confidence: above200 ? 82 : 75,
          entryLevel: currentPrice, stopLoss: sma50Val, takeProfit: currentPrice * 1.08,
        });
      } else if (sma20Val < sma50Val && prevSma20 >= prevSma50) {
        signals.push({
          type: 'sell', strength: 'strong', strategy: 'MA Crossover',
          reason: `Death Cross: 20-SMA crossed below 50-SMA${above200 === false ? ' (below 200-SMA)' : ''}`,
          date: latest.date, confidence: above200 === false ? 82 : 75,
          entryLevel: currentPrice, stopLoss: sma50Val, takeProfit: currentPrice * 0.92,
        });
      }
    }

    if (sma20Val > sma50Val && (above200 === true || above200 === undefined)) {
      const conf = 50 + Math.min(20, Math.abs(dist20) * 2) + (above200 ? 10 : 0);
      signals.push({
        type: 'buy', strength: dist20 > 2 ? 'moderate' : 'weak', strategy: 'MA Crossover',
        reason: `Uptrend: price ${dist20 > 0 ? '+' : ''}${dist20.toFixed(1)}% vs 20-SMA, 20 > 50 > 200`,
        date: latest.date, confidence: Math.min(70, conf),
        entryLevel: currentPrice, stopLoss: sma50Val, takeProfit: currentPrice * 1.06,
      });
    } else if (sma20Val < sma50Val && (above200 === false || above200 === undefined)) {
      const conf = 50 + Math.min(20, Math.abs(dist20) * 2) + (above200 === false ? 10 : 0);
      signals.push({
        type: 'sell', strength: dist20 < -2 ? 'moderate' : 'weak', strategy: 'MA Crossover',
        reason: `Downtrend: price ${dist20.toFixed(1)}% vs 20-SMA, 20 < 50 < 200`,
        date: latest.date, confidence: Math.min(70, conf),
        entryLevel: currentPrice, stopLoss: sma50Val, takeProfit: currentPrice * 0.94,
      });
    }
  }

  // === 2. RSI MOMENTUM ===
  if (rsi[latestIdx]) {
    const rsiVal = rsi[latestIdx]!;
    const prevRsi = rsi[latestIdx - 1] ?? rsiVal;
    const rsiDelta = rsiVal - prevRsi;

    if (rsiVal < 30) {
      signals.push({
        type: 'buy', strength: rsiVal < 20 ? 'strong' : 'moderate', strategy: 'RSI',
        reason: `Oversold: RSI ${rsiVal.toFixed(1)} — mean reversion expected`,
        date: latest.date, confidence: rsiVal < 20 ? 82 : 72,
        entryLevel: currentPrice, stopLoss: currentPrice * 0.95, takeProfit: currentPrice * 1.07,
      });
    } else if (rsiVal > 70) {
      signals.push({
        type: 'sell', strength: rsiVal > 80 ? 'strong' : 'moderate', strategy: 'RSI',
        reason: `Overbought: RSI ${rsiVal.toFixed(1)} — pullback risk elevated`,
        date: latest.date, confidence: rsiVal > 80 ? 82 : 72,
        entryLevel: currentPrice, stopLoss: currentPrice * 1.05, takeProfit: currentPrice * 0.93,
      });
    } else if (rsiVal < 45 && rsiDelta > 2) {
      signals.push({
        type: 'buy', strength: 'moderate', strategy: 'RSI',
        reason: `RSI momentum shift: ${prevRsi.toFixed(1)} -> ${rsiVal.toFixed(1)} (rising from below 45)`,
        date: latest.date, confidence: 58,
        entryLevel: currentPrice, stopLoss: currentPrice * 0.96, takeProfit: currentPrice * 1.05,
      });
    } else if (rsiVal > 55 && rsiDelta < -2) {
      signals.push({
        type: 'sell', strength: 'moderate', strategy: 'RSI',
        reason: `RSI momentum shift: ${prevRsi.toFixed(1)} -> ${rsiVal.toFixed(1)} (falling from above 55)`,
        date: latest.date, confidence: 58,
        entryLevel: currentPrice, stopLoss: currentPrice * 1.04, takeProfit: currentPrice * 0.95,
      });
    } else {
      signals.push({
        type: 'hold', strength: 'weak', strategy: 'RSI',
        reason: `RSI neutral: ${rsiVal.toFixed(1)} — no extreme signal`,
        date: latest.date, confidence: 35,
      });
    }
  }

  // === 3. MACD MOMENTUM ===
  if (macd[latestIdx] !== undefined && signal[latestIdx] !== undefined) {
    const macdVal = macd[latestIdx]!;
    const sigVal = signal[latestIdx]!;
    const prevMacd = macd[latestIdx - 1];
    const prevSig = signal[latestIdx - 1];
    const histogram = macdVal - sigVal;
    const prevHistogram = prevMacd !== undefined && prevSig !== undefined ? prevMacd - prevSig : 0;

    if (prevMacd !== undefined && prevSig !== undefined) {
      if (macdVal > sigVal && prevMacd <= prevSig) {
        signals.push({
          type: 'buy', strength: macdVal > 0 ? 'strong' : 'moderate', strategy: 'MACD',
          reason: `MACD bullish crossover${macdVal > 0 ? ' above zero' : ''}`,
          date: latest.date, confidence: macdVal > 0 ? 74 : 62,
          entryLevel: currentPrice, stopLoss: currentPrice * 0.96, takeProfit: currentPrice * 1.05,
        });
      } else if (macdVal < sigVal && prevMacd >= prevSig) {
        signals.push({
          type: 'sell', strength: macdVal < 0 ? 'strong' : 'moderate', strategy: 'MACD',
          reason: `MACD bearish crossover${macdVal < 0 ? ' below zero' : ''}`,
          date: latest.date, confidence: macdVal < 0 ? 74 : 62,
          entryLevel: currentPrice, stopLoss: currentPrice * 1.04, takeProfit: currentPrice * 0.95,
        });
      }
    }

    if (histogram > 0 && histogram > prevHistogram) {
      signals.push({
        type: 'buy', strength: histogram > 0.5 ? 'moderate' : 'weak', strategy: 'MACD',
        reason: `MACD histogram expanding positive (${histogram.toFixed(3)}) — bullish momentum building`,
        date: latest.date, confidence: 52,
      });
    } else if (histogram < 0 && histogram < prevHistogram) {
      signals.push({
        type: 'sell', strength: histogram < -0.5 ? 'moderate' : 'weak', strategy: 'MACD',
        reason: `MACD histogram expanding negative (${histogram.toFixed(3)}) — bearish momentum building`,
        date: latest.date, confidence: 52,
      });
    } else if (Math.abs(histogram) < 0.05) {
      signals.push({
        type: 'hold', strength: 'weak', strategy: 'MACD',
        reason: `MACD near zero — no directional momentum`,
        date: latest.date, confidence: 35,
      });
    }
  }

  // === 4. BOLLINGER POSITION ===
  if (upper[latestIdx] && lower[latestIdx] && middle[latestIdx]) {
    const bw = ((upper[latestIdx]! - lower[latestIdx]!) / middle[latestIdx]!) * 100;
    const prevBw = upper[latestIdx - 1] && lower[latestIdx - 1] && middle[latestIdx - 1]
      ? ((upper[latestIdx - 1]! - lower[latestIdx - 1]!) / middle[latestIdx - 1]!) * 100 : bw;
    const pctFromMiddle = ((currentPrice - middle[latestIdx]!) / middle[latestIdx]!) * 100;

    if (bw < 8 && bw < prevBw) {
      signals.push({
        type: 'hold', strength: 'moderate', strategy: 'Bollinger',
        reason: `Bollinger squeeze (bandwidth ${bw.toFixed(1)}%) — breakout imminent`,
        date: latest.date, confidence: 68,
      });
    }

    if (currentPrice > upper[latestIdx]!) {
      signals.push({
        type: 'buy', strength: 'moderate', strategy: 'Bollinger',
        reason: `Price above upper band (${upper[latestIdx]!.toFixed(2)}) — bullish breakout`,
        date: latest.date, confidence: 62,
        entryLevel: currentPrice, stopLoss: middle[latestIdx]!, takeProfit: currentPrice * 1.05,
      });
    } else if (currentPrice < lower[latestIdx]!) {
      signals.push({
        type: 'sell', strength: 'moderate', strategy: 'Bollinger',
        reason: `Price below lower band (${lower[latestIdx]!.toFixed(2)}) — bearish breakdown`,
        date: latest.date, confidence: 62,
        entryLevel: currentPrice, stopLoss: middle[latestIdx]!, takeProfit: currentPrice * 0.95,
      });
    } else if (pctFromMiddle > 1) {
      signals.push({
        type: 'buy', strength: 'weak', strategy: 'Bollinger',
        reason: `Price in upper half of Bollinger (+${pctFromMiddle.toFixed(1)}% from mid) — bullish bias`,
        date: latest.date, confidence: 45,
      });
    } else if (pctFromMiddle < -1) {
      signals.push({
        type: 'sell', strength: 'weak', strategy: 'Bollinger',
        reason: `Price in lower half of Bollinger (${pctFromMiddle.toFixed(1)}% from mid) — bearish bias`,
        date: latest.date, confidence: 45,
      });
    }
  }

  // === 5. VOLUME ===
  if (data.length >= 20) {
    const recent20 = data.slice(-20);
    const avgVolume = recent20.reduce((s, d) => s + d.volume, 0) / 20;
    const volRatio = latest.volume / (avgVolume || 1);
    const bullish = currentPrice > prev.close;

    if (volRatio > 2.5) {
      signals.push({
        type: bullish ? 'buy' : 'sell',
        strength: volRatio > 3.5 ? 'strong' : 'moderate',
        strategy: 'Volume',
        reason: `Volume spike ${volRatio.toFixed(1)}x avg — ${bullish ? 'buying' : 'selling'} pressure`,
        date: latest.date, confidence: volRatio > 3.5 ? 72 : 58,
      });
    } else if (volRatio > 1.5) {
      signals.push({
        type: bullish ? 'buy' : 'sell',
        strength: 'weak',
        strategy: 'Volume',
        reason: `Above-average volume ${volRatio.toFixed(1)}x — ${bullish ? 'accumulation' : 'distribution'}`,
        date: latest.date, confidence: 48,
      });
    } else if (volRatio < 0.5) {
      signals.push({
        type: 'hold', strength: 'weak', strategy: 'Volume',
        reason: `Low volume (${volRatio.toFixed(1)}x avg) — no conviction`,
        date: latest.date, confidence: 35,
      });
    }
  }

  // === 6. CANDLE PATTERNS ===
  if (prev && prev2) {
    const body = Math.abs(latest.close - latest.open);
    const range = latest.high - latest.low;
    const upperWick = latest.high - Math.max(latest.close, latest.open);
    const lowerWick = Math.min(latest.close, latest.open) - latest.low;
    const prevBody = Math.abs(prev.close - prev.open);
    const isGreen = latest.close > latest.open;
    const prevGreen = prev.close > prev.open;

    if (!prevGreen && isGreen && latest.open <= prev.close && latest.close >= prev.open && body > prevBody) {
      signals.push({
        type: 'buy', strength: 'moderate', strategy: 'Candle',
        reason: 'Bullish engulfing — buyers overwhelmed sellers',
        date: latest.date, confidence: 68,
        entryLevel: currentPrice, stopLoss: latest.low, takeProfit: currentPrice * 1.04,
      });
    }
    if (prevGreen && !isGreen && latest.open >= prev.close && latest.close <= prev.open && body > prevBody) {
      signals.push({
        type: 'sell', strength: 'moderate', strategy: 'Candle',
        reason: 'Bearish engulfing — sellers overwhelmed buyers',
        date: latest.date, confidence: 68,
        entryLevel: currentPrice, stopLoss: latest.high, takeProfit: currentPrice * 0.96,
      });
    }
    if (lowerWick > body * 2 && upperWick < body * 0.5 && isGreen) {
      signals.push({
        type: 'buy', strength: 'moderate', strategy: 'Candle',
        reason: 'Hammer — buyers rejected lower prices',
        date: latest.date, confidence: 62,
        entryLevel: currentPrice, stopLoss: latest.low, takeProfit: currentPrice * 1.04,
      });
    }
    if (upperWick > body * 2 && lowerWick < body * 0.5 && !isGreen) {
      signals.push({
        type: 'sell', strength: 'moderate', strategy: 'Candle',
        reason: 'Shooting star — sellers rejected higher prices',
        date: latest.date, confidence: 62,
        entryLevel: currentPrice, stopLoss: latest.high, takeProfit: currentPrice * 0.96,
      });
    }
    if (range > 0) {
      const closePosition = (latest.close - latest.low) / range;
      if (closePosition > 0.8 && isGreen) {
        signals.push({
          type: 'buy', strength: 'weak', strategy: 'Candle',
          reason: `Strong close at ${(closePosition * 100).toFixed(0)}% of range — buyers in control`,
          date: latest.date, confidence: 48,
        });
      } else if (closePosition < 0.2 && !isGreen) {
        signals.push({
          type: 'sell', strength: 'weak', strategy: 'Candle',
          reason: `Weak close at ${(closePosition * 100).toFixed(0)}% of range — sellers in control`,
          date: latest.date, confidence: 48,
        });
      }
    }
  }

  // === 7. SUPPORT/RESISTANCE ===
  if (data.length >= 50) {
    const recent50 = data.slice(-50);
    const resistance = Math.max(...recent50.map(d => d.high));
    const support = Math.min(...recent50.map(d => d.low));
    const distToRes = ((resistance - currentPrice) / currentPrice) * 100;
    const distToSup = ((currentPrice - support) / currentPrice) * 100;

    if (currentPrice > resistance * 0.995) {
      signals.push({
        type: 'buy', strength: 'strong', strategy: 'S/R Break',
        reason: `Testing 50-day high (${resistance.toFixed(2)}) — ${distToRes.toFixed(1)}% away`,
        date: latest.date, confidence: 70,
        entryLevel: currentPrice, stopLoss: resistance * 0.98, takeProfit: currentPrice * 1.06,
      });
    } else if (currentPrice < support * 1.005) {
      signals.push({
        type: 'sell', strength: 'strong', strategy: 'S/R Break',
        reason: `Testing 50-day low (${support.toFixed(2)}) — ${distToSup.toFixed(1)}% away`,
        date: latest.date, confidence: 70,
        entryLevel: currentPrice, stopLoss: support * 1.02, takeProfit: currentPrice * 0.94,
      });
    } else if (distToRes < 3) {
      signals.push({
        type: 'buy', strength: 'weak', strategy: 'S/R Break',
        reason: `Approaching resistance (${resistance.toFixed(2)}) — ${distToRes.toFixed(1)}% away`,
        date: latest.date, confidence: 45,
      });
    } else if (distToSup < 3) {
      signals.push({
        type: 'sell', strength: 'weak', strategy: 'S/R Break',
        reason: `Approaching support (${support.toFixed(2)}) — ${distToSup.toFixed(1)}% away`,
        date: latest.date, confidence: 45,
      });
    }
  }

  // === 8. MULTI-TIMEFRAME RSI ===
  if (data.length >= 21) {
    const rsi7 = calculateRSI(data, 7);
    const rsi14 = calculateRSI(data, 14);
    const rsi21 = calculateRSI(data, 21);
    const r7 = rsi7[latestIdx] ?? 50;
    const r14 = rsi14[latestIdx] ?? 50;
    const r21 = rsi21[latestIdx] ?? 50;

    if (r7 < 30 && r14 < 35 && r21 < 40) {
      signals.push({
        type: 'buy', strength: 'strong', strategy: 'Multi-TF RSI',
        reason: `All RSI timeframes oversold (7: ${r7.toFixed(0)}, 14: ${r14.toFixed(0)}, 21: ${r21.toFixed(0)})`,
        date: latest.date, confidence: 80,
        entryLevel: currentPrice, stopLoss: currentPrice * 0.95, takeProfit: currentPrice * 1.08,
      });
    } else if (r7 > 70 && r14 > 65 && r21 > 60) {
      signals.push({
        type: 'sell', strength: 'strong', strategy: 'Multi-TF RSI',
        reason: `All RSI timeframes elevated (7: ${r7.toFixed(0)}, 14: ${r14.toFixed(0)}, 21: ${r21.toFixed(0)})`,
        date: latest.date, confidence: 80,
        entryLevel: currentPrice, stopLoss: currentPrice * 1.05, takeProfit: currentPrice * 0.92,
      });
    } else if (r7 < 45 && r14 < 50 && r21 < 50) {
      signals.push({
        type: 'buy', strength: 'moderate', strategy: 'Multi-TF RSI',
        reason: `All RSI timeframes below 50 — bearish but improving (7: ${r7.toFixed(0)}, 14: ${r14.toFixed(0)})`,
        date: latest.date, confidence: 55,
      });
    } else if (r7 > 55 && r14 > 50 && r21 > 50) {
      signals.push({
        type: 'sell', strength: 'moderate', strategy: 'Multi-TF RSI',
        reason: `All RSI timeframes above 50 — bullish but stretched (7: ${r7.toFixed(0)}, 14: ${r14.toFixed(0)})`,
        date: latest.date, confidence: 55,
      });
    }
  }

  return signals;
}

// Forecast simulator
export interface ForecastPoint {
  date: string;
  predicted: number;
  upper: number;
  lower: number;
  confidence: number;
}

export function generateForecast(data: StockData[], days: number = 30): ForecastPoint[] {
  const forecast: ForecastPoint[] = [];
  const recentData = data.slice(-252); // Last year of data
  
  // Calculate historical volatility
  const returns = recentData.slice(1).map((d, i) => 
    Math.log(d.close / recentData[i].close)
  );
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const dailyVolatility = Math.sqrt(variance);
  
  // Calculate trend from recent data
  const ema20 = calculateEMA(data, 20);
  const ema50 = calculateEMA(data, 50);
  const lastEma20 = ema20[ema20.length - 1] || data[data.length - 1].close;
  const lastEma50 = ema50[ema50.length - 1] || data[data.length - 1].close;
  const trendStrength = (lastEma20 - lastEma50) / lastEma50;
  
  let currentPrice = data[data.length - 1].close;
  const baseDate = new Date(data[data.length - 1].date);
  
  for (let i = 1; i <= days; i++) {
    const forecastDate = new Date(baseDate);
    forecastDate.setDate(forecastDate.getDate() + i);
    
    // Skip weekends
    if (forecastDate.getDay() === 0) forecastDate.setDate(forecastDate.getDate() + 1);
    if (forecastDate.getDay() === 6) forecastDate.setDate(forecastDate.getDate() + 2);
    
    // Monte Carlo-like simulation with trend
    const drift = avgReturn + trendStrength * 0.001;
    const randomShock = (Math.random() - 0.5) * dailyVolatility * 2;
    const change = drift + randomShock;
    
    currentPrice = currentPrice * Math.exp(change);
    
    // Confidence interval widens over time
    const confidenceMultiplier = 1.96 * dailyVolatility * Math.sqrt(i);
    const confidence = Math.max(50, 95 - i * 1.5);
    
    forecast.push({
      date: forecastDate.toISOString().split('T')[0],
      predicted: parseFloat(currentPrice.toFixed(2)),
      upper: parseFloat((currentPrice * (1 + confidenceMultiplier)).toFixed(2)),
      lower: parseFloat((currentPrice * (1 - confidenceMultiplier)).toFixed(2)),
      confidence: parseFloat(confidence.toFixed(1)),
    });
  }
  
  return forecast;
}

export interface MonteCarloPath {
  path: number[];     // daily close prices for each forecast day
  totalReturn: number; // % return of this path
}

export interface MonteCarloResult {
  dates: string[];
  paths: MonteCarloPath[];
  p10: number[];  // 10th percentile per day
  p25: number[];
  p50: number[];  // median
  p75: number[];
  p90: number[];  // 90th percentile per day
}

// Generate N independent Monte Carlo paths from historical data
export function generateMonteCarloPaths(
  data: StockData[],
  days: number = 30,
  numPaths: number = 100,
  options?: { seed?: number }
): MonteCarloResult {
  const recentData = data.slice(-252);
  const returns = recentData.slice(1).map((d, i) =>
    Math.log(d.close / recentData[i].close)
  );
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - avgReturn) ** 2, 0) / returns.length;
  const dailyVol = Math.sqrt(variance);

  const ema20 = calculateEMA(data, 20);
  const ema50 = calculateEMA(data, 50);
  const lastEma20 = ema20[ema20.length - 1] || data[data.length - 1].close;
  const lastEma50 = ema50[ema50.length - 1] || data[data.length - 1].close;
  const trendStrength = (lastEma20 - lastEma50) / lastEma50;
  const drift = avgReturn + trendStrength * 0.001;

  const startPrice = data[data.length - 1].close;
  const baseDate = new Date(data[data.length - 1].date);

  // Pre-compute dates (skip weekends)
  const dates: string[] = [];
  const tempDate = new Date(baseDate);
  let added = 0;
  while (added < days) {
    tempDate.setDate(tempDate.getDate() + 1);
    if (tempDate.getDay() !== 0 && tempDate.getDay() !== 6) {
      dates.push(tempDate.toISOString().split('T')[0]);
      added++;
    }
  }

  // Deterministic RNG when seed is provided (prevents UI flicker on re-render)
  const mulberry32 = (seed: number) => {
    let t = seed >>> 0;
    return () => {
      t += 0x6D2B79F5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  };

  const rand = options?.seed != null ? mulberry32(options.seed) : Math.random;

  // Box-Muller for normally distributed random numbers
  const randn = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Generate all paths
  const paths: MonteCarloPath[] = Array.from({ length: numPaths }, () => {
    const path: number[] = [];
    let price = startPrice;
    for (let i = 0; i < days; i++) {
      price = price * Math.exp(drift + dailyVol * randn());
      path.push(parseFloat(price.toFixed(2)));
    }
    return { path, totalReturn: ((price - startPrice) / startPrice) * 100 };
  });

  // Compute percentiles per day
  const percentile = (arr: number[], p: number) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  const p10: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p90: number[] = [];

  for (let i = 0; i < days; i++) {
    const dayPrices = paths.map(p => p.path[i]);
    p10.push(percentile(dayPrices, 10));
    p25.push(percentile(dayPrices, 25));
    p50.push(percentile(dayPrices, 50));
    p75.push(percentile(dayPrices, 75));
    p90.push(percentile(dayPrices, 90));
  }

  return { dates, paths, p10, p25, p50, p75, p90 };
}

export interface StrategyPerformance {
  strategy: string;
  winRate: number;
  avgReturn: number;
  totalTrades: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
}

export function calculateStrategyPerformance(): StrategyPerformance[] {
  return [
    { strategy: 'MA Crossover', winRate: 58.5, avgReturn: 12.3, totalTrades: 156, profitFactor: 1.82, maxDrawdown: -15.2, sharpeRatio: 1.45 },
    { strategy: 'RSI Reversal', winRate: 62.1, avgReturn: 8.7, totalTrades: 234, profitFactor: 1.65, maxDrawdown: -12.8, sharpeRatio: 1.28 },
    { strategy: 'MACD Crossover', winRate: 55.8, avgReturn: 15.2, totalTrades: 128, profitFactor: 1.95, maxDrawdown: -18.5, sharpeRatio: 1.52 },
    { strategy: 'Bollinger Breakout', winRate: 51.2, avgReturn: 22.1, totalTrades: 89, profitFactor: 2.15, maxDrawdown: -22.3, sharpeRatio: 1.38 },
    { strategy: 'Combined Signal', winRate: 67.4, avgReturn: 18.5, totalTrades: 67, profitFactor: 2.42, maxDrawdown: -10.5, sharpeRatio: 1.89 },
  ];
}
