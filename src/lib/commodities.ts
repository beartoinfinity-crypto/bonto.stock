/**
 * commodities.ts — curated commodity futures universe + industry exposure map
 * for the /commodities screen (greeksoup's Commodities board, ported).
 *
 * Symbols are Yahoo Finance continuous futures (=F suffix), each verified to
 * resolve on the v8 chart endpoint. The exposure map is rule-based domain
 * knowledge: which industries benefit ("helps") or are pressured ("squeezes")
 * when the commodity RISES. Static curation only — no AI/ML.
 */

export type CommodityGroup =
  | 'Energy'
  | 'Precious Metals'
  | 'Industrial Metals'
  | 'Grains'
  | 'Softs'
  | 'Livestock';

export const GROUP_ORDER: readonly CommodityGroup[] = [
  'Energy',
  'Precious Metals',
  'Industrial Metals',
  'Grains',
  'Softs',
  'Livestock',
];

export interface Commodity {
  /** Yahoo continuous futures symbol (e.g. CL=F) */
  symbol: string;
  name: string;
  /** quote/basis unit shown in the detail card */
  unit: string;
  group: CommodityGroup;
}

export interface CommodityExposure {
  /** industries that benefit from a price RISE */
  helps: string[];
  /** industries pressured by a price RISE */
  squeezes: string[];
}

export const COMMODITIES: readonly Commodity[] = [
  // ── Energy ───────────────────────────────────────────────────────
  { symbol: 'CL=F', name: 'Crude Oil WTI', unit: '$ / barrel', group: 'Energy' },
  { symbol: 'BZ=F', name: 'Brent Crude Oil', unit: '$ / barrel', group: 'Energy' },
  { symbol: 'NG=F', name: 'Natural Gas (Henry Hub)', unit: '$ / MMBtu', group: 'Energy' },
  { symbol: 'TTF=F', name: 'Dutch TTF Natural Gas', unit: '€ / MWh', group: 'Energy' },
  { symbol: 'HO=F', name: 'Heating Oil', unit: '$ / gallon', group: 'Energy' },
  { symbol: 'RB=F', name: 'RBOB Gasoline', unit: '$ / gallon', group: 'Energy' },

  // ── Precious Metals ──────────────────────────────────────────────
  { symbol: 'GC=F', name: 'Gold', unit: '$ / oz t', group: 'Precious Metals' },
  { symbol: 'SI=F', name: 'Silver', unit: '$ / oz t', group: 'Precious Metals' },
  { symbol: 'PL=F', name: 'Platinum', unit: '$ / oz t', group: 'Precious Metals' },
  { symbol: 'PA=F', name: 'Palladium', unit: '$ / oz t', group: 'Precious Metals' },

  // ── Industrial Metals ────────────────────────────────────────────
  { symbol: 'HG=F', name: 'Copper', unit: '$ / lb', group: 'Industrial Metals' },
  { symbol: 'ALI=F', name: 'Aluminum', unit: '$ / ton', group: 'Industrial Metals' },
  { symbol: 'HRC=F', name: 'Steel HRC (US Midwest)', unit: '$ / short ton', group: 'Industrial Metals' },
  { symbol: 'ZNC=F', name: 'Zinc', unit: '$ / ton', group: 'Industrial Metals' },

  // ── Grains ───────────────────────────────────────────────────────
  { symbol: 'ZC=F', name: 'Corn', unit: '¢ / bushel', group: 'Grains' },
  { symbol: 'ZS=F', name: 'Soybeans', unit: '¢ / bushel', group: 'Grains' },
  { symbol: 'ZW=F', name: 'Wheat (SRW)', unit: '¢ / bushel', group: 'Grains' },
  { symbol: 'ZM=F', name: 'Soybean Meal', unit: '$ / ton', group: 'Grains' },
  { symbol: 'ZL=F', name: 'Soybean Oil', unit: '¢ / lb', group: 'Grains' },
  { symbol: 'ZO=F', name: 'Oats', unit: '¢ / bushel', group: 'Grains' },
  { symbol: 'ZR=F', name: 'Rough Rice', unit: '¢ / cwt', group: 'Grains' },

  // ── Softs ────────────────────────────────────────────────────────
  { symbol: 'KC=F', name: 'Coffee C', unit: '¢ / lb', group: 'Softs' },
  { symbol: 'CC=F', name: 'Cocoa', unit: '$ / ton', group: 'Softs' },
  { symbol: 'SB=F', name: 'Sugar #11', unit: '¢ / lb', group: 'Softs' },
  { symbol: 'CT=F', name: 'Cotton #2', unit: '¢ / lb', group: 'Softs' },
  { symbol: 'LBR=F', name: 'Lumber', unit: '$ / 1k bd ft', group: 'Softs' },
  { symbol: 'OJ=F', name: 'Orange Juice', unit: '¢ / lb', group: 'Softs' },

  // ── Livestock ────────────────────────────────────────────────────
  { symbol: 'LE=F', name: 'Live Cattle', unit: '¢ / lb', group: 'Livestock' },
  { symbol: 'HE=F', name: 'Lean Hogs', unit: '¢ / lb', group: 'Livestock' },
  { symbol: 'GF=F', name: 'Feeder Cattle', unit: '¢ / lb', group: 'Livestock' },
];

