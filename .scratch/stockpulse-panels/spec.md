# StockPulse Dashboard Panels — Comprehensive Improvement Spec

Status: ready-for-agent

## Problem Statement

The StockPulse dashboard has 13 panels across two columns. Several have bugs (in-place array mutation, `??` rendering artifacts, dead state), inconsistent i18n (hardcoded English strings in otherwise bilingual components), type safety issues (`as any` casts), and structural problems (one file at 1052 lines). Some panels simulate data that should be clearly marked, and the overall code quality varies from "good" to "needs-work". There is no consistent pattern for how panels handle empty data, loading states, or error boundaries.

## Solution

A systematic pass over all 13 panels to fix bugs, standardize i18n, improve type safety, break up monolithic components, and establish consistent patterns for empty states, disclaimers, and data handling.

## User Stories

### Bug Fixes (Critical)

1. As a user, I want SignalPanel to not crash or show stale data, so that I can trust the trading signals — the in-place `signals.sort()` mutates the props array and can cause React rendering bugs
2. As a user, I want ChartAnalyst to render cleanly without `??` artifacts in the title and key level bullets, so that the commentary is professional and readable
3. As a user, I want ForecastSimulator to not freeze the UI when running 200-path simulations, so that I can interact with the dashboard while calculations run
4. As a user, I want SentimentMonitor and LiquidityMonitor to not silently return null when there's insufficient data, so that I know why a panel is empty

### i18n Standardization

5. As a bilingual user, I want all UI text in SignalPanel (STRONG BUY, BUY, HOLD, SELL, STRONG SELL, Strategies Aligned, Avg Confidence, Buy / Sell, Best Setup) to use translation keys, so that the panel respects my language setting
6. As a bilingual user, I want "Signal Synthesis" headings in SentimentMonitor and LiquidityMonitor to use translation keys, so that the entire dashboard is consistently translated
7. As a bilingual user, I want StockMetrics intrinsic value labels ("Intrinsic (Actual)", "Intrinsic (Est.)") to use translation keys, so that all metric labels are translated
8. As a bilingual user, I want SocialSentimentCheck error messages and confirmation labels to use translation keys, so that error states are also translated

### Type Safety

9. As a developer, I want SentimentMonitor and LiquidityMonitor to not use `as any` casts on rating i18n lookups, so that type safety is maintained and refactoring is safe
10. As a developer, I want all component props to be fully typed without escape hatches, so that the compiler catches errors at build time

### Component Structure

11. As a developer, I want TodayActionPlan (1052 lines) broken into smaller focused sub-components, so that the file is maintainable and each piece is independently testable
12. As a developer, I want ChartAnalyst's monolithic `analyze()` function (~340 lines) extracted into composable analysis modules, so that individual analyses can be tested and modified in isolation
13. As a developer, I want OptionsWheel's inline Black-Scholes implementation extracted to a shared utility, so that the math is testable and reusable

### Data Quality & Transparency

14. As a user, I want PutCallRatio to use a less predictable noise function (not `sin()`), so that the simulated data looks realistic rather than oscillating formulaically
15. As a user, I want all simulated/estimated data panels (PutCallRatio, OptionsWheel, LiquidityMonitor) to have consistent disclaimer styling and placement, so that I always know where to look for data quality warnings
16. As a user, I want PriceChart gradient IDs to be unique per instance, so that multiple chart instances don't have visual conflicts

### Dead Code Cleanup

17. As a developer, I want ForecastSimulator's dead `forecast` and `simCount` state variables removed, so that the codebase is clean and confusion is reduced
18. As a developer, I want MultiTimeframeRSI's unused `rsi7Gradient` CSS gradient removed, so that dead code doesn't accumulate
19. As a developer, I want PutCallRatio's unused `symbol` prop removed or documented, so that the interface is honest about what it uses

### Performance

20. As a user, I want TodayActionPlan's confidence history computation to not block the main thread for 30 days × full model recomputation, so that the dashboard remains responsive
21. As a user, I want all panels to handle the `data.length < 100` case gracefully with a visible message rather than returning null, so that I understand what's happening during initial data loading

### Consistency

