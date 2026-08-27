import { useEffect, useRef, useMemo, useState } from 'react';
import { createChart, IChartApi, ICandlestickSeriesApi, IHistogramSeriesApi, Time, UTCTimestamp, ColorType } from 'lightweight-charts';
import { StockData } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { clearSymbol } from '@/lib/localDb';
import { RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/i18n';

interface TVChartProps {
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

const CHART_HEIGHT = 500;

function toChartTime(dateStr: string): UTCTimestamp {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toString();
}

export function TVChart({ data, symbol, lastUpdated, onRefresh }: TVChartProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ICandlestickSeriesApi | null>(null);
  const volumeSeriesRef = useRef<IHistogramSeriesApi | null>(null);

  const [timeRange, setTimeRange] = useState<TimeRange>('1Y');
  const [showMA, setShowMA] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);

  const { slicedData, sma20, sma50, bollingerUpper, bollingerLower, minPrice, maxPrice, maxVolume, priceChange } = useMemo(() => {
    const range = timeRanges.find((r) => r.label === timeRange)!;
    const sliced = data.slice(-range.days);

    const calcSMA = (period: number) => {
      const result: (number | null)[] = [];
      for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
          result.push(null);
        } else {
          let sum = 0;
          for (let j = i - period + 1; j <= i; j++) {
            sum += data[j].close;
          }
          result.push(sum / period);
        }
      }
      return result.slice(-range.days);
    };

    const sma20Data = calcSMA(20);
    const sma50Data = calcSMA(50);

    const calcBollinger = () => {
      const period = 20;
      const mult = 2;
      const upper: (number | null)[] = [];
      const lower: (number | null)[] = [];
      for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
          upper.push(null);
          lower.push(null);
        } else {
          const slice = data.slice(i - period + 1, i + 1);
          const mean = slice.reduce((s, d) => s + d.close, 0) / period;
          const variance = slice.reduce((s, d) => s + Math.pow(d.close - mean, 2), 0) / period;
          const sd = Math.sqrt(variance);
          upper.push(mean + mult * sd);
          lower.push(mean - mult * sd);
        }
      }
      return { upper: upper.slice(-range.days), lower: lower.slice(-range.days) };
    };

    const { upper: bbUpper, lower: bbLower } = calcBollinger();

    const prices = sliced.map((d) => d.close);
    const volumes = sliced.map((d) => d.volume);

    return {
      slicedData: sliced,
      sma20: sma20Data,
      sma50: sma50Data,
      bollingerUpper: bbUpper,
      bollingerLower: bbLower,
      minPrice: Math.min(...sliced.map((d) => d.low)) * 0.98,
      maxPrice: Math.max(...sliced.map((d) => d.high)) * 1.02,
      maxVolume: Math.max(...volumes),
      priceChange: sliced.length > 0
        ? ((sliced[sliced.length - 1].close - sliced[0].close) / sliced[0].close) * 100
        : 0,
    };
  }, [data, timeRange]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: '#0b0f19' },
        textColor: '#d1d4dc',
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: '#2a2e39', style: 1 },
        horzLines: { color: '#2a2e39', style: 1 },
      },
      rightPriceScale: {
        borderColor: '#2a2e39',
        borderVisible: true,
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.3 : 0.1 },
      },
      timeScale: {
        borderColor: '#2a2e39',
        borderVisible: true,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 1,
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceScaleId: 'price',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      color: '#787b86',
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      priceScale: {
        scaleMargins: { top: 0.8, bottom: 0 },
        borderVisible: false,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    const candleData = slicedData.map((d, i) => ({
      time: toChartTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    candleSeries.setData(candleData);

    const volumeData = slicedData.map((d) => ({
      time: toChartTime(d.date),
      value: d.volume,
      color: d.close >= d.open ? '#26a69a' : '#ef5350',
    }));
    volumeSeries.setData(volumeData);

    volumeSeries.applyOptions({ visible: showVolume });

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleData = slicedData.map((d) => ({
      time: toChartTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    candleSeriesRef.current.setData(candleData);

    const volumeData = slicedData.map((d) => ({
      time: toChartTime(d.date),
      value: d.volume,
      color: d.close >= d.open ? '#26a69a' : '#ef5350',
    }));
    volumeSeriesRef.current.setData(volumeData);

    if (chartRef.current) {
      chartRef.current.applyOptions({
        rightPriceScale: {
          scaleMargins: { top: 0.1, bottom: showVolume ? 0.3 : 0.1 },
        },
      });
    }
  }, [slicedData, showVolume]);

  useEffect(() => {
    if (!volumeSeriesRef.current) return;
    volumeSeriesRef.current.applyOptions({ visible: showVolume });
    if (chartRef.current) {
      chartRef.current.applyOptions({
        rightPriceScale: {
          scaleMargins: { top: 0.1, bottom: showVolume ? 0.3 : 0.1 },
        },
      });
    }
  }, [showVolume]);

  const handleRefresh = () => {
    clearSymbol(symbol);
    onRefresh?.();
    toast.success('Cache cleared, refreshing data...');
  };

  if (data.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 text-muted-foreground">
        No price data available
      </div>
    );
  }

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
                onClick={handleRefresh}
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

      <div 
        ref={containerRef} 
        id="tv-chart-container"
        data-testid="tv-chart-container"
        className="w-full" 
        style={{ height: CHART_HEIGHT }}
      />

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