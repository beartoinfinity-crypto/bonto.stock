---
name: Social Sentiment Cache
description: 24-hour backend cache for AI social sentiment analysis to skip repeat AI calls
type: feature
---
The `social-sentiment` edge function persists every successful AI result into
`public.social_sentiment_cache` (keyed on `symbol + action`). Subsequent requests
within 24h return the cached row with `cached: true` and skip the Lovable AI call,
which avoids 429 rate-limit storms during screener refresh.

- TTL: 24h (CACHE_TTL_MS in `supabase/functions/social-sentiment/index.ts`)
- Bypass: send `{ force: true }` in the request body to recompute
- RLS: public read; only `service_role` can insert/update
- Fallback responses (when AI is throttled) are served but NOT cached
