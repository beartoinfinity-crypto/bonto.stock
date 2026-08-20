import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, Award, Target, AlertTriangle } from 'lucide-react';
import { StrategyPerformance as StrategyPerformanceType, calculateStrategyPerformance } from '@/lib/stockData';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n';

export function StrategyPerformance() {
  const { t } = useLanguage();
  const strategies = calculateStrategyPerformance();

  const bestStrategy = strategies.reduce((best, s) => 
    s.sharpeRatio > best.sharpeRatio ? s : best
  , strategies[0]);

  return (
    <div className="bg-card rounded-xl border border-border p-6 card-glow">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            {t('strategyPerformance')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('historicalBacktest')}</p>
        </div>
        <div className="px-3 py-1.5 bg-primary/20 rounded-lg">
          <div className="text-xs text-muted-foreground">{t('bestStrategy')}</div>
          <div className="font-semibold text-primary">{bestStrategy.strategy}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('strategy')}</th>
              <th className="text-right">{t('winRate')}</th>
              <th className="text-right">{t('avgReturn')}</th>
              <th className="text-right">{t('trades')}</th>
              <th className="text-right">{t('profitFactor')}</th>
              <th className="text-right">{t('maxDD')}</th>
              <th className="text-right">{t('sharpe')}</th>
            </tr>
          </thead>
          <tbody>
            {strategies.map((strategy) => (
              <tr key={strategy.strategy} className={cn(strategy.strategy === bestStrategy.strategy && "bg-primary/5")}>
                <td className="font-medium">
                  <div className="flex items-center gap-2">
                    {strategy.strategy === bestStrategy.strategy && <Award className="h-4 w-4 text-primary" />}
                    {strategy.strategy}
                  </div>
                </td>
                <td className={cn("text-right", strategy.winRate >= 60 ? "text-bullish" : strategy.winRate >= 50 ? "text-neutral" : "text-bearish")}>{strategy.winRate}%</td>
                <td className={cn("text-right", strategy.avgReturn >= 15 ? "text-bullish" : strategy.avgReturn >= 10 ? "text-neutral" : "text-muted-foreground")}>+{strategy.avgReturn}%</td>
                <td className="text-right text-muted-foreground">{strategy.totalTrades}</td>
                <td className={cn("text-right", strategy.profitFactor >= 2 ? "text-bullish" : strategy.profitFactor >= 1.5 ? "text-neutral" : "text-bearish")}>{strategy.profitFactor.toFixed(2)}</td>
                <td className="text-right text-bearish">{strategy.maxDrawdown}%</td>
                <td className={cn("text-right font-semibold", strategy.sharpeRatio >= 1.5 ? "text-bullish" : strategy.sharpeRatio >= 1 ? "text-neutral" : "text-bearish")}>{strategy.sharpeRatio.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold mb-3">{t('winRate')}</h4>
        <div className="h-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={strategies} layout="vertical" margin={{ top: 0, right: 0, bottom: 0, left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(222, 30%, 16%)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 10 }} tickFormatter={(v) => v + '%'} />
              <YAxis type="category" dataKey="strategy" axisLine={false} tickLine={false} tick={{ fill: 'hsl(215, 20%, 55%)', fontSize: 11 }} width={95} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(222, 47%, 10%)', border: '1px solid hsl(222, 30%, 16%)', borderRadius: '8px' }} formatter={(value: number) => [value + '%', t('winRate')]} />
              <Bar dataKey="winRate" radius={[0, 4, 4, 0]}>
                {strategies.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.winRate >= 60 ? 'hsl(160, 84%, 39%)' : entry.winRate >= 55 ? 'hsl(173, 80%, 50%)' : 'hsl(38, 92%, 50%)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-4 p-3 bg-secondary/30 rounded-lg flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">{t('disclaimer')}</p>
      </div>
    </div>
  );
}
