import { TrendingUp, TrendingDown, BarChart3, DollarSign, Activity, Calendar, Gem, Sparkles } from 'lucide-react';
import { Stock, StockData } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n';

interface StockMetricsProps {
  stock: Stock;
  historicalData?: StockData[];
}

const formatNumber = (value: number | undefined | null, decimals: number = 2): string => {
  if (value === undefined || value === null || isNaN(value)) return '0.00';
  return value.toFixed(decimals);
};

const formatVolume = (vol: number): string => {
  if (vol >= 1_000_000_000) return formatNumber(vol / 1_000_000_000, 2) + 'B';
  if (vol >= 1_000_000) return formatNumber(vol / 1_000_000, 1) + 'M';
  if (vol >= 1_000) return formatNumber(vol / 1_000, 1) + 'K';
  return vol.toString();
};

export function StockMetrics({ stock, historicalData = [] }: StockMetricsProps) {
  const { t } = useLanguage();
  const isPositive = (stock.change ?? 0) >= 0;
  const latestDailyVolume = historicalData.length > 0 ? historicalData[historicalData.length - 1].volume : 0;

  // Graham intrinsic value: IV = EPS × (8.5 + 2g)
  // "Actual" uses no-growth assumption (g=0) → EPS × 8.5 (conservative / current earnings power)
  // "Estimated" uses modeled growth (g=7.5%) → EPS × 23.5 (forward-looking fair value)
  const eps = stock.pe && stock.pe > 0 ? (stock.price || 0) / stock.pe : 0;
  const ivActual = eps > 0 ? eps * 8.5 : 0;
  const ivEstimated = eps > 0 ? eps * 23.5 : 0;

  const metrics = [
    { label: t('marketCap'), value: stock.marketCap || 'N/A', icon: DollarSign },
    { label: t('peRatio'), value: formatNumber(stock.pe), icon: BarChart3 },
    { label: t('dailyVolume'), value: formatVolume(latestDailyVolume), icon: Activity },
    { label: t('avgVolume'), value: formatVolume(stock.volume ?? 0), icon: Activity },
    { label: t('week52High'), value: '$' + formatNumber(stock.week52High), icon: TrendingUp },
    { label: t('week52Low'), value: '$' + formatNumber(stock.week52Low), icon: TrendingDown },
    { label: 'Intrinsic (Actual)', value: ivActual > 0 ? '$' + formatNumber(ivActual) : 'N/A', icon: Gem },
    { label: 'Intrinsic (Est.)', value: ivEstimated > 0 ? '$' + formatNumber(ivEstimated) : 'N/A', icon: Sparkles },
    { label: t('sector'), value: stock.sector || 'Unknown', icon: Calendar },
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
              <span className="font-mono font-bold text-primary text-lg">{stock.symbol?.slice(0, 2) || '??'}</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold">{stock.symbol || 'N/A'}</h2>
              <p className="text-muted-foreground text-sm">{stock.name || 'Unknown'}</p>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-mono font-bold">${formatNumber(stock.price)}</div>
          <div className={cn("flex items-center justify-end gap-2 text-lg font-mono", isPositive ? "text-bullish" : "text-bearish")}>
            {isPositive ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
            <span>{isPositive ? '+' : ''}{formatNumber(stock.change)}</span>
            <span className={cn("px-2 py-0.5 rounded text-sm", isPositive ? "bg-success/20" : "bg-destructive/20")}>
              {isPositive ? '+' : ''}{formatNumber(stock.changePercent)}%
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-secondary/50 rounded-lg p-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <metric.icon className="h-3 w-3" />
              {metric.label}
            </div>
            <div className="font-mono font-semibold">{metric.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
