import { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { StockData, calculateKDJ } from '@/lib/stockData';
import { cn } from '@/lib/utils';

interface KDJIndicatorProps {
  data: StockData[];
}

export function KDJIndicator({ data }: KDJIndicatorProps) {
  const chartData = useMemo(() => {
    const slicedData = data.slice(-126);
    const { k, d, j } = calculateKDJ(data);
    const kSliced = k.slice(-126);
    const dSliced = d.slice(-126);
    const jSliced = j.slice(-126);

    return slicedData.map((d, i) => ({
      date: d.date,
      k: kSliced[i],
      d: dSliced[i],
      j: jSliced[i],
    }));
  }, [data]);

  const latest = chartData[chartData.length - 1];
  const latestK = latest?.k;
  const latestD = latest?.d;
  const latestJ = latest?.j;

  const getKDJStatus = (k: number | null, d: number | null, j: number | null) => {
    if (k === null || d === null || j === null) return { label: 'N/A', color: 'text-muted-foreground' };
    if (j > 100) return { label: 'Overbought', color: 'text-bearish' };
    if (j < 0) return { label: 'Oversold', color: 'text-bullish' };
    if (k > d) return { label: 'Bullish', color: 'text-bullish' };
    return { label: 'Bearish', color: 'text-bearish' };
  };

  const status = getKDJStatus(latestK, latestD, latestJ);

  return (
    <div className="bg-card rounded-xl border border-border p-4 card-glow">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="font-semibold">KDJ Indicator</h4>
          <p className="text-xs text-muted-foreground">Stochastic Oscillator with J-line</p>
        </div>
        <div className="text-right">
          <div className="font-mono font-bold text-lg">
            K:{latestK?.toFixed(1) || 'N/A'} D:{latestD?.toFixed(1) || 'N/A'}
          </div>
          <div className={cn("text-xs font-medium", status.color)}>{status.label}</div>
        </div>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis domain={[-20, 120]} axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} ticks={[0, 20, 50, 80, 100]} width={30} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }}
              formatter={(value: number, name: string) => [value?.toFixed(2), name.toUpperCase()]}
            />
            <ReferenceLine y={80} stroke="hsl(0, 72%, 51%)" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine y={20} stroke="hsl(160, 84%, 39%)" strokeDasharray="3 3" opacity={0.5} />
            <ReferenceLine y={50} stroke="hsl(222, 30%, 30%)" strokeDasharray="2 2" opacity={0.3} />
            <Line type="monotone" dataKey="k" stroke="hsl(173, 80%, 50%)" strokeWidth={2} dot={false} connectNulls name="K" />
            <Line type="monotone" dataKey="d" stroke="hsl(280, 70%, 60%)" strokeWidth={2} dot={false} connectNulls name="D" />
            <Line type="monotone" dataKey="j" stroke="hsl(45, 93%, 50%)" strokeWidth={1.5} dot={false} connectNulls opacity={0.7} name="J" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground mt-2">
        <div className="flex items-center gap-1">
          <div className="w-2 h-0.5 bg-bullish rounded" />
          <span>Oversold &lt;20</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-primary rounded" />
            <span>K</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-chart-maFast rounded" />
            <span>D</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-0.5 bg-yellow-400 rounded" />
            <span>J</span>
          </div>
        </div>
        <span className="text-bearish">Overbought &gt;80</span>
      </div>
    </div>
  );
}
