// Stock Screener Utility - List of US stocks to screen
// This provides a curated list of major US stocks for screening

export interface ScreenerStock {
  symbol: string;
  name: string;
  sector: string;
}

// Major US stocks covering various sectors
export const screenerStocks: ScreenerStock[] = [
  // Technology
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Technology' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology' },
  { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology' },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Technology' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology' },
  { symbol: 'INTC', name: 'Intel Corporation', sector: 'Technology' },
  { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology' },
  { symbol: 'ORCL', name: 'Oracle Corporation', sector: 'Technology' },
  { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology' },
  
  // Financial
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financial' },
  { symbol: 'BAC', name: 'Bank of America Corp', sector: 'Financial' },
  { symbol: 'WFC', name: 'Wells Fargo & Company', sector: 'Financial' },
  { symbol: 'GS', name: 'Goldman Sachs Group', sector: 'Financial' },
  { symbol: 'MS', name: 'Morgan Stanley', sector: 'Financial' },
  { symbol: 'V', name: 'Visa Inc.', sector: 'Financial' },
  { symbol: 'MA', name: 'Mastercard Inc.', sector: 'Financial' },
  
  // Healthcare
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { symbol: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare' },
  { symbol: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare' },
  { symbol: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare' },
  { symbol: 'MRK', name: 'Merck & Co.', sector: 'Healthcare' },
  { symbol: 'LLY', name: 'Eli Lilly and Company', sector: 'Healthcare' },
  
  // Consumer
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer' },
  { symbol: 'PG', name: 'Procter & Gamble Co', sector: 'Consumer' },
  { symbol: 'KO', name: 'Coca-Cola Company', sector: 'Consumer' },
  { symbol: 'COKE', name: 'Coca-Cola Consolidated', sector: 'Consumer' },
  { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer' },
  { symbol: 'COST', name: 'Costco Wholesale', sector: 'Consumer' },
  { symbol: 'NKE', name: 'Nike Inc.', sector: 'Consumer' },
  { symbol: 'MCD', name: "McDonald's Corporation", sector: 'Consumer' },
  { symbol: 'SBUX', name: 'Starbucks Corporation', sector: 'Consumer' },
  
  // Energy
  { symbol: 'XOM', name: 'Exxon Mobil Corp', sector: 'Energy' },
  { symbol: 'CVX', name: 'Chevron Corporation', sector: 'Energy' },
  { symbol: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  
  // Industrial
  { symbol: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrial' },
  { symbol: 'BA', name: 'Boeing Company', sector: 'Industrial' },
  { symbol: 'HON', name: 'Honeywell International', sector: 'Industrial' },
  { symbol: 'UPS', name: 'United Parcel Service', sector: 'Industrial' },
  { symbol: 'GE', name: 'General Electric Co', sector: 'Industrial' },
  
  // Telecom
  { symbol: 'VZ', name: 'Verizon Communications', sector: 'Telecom' },
  { symbol: 'T', name: 'AT&T Inc.', sector: 'Telecom' },
  { symbol: 'TMUS', name: 'T-Mobile US Inc.', sector: 'Telecom' },
  
  // Real Estate
  { symbol: 'AMT', name: 'American Tower Corp', sector: 'Real Estate' },
  { symbol: 'PLD', name: 'Prologis Inc.', sector: 'Real Estate' },

  // Defense & Aerospace
  { symbol: 'LMT', name: 'Lockheed Martin Corp', sector: 'Aerospace & Defense' },
  { symbol: 'RTX', name: 'RTX Corporation', sector: 'Aerospace & Defense' },
  { symbol: 'NOC', name: 'Northrop Grumman Corp', sector: 'Aerospace & Defense' },
  { symbol: 'GD', name: 'General Dynamics Corp', sector: 'Aerospace & Defense' },

  // Fintech & Crypto
  { symbol: 'COIN', name: 'Coinbase Global Inc', sector: 'Financial' },
  { symbol: 'SOFI', name: 'SoFi Technologies Inc', sector: 'Financial' },
  { symbol: 'SQ', name: 'Block Inc.', sector: 'Financial' },

  // Growth Tech
  { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Technology' },
  { symbol: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology' },
  { symbol: 'NET', name: 'Cloudflare Inc.', sector: 'Technology' },
  { symbol: 'CRWD', name: 'CrowdStrike Holdings', sector: 'Technology' },
  { symbol: 'UBER', name: 'Uber Technologies Inc', sector: 'Technology' },

  // Semiconductors
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology' },
  { symbol: 'TSM', name: 'Taiwan Semiconductor', sector: 'Technology' },
  { symbol: 'QCOM', name: 'Qualcomm Inc.', sector: 'Technology' },
  { symbol: 'ARM', name: 'Arm Holdings plc', sector: 'Technology' },
];

export type SortField = 'symbol' | 'name' | 'sector' | 'confidence' | 'risk';
export type SortDirection = 'asc' | 'desc';
export type RiskFilter = 'all' | 'low' | 'medium' | 'high';
export type SignalFilter = 'all' | 'excellent' | 'good' | 'moderate' | 'poor';
