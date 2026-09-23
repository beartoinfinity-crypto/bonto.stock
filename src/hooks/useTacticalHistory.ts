import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_PARAMS, EngineParams, ReplayResult, replayEngine } from '@/lib/tacticalEngine';
import { StockData } from '@/lib/stockData';

export type HistorySource = 'local' | 'none';

/** True when the params match the engine defaults. */
export function usesDefaultParams(p: EngineParams): boolean {
  return (Object.keys(DEFAULT_PARAMS) as (keyof EngineParams)[]).every(
    k => p[k] === DEFAULT_PARAMS[k],
  );
}

/**
 * Computes the after-close action history entirely in-browser.
 * There is no backend cache — Recompute invalidates the bar/quote queries
 * so fresh data is fetched and the memoized replay re-runs.
 */
export function useTacticalHistory(
  symbol: string,
  historicalData: StockData[],
  params: EngineParams,
  lookback: number,
) {
  const isDefault = usesDefaultParams(params);
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const replay: ReplayResult | null = useMemo(
    () => replayEngine(historicalData, params, lookback),
    [historicalData, params, lookback],
  );

  const source: HistorySource = replay ? 'local' : 'none';

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['stock-historical', symbol] });
      await queryClient.invalidateQueries({ queryKey: ['stock-quote', symbol] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, symbol]);

  return {
    replay,
    source,
    computedAt: null as string | null,
    lastBarDate: null as string | null,
    isLoading: false,
    isDefaultParams: isDefault,
    refreshing,
    refresh,
  };
}
