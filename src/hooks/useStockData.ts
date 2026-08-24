import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stock, StockData, popularStocks, generateSignals, Signal } from '@/lib/stockData';
import { fetchStockQuote, fetchHistoricalData } from '@/lib/stockApi';
import { toast } from 'sonner';

interface UseStockDataResult {
  selectedStock: Stock;
  historicalData: StockData[];
  signals: Signal[];
  isLoading: boolean;
  isRealData: boolean;
  error: string | null;
  lastUpdated: string | null;
  setSelectedStock: (stock: Stock) => void;
  refetch: () => void;
}

export function useStockData(initialStock: Stock = popularStocks[0]): UseStockDataResult {
  const [selectedStock, setSelectedStock] = useState<Stock>(initialStock);
  const [isRealData, setIsRealData] = useState(false);
  const lastFetchedAt = useRef<string | null>(null);

  // Fetch real-time quote
  const quoteQuery = useQuery({
    queryKey: ['stock-quote', selectedStock.symbol],
    queryFn: async () => {
      const result = await fetchStockQuote(selectedStock.symbol);
      if (!result.isRealData && result.error) {
        console.warn('Using mock quote data:', result.error);
      }
      // Track when fresh (non-cache) data was actually fetched
      if (result.isRealData && !result.fromCache) {
        lastFetchedAt.current = new Date().toISOString();
      }
      setIsRealData(prev => prev || result.isRealData);
      return result;
    },
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  // Fetch historical data
  const historicalQuery = useQuery({
    queryKey: ['stock-historical', selectedStock.symbol],
    queryFn: async () => {
      const result = await fetchHistoricalData(selectedStock.symbol);
      if (!result.isRealData && result.error) {
        console.warn('Using mock historical data:', result.error);
      }
      // Track when fresh (non-cache) data was actually fetched
      if (result.isRealData && !result.fromCache) {
        lastFetchedAt.current = new Date().toISOString();
      }
      setIsRealData(prev => prev || result.isRealData);
      return result;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Update stock data when quote is fetched
  const currentStock = quoteQuery.data?.data || selectedStock;
  const historicalData = historicalQuery.data?.data || [];
  const signals = historicalData.length > 0 ? generateSignals(historicalData) : [];
  
  // "Last updated" = when fresh data was last fetched from the API,
  // NOT the last trading day in the chart (which stays stale if fetch fails).
  const lastUpdated = lastFetchedAt.current;

  // Show toast when data source changes
  useEffect(() => {
    if (!quoteQuery.isSuccess || !historicalQuery.isSuccess) return;
    const quoteReal = quoteQuery.data?.isRealData ?? false;
    const histReal = historicalQuery.data?.isRealData ?? false;
    const quoteFromCache = quoteQuery.data?.fromCache ?? false;
    const histFromCache = historicalQuery.data?.fromCache ?? false;
    
    if (quoteReal && histReal) {
      if (quoteFromCache && histFromCache) {
        toast.success('Loaded from cache (no API call)', { duration: 2000 });
      } else if (quoteFromCache || histFromCache) {
        toast.success('Loaded data (partial cache hit)', { duration: 2000 });
      } else {
        toast.success('Loaded real-time data from API', { duration: 2000 });
      }
    } else if (!quoteReal || !histReal) {
      toast.info('Using simulated data (API limit or unavailable)', { duration: 3000 });
    }
  }, [selectedStock.symbol, quoteQuery.isSuccess, historicalQuery.isSuccess, quoteQuery.data?.isRealData, historicalQuery.data?.isRealData, quoteQuery.data?.fromCache, historicalQuery.data?.fromCache]);

  const queryClient = useQueryClient();

  // Refetch when the background cron sync finishes
  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['stock-quote', selectedStock.symbol] });
      queryClient.invalidateQueries({ queryKey: ['stock-historical', selectedStock.symbol] });
    };
    window.addEventListener('stockpulse-sync', handler);
    return () => window.removeEventListener('stockpulse-sync', handler);
  }, [queryClient, selectedStock.symbol]);

  const handleSetSelectedStock = useCallback((stock: Stock) => {
    // No need to clear DB — SQLite handles per-symbol caching with TTL
    queryClient.invalidateQueries({ queryKey: ['stock-quote', stock.symbol] });
    queryClient.invalidateQueries({ queryKey: ['stock-historical', stock.symbol] });
    setSelectedStock(stock);
  }, [queryClient]);

  const refetch = useCallback(() => {
    quoteQuery.refetch();
    historicalQuery.refetch();
  }, [quoteQuery, historicalQuery]);

  return {
    selectedStock: currentStock,
    historicalData,
    signals,
    isLoading: quoteQuery.isLoading || historicalQuery.isLoading || quoteQuery.isFetching || historicalQuery.isFetching,
    isRealData,
    error: quoteQuery.data?.error || historicalQuery.data?.error || null,
    lastUpdated,
    setSelectedStock: handleSetSelectedStock,
    refetch,
  };
}
