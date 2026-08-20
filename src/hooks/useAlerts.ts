import { useState, useCallback, useEffect } from 'react';
import { 
  Alert, 
  AlertRule, 
  AlertConfig, 
  MarketSnapshot,
  defaultAlertConfig,
} from '@/lib/alertTypes';
import { Signal } from '@/lib/stockData';
import { MarketCondition } from '@/lib/strategyRecommendation';
import { toast } from 'sonner';
import * as storage from '@/lib/storage';

const ALERTS_STORAGE_KEY = 'stockpulse_alerts';
const CONFIG_STORAGE_KEY = 'stockpulse_alert_config';
const SNAPSHOT_STORAGE_KEY = 'stockpulse_market_snapshot';
const MAX_ALERTS = 50;

interface UseAlertsResult {
  alerts: Alert[];
  config: AlertConfig;
  addAlert: (alert: Omit<Alert, 'id' | 'createdAt' | 'status'>) => void;
  dismissAlert: (id: string) => void;
  clearAllAlerts: () => void;
  updateRule: (ruleId: string, updates: Partial<AlertRule>) => void;
  toggleRule: (ruleId: string) => void;
  updateConfig: (updates: Partial<AlertConfig>) => void;
  checkMarketConditions: (conditions: MarketCondition, symbol: string) => void;
  checkStrategySignals: (signals: Signal[], symbol: string) => void;
  unreadCount: number;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function loadFromStorage<T>(key: string, defaultValue: T): T {
  try {
    const stored = storage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveToStorage<T>(key: string, value: T): void {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('Failed to save to localStorage:', e);
  }
}

export function useAlerts(): UseAlertsResult {
  const [alerts, setAlerts] = useState<Alert[]>(() => 
    loadFromStorage<Alert[]>(ALERTS_STORAGE_KEY, [])
  );
  const [config, setConfig] = useState<AlertConfig>(() => 
    loadFromStorage<AlertConfig>(CONFIG_STORAGE_KEY, defaultAlertConfig)
  );
  const [lastSnapshot, setLastSnapshot] = useState<MarketSnapshot | null>(() =>
    loadFromStorage<MarketSnapshot | null>(SNAPSHOT_STORAGE_KEY, null)
  );
  const [processedSignals, setProcessedSignals] = useState<Set<string>>(new Set());

  // Persist alerts to localStorage
  useEffect(() => {
    saveToStorage(ALERTS_STORAGE_KEY, alerts);
  }, [alerts]);

  // Persist config to localStorage
  useEffect(() => {
    saveToStorage(CONFIG_STORAGE_KEY, config);
  }, [config]);

  // Persist snapshot to localStorage
  useEffect(() => {
    if (lastSnapshot) {
      saveToStorage(SNAPSHOT_STORAGE_KEY, lastSnapshot);
    }
  }, [lastSnapshot]);

  const addAlert = useCallback((alertData: Omit<Alert, 'id' | 'createdAt' | 'status'>) => {
    const newAlert: Alert = {
      ...alertData,
      id: generateId(),
      status: 'triggered',
      createdAt: new Date().toISOString(),
      triggeredAt: new Date().toISOString(),
    };

    setAlerts(prev => {
      const updated = [newAlert, ...prev].slice(0, MAX_ALERTS);
      return updated;
    });

    // Show toast notification
    const toastType = alertData.severity === 'critical' ? 'error' : 
                      alertData.severity === 'warning' ? 'warning' : 'info';
    
    if (toastType === 'error') {
      toast.error(alertData.title, { description: alertData.message, duration: 5000 });
    } else if (toastType === 'warning') {
      toast.warning(alertData.title, { description: alertData.message, duration: 4000 });
    } else {
      toast.info(alertData.title, { description: alertData.message, duration: 3000 });
    }

    // Browser notification
    if (config.browserNotifications && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(alertData.title, { body: alertData.message });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    }
  }, [config.browserNotifications]);

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => 
      a.id === id ? { ...a, status: 'dismissed' as const } : a
    ));
  }, []);

  const clearAllAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const updateRule = useCallback((ruleId: string, updates: Partial<AlertRule>) => {
    setConfig(prev => ({
      ...prev,
      rules: prev.rules.map(r => r.id === ruleId ? { ...r, ...updates } : r),
    }));
  }, []);

  const toggleRule = useCallback((ruleId: string) => {
    setConfig(prev => ({
      ...prev,
      rules: prev.rules.map(r => 
        r.id === ruleId ? { ...r, enabled: !r.enabled } : r
      ),
    }));
  }, []);

  const updateConfig = useCallback((updates: Partial<AlertConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  }, []);

  const checkMarketConditions = useCallback((conditions: MarketCondition, symbol: string) => {
    const enabledRules = config.rules.filter(r => r.enabled && r.category === 'market_condition');
    
    if (!lastSnapshot) {
      // First run, just save snapshot
      setLastSnapshot({
        regime: conditions.regime,
        regimeScore: conditions.regimeScore,
        volatility: conditions.volatility,
        volatilityPercentile: conditions.volatilityPercentile,
        momentum: conditions.momentum,
        rsiValue: conditions.rsiValue,
        trendStrength: conditions.trendStrength,
      });
      return;
    }

    enabledRules.forEach(rule => {
      switch (rule.conditionType) {
        case 'regime_change':
          if (lastSnapshot.regime !== conditions.regime) {
            const isUpgrade = conditions.regimeScore > lastSnapshot.regimeScore;
            addAlert({
              category: 'market_condition',
              severity: 'warning',
              title: `Trend Regime Changed`,
              message: `Market shifted from ${lastSnapshot.regime.replace('_', ' ')} to ${conditions.regime.replace('_', ' ')}`,
              symbol,
              metadata: { 
                from: lastSnapshot.regime, 
                to: conditions.regime,
                direction: isUpgrade ? 'bullish' : 'bearish',
              },
            });
          }
          break;

        case 'volatility_spike':
          if (conditions.volatility === 'extreme' && lastSnapshot.volatility !== 'extreme') {
            addAlert({
              category: 'market_condition',
              severity: 'critical',
              title: 'Volatility Spike Detected',
              message: `Volatility surged to extreme levels (${conditions.volatilityPercentile}th percentile)`,
              symbol,
              metadata: { volatilityPercentile: conditions.volatilityPercentile },
            });
          }
          break;

        case 'rsi_extreme':
          if (conditions.rsiValue <= 30 && lastSnapshot.rsiValue > 30) {
            addAlert({
              category: 'market_condition',
              severity: 'info',
              title: 'RSI Oversold',
              message: `RSI dropped to ${conditions.rsiValue} - potential buying opportunity`,
              symbol,
              metadata: { rsiValue: conditions.rsiValue },
            });
          } else if (conditions.rsiValue >= 70 && lastSnapshot.rsiValue < 70) {
            addAlert({
              category: 'market_condition',
              severity: 'info',
              title: 'RSI Overbought',
              message: `RSI rose to ${conditions.rsiValue} - consider taking profits`,
              symbol,
              metadata: { rsiValue: conditions.rsiValue },
            });
          }
          break;

        case 'momentum_shift':
          if (lastSnapshot.momentum !== conditions.momentum) {
            const isBullish = ['bullish', 'overbought'].includes(conditions.momentum);
            addAlert({
              category: 'market_condition',
              severity: 'info',
              title: 'Momentum Shift',
              message: `Momentum changed from ${lastSnapshot.momentum} to ${conditions.momentum}`,
              symbol,
              metadata: { from: lastSnapshot.momentum, to: conditions.momentum, isBullish },
            });
          }
          break;
      }
    });

    // Update snapshot
    setLastSnapshot({
      regime: conditions.regime,
      regimeScore: conditions.regimeScore,
      volatility: conditions.volatility,
      volatilityPercentile: conditions.volatilityPercentile,
      momentum: conditions.momentum,
      rsiValue: conditions.rsiValue,
      trendStrength: conditions.trendStrength,
    });
  }, [config.rules, lastSnapshot, addAlert]);

  const checkStrategySignals = useCallback((signals: Signal[], symbol: string) => {
    const enabledRules = config.rules.filter(r => r.enabled && r.category === 'strategy_signal');
    
    signals.forEach(signal => {
      // Create a unique key for this signal to avoid duplicates
      const signalKey = `${symbol}-${signal.strategy}-${signal.type}-${signal.date}`;
      
      if (processedSignals.has(signalKey)) {
        return; // Already processed this signal
      }

      enabledRules.forEach(rule => {
        // Map strategy names to rule types
        const strategyMap: Record<string, string> = {
          'MA Crossover': 'ma_crossover',
          'RSI': 'rsi_reversal',
          'MACD': 'macd_crossover',
          'Bollinger': 'bollinger_breakout',
          'Combined': 'combined_signal',
        };

        const signalStrategyType = strategyMap[signal.strategy];
        if (rule.strategyType !== signalStrategyType) return;

        // Check signal type match
        if (rule.signalType !== 'any' && rule.signalType !== signal.type) return;

        // Check signal strength match
        if (rule.signalStrength !== 'any' && rule.signalStrength !== signal.strength) return;

        // Don't alert on hold signals
        if (signal.type === 'hold') return;

        addAlert({
          category: 'strategy_signal',
          severity: signal.strength === 'strong' ? 'warning' : 'info',
          title: `${signal.strategy} ${signal.type.toUpperCase()} Signal`,
          message: signal.reason,
          symbol,
          metadata: { 
            strategy: signal.strategy, 
            type: signal.type, 
            strength: signal.strength,
          },
        });
      });

      // Mark signal as processed
      setProcessedSignals(prev => new Set(prev).add(signalKey));
    });
  }, [config.rules, processedSignals, addAlert]);

  const unreadCount = alerts.filter(a => a.status === 'triggered').length;

  return {
    alerts,
    config,
    addAlert,
    dismissAlert,
    clearAllAlerts,
    updateRule,
    toggleRule,
    updateConfig,
    checkMarketConditions,
    checkStrategySignals,
    unreadCount,
  };
}
