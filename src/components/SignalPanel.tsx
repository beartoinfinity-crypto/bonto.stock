import { useMemo } from 'react';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
  Zap,
  TrendingUp,
  TrendingDown,
  BarChart2,
  Activity,
  Target,
  Lightbulb,
} from 'lucide-react';
import { Signal } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n';

interface SignalPanelProps {
  signals: Signal[];
}

const strategyIcons: Record<string, React.ElementType> = {
  'MA Crossover': TrendingUp,
  'RSI': Activity,
  'MACD': BarChart2,
  'Bollinger': Zap,
  'Volume': BarChart2,
  'Candle': Activity,
  'S/R Break': Target,
  'Multi-TF RSI': Activity,
};

const signalCardClass = (type: Signal['type'], confidence: number) => {
  if (type === 'hold') return 'border-border bg-muted/20';
  const strong = confidence >= 70;
  if (type === 'buy') return strong ? 'border-green-500/40 bg-green-500/[0.12]' : 'border-green-500/25 bg-green-500/[0.06]';
  return strong ? 'border-red-500/40 bg-red-500/[0.12]' : 'border-red-500/25 bg-red-500/[0.06]';
};

const confidenceText = (type: Signal['type']) =>
  type === 'buy' ? 'text-green-400' : type === 'sell' ? 'text-red-400' : 'text-muted-foreground';

const typeChipClass = (type: Signal['type']) =>
  type === 'buy'
    ? 'bg-green-500/15 text-green-400'
    : type === 'sell'
      ? 'bg-red-500/15 text-red-400'
      : 'bg-muted text-muted-foreground';

