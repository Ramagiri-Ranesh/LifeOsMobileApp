// @ts-nocheck Deno Edge Functions use remote imports that the Expo app tsconfig does not resolve.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const MAX_PROMPT_CHARS = 4000;
const MAX_CONTEXT_CHARS = 12000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Payload = {
  prompt?: string;
  context?: Record<string, unknown>;
  responseFormat?: 'json_object';
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

function forwardedIp(req: Request) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

async function rateLimitKey(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  if (authHeader && supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data } = await supabase.auth.getUser();
      if (data.user?.id) return `user:${data.user.id}`;
    } catch {
      // Fall through to IP limiting when auth validation is unavailable.
    }
  }

  return `ip:${forwardedIp(req)}`;
}

async function consumeDurableRateLimit(key: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return null;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.rpc('consume_ai_rate_limit', {
      input_key: key,
      input_max_requests: RATE_LIMIT_MAX_REQUESTS,
      input_window_seconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    });

    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;

    return {
      allowed: row.allowed === true,
      remaining: typeof row.remaining === 'number' ? row.remaining : 0,
      resetSeconds: typeof row.reset_seconds === 'number' ? row.reset_seconds : Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  } catch (error) {
    console.warn('Durable AI rate limit unavailable; falling back to instance memory.', error);
    return null;
  }
}

function consumeRateLimit(key: string) {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  const bucket = existing && existing.resetAt > now
    ? existing
    : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  bucket.count += 1;
  rateBuckets.set(key, bucket);

  for (const [bucketKey, value] of rateBuckets) {
    if (value.resetAt <= now) rateBuckets.delete(bucketKey);
  }

  return {
    allowed: bucket.count <= RATE_LIMIT_MAX_REQUESTS,
    remaining: Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count),
    resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function rateLimitHeaders(limit: ReturnType<typeof consumeRateLimit>) {
  return {
    ...corsHeaders,
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(limit.remaining),
    'X-RateLimit-Reset': String(limit.resetSeconds),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const key = await rateLimitKey(req);
    const limit = (await consumeDurableRateLimit(key)) ?? consumeRateLimit(key);
    if (!limit.allowed) {
      return Response.json(
        { text: '', error: 'Daily AI limit reached. You can make 5 AI requests per day.' },
        { headers: rateLimitHeaders(limit), status: 429 },
      );
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return Response.json({ text: '', error: 'OPENAI_API_KEY is not configured.' }, { headers: rateLimitHeaders(limit), status: 503 });
    }

    const payload = (await req.json().catch(() => ({}))) as Payload;
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
    if (!prompt) {
      return Response.json({ text: '', error: 'Prompt is required.' }, { headers: rateLimitHeaders(limit), status: 400 });
    }

    if (prompt.length > MAX_PROMPT_CHARS) {
      return Response.json({ text: '', error: 'Prompt is too large.' }, { headers: rateLimitHeaders(limit), status: 413 });
    }

    const contextJson = JSON.stringify(payload.context ?? {});
    if (contextJson.length > MAX_CONTEXT_CHARS) {
      return Response.json({ text: '', error: 'AI context is too large.' }, { headers: rateLimitHeaders(limit), status: 413 });
    }

    const response = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        ...(payload.responseFormat ? { response_format: { type: payload.responseFormat } } : {}),
        messages: [
          {
            role: 'system',
            content: `You are the LifeOS AI coach. Use this app/user context: ${contextJson}`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.4,
      }),
    });

    if (!response.ok) {
      return Response.json({ text: '', error: `OpenAI failed: ${response.status}` }, { headers: rateLimitHeaders(limit), status: 502 });
    }

    const data = await response.json();
    return Response.json({ text: data?.choices?.[0]?.message?.content ?? '' }, { headers: rateLimitHeaders(limit) });
  } catch (error) {
    return Response.json(
      { text: '', error: error instanceof Error ? error.message : 'Unknown AI error' },
      { headers: corsHeaders, status: 500 },
    );
  }
});
