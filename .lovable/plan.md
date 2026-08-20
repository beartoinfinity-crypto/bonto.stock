

# Social Media Sentiment Cross-Check Indicator

## Overview
Add a new component "Social Sentiment Cross-Check" that fetches social media buzz for the current stock symbol, analyzes sentiment using the Lovable AI gateway, and compares it against the technical action recommendation (BUY/SELL/HOLD) to show confirmation or divergence.

## Data Source
Since direct social media APIs (Twitter/Reddit) require paid API keys, we'll use **web search via the existing Firecrawl connector or a new edge function** that searches for recent social mentions. However, the simplest approach that doesn't require new API keys is to build a new edge function that uses the **Lovable AI gateway** (already available) to analyze social sentiment based on web search results.

**Approach**: Create an edge function `social-sentiment` that:
1. Uses Firecrawl search (if connected) OR falls back to analyzing the stock's existing news data with a social-media-focused prompt
2. Uses the Lovable AI gateway (google/gemini-3-flash-preview) to classify social buzz as bullish/bearish/neutral and extract key themes

## New Files

### `supabase/functions/social-sentiment/index.ts`
- Accepts `symbol` and `action` (current BUY/SELL/HOLD recommendation)
- Searches for recent social media discussions about the stock (Reddit, Twitter/X, StockTwits mentions via news)
- Calls Lovable AI gateway to analyze sentiment and determine if social buzz confirms or contradicts the technical signal
- Returns: `{ socialSentiment, confirmation, confidence, themes[], summary }`

### `src/components/SocialSentimentCheck.tsx`
- Card component showing:
  - Social sentiment badge (Bullish/Bearish/Neutral)
  - Confirmation status: "Confirmed" (green) or "Divergence" (red/yellow) vs the technical action
  - Key social themes/topics (e.g., "earnings beat", "CEO resignation")
  - Confidence meter
  - Summary text from AI analysis
- Props: `symbol`, `action` (from TodayActionPlan's recommendation)
- Uses `useQuery` with a reasonable stale time (5 min) to avoid excessive API calls

## Modified Files

### `src/pages/Index.tsx`
- Import and place `SocialSentimentCheck` in the right sidebar, after `TodayActionPlan`
- Compute the current action from `historicalData` to pass as prop

### `src/lib/i18n.tsx`
- Add ~15 translation keys for the new component (both EN and zh-TW)

### `supabase/config.toml`
- Add `[functions.social-sentiment]` with `verify_jwt = false`

## Technical Details

### Edge Function Logic
```text
1. Receive symbol + action
2. Fetch recent news via existing stock-data?action=news endpoint (reuse)
3. Send articles to Lovable AI with prompt:
   "Analyze social media sentiment and public discussion tone for {symbol}.
    Current technical signal is {action}.
    Classify overall social sentiment, identify key discussion themes,
    and determine if social buzz confirms or contradicts the technical signal."
4. Use structured tool_choice to get: sentiment, confirmation, confidence, themes, summary
5. Return JSON result
```

### Component UI
- Confirmation badge: green checkmark "Signal Confirmed" or yellow warning "Signal Divergence"
- Social sentiment gauge bar
- Collapsible themes list
- "Last checked" timestamp
- Loading skeleton while fetching
- Disclaimer: "Based on AI analysis of recent news and social mentions"

