import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Bar, ComposedChart,
} from 'recharts';
import { StockData, calculateRSI, calculateMACD } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n';

interface TechnicalIndicatorsProps {
  data: StockData[];
}

export function TechnicalIndicators({ data }: TechnicalIndicatorsProps) {
  const { t } = useLanguage();

  const chartData = useMemo(() => {
    const slicedData = data.slice(-126);
    const rsi = calculateRSI(data).slice(-126);
    const { macd, signal, histogram } = calculateMACD(data);
    const macdSliced = macd.slice(-126);
    const signalSliced = signal.slice(-126);
    const histogramSliced = histogram.slice(-126);

    return slicedData.map((d, i) => ({
      date: d.date,
      rsi: rsi[i],
      macd: macdSliced[i],
      signal: signalSliced[i],
      histogram: histogramSliced[i],
    }));
  }, [data]);

  const latestRSI = chartData[chartData.length - 1]?.rsi;
  const latestMACD = chartData[chartData.length - 1]?.macd;
  const latestSignal = chartData[chartData.length - 1]?.signal;

  const getRSIStatus = (rsi: number | null) => {
    if (!rsi) return { label: 'N/A', color: 'text-muted-foreground' };
    if (rsi > 70) return { label: t('overbought'), color: 'text-bearish' };
    if (rsi < 30) return { label: t('oversold'), color: 'text-bullish' };
    return { label: t('neutral'), color: 'text-neutral' };
  };

  const getMACDStatus = (macd: number | null, signal: number | null) => {
    if (macd === null || signal === null) return { label: 'N/A', color: 'text-muted-foreground' };
    if (macd > signal) return { label: t('bullish'), color: 'text-bullish' };
    return { label: t('bearish'), color: 'text-bearish' };
  };

  const rsiStatus = getRSIStatus(latestRSI);
  const macdStatus = getMACDStatus(latestMACD, latestSignal);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* RSI Chart */}
      <div className="bg-card rounded-xl border border-border p-4 card-glow">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-semibold">{t('rsiCurrent')}</h4>
            <p className="text-xs text-muted-foreground">{t('rsiIndicator')}</p>
          </div>
          <div className="text-right">
            <div className="font-mono font-bold text-lg">{latestRSI?.toFixed(1) || 'N/A'}</div>
            <div className={cn("text-xs font-medium", rsiStatus.color)}>{rsiStatus.label}</div>
          </div>
        </div>

        <div className="h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} ticks={[30, 50, 70]} width={30} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }}
                formatter={(value: number) => [value?.toFixed(2), 'RSI']}
              />
              <ReferenceLine y={70} stroke="hsl(0, 72%, 51%)" strokeDasharray="3 3" opacity={0.5} />
              <ReferenceLine y={30} stroke="hsl(160, 84%, 39%)" strokeDasharray="3 3" opacity={0.5} />
              <Line type="monotone" dataKey="rsi" stroke="hsl(173, 80%, 50%)" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span className="text-bullish">{t('oversold')} &lt;30</span>
          <span className="text-bearish">{t('overbought')} &gt;70</span>
        </div>
      </div>

      {/* MACD Chart */}
      <div className="bg-card rounded-xl border border-border p-4 card-glow">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="font-semibold">{t('macdCurrent')}</h4>
            <p className="text-xs text-muted-foreground">{t('macdIndicator')}</p>
          </div>
          <div className="text-right">
            <div className="font-mono font-bold text-lg">{latestMACD?.toFixed(2) || 'N/A'}</div>
            <div className={cn("text-xs font-medium", macdStatus.color)}>{macdStatus.label}</div>
          </div>
        </div>

        <div className="h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} width={35} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }}
                formatter={(value: number, name: string) => [value?.toFixed(2), name === 'macd' ? 'MACD' : name === 'signal' ? 'Signal' : 'Histogram']}
              />
              <ReferenceLine y={0} stroke="hsl(222, 30%, 30%)" />
              <Bar dataKey="histogram" fill="hsl(173, 80%, 50%)" opacity={0.5} />
              <Line type="monotone" dataKey="macd" stroke="hsl(173, 80%, 50%)" strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="signal" stroke="hsl(280, 70%, 60%)" strokeWidth={2} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="flex justify-center gap-4 text-xs mt-2">
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-primary rounded" />
            <span className="text-muted-foreground">MACD</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-chart-maFast rounded" />
            <span className="text-muted-foreground">Signal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
