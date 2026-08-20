import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Activity, Zap } from 'lucide-react';
import { StockData, calculateRSI } from '@/lib/stockData';
import { cn } from '@/lib/utils';

interface MultiTimeframeRSIProps {
  data: StockData[];
}

interface RSISignal {
  type: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  label: string;
  description: string;
  strength: number;
  color: string;
  icon: typeof TrendingUp;
}

function generateMultiRSISignal(rsi7: number | null, rsi14: number | null, rsi21: number | null): RSISignal {
  if (rsi7 === null || rsi14 === null || rsi21 === null) {
    return {
      type: 'neutral',
      label: 'Insufficient Data',
      description: 'Waiting for RSI calculations',
      strength: 0,
      color: 'text-muted-foreground',
      icon: Minus,
    };
  }

  // Strong Buy: All RSIs oversold
  if (rsi7 < 30 && rsi14 < 30 && rsi21 < 30) {
    return {
      type: 'strong_buy',
      label: 'Strong Buy',
      description: 'All timeframes oversold - high probability reversal',
      strength: 95,
      color: 'text-bullish',
      icon: TrendingUp,
    };
  }

  // Strong Sell: All RSIs overbought
  if (rsi7 > 70 && rsi14 > 70 && rsi21 > 70) {
    return {
      type: 'strong_sell',
      label: 'Strong Sell',
      description: 'All timeframes overbought - high probability pullback',
      strength: 95,
      color: 'text-bearish',
      icon: TrendingDown,
    };
  }

  // Buy: Short-term oversold with medium-term confirmation
  if (rsi7 < 30 && rsi14 < 40) {
    return {
      type: 'buy',
      label: 'Buy Signal',
      description: 'Short-term oversold with medium-term confirmation',
      strength: 75,
      color: 'text-bullish',
      icon: TrendingUp,
    };
  }

  // Sell: Short-term overbought with medium-term confirmation
  if (rsi7 > 70 && rsi14 > 60) {
    return {
      type: 'sell',
      label: 'Sell Signal',
      description: 'Short-term overbought with medium-term confirmation',
      strength: 75,
      color: 'text-bearish',
      icon: TrendingDown,
    };
  }

  // Bullish momentum: RSI7 crossing above RSI14 while below 50
  if (rsi7 > rsi14 && rsi7 < 50 && rsi14 < 45) {
    return {
      type: 'buy',
      label: 'Bullish Momentum',
      description: 'Short-term RSI crossing above medium-term - early reversal',
      strength: 60,
      color: 'text-bullish',
      icon: TrendingUp,
    };
  }

  // Bearish momentum: RSI7 crossing below RSI14 while above 50
  if (rsi7 < rsi14 && rsi7 > 50 && rsi14 > 55) {
    return {
      type: 'sell',
      label: 'Bearish Momentum',
      description: 'Short-term RSI crossing below medium-term - early weakness',
      strength: 60,
      color: 'text-bearish',
      icon: TrendingDown,
    };
  }

  // Neutral
  return {
    type: 'neutral',
    label: 'Neutral',
    description: 'No clear signal - wait for confluence',
    strength: 50,
    color: 'text-neutral',
    icon: Minus,
  };
}