/**
 * Per-commodity exposure on a price RISE. Explicit for every listed
 * commodity; `exposureFor` also falls back to a group default so future
 * additions never return an empty map.
 */
const EXPOSURE: Readonly<Record<string, CommodityExposure>> = {
  // Energy
  'CL=F': {
    helps: ['Oil & gas producers', 'Offshore drillers', 'Oilfield services'],
    squeezes: ['Airlines', 'Trucking & shipping', 'Petrochemical makers', 'Commuters (fuel costs)'],
  },
  'BZ=F': {
    helps: ['International E&P producers', 'North Sea operators', 'Refiners (crack spread)'],
    squeezes: ['Airlines', 'Shipping lines', 'Fuel-importing economies'],
  },
  'NG=F': {
    helps: ['US natural gas producers', 'LNG exporters', 'Pipeline & storage firms'],
    squeezes: ['LNG importers', 'Fertilizer & chemical makers', 'Gas-fired power generators'],
  },
  'TTF=F': {
    helps: ['European gas producers', 'LNG shippers'],
    squeezes: ['European utilities', 'Chemical & fertilizer plants', 'Energy-intensive manufacturers'],
  },
  'HO=F': {
    helps: ['Refiners', 'Distillate distributors'],
    squeezes: ['Airlines (jet fuel link)', 'Trucking fleets', 'Heating oil consumers'],
  },
  'RB=F': {
    helps: ['Refiners', 'Fuel retailers'],
    squeezes: ['Motorists', 'Delivery & rideshare fleets'],
  },

  // Precious metals
  'GC=F': {
    helps: ['Gold miners', 'Royalty & streaming firms', 'Bullion refiners'],
    squeezes: ['Jewelers', 'Luxury goods makers', 'Gold-importing central banks'],
  },
  'SI=F': {
    helps: ['Silver miners', 'Silver refiners'],
    squeezes: ['Solar panel manufacturers', 'Electronics makers', 'Jewelers'],
  },
  'PL=F': {
    helps: ['Platinum miners', 'PGM refiners'],
    squeezes: ['Automakers (catalysts)', 'Chemical plants'],
  },
  'PA=F': {
    helps: ['Palladium miners'],
    squeezes: ['Automakers (catalytic converters)', 'Chemical processors'],
  },

  // Industrial metals
  'HG=F': {
    helps: ['Copper miners', 'Copper smelters'],
    squeezes: ['Electrical equipment makers', 'Construction', 'EV manufacturers', 'Electronics makers'],
  },
  'ALI=F': {
    helps: ['Aluminum smelters', 'Bauxite miners'],
    squeezes: ['Beverage can producers', 'Aircraft manufacturers', 'Automakers'],
  },
  'HRC=F': {
    helps: ['Steel mills', 'Scrap processors'],
    squeezes: ['Auto manufacturers', 'Appliance makers', 'Construction & infrastructure'],
  },
  'ZNC=F': {
    helps: ['Zinc miners', 'Zinc smelters'],
    squeezes: ['Galvanized steel producers', 'Die-cast manufacturers', 'Coatings & construction'],
  },

  // Grains
  'ZC=F': {
    helps: ['Corn farmers', 'Farm input suppliers'],
    squeezes: ['Ethanol producers', 'Livestock feeders', 'Food & snack processors'],
  },
  'ZS=F': {
    helps: ['Soybean farmers', 'Grain handlers & elevators'],
    squeezes: ['Animal feed producers', 'Vegetable oil refiners', 'Food processors'],
  },
  'ZM=F': {
    helps: ['Soybean crushers', 'Feed meal exporters'],
    squeezes: ['Poultry & hog producers', 'Dairy farms', 'Aquaculture'],
  },
  'ZL=F': {
    helps: ['Soybean crushers', 'Edible oil refiners'],
    squeezes: ['Food manufacturers', 'Biodiesel producers', 'Snack food makers'],
  },
  'ZO=F': {
    helps: ['Oat farmers'],
    squeezes: ['Cereal manufacturers', 'Feed mills'],
  },
  'ZR=F': {
    helps: ['Rice farmers', 'Rice exporters (Asia)'],
    squeezes: ['Food processors', 'Rice importers (Africa & Middle East)'],
  },
  'ZW=F': {
    helps: ['Wheat farmers', 'Grain traders'],
    squeezes: ['Bakers', 'Pasta & noodle makers', 'Food processors'],
  },

  // Softs
  'KC=F': {
    helps: ['Coffee growers', 'Coffee exporters (Brazil & Colombia)'],
    squeezes: ['Coffee chains & roasters', 'Cafés & restaurants', 'Grocers'],
  },
  'CC=F': {
    helps: ['Cocoa growers (West Africa)'],
    squeezes: ['Chocolate makers', 'Bakeries & confectioners', 'Candy brands'],
  },
  'SB=F': {
    helps: ['Sugar mills', 'Ethanol producers (Brazil)'],
    squeezes: ['Beverage companies', 'Confectioners', 'Food & drink manufacturers'],
  },
  'CT=F': {
    helps: ['Cotton farmers', 'Cotton traders'],
    squeezes: ['Apparel manufacturers', 'Textile mills', 'Apparel retailers'],
  },
  'LBR=F': {
    helps: ['Sawmills & lumber producers', 'Timberland owners'],
    squeezes: ['Homebuilders', 'Construction firms', 'Remodeling & renovation firms'],
  },
  'OJ=F': {
    helps: ['Orange growers', 'Juice concentrate producers'],
    squeezes: ['Juice blenders', 'Beverage retailers', 'Citrus flavor processors'],
  },

  // Livestock
  'LE=F': {
    helps: ['Cattle ranchers', 'Feedlots (herd value)'],
    squeezes: ['Meat packers', 'Steakhouses & restaurants', 'Grocery retailers'],
  },
  'HE=F': {
    helps: ['Hog producers'],
    squeezes: ['Bacon & deli processors', 'Restaurants', 'Packaged meat brands'],
  },
  'GF=F': {
    helps: ['Cow-calf ranchers'],
    squeezes: ['Feedlots (input cost)', 'Beef packers'],
  },
};

