// @ts-nocheck Deno Edge Functions use remote imports that the Expo app tsconfig does not resolve.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.108.1';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const AUTH_EMAIL_DOMAIN = 'example.com';
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;

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

async function sha256Hex(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function legacyPasswordHash(username: string, password: string) {
  return sha256Hex(`lifeos:v1:${normalizeUsername(username)}:${password}`);
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
    return Response.json({ message: 'Migration service is not configured.' }, { headers: corsHeaders, status: 503 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const username = normalizeUsername(typeof body.username === 'string' ? body.username : '');
    const password = typeof body.password === 'string' ? body.password : '';

    if (!USERNAME_PATTERN.test(username) || !password) {
      return Response.json({ message: 'Username and password are required.' }, { headers: corsHeaders, status: 400 });
    }

    const limit = consumeRateLimit(`${forwardedIp(req)}:${username}`);
    if (!limit.allowed) {
      return Response.json(
        { message: 'Too many migration attempts. Try again shortly.' },
        { headers: { ...corsHeaders, 'Retry-After': String(limit.resetSeconds) }, status: 429 },
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: legacyUser, error: legacyError } = await supabase
      .from('app_users')
      .select('profile_id, password_hash')
      .eq('username', username)
      .maybeSingle();

    if (legacyError) throw legacyError;
    if (!legacyUser?.profile_id || !legacyUser?.password_hash) {
      return Response.json({ message: 'Invalid username or password.' }, { headers: corsHeaders, status: 401 });
    }

    const expectedHash = await legacyPasswordHash(username, password);
    if (expectedHash !== legacyUser.password_hash) {
      return Response.json({ message: 'Invalid username or password.' }, { headers: corsHeaders, status: 401 });
    }

    const email = usernameToAuthEmail(username);
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, auth_user_id')
      .eq('id', legacyUser.profile_id)
      .maybeSingle();

    if (profileError) throw profileError;
    if (!profile?.id) {
      return Response.json({ message: 'Legacy profile is missing.' }, { headers: corsHeaders, status: 409 });
    }

    let authUserId = profile.auth_user_id ?? '';

    if (authUserId) {
      const { error: updateExistingError } = await supabase.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        user_metadata: { username },
      });

      if (!updateExistingError) {
        return Response.json({ migrated: true, email }, { headers: corsHeaders });
      }

      console.warn('Unable to update linked auth user during migration', updateExistingError);
      authUserId = '';
    }

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

    const { error: updateProfileError } = await supabase
      .from('profiles')
      .update({ auth_user_id: authUserId })
      .eq('id', profile.id);

    if (updateProfileError) throw updateProfileError;

    return Response.json({ migrated: true, email }, { headers: corsHeaders });
  } catch (error) {
    console.warn('Legacy auth migration failed', error);
    return Response.json(
      { message: error instanceof Error ? error.message : 'Legacy auth migration failed.' },
      { headers: corsHeaders, status: 500 },
    );
  }
});
