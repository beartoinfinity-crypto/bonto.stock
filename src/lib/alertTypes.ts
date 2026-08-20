// Alert Types and Interfaces for the Alert System

export type AlertCategory = 'market_condition' | 'strategy_signal' | 'price_level';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'active' | 'triggered' | 'dismissed';

export interface Alert {
  id: string;
  category: AlertCategory;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  message: string;
  symbol: string;
  createdAt: string;
  triggeredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AlertRule {
  id: string;
  category: AlertCategory;
  enabled: boolean;
  name: string;
  description: string;
  // For market condition alerts
  conditionType?: 'regime_change' | 'volatility_spike' | 'momentum_shift' | 'rsi_extreme';
  // For strategy signal alerts
  strategyType?: 'ma_crossover' | 'rsi_reversal' | 'macd_crossover' | 'bollinger_breakout' | 'combined_signal';
  signalType?: 'buy' | 'sell' | 'any';
  signalStrength?: 'strong' | 'moderate' | 'any';
  // For price level alerts
  priceLevel?: number;
  priceCondition?: 'above' | 'below';
}

export interface MarketSnapshot {
  regime: string;
  regimeScore: number;
  volatility: string;
  volatilityPercentile: number;
  momentum: string;
  rsiValue: number;
  trendStrength: number;
}

export interface AlertConfig {
  rules: AlertRule[];
  soundEnabled: boolean;
  browserNotifications: boolean;
}

// Default alert rules
export const defaultAlertRules: AlertRule[] = [
  {
    id: 'regime-change',
    category: 'market_condition',
    enabled: true,
    name: 'Trend Regime Change',
    description: 'Alert when market trend changes (e.g., uptrend to downtrend)',
    conditionType: 'regime_change',
  },
  {
    id: 'volatility-spike',
    category: 'market_condition',
    enabled: true,
    name: 'Volatility Spike',
    description: 'Alert when volatility reaches extreme levels',
    conditionType: 'volatility_spike',
  },
  {
    id: 'rsi-extreme',
    category: 'market_condition',
    enabled: true,
    name: 'RSI Extreme',
    description: 'Alert when RSI reaches overbought (>70) or oversold (<30)',
    conditionType: 'rsi_extreme',
  },
  {
    id: 'ma-crossover-strong',
    category: 'strategy_signal',
    enabled: true,
    name: 'MA Crossover Signal',
    description: 'Alert on Golden Cross or Death Cross',
    strategyType: 'ma_crossover',
    signalType: 'any',
    signalStrength: 'strong',
  },
  {
    id: 'rsi-reversal-signal',
    category: 'strategy_signal',
    enabled: true,
    name: 'RSI Reversal Signal',
    description: 'Alert when RSI indicates reversal opportunity',
    strategyType: 'rsi_reversal',
    signalType: 'any',
    signalStrength: 'any',
  },
  {
    id: 'macd-crossover-signal',
    category: 'strategy_signal',
    enabled: true,
    name: 'MACD Crossover Signal',
    description: 'Alert on MACD line crossing signal line',
    strategyType: 'macd_crossover',
    signalType: 'any',
    signalStrength: 'any',
  },
  {
    id: 'combined-signal-strong',
    category: 'strategy_signal',
    enabled: false,
    name: 'Combined Signal',
    description: 'Alert when multiple strategies agree',
    strategyType: 'combined_signal',
    signalType: 'any',
    signalStrength: 'strong',
  },
];

export const defaultAlertConfig: AlertConfig = {
  rules: defaultAlertRules,
  soundEnabled: false,
  browserNotifications: true,
};
