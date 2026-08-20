import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_PARAMS, EngineParams, ReplayResult, replayEngine } from '@/lib/tacticalEngine';
import { StockData } from '@/lib/stockData';

export type HistorySource = 'local' | 'none';

/** True when the params match the defaults the backend job uses. */
export function usesDefaultParams(p: EngineParams): boolean {
  return (Object.keys(DEFAULT_PARAMS) as (keyof EngineParams)[]).every(
    k => p[k] === DEFAULT_PARAMS[k],
  );
}

/**
 * Computes the after-close action history entirely in-browser.
 * The nightly backend job is no longer queried for cached results.
 */
export function useTacticalHistory(
  symbol: string,
  historicalData: StockData[],
  params: EngineParams,
  lookback: number,
) {
  const isDefault = usesDefaultParams(params);
  const [refreshing] = useState(false);

  const replay: ReplayResult | null = useMemo(
    () => replayEngine(historicalData, params, lookback),
    [historicalData, params, lookback],
  );

  const source: HistorySource = replay ? 'local' : 'none';

  const refresh = useCallback(async () => {
    // no-op: computation is now purely local
  }, []);

  return {
    replay,
    source,
    computedAt: null,
    lastBarDate: null,
    isLoading: false,
    isDefaultParams: isDefault,
    refreshing,
    refresh,
  };
}
