import { useMemo } from 'react';
import { ArrowUpCircle, ArrowDownCircle, MinusCircle, Zap, TrendingUp, BarChart2, Activity, Target, Shield, Lightbulb } from 'lucide-react';
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

const confidenceColor = (conf: number) => {
  if (conf >= 75) return 'text-green-500';
  if (conf >= 60) return 'text-yellow-500';
  return 'text-muted-foreground';
};

const confidenceBg = (conf: number) => {
  if (conf >= 75) return 'bg-green-500/15 border-green-500/30';
  if (conf >= 60) return 'bg-yellow-500/10 border-yellow-500/25';
  return 'bg-muted/30 border-border';
};

export function SignalPanel({ signals }: SignalPanelProps) {
  const { t } = useLanguage();

  const { buySignals, sellSignals, holdSignals, avgConfidence, confluence } = useMemo(() => {
    const buy = signals.filter(s => s.type === 'buy');
    const sell = signals.filter(s => s.type === 'sell');
    const hold = signals.filter(s => s.type === 'hold');
    const avg = signals.length > 0 ? signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length : 0;
    
    // Confluence: how many strategies agree on direction
    const strategies = new Set(signals.map(s => s.strategy));
    const buyStrategies = new Set(buy.map(s => s.strategy));
    const sellStrategies = new Set(sell.map(s => s.strategy));
    const confluence = Math.max(buyStrategies.size, sellStrategies.size);
    
    return { buySignals: buy, sellSignals: sell, holdSignals: hold, avgConfidence: avg, confluence };
  }, [signals]);

  const overallAction = useMemo(() => {
    const buyScore = buySignals.reduce((s, sig) => s + sig.confidence, 0);
    const sellScore = sellSignals.reduce((s, sig) => s + sig.confidence, 0);
    const diff = buyScore - sellScore;
    if (diff > 80) return { label: 'STRONG BUY', color: 'text-green-400', bg: 'bg-green-500/20' };
    if (diff > 30) return { label: 'BUY', color: 'text-green-500', bg: 'bg-green-500/10' };
    if (diff < -80) return { label: 'STRONG SELL', color: 'text-red-400', bg: 'bg-red-500/20' };
    if (diff < -30) return { label: 'SELL', color: 'text-red-500', bg: 'bg-red-500/10' };
    return { label: 'HOLD', color: 'text-yellow-500', bg: 'bg-yellow-500/10' };
  }, [buySignals, sellSignals]);

  // Best actionable signal (highest confidence buy or sell with entry levels)
  const bestSignal = useMemo(() => {
    const actionable = signals.filter(s => s.type !== 'hold' && s.entryLevel);
    return actionable.sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  }, [signals]);

  if (signals.length === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-6 card-glow">
        <h3 className="text-lg font-semibold">{t('tradingSignals')}</h3>
        <p className="text-sm text-muted-foreground mt-2">No active signals — need more data.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('tradingSignals')}</h3>
          <p className="text-xs text-muted-foreground">{signals.length} signals from {new Set(signals.map(s => s.strategy)).size} strategies</p>
        </div>
        <div className={cn("px-3 py-2 rounded-lg text-center", overallAction.bg)}>
          <div className={cn("text-lg font-bold", overallAction.color)}>{overallAction.label}</div>
          <div className="text-[10px] text-muted-foreground">Avg confidence</div>
        </div>
      </div>

      {/* Confluence & Confidence Bar */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-muted/30 p-2">
          <div className="text-lg font-bold text-primary">{confluence}</div>
          <div className="text-[10px] text-muted-foreground">Strategies Aligned</div>
        </div>
        <div className="rounded-lg bg-muted/30 p-2">
          <div className={cn("text-lg font-bold", confidenceColor(avgConfidence))}>{avgConfidence.toFixed(0)}%</div>
          <div className="text-[10px] text-muted-foreground">Avg Confidence</div>
        </div>
        <div className="rounded-lg bg-muted/30 p-2">
          <div className="text-lg font-bold text-primary">{buySignals.length}/{sellSignals.length}</div>
          <div className="text-[10px] text-muted-foreground">Buy / Sell</div>
        </div>
      </div>

      {/* Best actionable signal */}
      {bestSignal && (
        <div className={cn("rounded-lg border p-3 space-y-1", confidenceBg(bestSignal.confidence))}>
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-yellow-500" />
            <span className="text-sm font-semibold">Best Setup: {bestSignal.strategy}</span>
            <span className={cn("text-xs font-bold px-2 py-0.5 rounded",
              bestSignal.type === 'buy' ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500'
            )}>{bestSignal.type.toUpperCase()}</span>
          </div>
          <p className="text-xs text-muted-foreground">{bestSignal.reason}</p>
          <div className="flex gap-4 text-xs mt-1">
            {bestSignal.entryLevel && <span>Entry: <span className="font-mono font-bold">${bestSignal.entryLevel.toFixed(2)}</span></span>}
            {bestSignal.stopLoss && <span>Stop: <span className="font-mono font-bold text-red-400">${bestSignal.stopLoss.toFixed(2)}</span></span>}
            {bestSignal.takeProfit && <span>Target: <span className="font-mono font-bold text-green-400">${bestSignal.takeProfit.toFixed(2)}</span></span>}
          </div>
        </div>
      )}

      {/* All signals */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {signals.sort((a, b) => b.confidence - a.confidence).map((signal, index) => {
          const StrategyIcon = strategyIcons[signal.strategy] || Zap;
          const typeIcon = signal.type === 'buy' ? ArrowUpCircle : signal.type === 'sell' ? ArrowDownCircle : MinusCircle;
          const TypeIcon = typeIcon;
          const typeColor = signal.type === 'buy' ? 'text-green-500' : signal.type === 'sell' ? 'text-red-500' : 'text-yellow-500';
          const typeBg = signal.type === 'buy' ? 'bg-green-500/10' : signal.type === 'sell' ? 'bg-red-500/10' : 'bg-yellow-500/10';

          return (
            <div
              key={`${signal.strategy}-${index}`}
              className={cn("p-3 rounded-lg border transition-all hover:scale-[1.01]", confidenceBg(signal.confidence))}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <TypeIcon className={cn("h-4 w-4 mt-0.5 shrink-0", typeColor)} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StrategyIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm font-semibold">{signal.strategy}</span>
                      <span className={cn("text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", typeBg, typeColor)}>
                        {signal.type}
                      </span>
                      {signal.strength === 'strong' && (
                        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary">strong</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{signal.reason}</p>
                    {(signal.entryLevel || signal.stopLoss || signal.takeProfit) && (
                      <div className="flex gap-3 text-[11px] mt-1 font-mono">
                        {signal.entryLevel && <span>E: ${signal.entryLevel.toFixed(2)}</span>}
                        {signal.stopLoss && <span className="text-red-400">SL: ${signal.stopLoss.toFixed(2)}</span>}
                        {signal.takeProfit && <span className="text-green-400">TP: ${signal.takeProfit.toFixed(2)}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className={cn("text-sm font-bold", confidenceColor(signal.confidence))}>{signal.confidence}%</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground italic pt-1">
        Signals are computed from price action only. Always confirm with volume and market context.
      </p>
    </div>
  );
}
