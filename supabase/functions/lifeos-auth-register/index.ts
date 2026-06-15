// @ts-nocheck Deno Edge Functions use remote imports that the Expo app tsconfig does not resolve.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const AUTH_EMAIL_DOMAIN = 'example.com';
const MIN_PASSWORD_LENGTH = 8;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const rateBuckets = new Map<string, RateBucket>();

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function usernameHash(username: string) {
  let hash = 5381;
  for (let index = 0; index < username.length; index += 1) {
    hash = ((hash << 5) + hash + username.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function usernameToAuthEmail(username: string) {
  const normalized = normalizeUsername(username);
  const safeUsername = normalized.replace(/[^a-z0-9-]/g, '-');
  return `lifeos-${safeUsername}-${usernameHash(normalized)}@${AUTH_EMAIL_DOMAIN}`;
}

function forwardedIp(req: Request) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
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
    allowed: bucket.count <= RATE_LIMIT_MAX_ATTEMPTS,
    resetSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

async function findAuthUserByEmail(supabase: ReturnType<typeof createClient>, email: string) {
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return Response.json({ message: 'Method not allowed.' }, { headers: corsHeaders, status: 405 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ message: 'Registration service is not configured.' }, { headers: corsHeaders, status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername(typeof body.username === 'string' ? body.username : '');
    const password = typeof body.password === 'string' ? body.password : '';

    if (!USERNAME_PATTERN.test(username)) {
      return Response.json({ message: 'Use 3-32 lowercase letters, numbers, dots, underscores, or hyphens.' }, { headers: corsHeaders, status: 400 });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return Response.json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }, { headers: corsHeaders, status: 400 });
    }

    const limit = consumeRateLimit(`${forwardedIp(req)}:${username}`);
    if (!limit.allowed) {
      return Response.json(
        { message: 'Too many registration attempts. Try again shortly.' },
        { headers: { ...corsHeaders, 'Retry-After': String(limit.resetSeconds) }, status: 429 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: usernameAvailable, error: availabilityError } = await supabase.rpc('profile_username_available', {
      input_username: username,
    });
    if (availabilityError) throw availabilityError;
    if (usernameAvailable !== true) {
      return Response.json({ message: 'Username is already taken.' }, { headers: corsHeaders, status: 409 });
    }

    const email = usernameToAuthEmail(username);
    let authUserId = '';
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username },
    });

    if (created.user?.id) {
      authUserId = created.user.id;
    } else if (createError) {
      const existing = await findAuthUserByEmail(supabase, email);
      if (!existing?.id) throw createError;

      const { error: updateError } = await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
        user_metadata: { username },
      });
      if (updateError) throw updateError;
      authUserId = existing.id;
    }

    if (!authUserId) {
      return Response.json({ message: 'Unable to create Supabase Auth user.' }, { headers: corsHeaders, status: 500 });
    }

    return Response.json({ userId: authUserId, email }, { headers: corsHeaders });
  } catch (error) {
    console.warn('LifeOS auth registration failed', error);
    return Response.json(
      { message: error instanceof Error ? error.message : 'LifeOS auth registration failed.' },
      { headers: corsHeaders, status: 500 },
    );
  }
});