export function MultiTimeframeRSI({ data }: MultiTimeframeRSIProps) {
  const { chartData, latestValues, signal } = useMemo(() => {
    const slicedData = data.slice(-126); // Last 6 months
    const rsi7 = calculateRSI(data, 7).slice(-126);
    const rsi14 = calculateRSI(data, 14).slice(-126);
    const rsi21 = calculateRSI(data, 21).slice(-126);

    const chartData = slicedData.map((d, i) => ({
      date: d.date,
      rsi7: rsi7[i],
      rsi14: rsi14[i],
      rsi21: rsi21[i],
    }));

    const latest = chartData[chartData.length - 1];
    const signal = generateMultiRSISignal(latest?.rsi7 ?? null, latest?.rsi14 ?? null, latest?.rsi21 ?? null);

    return {
      chartData,
      latestValues: {
        rsi7: latest?.rsi7,
        rsi14: latest?.rsi14,
        rsi21: latest?.rsi21,
      },
      signal,
    };
  }, [data]);

  const SignalIcon = signal.icon;

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Multi-Timeframe RSI
          </h3>
          <p className="text-sm text-muted-foreground">Confluence analysis across RSI(7), RSI(14), RSI(21)</p>
        </div>
        <div className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-lg font-semibold",
          signal.type === 'strong_buy' || signal.type === 'buy' ? 'bg-bullish/20 text-bullish' :
          signal.type === 'strong_sell' || signal.type === 'sell' ? 'bg-bearish/20 text-bearish' :
          'bg-neutral/20 text-neutral'
        )}>
          <SignalIcon className="h-4 w-4" />
          {signal.label}
        </div>
      </div>

      {/* RSI Values Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-secondary/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Zap className="h-3 w-3" />
            RSI (7)
          </div>
          <div className={cn(
            "font-mono font-bold text-lg",
            (latestValues.rsi7 ?? 50) < 30 ? "text-bullish" :
            (latestValues.rsi7 ?? 50) > 70 ? "text-bearish" : "text-foreground"
          )}>
            {latestValues.rsi7?.toFixed(1) || 'N/A'}
          </div>
          <div className="text-xs text-muted-foreground">Short-term</div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <Activity className="h-3 w-3" />
            RSI (14)
          </div>
          <div className={cn(
            "font-mono font-bold text-lg",
            (latestValues.rsi14 ?? 50) < 30 ? "text-bullish" :
            (latestValues.rsi14 ?? 50) > 70 ? "text-bearish" : "text-foreground"
          )}>
            {latestValues.rsi14?.toFixed(1) || 'N/A'}
          </div>
          <div className="text-xs text-muted-foreground">Standard</div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <TrendingUp className="h-3 w-3" />
            RSI (21)
          </div>
          <div className={cn(
            "font-mono font-bold text-lg",
            (latestValues.rsi21 ?? 50) < 30 ? "text-bullish" :
            (latestValues.rsi21 ?? 50) > 70 ? "text-bearish" : "text-foreground"
          )}>
            {latestValues.rsi21?.toFixed(1) || 'N/A'}
          </div>
          <div className="text-xs text-muted-foreground">Long-term</div>
        </div>
        <div className="bg-secondary/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
            <SignalIcon className="h-3 w-3" />
            Signal Strength
          </div>
          <div className={cn("font-mono font-bold text-lg", signal.color)}>
            {signal.strength}%
          </div>
          <div className="text-xs text-muted-foreground">Confluence</div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[200px] mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="rsi7Gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(173, 80%, 50%)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="hsl(173, 80%, 50%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }}
              tickFormatter={(value) => {
                const date = new Date(value);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              }}
              minTickGap={50}
            />
            <YAxis
              domain={[0, 100]}
              axisLine={false}
              tickLine={false}
              tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }}
              ticks={[20, 30, 50, 70, 80]}
              width={30}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(222, 47%, 10%)',
                border: '1px solid hsl(222, 30%, 16%)',
                borderRadius: '8px',
              }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  rsi7: 'RSI (7)',
                  rsi14: 'RSI (14)',
                  rsi21: 'RSI (21)',
                };
                return [value?.toFixed(2), labels[name] || name];
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: '10px' }}
              formatter={(value) => {
                const labels: Record<string, string> = {
                  rsi7: 'RSI (7)',
                  rsi14: 'RSI (14)',
                  rsi21: 'RSI (21)',
                };
                return <span className="text-muted-foreground text-xs">{labels[value] || value}</span>;
              }}
            />
            
            {/* Overbought/Oversold zones */}
            <ReferenceLine y={70} stroke="hsl(0, 72%, 51%)" strokeDasharray="4 4" opacity={0.5} />
            <ReferenceLine y={30} stroke="hsl(160, 84%, 39%)" strokeDasharray="4 4" opacity={0.5} />
            <ReferenceLine y={50} stroke="hsl(222, 30%, 30%)" strokeDasharray="2 2" opacity={0.3} />

            {/* RSI Lines */}
            <Line
              type="monotone"
              dataKey="rsi7"
              stroke="hsl(173, 80%, 50%)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rsi14"
              stroke="hsl(280, 70%, 60%)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rsi21"
              stroke="hsl(38, 92%, 50%)"
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Signal Description */}
      <div className={cn(
        "p-3 rounded-lg border",
        signal.type === 'strong_buy' || signal.type === 'buy' ? 'bg-bullish/10 border-bullish/30' :
        signal.type === 'strong_sell' || signal.type === 'sell' ? 'bg-bearish/10 border-bearish/30' :
        'bg-secondary/50 border-border'
      )}>
        <div className="flex items-center gap-2">
          <SignalIcon className={cn("h-4 w-4", signal.color)} />
          <span className={cn("font-medium text-sm", signal.color)}>{signal.label}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{signal.description}</p>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-6 mt-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 rounded" style={{ backgroundColor: 'hsl(173, 80%, 50%)' }} />
          <span className="text-muted-foreground">RSI (7) Fast</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 rounded" style={{ backgroundColor: 'hsl(280, 70%, 60%)' }} />
          <span className="text-muted-foreground">RSI (14) Standard</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 rounded" style={{ backgroundColor: 'hsl(38, 92%, 50%)' }} />
          <span className="text-muted-foreground">RSI (21) Slow</span>
        </div>
      </div>
    </div>
  );
}
