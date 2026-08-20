import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';

type Sentiment = 'bullish' | 'bearish' | 'neutral';

interface Article {
  datetime: number;
  headline: string;
  summary: string;
}

interface Props {
  articles: Article[];
  analyzeSentiment: (headline: string, summary: string) => Sentiment;
}

export function NewsSentimentTrend({ articles, analyzeSentiment }: Props) {
  const chartData = useMemo(() => {
    // Group articles by date
    const byDate: Record<string, { bullish: number; bearish: number; neutral: number }> = {};

    articles.forEach((a) => {
      const date = format(new Date(a.datetime * 1000), 'MM/dd');
      if (!byDate[date]) byDate[date] = { bullish: 0, bearish: 0, neutral: 0 };
      const s = analyzeSentiment(a.headline, a.summary);
      byDate[date][s]++;
    });

    // Sort by date and compute cumulative sentiment score
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({
        date,
        bullish: counts.bullish,
        bearish: counts.bearish,
        neutral: counts.neutral,
        score: counts.bullish - counts.bearish,
      }));
  }, [articles, analyzeSentiment]);

  if (chartData.length < 2) return null;

  return (
    <div className="mb-3 p-3 rounded-lg border border-border bg-card/50">
      <p className="text-xs font-medium text-muted-foreground mb-2">Sentiment Trend (30d)</p>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="bullGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="bearGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--destructive))" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '8px',
              fontSize: '11px',
            }}
          />
          <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
          <Area type="monotone" dataKey="bullish" name="Bullish" stroke="hsl(var(--chart-2))" fill="url(#bullGrad)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="bearish" name="Bearish" stroke="hsl(var(--destructive))" fill="url(#bearGrad)" strokeWidth={1.5} />
          <Area type="monotone" dataKey="neutral" name="Neutral" stroke="hsl(var(--muted-foreground))" fill="none" strokeWidth={1} strokeDasharray="3 3" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