22. As a user, I want all panels to use the same disclaimer component/styling, so that the dashboard has a cohesive visual language
23. As a user, I want all panels to have consistent empty-state behavior (visible message vs silent null), so that the dashboard never shows空白 without explanation
24. As a user, I want Graham intrinsic value growth rate in StockMetrics to be documented as a hardcoded assumption, so that I understand the model's limitations

## Implementation Decisions

### Panel-by-Panel Changes

**SignalPanel (179 lines)**
- Replace in-place `signals.sort()` with `[...signals].sort()` to avoid mutating props
- Add i18n keys for all hardcoded English labels (STRONG BUY, BUY, etc.)
- Add null/empty signals guard with visible empty state

**ChartAnalyst (571 lines)**
- Fix `??` rendering artifacts in card title (line 439) and key level list items (line 533) — replace with em dash and bullet respectively
- Extract `analyze()` into composable sub-functions: `analyzeTrend()`, `analyzeMovingAverages()`, `analyzeRSI()`, `analyzeMACD()`, `analyzeBollinger()`, `analyzeVolume()`, `analyzePatterns()`, `generateForecasts()`

**ForecastSimulator (485 lines)**
- Replace `setTimeout(() => {...}, 600)` with `requestIdleCallback` or `Web Worker` for 200-path simulations
- Remove dead `forecast` and `simCount` state variables

**TodayActionPlan (1052 lines)**
- Extract sub-components: `ConfidenceGauge`, `ConfidenceHistory`, `ConfidenceBreakdown`, `PriceLevels`, `MonteCarloInsight`
- Extract `computeActionAdvice` to a pure function in a separate module
- Replace Chinese comments with English equivalents
- Memoize confidence history computation

**SentimentMonitor (119 lines)**
- Remove `as any` cast — add `extreme_fear` to `ratingConfig` and fix `ratingI18n` type
- Add visible empty state message when `data.length < 100`
- i18n for "Signal Synthesis" heading

**LiquidityMonitor (132 lines)**
- Remove `as any` cast — same fix as SentimentMonitor
- Add visible empty state message when `data.length < 100`
- i18n for "Signal Synthesis" heading
- Move disclaimer to bottom for consistency with other panels

**PutCallRatio (241 lines)**
- Replace `sin()` noise with `Math.random()` seeded by symbol+data-length for less predictable oscillation
- Remove or document unused `symbol` prop
- Standardize disclaimer styling to match other panels

**StockMetrics (86 lines)**
- i18n for intrinsic value labels
- Document Graham growth rate assumption in a tooltip or subtext

**PriceChart (351 lines)**
- Use unique gradient IDs (append symbol or instance ID)
- Extract hardcoded HSL colors to CSS variables or theme tokens

**TechnicalIndicators (135 lines)**
- Extract hardcoded HSL colors to theme tokens
- No structural changes needed

**MultiTimeframeRSI (354 lines)**
- Remove unused `rsi7Gradient` CSS gradient
- No structural changes needed

**OptionsWheel (456 lines)**
- Extract Black-Scholes math to `src/lib/blackScholes.ts`
- No other structural changes needed

**SocialSentimentCheck (212 lines)**
- i18n for error message and confirmation labels
- Replace if/else icon chain with a map

### Shared Patterns

- All panels will use a consistent `EmptyState` sub-component when data is insufficient
- All disclaimers will use a shared `Disclaimer` component with consistent styling
- All panels will use `useLanguage()` for every user-facing string

## Testing Decisions

- **What makes a good test**: Test the output of pure functions (signal generation, confidence computation, Black-Scholes pricing) rather than rendering. Snapshot tests for i18n completeness.
- **Modules to test**: `computeActionAdvice` (extracted), `analyzeTrend`/`analyzeRSI`/etc. (extracted from ChartAnalyst), Black-Scholes utility, signal sorting behavior
- **Prior art**: Existing `stockApi.test.ts` tests pure functions with mock data — follow same pattern

## Out of Scope

- Real options chain data integration (PutCallRatio remains simulated)
- Real IV data integration (OptionsWheel remains estimated)
- Redesigning the panel layout or grid system
- Adding new panels
- Changing the data sources or API layer

## Further Notes

- The user recently reverted a "combine Trading Signals into Today's Action Plan" refactor — SignalPanel should remain standalone for now
- The dashboard must remain fully functional in Chinese (zh-TW) and English
- All simulated data panels already have disclaimers; this spec standardizes their placement and styling
