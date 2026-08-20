import { useEffect, useRef } from 'react';

/**
 * TradingView Stock Heatmap widget — sector-grouped S&P 500 performance map.
 * Drop-in replacement for the (now blocked) Finviz hotlink.
 */
export const SectorHeatmap = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js';
    script.async = true;
    script.type = 'text/javascript';
    script.innerHTML = JSON.stringify({
      exchanges: [],
      dataSource: 'SPX500',
      grouping: 'sector',
      blockSize: 'market_cap_basic',
      blockColor: 'change',
      locale: 'en',
      symbolUrl: `${window.location.origin}/?symbol=`,
      colorTheme: 'dark',
      hasTopBar: false,
      isDataSetEnabled: false,
      isZoomEnabled: true,
      hasSymbolTooltip: true,
      isMonoSize: false,
      width: '100%',
      height: '100%',
    });
    el.appendChild(script);
  }, []);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">S&P 500 Sector Heatmap</h2>
        <a
          href="https://finviz.com/map?t=sec"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Open Finviz map ↗
        </a>
      </div>
      <div className="h-[520px] w-full overflow-hidden rounded-md">
        <div ref={containerRef} className="tradingview-widget-container h-full w-full" />
      </div>
    </div>
  );
};
