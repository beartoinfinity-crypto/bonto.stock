import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Simple in-memory rate limiter (per-function instance)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 30; // requests per window
const RATE_WINDOW_MS = 60_000; // 1 minute

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

// Sanitize user-controlled strings before embedding in AI prompts.
// Strips newlines/control chars and enforces max length to mitigate prompt injection.
function sanitizeForPrompt(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\r\n\t\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { articles } = await req.json();

    if (!articles || !Array.isArray(articles) || articles.length === 0) {
      return new Response(
        JSON.stringify({ error: "articles array is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (articles.length > 30) {
      return new Response(
        JSON.stringify({ error: "Too many articles (max 30)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build a compact prompt with all articles for a single API call.
    // Sanitize headline/summary to prevent prompt injection via newlines or override phrases.
    const articleList = articles
      .map((a: { id: number; headline: string; summary: string }) => {
        const id = Number(a?.id);
        const safeId = Number.isFinite(id) ? id : 0;
        const headline = sanitizeForPrompt(a?.headline, 200);
        const summary = sanitizeForPrompt(a?.summary, 500);
        return `[${safeId}] ${headline} | ${summary}`;
      })
      .join("\n---\n");


    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are a financial news sentiment analyst. Analyze each news article and classify its sentiment impact on the stock as bullish, bearish, or neutral. Consider the headline and summary together. Be precise — only mark bullish if it clearly suggests positive price impact, bearish if negative, neutral otherwise.",
            },
            {
              role: "user",
              content: `Analyze the sentiment of each article below for the stock mentioned. Return results using the tool provided.\n\n${articleList}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "report_sentiments",
                description:
                  "Report sentiment classification for each news article",
                parameters: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: {
                            type: "number",
                            description: "The article ID from the input",
                          },
                          sentiment: {
                            type: "string",
                            enum: ["bullish", "bearish", "neutral"],
                          },
                          reason: {
                            type: "string",
                            description:
                              "One-sentence reason for the classification",
                          },
                        },
                        required: ["id", "sentiment", "reason"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["results"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "report_sentiments" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted, please add funds." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();

    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      console.error("No tool call in response:", JSON.stringify(data));
      throw new Error("AI did not return structured results");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-news-sentiment error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