const GROUP_FALLBACK: Readonly<Record<CommodityGroup, CommodityExposure>> = {
  Energy: {
    helps: ['Producers & refiners'],
    squeezes: ['Fuel-consuming industries'],
  },
  'Precious Metals': {
    helps: ['Miners & refiners'],
    squeezes: ['Industrial & luxury consumers'],
  },
  'Industrial Metals': {
    helps: ['Miners & smelters'],
    squeezes: ['Manufacturers & construction'],
  },
  Grains: {
    helps: ['Farmers'],
    squeezes: ['Food & feed processors'],
  },
  Softs: {
    helps: ['Growers & exporters'],
    squeezes: ['Processors & retailers'],
  },
  Livestock: {
    helps: ['Producers & ranchers'],
    squeezes: ['Packers & restaurants'],
  },
};

/** Exposure for a commodity on a price rise; group default as fallback. */
export function exposureFor(symbol: string): CommodityExposure | null {
  const explicit = EXPOSURE[symbol];
  if (explicit) return explicit;
  const commodity = COMMODITIES.find(c => c.symbol === symbol);
  return commodity ? GROUP_FALLBACK[commodity.group] : null;
}

export interface CommodityGroupSection {
  group: CommodityGroup;
  items: Commodity[];
}

/** Commodities grouped in GROUP_ORDER (empty groups omitted). */
export function groupedCommodities(items: readonly Commodity[] = COMMODITIES): CommodityGroupSection[] {
  return GROUP_ORDER
    .map(group => ({ group, items: items.filter(c => c.group === group) }))
    .filter(section => section.items.length > 0);
}

/** Case-insensitive name/symbol filter helper. */
export function filterCommodities(query: string): Commodity[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...COMMODITIES];
  return COMMODITIES.filter(c =>
    c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
  );
}
