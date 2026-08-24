import { useMemo, useState } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { StockData, calculateSMA, calculateBollingerBands } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { clearSymbol } from '@/lib/localDb';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/i18n';

interface PriceChartProps {
  data: StockData[];
  symbol: string;
  lastUpdated?: string | null;
  onRefresh?: () => void;
}

type TimeRange = '1M' | '3M' | '6M' | '1Y' | '5Y' | '10Y';

const timeRanges: { label: TimeRange; days: number }[] = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: '1Y', days: 252 },
  { label: '5Y', days: 1260 },
  { label: '10Y', days: 2520 },
];

export function PriceChart({ data, symbol, lastUpdated, onRefresh }: PriceChartProps) {
  const { t } = useLanguage();
  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');
  const [showMA, setShowMA] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);

  const chartData = useMemo(() => {
    const range = timeRanges.find((r) => r.label === timeRange)!;
    const slicedData = data.slice(-range.days);
    const sma20 = calculateSMA(data, 20).slice(-range.days);
    const sma50 = calculateSMA(data, 50).slice(-range.days);
    const bollinger = calculateBollingerBands(data);
    const bollingerUpper = bollinger.upper.slice(-range.days);
    const bollingerLower = bollinger.lower.slice(-range.days);

    return slicedData.map((d, i) => ({
      ...d,
      sma20: sma20[i],
      sma50: sma50[i],
      bollingerUpper: bollingerUpper[i],
      bollingerLower: bollingerLower[i],
      isUp: d.close >= d.open,
    }));
  }, [data, timeRange]);

  if (chartData.length === 0) return <div className="bg-card rounded-xl border border-border p-6 text-muted-foreground">No price data available</div>;
  const minPrice = Math.min(...chartData.map((d) => d.low)) * 0.98;
  const maxPrice = Math.max(...chartData.map((d) => d.high)) * 1.02;
  const maxVolume = Math.max(...chartData.map((d) => d.volume));

  const priceChange = chartData.length > 0
    ? ((chartData[chartData.length - 1].close - chartData[0].close) / chartData[0].close) * 100
    : 0;

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            {symbol} {t('priceChart')}
            <span className={cn(
              "text-sm font-mono px-2 py-0.5 rounded",
              priceChange >= 0 ? "bg-success/20 text-bullish" : "bg-destructive/20 text-bearish"
            )}>
              {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground">Historical price data</p>
            {lastUpdated && (
              <span className="text-xs text-muted-foreground/70">
                · Last updated: {new Date(lastUpdated).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {onRefresh && (
              <button
                onClick={() => {
                  clearSymbol(symbol);
                  onRefresh();
                  toast.success('Cache cleared, refreshing data...');
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
                title="Clear cache and refresh data"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMA(!showMA)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md transition-colors",
                showMA ? "bg-chart-maFast text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}
            >
              MA
            </button>
            <button
              onClick={() => setShowBollinger(!showBollinger)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md transition-colors",
                showBollinger ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
              )}
            >
              BB
            </button>
            <button
              onClick={() => setShowVolume(!showVolume)}
              className={cn(
                "px-3 py-1.5 text-xs rounded-md transition-colors",
                showVolume ? "bg-chart-volume text-foreground" : "bg-secondary text-muted-foreground"
              )}
            >
              Vol
            </button>
          </div>
          
          <div className="flex bg-secondary rounded-lg p-1">
            {timeRanges.map((range) => (
              <button
                key={range.label}
                onClick={() => setTimeRange(range.label)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                  timeRange === range.label
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="h-[400px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(173, 80%, 50%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(173, 80%, 50%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="bollingerGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(173, 80%, 50%)" stopOpacity={0.1} />
                <stop offset="100%" stopColor="hsl(173, 80%, 50%)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(222, 30%, 16%)"
              vertical={false}
            />
            
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }}
              tickFormatter={(value) => {
                const date = new Date(value);
                if (timeRange === '10Y' || timeRange === '5Y') {
                  return date.getFullYear().toString();
                }
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }}
              minTickGap={50}
            />
            
            <YAxis
              yAxisId="price"
              domain={[minPrice, maxPrice]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }}
              tickFormatter={(value) => `$${value.toFixed(0)}`}
              orientation="right"
              width={60}
            />
            
            {showVolume && (
              <YAxis
                yAxisId="volume"
                domain={[0, maxVolume * 4]}
                axisLine={false}
                tickLine={false}
                tick={false}
                width={0}
              />
            )}
            
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(222, 47%, 10%)',
                border: '1px solid hsl(222, 30%, 16%)',
                borderRadius: '8px',
                padding: '12px',
              }}
              labelStyle={{ color: 'hsl(210, 40%, 98%)', marginBottom: '8px' }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  close: 'Close',
                  sma20: 'SMA 20',
                  sma50: 'SMA 50',
                  bollingerUpper: 'BB Upper',
                  bollingerLower: 'BB Lower',
                  volume: 'Volume',
                };
                if (name === 'volume') {
                  return [(value / 1000000).toFixed(2) + 'M', labels[name]];
                }
                return ['$' + value.toFixed(2), labels[name] || name];
              }}
            />
            
            {showVolume && (
              <Bar
                yAxisId="volume"
                dataKey="volume"
                fill="hsl(222, 30%, 25%)"
                opacity={0.5}
              />
            )}
            
            {showBollinger && (
              <>
                <Area
                  yAxisId="price"
                  dataKey="bollingerUpper"
                  stroke="none"
                  fill="url(#bollingerGradient)"
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="bollingerUpper"
                  stroke="hsl(173, 80%, 50%)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="bollingerLower"
                  stroke="hsl(173, 80%, 50%)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  dot={false}
                  connectNulls
                />
              </>
            )}
            
            <Area
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="none"
              fill="url(#priceGradient)"
            />
            
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="hsl(173, 80%, 50%)"
              strokeWidth={2}
              dot={false}
            />
            
            {showMA && (
              <>
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="sma20"
                  stroke="hsl(280, 70%, 60%)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="sma50"
                  stroke="hsl(200, 80%, 60%)"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-6 mt-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-primary rounded" />
          <span className="text-muted-foreground">{t('price')}</span>
        </div>
        {showMA && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-chart-maFast rounded" />
              <span className="text-muted-foreground">SMA 20</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-chart-maSlow rounded" />
              <span className="text-muted-foreground">SMA 50</span>
            </div>
          </>
        )}
        {showBollinger && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-0.5 bg-primary/50 rounded border-dashed" />
            <span className="text-muted-foreground">Bollinger Bands</span>
          </div>
        )}
      </div>
    </div>
  );
}
