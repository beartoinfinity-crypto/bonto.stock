import { useState, useCallback, useEffect, useMemo } from 'react';
import { Search, Loader2, Clock, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Stock, popularStocks } from '@/lib/stockData';
import { fetchStockQuote } from '@/lib/stockApi';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/i18n';
import * as storage from '@/lib/storage';

const RECENT_KEY = 'stockpulse_recent_stocks';
const MAX_RECENT = 8;

function loadRecent(): Stock[] {
  try {
    const raw = storage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecent(stocks: Stock[]) {
  try {
    storage.setItem(RECENT_KEY, JSON.stringify(stocks.slice(0, MAX_RECENT)));
  } catch { /* quota */ }
}

// Extract unique sectors
const ALL_SECTORS = Array.from(new Set(popularStocks.map(s => s.sector))).sort();

interface StockSearchProps {
  selectedStock: Stock | null;
  onSelectStock: (stock: Stock) => void;
}

export function StockSearch({ selectedStock, onSelectStock }: StockSearchProps) {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [recentStocks, setRecentStocks] = useState<Stock[]>(loadRecent);
  const [activeSector, setActiveSector] = useState<string | null>(null);

  useEffect(() => { saveRecent(recentStocks); }, [recentStocks]);

  const addToRecent = useCallback((stock: Stock) => {
    setRecentStocks(prev => {
      const filtered = prev.filter(s => s.symbol !== stock.symbol);
      return [stock, ...filtered].slice(0, MAX_RECENT);
    });
  }, []);

  const removeFromRecent = useCallback((symbol: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRecentStocks(prev => prev.filter(s => s.symbol !== symbol));
  }, []);

  const handleSelect = useCallback((stock: Stock) => {
    addToRecent(stock);
    onSelectStock(stock);
    setIsOpen(false);
    setSearch('');
    setActiveSector(null);
  }, [addToRecent, onSelectStock]);

  const filteredStocks = useMemo(() => {
    let list = popularStocks;
    if (activeSector) {
      list = list.filter(s => s.sector === activeSector);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [search, activeSector]);

  const trimmed = search.trim().toUpperCase();
  const isUnknownSymbol =
    trimmed.length >= 1 &&
    trimmed.length <= 5 &&
    /^[A-Z]+$/.test(trimmed) &&
    !popularStocks.some((s) => s.symbol === trimmed);

  const handleSearchSymbol = useCallback(async () => {
    if (!trimmed || isSearching) return;
    setIsSearching(true);
    try {
      const result = await fetchStockQuote(trimmed);
      if (result.data) {
        handleSelect(result.data);
      }
    } catch { /* ignore */ } finally {
      setIsSearching(false);
    }
  }, [trimmed, isSearching, handleSelect]);

  const showRecent = search === '' && !activeSector && recentStocks.length > 0;

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isUnknownSymbol) {
              e.preventDefault();
              handleSearchSymbol();
            }
          }}
          className="pl-10 bg-secondary border-border focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setIsOpen(false); setActiveSector(null); }} />
          <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-lg shadow-lg z-50 max-h-96 overflow-hidden animate-fade-in flex flex-col">
            {/* Sector filter chips */}
            <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1.5 shrink-0">
              <button
                onClick={() => setActiveSector(null)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                  !activeSector
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {t('allSectors')}
              </button>
              {ALL_SECTORS.map(sector => (
                <button
                  key={sector}
                  onClick={() => setActiveSector(prev => prev === sector ? null : sector)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                    activeSector === sector
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  {sector}
                </button>
              ))}
            </div>

            {/* Scrollable list */}
            <div className="overflow-y-auto scrollbar-thin flex-1">
              {/* Recent searches */}
              {showRecent && (
                <div className="border-b border-border">
                  <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground font-medium">
                    <Clock className="h-3 w-3" />
                    最近搜尋
                  </div>
                  {recentStocks.map((stock) => (
                    <button
                      key={`recent-${stock.symbol}`}
                      onClick={() => handleSelect(stock)}
                      className={cn(
                        "w-full px-4 py-2.5 flex items-center justify-between hover:bg-accent transition-colors",
                        selectedStock?.symbol === stock.symbol && "bg-accent"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center font-mono font-semibold text-primary text-xs">
                          {stock.symbol.slice(0, 2)}
                        </div>
                        <div className="text-left">
                          <div className="font-semibold text-sm">{stock.symbol}</div>
                          <div className="text-xs text-muted-foreground">{stock.name}</div>
                        </div>
                      </div>
                      <button
                        onClick={(e) => removeFromRecent(stock.symbol, e)}
                        className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </button>
                  ))}
                </div>
              )}

              {/* API search option */}
              {isUnknownSymbol && (
                <button
                  onClick={handleSearchSymbol}
                  disabled={isSearching}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-accent transition-colors border-b border-border text-primary"
                >
                  {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  <span className="font-semibold">{t('searchLabel')} "{trimmed}"</span>
                </button>
              )}

              {/* Filtered list */}
              {filteredStocks.map((stock) => (
                <button
                  key={stock.symbol}
                  onClick={() => handleSelect(stock)}
                  className={cn(
                    "w-full px-4 py-3 flex items-center justify-between hover:bg-accent transition-colors",
                    selectedStock?.symbol === stock.symbol && "bg-accent"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center font-mono font-semibold text-primary text-sm">
                      {stock.symbol.slice(0, 2)}
                    </div>
                    <div className="text-left">
                      <div className="font-semibold">{stock.symbol}</div>
                      <div className="text-sm text-muted-foreground">{stock.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{stock.sector}</div>
                  </div>
                </button>
              ))}

              {filteredStocks.length === 0 && !isUnknownSymbol && (
                <div className="px-4 py-6 text-center text-muted-foreground text-sm">
                  {t('searchNoResults')}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
