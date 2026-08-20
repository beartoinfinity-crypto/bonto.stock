import React, { createContext, useContext, useState, ReactNode } from 'react';
import * as storage from '@/lib/storage';

export type Language = 'en' | 'zh-TW';

const translations = {
  en: {
    // ---- App / Header ----
    appSubtitle: 'Advanced Technical Analysis',
    marketOpen: 'Market Open',
    tenYearData: '10Y Data',
    fiveStrategies: '5 Strategies',
    lastUpdated: 'Last updated',
    screener: 'Screener',
    tacticalEngine: 'Tactical Engine',

    // ---- Unknown Symbol ----
    unknownSymbolTitle: 'Symbol not in our list',
    unknownSymbolMsg: 'We loaded "{symbol}" using placeholder data. Search and select the stock from the dropdown for full analysis.',
    unknownSymbolDismiss: 'Dismiss',

    // ---- Index Footer ----
    footerCopyright: 'StockPulse © 2024 — Advanced Technical Analysis Platform',
    footerDataReal: 'Real-time data provided by Finnhub',
    footerDataSim: 'Data is simulated for demonstration purposes',
    liveData: 'Live Data',
    simulated: 'Simulated',

    // ---- StockSearch ----
    searchPlaceholder: 'Search stocks...',
    searchNoResults: 'No stocks found.',
    searchLabel: 'Symbol',

    // ---- StockMetrics ----
    marketCap: 'Market Cap',
    peRatio: 'P/E Ratio',
    dailyVolume: 'Daily Volume',
    avgVolume: 'Avg Volume (10D)',
    week52High: '52W High',
    week52Low: '52W Low',
    sector: 'Sector',

    // ---- PriceChart ----
    priceChart: 'Price Chart',
    movingAvg: 'Moving Avg',
    bollinger: 'Bollinger',
    volume: 'Volume',
    refresh: 'Refresh',
    price: 'Price',
    priceOpen: 'Open',
    priceHigh: 'High',
    priceLow: 'Low',
    priceClose: 'Close',
    sma20: 'SMA 20',
    sma50: 'SMA 50',
    bollingerBands: 'Bollinger Bands',

    // ---- TechnicalIndicators ----
    rsiIndicator: 'RSI Indicator',
    macdIndicator: 'MACD Indicator',
    overbought: 'Overbought',
    oversold: 'Oversold',
    neutral: 'Neutral',
    bullish: 'Bullish',
    bearish: 'Bearish',
    period6M: 'Last 6 months',
    rsiCurrent: 'RSI (14)',
    macdCurrent: 'MACD',

    // ---- MultiTimeframeRSI ----
    multiRSI: 'Multi-Timeframe RSI',
    multiRSIDesc: 'RSI cross-timeframe confluence analysis',
    strongBuy: 'Strong Buy',
    buy: 'Buy',
    sell: 'Sell',
    strongSell: 'Strong Sell',
    rsi7: 'RSI-7',
    rsi14: 'RSI-14',
    rsi21: 'RSI-21',
    rsiSignal: 'Signal',
    rsiStrength: 'Strength',
    signalStrong: 'Strong',
    signalModerate: 'Moderate',
    signalWeak: 'Weak',

    // ---- SignalPanel ----
    tradingSignals: 'Trading Signals',
    signalsActive: 'signals active',
    noSignals: 'No active signals',
    waitingData: 'Waiting for sufficient data...',
    confidence: 'Confidence',
    strategy: 'Strategy',

    // ---- TodayActionPlan ----
    todayActionPlan: "Today's Action Plan",
    synthesizedRec: 'synthesized recommendation',
    hold: 'HOLD',
    confidenceIndex: 'Confidence',
    historyBtn: 'History',
    breakdownBtn: 'Breakdown',
    collapseBtn: 'Collapse',
    confidenceHistory: 'Confidence History',
    pastTradingDays: 'past trading days',
    confidenceBreakdown: 'Confidence Breakdown',
    weightedTotal: 'Weighted Total',
    signalAgreement: 'Signal Agreement',
    trendAlignment: 'Trend Alignment',
    rsiConfirm: 'RSI Confirmation',
    macdMomentum: 'MACD Momentum',
    volumeConfirm: 'Volume Confirmation',
    pricePosition: 'Price Position',
    forecastAlign: 'Forecast Alignment',
    entryPrice: 'Entry Price',
    stopLoss: 'Stop Loss',
    targetPrice: 'Target Price',
    riskReward: 'Risk / Reward',
    support: 'Support',
    resistance: 'Resistance',
    below: 'below',
    above: 'above',
    forecastInsight: 'Forecast Insight',
    p50Median: 'P50 Median',
    projectedPrice: 'Projected Price',
    expectedReturn: 'Expected Return',
    monteCarloBasis: 'Based on {days}-day Monte Carlo simulation (100 paths)',
    whyAction: 'Why this action?',
    reroll: 'Re-roll',
    disclaimer: 'This is an automated technical analysis summary, not financial advice. Always do your own research and manage risk accordingly.',
    insufficientData: 'Insufficient data for action plan (need 100+ data points)',
    actionBuy: 'Consider buying — bullish setup',
    actionSell: 'Consider reducing/selling — bearish setup',
    actionHold: 'Hold position — wait for clearer signals',
    signalConsistency: 'Signal Consistency',
    marketRegime: 'Market Regime',
    operationSuggestion: 'Suggestions',
    rerollForecast: 'Re-roll Forecast',
    viewBreakdown: 'Breakdown',
    lowConfidenceWarning: '⚠ Low Confidence Warning',
    lowConfidenceMsg: 'Confidence is only {pct}%. Technical indicators diverge significantly. Exercise caution—avoid heavy positions or consider staying on the sidelines.',
    daysLabel: 'days',
    confidenceLegend: 'Confidence',
    priceLegend: 'Price',
    dayActionLabel: 'Day',

    // ---- Confidence factor names ----
    factorSignalAgreement: 'Signal Agreement',
    factorTrendAlignment: 'Trend Alignment',
    factorRSI: 'RSI Confirmation',
    factorMACD: 'MACD Momentum',
    factorVolume: 'Volume Confirmation',
    factorPrice: 'Price Position',
    factorForecast: 'Forecast Alignment',

    // ---- Confidence factor descriptions ----
    descSignalSupport: '{supported} of {total} signals support action',
    descMarketRegime: 'Market regime: {regime}',
    descRsiOversold: 'RSI {val} oversold zone',
    descRsiLowRoom: 'RSI {val} low with upside room',
    descRsiNeutral: 'RSI {val} neutral zone',
    descRsiOverboughtRisk: 'RSI {val} overbought risk',
    descRsiOverbought: 'RSI {val} overbought zone',
    descRsiHighRoom: 'RSI {val} high with downside room',
    descRsiOversoldRisk: 'RSI {val} oversold risk',
    descRsiNeutralHold: 'RSI {val} neutral—good for holding',
    descRsiExtreme: 'RSI {val} extreme zone',
    descMacdGoldenCross: 'MACD golden cross, momentum up',
    descMacdDeathCross: 'MACD death cross, momentum down',
    descMacdNeutral: 'MACD signal neutral',
    descVolumeUp: 'Volume up {pct}%',
    descVolumeDown: 'Volume down {pct}%',
    descVolumeNormal: 'Volume normal',
    descPriceNearSupport: 'Price near support',
    descPriceAboveMA: 'Price above moving average',
    descPriceNeutral: 'Price position neutral',
    descPriceNearResistance: 'Price near resistance',
    descPriceBelowMA: 'Price below moving average',
    descPriceInRange: 'Price within range',
    descForecastP50: 'P50 forecast {ret}% ({days}d)',

    // ---- Reasoning strings ----
    reasonBuySignalsTrend: '{count} buy signals with {regime} trend',
    reasonSellSignalsTrend: '{count} sell signals with {regime} trend',
    reasonBullishBias: 'Bullish bias: {buy} buy vs {sell} sell signals',
    reasonBearishBias: 'Bearish bias: {sell} sell vs {buy} buy signals',
    reasonForecastBullish: 'Mixed signals, but P50 forecast shows upside potential',
    reasonForecastBearish: 'Mixed signals, but P50 forecast shows downside risk',
    reasonMixed: 'Mixed signals — no clear directional bias',
    reasonP50Confirms: 'P50 forecast confirms {direction} outlook: {ret}%',
    reasonBullishWord: 'bullish',
    reasonBearishWord: 'bearish',

    // ---- Headlines ----
    headlineBuy: 'Consider buying ${price} — bullish setup',
    headlineSell: 'Consider selling ${price} — bearish setup',
    headlineHold: 'Hold — wait for clearer signals ${price}',

    // ---- Confidence Notifications ----
    confidenceSurgeTitle: '📈 Confidence Surge',
    confidenceSurgeMsg: '{symbol} confidence jumped from {prev}% to {curr}% (+{delta})',
    confidenceDropTitle: '📉 Confidence Drop',
    confidenceDropMsg: '{symbol} confidence fell from {prev}% to {curr}% ({delta})',
    confidenceActionChangeTitle: '🔄 Action Changed',
    confidenceActionChangeMsg: '{symbol} recommendation changed from {prev} to {curr} (confidence {pct}%)',

    // ---- SentimentMonitor ----
    marketSentiment: 'Market Sentiment',
    extremeGreed: 'Extreme Greed',
    greed: 'Greed',
    fear: 'Fear',
    sentimentScore: 'Sentiment Score',
    indicators: 'Indicators',

    // ---- LiquidityMonitor ----
    liquidityConditions: 'Liquidity Proxy',
    abundant: 'Abundant',
    normal: 'Normal',
    tightening: 'Tightening',
    critical: 'Critical',
    liquidityScore: 'Liquidity Score',
    liquidityIndicators: 'Liquidity Indicators',
    liquidityDisclaimer: 'Estimates derived from price action — not real macro data. Use as a directional signal only.',

    // ---- PutCallRatio ----
    putCallRatio: 'Put/Call Ratio',
    puts: 'Puts',
    calls: 'Calls',
    putVolume: 'Put Volume',
    callVolume: 'Call Volume',
    historicalAvg: 'Historical Avg',
    trend: 'Trend',
    rising: 'Rising',
    falling: 'Falling',
    stable: 'Stable',
    bearishSentiment: 'Bearish Sentiment',
    bullishSentiment: 'Bullish Sentiment',
    neutralSentiment: 'Neutral Sentiment',

    // ---- ForecastSimulator ----
    forecastSimulator: 'Monte Carlo Forecast',
    backtestSimulator: 'Backtest Simulator',
    simulationPaths: 'Simulation Paths',
    backtestOffset: 'Backtest Offset',
    runSimulation: 'Run Simulation',
    reSimulate: 'Re-simulate',
    liveMode: 'Live Mode',
    today: 'Today',
    morePathsAccuracy: 'More paths = more accurate distribution',
    p10: 'P10',
    p25: 'P25',
    p50: 'P50',
    p75: 'P75',
    p90: 'P90',
    actual: 'Actual',
    percentile: 'percentile',
    probabilityBullish: 'Bullish Probability',
    pathsPositive: 'paths positive',
    avgPathReturn: 'Avg Path Return',
    returnStdDev: 'Return Std Dev',

    // ---- StrategyRecommendation ----
    strategyEngine: 'Strategy Recommendation Engine',
    strategyEngineDesc: 'AI-powered multi-strategy analysis',
    marketConditions: 'Market Conditions',
    regime: 'Regime',
    momentum: 'Momentum',
    rsiValue: 'RSI',
    volatility: 'Volatility',
    topPick: 'Top Pick',
    allStrategies: 'All Strategies',
    actionItems: 'Action Items',
    riskLevel: 'Risk Level',
    suitability: 'Suitability',
    strongUptrend: 'Strong Uptrend',
    uptrend: 'Uptrend',
    sideways: 'Sideways',
    downtrend: 'Downtrend',
    strongDowntrend: 'Strong Downtrend',
    excellent: 'Excellent',
    good: 'Good',
    moderate: 'Moderate',
    poor: 'Poor',
    riskLow: 'Low',
    riskMedium: 'Medium',
    riskHigh: 'High',

    // ---- StrategyPerformance ----
    strategyPerformance: 'Strategy Performance',
    historicalBacktest: 'Historical backtesting results',
    bestStrategy: 'Best Strategy',
    winRate: 'Win Rate',
    avgReturn: 'Avg Return',
    trades: 'Trades',
    profitFactor: 'Profit Factor',
    maxDD: 'Max DD',
    sharpe: 'Sharpe',

    // ---- AlertPanel ----
    alerts: 'Alerts',
    noAlerts: 'No alerts yet',
    clearAll: 'Clear All',
    alertRules: 'Alert Rules',
    alertSettings: 'Settings',
    notifications: 'Notifications',
    newAlerts: 'new',

    // ---- Screener ----
    stockScreener: 'Stock Screener',
    screenerDesc: 'Multi-factor analysis across all tracked stocks',
    backToAnalysis: 'Back to Analysis',
    refreshAll: 'Refresh All',
    lastScan: 'Last Scan',
    analyzing: 'Analyzing',
    sortBy: 'Sort By',
    riskFilter: 'Risk Filter',
    signalQuality: 'Signal Quality',
    allSectors: 'All Sectors',
    allRisks: 'All Risks',
    allSignals: 'All Signals',
    symbol: 'Symbol',
    name: 'Name',
    change: 'Change',
    signalCol: 'Signal',
    noResults: 'No results match your filters.',
    loadingScreener: 'Analyzing stocks...',
    stocksAnalyzed: 'stocks analyzed',
    fromCache: 'Cached',

    // ---- News ----
    relatedNews: 'Related News',
    noNews: 'No news available',
    newsLoading: 'Loading news...',

    // ---- Social Sentiment ----
    socialSentimentTitle: 'Social Sentiment Check',
    socialSentimentError: 'Failed to load sentiment analysis',
    socialSentiment_bullish: 'Bullish',
    socialSentiment_bearish: 'Bearish',
    socialSentiment_neutral: 'Neutral',
    socialConfirm_confirmed: 'Signal Confirmed',
    socialConfirm_divergence: 'Signal Divergence',
    socialConfirm_neutral: 'Inconclusive',
    socialConfidence: 'Confidence',
    socialThemes: 'Key Themes',
    socialLastChecked: 'Last checked',
    socialDisclaimer: 'Based on AI analysis of recent news and social mentions. Not financial advice.',
  },

  'zh-TW': {
    // ---- App / Header ----
    appSubtitle: '進階技術分析平台',
    marketOpen: '市場開放中',
    tenYearData: '10年數據',
    fiveStrategies: '5種策略',
    lastUpdated: '最後更新',
    screener: '選股器',
    tacticalEngine: '戰術引擎',

    // ---- Unknown Symbol ----
    unknownSymbolTitle: '不在股票清單中',
    unknownSymbolMsg: '我們已以暫時資料載入 "{symbol}"。請從下拉選單搜尋並選擇該股票，以獲得完整分析。',
    unknownSymbolDismiss: '關閉',

    // ---- Index Footer ----
    footerCopyright: 'StockPulse © 2024 — 進階技術分析平台',
    footerDataReal: '即時數據由 Finnhub 提供',
    footerDataSim: '數據為示範用途，以模擬數據呈現',
    liveData: '即時數據',
    simulated: '模擬數據',

    // ---- StockSearch ----
    searchPlaceholder: '搜尋股票...',
    searchNoResults: '找不到相關股票。',
    searchLabel: '代碼',

    // ---- StockMetrics ----
    marketCap: '市值',
    peRatio: '本益比',
    dailyVolume: '今日成交量',
    avgVolume: '平均成交量 (10日)',
    week52High: '52週高點',
    week52Low: '52週低點',
    sector: '產業',

    // ---- PriceChart ----
    priceChart: '價格走勢圖',
    movingAvg: '均線',
    bollinger: '布林通道',
    volume: '成交量',
    refresh: '重新整理',
    price: '價格',
    priceOpen: '開盤',
    priceHigh: '最高',
    priceLow: '最低',
    priceClose: '收盤',
    sma20: 'SMA 20日',
    sma50: 'SMA 50日',
    bollingerBands: '布林通道',

    // ---- TechnicalIndicators ----
    rsiIndicator: 'RSI 指標',
    macdIndicator: 'MACD 指標',
    overbought: '超買',
    oversold: '超賣',
    neutral: '中性',
    bullish: '看多',
    bearish: '看空',
    period6M: '最近六個月',
    rsiCurrent: 'RSI (14)',
    macdCurrent: 'MACD',

    // ---- MultiTimeframeRSI ----
    multiRSI: '多時框 RSI',
    multiRSIDesc: 'RSI 跨時框共鳴分析',
    strongBuy: '強力買入',
    buy: '買入',
    sell: '賣出',
    strongSell: '強力賣出',
    rsi7: 'RSI-7',
    rsi14: 'RSI-14',
    rsi21: 'RSI-21',
    rsiSignal: '信號',
    rsiStrength: '強度',
    signalStrong: '強',
    signalModerate: '中',
    signalWeak: '弱',

    // ---- SignalPanel ----
    tradingSignals: '交易信號',
    signalsActive: '個信號啟動',
    noSignals: '目前無交易信號',
    waitingData: '等待足夠數據...',
    confidence: '信心',
    strategy: '策略',

    // ---- TodayActionPlan ----
    todayActionPlan: '今日操作計劃',
    synthesizedRec: '綜合操作建議',
    hold: '持有',
    confidenceIndex: '信心指數',
    historyBtn: '歷史',
    breakdownBtn: '計算詳情',
    collapseBtn: '收起',
    confidenceHistory: '信心指數歷史趨勢',
    pastTradingDays: '個交易日',
    confidenceBreakdown: '信心指數計算明細',
    weightedTotal: '加權總分',
    signalAgreement: '信號一致性',
    trendAlignment: '趨勢對齊',
    rsiConfirm: 'RSI 確認',
    macdMomentum: 'MACD 動能',
    volumeConfirm: '成交量確認',
    pricePosition: '價格位置',
    forecastAlign: '預測對齊',
    entryPrice: '進場價',
    stopLoss: '停損價',
    targetPrice: '目標價',
    riskReward: '風險報酬',
    support: '支撐',
    resistance: '阻力',
    below: '以下',
    above: '以上',
    forecastInsight: '預測洞察',
    p50Median: 'P50 中位數',
    projectedPrice: '預測價格',
    expectedReturn: '預期報酬',
    monteCarloBasis: '基於 {days} 天蒙地卡羅模擬（100條路徑）',
    whyAction: '為何如此建議？',
    reroll: '重新模擬',
    disclaimer: '本內容為自動技術分析摘要，非投資建議。請自行研究並妥善管理風險。',
    insufficientData: '數據不足，無法產生操作計劃（需 100 筆以上數據）',
    actionBuy: '建議買入 — 多頭設置',
    actionSell: '建議減倉/賣出 — 空頭設置',
    actionHold: '持有觀望 — 等待更清晰信號',
    signalConsistency: '信號一致性',
    marketRegime: '市場狀態',
    operationSuggestion: '操作建議',
    rerollForecast: '重新模擬',
    viewBreakdown: '計算詳情',
    lowConfidenceWarning: '⚠ 低信心警告',
    lowConfidenceMsg: '目前信心指數僅 {pct}%，技術指標分歧較大，建議謹慎操作，避免重倉或考慮觀望。',
    daysLabel: '天',
    confidenceLegend: '信心指數',
    priceLegend: '股價',
    dayActionLabel: '日',

    // ---- Confidence factor names ----
    factorSignalAgreement: '信號一致性',
    factorTrendAlignment: '趨勢對齊',
    factorRSI: 'RSI 確認',
    factorMACD: 'MACD 動能',
    factorVolume: '成交量確認',
    factorPrice: '價格位置',
    factorForecast: '預測對齊',

    // ---- Confidence factor descriptions ----
    descSignalSupport: '{total} 個信號中 {supported} 個支持操作',
    descMarketRegime: '市場狀態：{regime}',
    descRsiOversold: 'RSI {val} 超賣區域',
    descRsiLowRoom: 'RSI {val} 偏低有上漲空間',
    descRsiNeutral: 'RSI {val} 中性區域',
    descRsiOverboughtRisk: 'RSI {val} 超買風險',
    descRsiOverbought: 'RSI {val} 超買區域',
    descRsiHighRoom: 'RSI {val} 偏高有下跌空間',
    descRsiOversoldRisk: 'RSI {val} 超賣風險',
    descRsiNeutralHold: 'RSI {val} 中性區域適合觀望',
    descRsiExtreme: 'RSI {val} 極端區域',
    descMacdGoldenCross: 'MACD 黃金交叉，動能向上',
    descMacdDeathCross: 'MACD 死亡交叉，動能向下',
    descMacdNeutral: 'MACD 信號中性',
    descVolumeUp: '成交量放大 {pct}%',
    descVolumeDown: '成交量萎縮 {pct}%',
    descVolumeNormal: '成交量正常',
    descPriceNearSupport: '價格接近支撐位',
    descPriceAboveMA: '價格在均線上方',
    descPriceNeutral: '價格位置中性',
    descPriceNearResistance: '價格接近阻力位',
    descPriceBelowMA: '價格在均線下方',
    descPriceInRange: '價格在區間內',
    descForecastP50: 'P50 預測 {ret}% ({days}天)',

    // ---- Reasoning strings ----
    reasonBuySignalsTrend: '{count} 個買入信號配合 {regime} 趨勢',
    reasonSellSignalsTrend: '{count} 個賣出信號配合 {regime} 趨勢',
    reasonBullishBias: '偏向看多：{buy} 個買入 vs {sell} 個賣出信號',
    reasonBearishBias: '偏向看空：{sell} 個賣出 vs {buy} 個買入信號',
    reasonForecastBullish: '技術信號混合，但 P50 預測顯示上漲潛力',
    reasonForecastBearish: '技術信號混合，但 P50 預測顯示下跌風險',
    reasonMixed: '混合信號 — 無明確方向偏向',
    reasonP50Confirms: 'P50 預測確認{direction}展望：{ret}%',
    reasonBullishWord: '看多',
    reasonBearishWord: '看空',

    // ---- Headlines ----
    headlineBuy: '建議買入 ${price} — 多頭設置',
    headlineSell: '建議減倉/賣出 ${price} — 空頭設置',
    headlineHold: '持有觀望 — 等待更清晰信號 ${price}',

    // ---- Confidence Notifications ----
    confidenceSurgeTitle: '📈 信心指數飆升',
    confidenceSurgeMsg: '{symbol} 信心指數從 {prev}% 躍升至 {curr}%（+{delta}）',
    confidenceDropTitle: '📉 信心指數驟降',
    confidenceDropMsg: '{symbol} 信心指數從 {prev}% 降至 {curr}%（{delta}）',
    confidenceActionChangeTitle: '🔄 操作建議變更',
    confidenceActionChangeMsg: '{symbol} 操作建議從 {prev} 變更為 {curr}（信心 {pct}%）',

    marketSentiment: '市場情緒',
    extremeGreed: '極度貪婪',
    greed: '貪婪',
    fear: '恐懼',
    sentimentScore: '情緒分數',
    indicators: '指標',

    // ---- LiquidityMonitor ----
    liquidityConditions: '流動性代理指標',
    abundant: '充裕',
    normal: '正常',
    tightening: '收緊中',
    critical: '危急',
    liquidityScore: '流動性分數',
    liquidityIndicators: '流動性指標',
    liquidityDisclaimer: '基於價格走勢推算的估計值，並非實際宏觀數據。僅供方向性參考。',

    // ---- PutCallRatio ----
    putCallRatio: '認沽/認購比率',
    puts: '認沽',
    calls: '認購',
    putVolume: '認沽量',
    callVolume: '認購量',
    historicalAvg: '歷史均值',
    trend: '趨勢',
    rising: '上升',
    falling: '下降',
    stable: '穩定',
    bearishSentiment: '看空情緒',
    bullishSentiment: '看多情緒',
    neutralSentiment: '中性情緒',

    // ---- ForecastSimulator ----
    forecastSimulator: '蒙地卡羅預測',
    backtestSimulator: '回測模擬器',
    simulationPaths: '模擬路徑',
    backtestOffset: '回測偏移',
    runSimulation: '執行模擬',
    reSimulate: '重新模擬',
    liveMode: '即時模式',
    today: '今天',
    morePathsAccuracy: '路徑越多，分佈越準確',
    p10: 'P10',
    p25: 'P25',
    p50: 'P50',
    p75: 'P75',
    p90: 'P90',
    actual: '實際',
    percentile: '百分位',
    probabilityBullish: '看多機率',
    pathsPositive: '條路徑為正',
    avgPathReturn: '平均路徑報酬',
    returnStdDev: '報酬標準差',

    // ---- StrategyRecommendation ----
    strategyEngine: '策略推薦引擎',
    strategyEngineDesc: 'AI 驅動多策略分析',
    marketConditions: '市場狀況',
    regime: '趨勢狀態',
    momentum: '動能',
    rsiValue: 'RSI',
    volatility: '波動性',
    topPick: '首選策略',
    allStrategies: '所有策略',
    actionItems: '操作建議',
    riskLevel: '風險等級',
    suitability: '適用性',
    strongUptrend: '強勢上漲',
    uptrend: '上漲',
    sideways: '橫盤',
    downtrend: '下跌',
    strongDowntrend: '強勢下跌',
    excellent: '絕佳',
    good: '良好',
    moderate: '適中',
    poor: '不佳',
    riskLow: '低',
    riskMedium: '中',
    riskHigh: '高',

    // ---- StrategyPerformance ----
    strategyPerformance: '策略績效',
    historicalBacktest: '歷史回測結果',
    bestStrategy: '最佳策略',
    winRate: '勝率',
    avgReturn: '平均報酬',
    trades: '交易次數',
    profitFactor: '獲利因子',
    maxDD: '最大回撤',
    sharpe: '夏普比率',

    // ---- AlertPanel ----
    alerts: '警報',
    noAlerts: '目前無警報',
    clearAll: '清除全部',
    alertRules: '警報規則',
    alertSettings: '設定',
    notifications: '通知',
    newAlerts: '則新警報',

    // ---- Screener ----
    stockScreener: '股票選股器',
    screenerDesc: '跨所有追蹤股票的多因子分析',
    backToAnalysis: '返回分析',
    refreshAll: '全部重新整理',
    lastScan: '最後掃描',
    analyzing: '分析中',
    sortBy: '排序依據',
    riskFilter: '風險篩選',
    signalQuality: '信號質量',
    allSectors: '所有產業',
    allRisks: '所有風險',
    allSignals: '所有信號',
    symbol: '代碼',
    name: '名稱',
    change: '漲跌',
    signalCol: '信號',
    noResults: '沒有符合篩選條件的結果。',
    loadingScreener: '分析股票中...',
    stocksAnalyzed: '支股票已分析',
    fromCache: '已快取',

    // ---- News ----
    relatedNews: '相關新聞',
    noNews: '暫無新聞',
    newsLoading: '載入新聞中...',

    // ---- Social Sentiment ----
    socialSentimentTitle: '社群情緒交叉驗證',
    socialSentimentError: '情緒分析載入失敗',
    socialSentiment_bullish: '看多',
    socialSentiment_bearish: '看空',
    socialSentiment_neutral: '中性',
    socialConfirm_confirmed: '訊號確認',
    socialConfirm_divergence: '訊號背離',
    socialConfirm_neutral: '不確定',
    socialConfidence: '信心度',
    socialThemes: '關鍵主題',
    socialLastChecked: '最後檢查',
    socialDisclaimer: '基於 AI 分析近期新聞與社群討論。非投資建議。',
  },
} as const;

export type TranslationKey = keyof typeof translations['en'];

interface LanguageContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => {
    try {
      return (storage.getItem('sp-lang') as Language) || 'en';
    } catch {
      return 'en';
    }
  });

  const handleSetLang = (l: Language) => {
    setLang(l);
    try { storage.setItem('sp-lang', l); } catch {}
  };

  const t = (key: TranslationKey): string => {
    return (translations[lang] as Record<string, string>)[key] ?? (translations['en'] as Record<string, string>)[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang: handleSetLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used inside LanguageProvider');
  return ctx;
}