export function SignalPanel({ signals }: SignalPanelProps) {
  const { t } = useLanguage();

  const stats = useMemo(() => {
    const buys = signals.filter(s => s.type === 'buy');
    const sells = signals.filter(s => s.type === 'sell');
    const holds = signals.filter(s => s.type === 'hold');

    const buyScore = buys.reduce((sum, s) => sum + s.confidence, 0);
    const sellScore = sells.reduce((sum, s) => sum + s.confidence, 0);
    const totalScore = signals.reduce((sum, s) => sum + s.confidence, 0);
    const net = totalScore > 0 ? ((buyScore - sellScore) / totalScore) * 100 : 0;

    const directional = buys.length + sells.length;
    const avgConfidence = directional > 0 ? (buyScore + sellScore) / directional : 0;

    const buyStrategies = new Set(buys.map(s => s.strategy));
    const sellStrategies = new Set(sells.map(s => s.strategy));

    return {
      buys,
      sells,
      holds,
      net,
      avgConfidence,
      directional,
      aligned: Math.max(buyStrategies.size, sellStrategies.size),
      strategyCount: new Set(signals.map(s => s.strategy)).size,
    };
  }, [signals]);

  const sorted = useMemo(
    () =>
      [...signals].sort(
        (a, b) =>
          (a.type === 'hold' ? 1 : 0) - (b.type === 'hold' ? 1 : 0) || b.confidence - a.confidence,
      ),
    [signals],
  );

  const latestDate = useMemo(
    () => signals.reduce((latest, s) => (s.date > latest ? s.date : latest), signals[0]?.date ?? ''),
    [signals],
  );

  if (signals.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 card-glow">
        <h3 className="text-lg font-semibold">{t('tradingSignals')}</h3>
        <p className="text-sm text-muted-foreground mt-2">No active signals — need more data.</p>
      </div>
    );
  }

  const verdict =
    stats.net > 60
      ? { label: t('strongBuy'), text: 'text-green-400', Icon: TrendingUp }
      : stats.net > 20
        ? { label: t('buy'), text: 'text-green-500', Icon: TrendingUp }
        : stats.net < -60
          ? { label: t('strongSell'), text: 'text-red-400', Icon: TrendingDown }
          : stats.net < -20
            ? { label: t('sell'), text: 'text-red-500', Icon: TrendingDown }
            : { label: t('hold'), text: 'text-yellow-500', Icon: MinusCircle };

  const VerdictIcon = verdict.Icon;
  const litSegments = Math.min(10, Math.round(Math.abs(stats.net) / 10));

  const agreement = (() => {
    const { buys, sells, holds, strategyCount } = stats;
    if (buys.length > 0 && sells.length > 0) {
      const buyLeads = buys.length >= sells.length;
      const leadCount = buyLeads ? buys.length : sells.length;
      const lagCount = buyLeads ? sells.length : buys.length;
      return `${leadCount} strategies ${buyLeads ? 'bullish' : 'bearish'} · ${lagCount} ${
        buyLeads ? 'bearish' : 'bullish'
      } — conflicting`;
    }
    if (buys.length > 0) {
      return holds.length > 0
        ? `${buys.length} strategies bullish · ${holds.length} neutral — broad agreement`
        : `All ${buys.length} strategies bullish`;
    }
    if (sells.length > 0) {
      return holds.length > 0
        ? `${sells.length} strategies bearish · ${holds.length} neutral — broad agreement`
        : `All ${sells.length} strategies bearish`;
    }
    return `All ${strategyCount} strategies neutral — no conviction`;
  })();

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow space-y-4">
      <h3 className="text-lg font-semibold flex items-center gap-2">
        <Zap className="h-5 w-5 text-primary" />
        {t('tradingSignals')}
      </h3>

      <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className={cn('flex items-center gap-2', verdict.text)}>
              <VerdictIcon className="h-5 w-5 shrink-0" />
              <span className="text-2xl font-bold uppercase leading-none">{verdict.label}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              <span className={cn('font-semibold', verdict.text)}>{stats.directional}</span> of{' '}
              {stats.strategyCount} strategies flagged
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{t('netScore')}</p>
            <p className={cn('text-2xl font-bold tabular-nums leading-none', verdict.text)}>
              {stats.net > 0 ? '+' : ''}
              {stats.net.toFixed(0)}
            </p>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex gap-1" aria-hidden="true">
            {Array.from({ length: 20 }).map((_, i) => {
              const isBull = i >= 10;
              const distance = isBull ? i - 10 : 9 - i;
              const active = distance < litSegments && isBull === (stats.net >= 0);
              return (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    active ? (stats.net >= 0 ? 'bg-green-500' : 'bg-red-500') : 'bg-border',
                  )}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{t('bearish')}</span>
            <span>{t('bullish')}</span>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-md bg-background/70 px-2.5 py-2">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
          <p className="text-sm font-medium leading-snug">{agreement}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-background/70 p-2">
            <div className="text-lg font-bold tabular-nums text-primary">{stats.aligned}</div>
            <div className="text-[10px] text-muted-foreground">{t('strategiesAligned')}</div>
          </div>
          <div className="rounded-lg bg-background/70 p-2">
            <div
              className={cn(
                'text-lg font-bold tabular-nums',
                stats.directional === 0
                  ? 'text-muted-foreground'
                  : confidenceText(stats.net >= 0 ? 'buy' : 'sell'),
              )}
            >
              {stats.directional === 0 ? '—' : `${stats.avgConfidence.toFixed(0)}%`}
            </div>
            <div className="text-[10px] text-muted-foreground">{t('avgConfidence')}</div>
          </div>
          <div className="rounded-lg bg-background/70 p-2">
            <div className="text-lg font-bold tabular-nums">
              <span className="text-green-400">{stats.buys.length}</span>
              <span className="text-muted-foreground">–</span>
              <span className="text-red-400">{stats.sells.length}</span>
            </div>
            <div className="text-[10px] text-muted-foreground">{t('buySell')}</div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('signals')}
          </span>
          <span className="text-xs text-muted-foreground">
            {stats.directional} flagged · {stats.holds.length} neutral
          </span>
        </div>

        <div className="max-h-[400px] space-y-2 overflow-y-auto pr-0.5">
          {sorted.map(signal => {
            const flagged = signal.type !== 'hold';
            const TypeIcon =
              signal.type === 'buy' ? ArrowUpCircle : signal.type === 'sell' ? ArrowDownCircle : MinusCircle;
            const StrategyIcon = strategyIcons[signal.strategy] || Zap;

            return (
              <div
                key={`${signal.strategy}-${signal.date}`}
                className={cn('rounded-md border px-3 py-2', signalCardClass(signal.type, signal.confidence))}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <TypeIcon className={cn('h-4 w-4 shrink-0', confidenceText(signal.type))} />
                    <StrategyIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">{signal.strategy}</span>
                    {flagged && (
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          typeChipClass(signal.type),
                        )}
                      >
                        Flag
                      </span>
                    )}
                    {flagged && signal.strength === 'strong' && (
                      <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        Strong
                      </span>
                    )}
                  </div>
                  <span className={cn('shrink-0 text-sm font-bold tabular-nums', confidenceText(signal.type))}>
                    {signal.confidence.toFixed(0)}%
                  </span>
                </div>
                <p
                  className={cn(
                    'mt-1 pl-6 text-xs leading-relaxed text-muted-foreground',
                    flagged ? 'line-clamp-2' : 'truncate',
                  )}
                  title={flagged ? signal.reason : undefined}
                >
                  {signal.reason}
                </p>
                {flagged && (signal.entryLevel || signal.stopLoss || signal.takeProfit) && (
                  <div className="mt-1 flex gap-3 pl-6 font-mono text-[11px]">
                    {signal.entryLevel && <span>E: ${signal.entryLevel.toFixed(2)}</span>}
                    {signal.stopLoss && <span className="text-red-400">SL: ${signal.stopLoss.toFixed(2)}</span>}
                    {signal.takeProfit && <span className="text-green-400">TP: ${signal.takeProfit.toFixed(2)}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs italic text-muted-foreground">
        * As of <span className="font-mono not-italic">{latestDate}</span> — rule-based signals on price action only,
        no backtested hit rate. Not investment advice.
      </p>
    </div>
  );
}
