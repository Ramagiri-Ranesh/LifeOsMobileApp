// @ts-nocheck Deno Edge Functions use remote imports that the Expo app tsconfig does not resolve.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
const COACH_DAILY_LIMIT = 2;
const BODY_RECALIBRATION_DAYS = 14;
const MAX_PROMPT_CHARS = 4000;
const MAX_CONTEXT_CHARS = 12000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Payload = {
  prompt?: string;
  context?: Record<string, unknown>;
  purpose?: 'coach' | 'body_recalibration' | 'registration_plan';
  responseFormat?: 'json_object';
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

async function authenticatedUser(req: Request) {
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
      if (data.user?.id) return data.user.id;
    } catch {
      // The request remains unauthenticated when token validation fails.
    }
  }

  return null;
}

async function consumeDurableRateLimit(key: string, maxRequests: number) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return null;

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await supabase.rpc('consume_ai_rate_limit', {
      input_key: key,
      input_max_requests: maxRequests,
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

function consumeRateLimit(key: string, maxRequests: number) {
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
    allowed: bucket.count <= maxRequests,
    remaining: Math.max(0, maxRequests - bucket.count),
    resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

function rateLimitHeaders(limit: ReturnType<typeof consumeRateLimit>, maxRequests = COACH_DAILY_LIMIT) {
  return {
    ...corsHeaders,
    'X-RateLimit-Limit': String(maxRequests),
    'X-RateLimit-Remaining': String(limit.remaining),
    'X-RateLimit-Reset': String(limit.resetSeconds),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    if (payload.purpose !== 'coach' && payload.purpose !== 'body_recalibration' && payload.purpose !== 'registration_plan') {
      return Response.json({ text: '', error: 'This AI request is not allowed.' }, { headers: corsHeaders, status: 403 });
    }

    const userId = await authenticatedUser(req);
    if (!userId && payload.purpose !== 'registration_plan') {
      return Response.json({ text: '', error: 'Complete registration and sign in before using AI.' }, { headers: corsHeaders, status: 401 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const admin = supabaseUrl && serviceRoleKey
      ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
      : null;
    let profile = null;
    if (payload.purpose !== 'registration_plan') {
      const authHeader = req.headers.get('Authorization') ?? '';
      const profileClient = admin ?? createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data, error: profileError } = await profileClient
        .from('profiles')
        .select('onboarding_completed,last_body_recalibration_at')
        .eq('id', userId)
        .single();

      if (profileError || data?.onboarding_completed !== true) {
        return Response.json({ text: '', error: 'Complete registration before using AI.' }, { headers: corsHeaders, status: 403 });
      }
      profile = data;
    }

    let limit = { allowed: true, remaining: 0, resetSeconds: 0 };
    if (payload.purpose === 'coach') {
      const dayKey = new Date().toISOString().slice(0, 10);
      const key = `user:${userId}:coach:${dayKey}`;
      limit = (await consumeDurableRateLimit(key, COACH_DAILY_LIMIT)) ?? consumeRateLimit(key, COACH_DAILY_LIMIT);
      if (!limit.allowed) {
        return Response.json(
          { text: '', error: 'Daily AI Coach limit reached. You can ask 2 questions per day.' },
          { headers: rateLimitHeaders(limit), status: 429 },
        );
      }
    } else if (payload.purpose === 'body_recalibration' && profile?.last_body_recalibration_at) {
      const lastGeneratedAt = new Date(profile.last_body_recalibration_at).getTime();
      const nextGeneratedAt = lastGeneratedAt + BODY_RECALIBRATION_DAYS * 24 * 60 * 60 * 1000;
      if (Number.isFinite(lastGeneratedAt) && Date.now() < nextGeneratedAt) {
        const nextDate = new Date(nextGeneratedAt).toISOString();
        return Response.json(
          { text: '', error: `Body targets can be AI-generated again on ${nextDate}.` },
          { headers: corsHeaders, status: 429 },
        );
      }
    }

    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return Response.json({ text: '', error: 'OPENAI_API_KEY is not configured.' }, { headers: rateLimitHeaders(limit), status: 503 });
    }

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
            content: payload.purpose === 'coach'
              ? `You are the LifeOS AI coach. Use this app/user context: ${contextJson}`
              : payload.purpose === 'registration_plan'
                ? `You are the LifeOS registration plan generator. Calculate the user's starting calories, macros, water target, workout split, and first-week goals from onboarding answers. Return only the requested JSON and use this app/user context: ${contextJson}`
                : `You are the LifeOS body-target recalibration assistant. Return only the requested structured plan and use this app/user context: ${contextJson}`,
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
