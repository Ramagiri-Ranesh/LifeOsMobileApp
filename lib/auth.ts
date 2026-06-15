import { supabase } from '@/lib/supabase';
import type { Json } from '@/types/database';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const AUTH_EMAIL_DOMAIN = 'example.com';
const LEGACY_AUTH_EMAIL_DOMAIN = 'users.lifeos.app';

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function validateUsername(username: string) {
  const normalized = normalizeUsername(username);
  return USERNAME_PATTERN.test(normalized);
}

function usernameHash(username: string) {
  let hash = 5381;
  for (let index = 0; index < username.length; index += 1) {
    hash = ((hash << 5) + hash + username.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function usernameToAuthEmail(username: string) {
  const normalized = normalizeUsername(username);
  const safeUsername = normalized.replace(/[^a-z0-9-]/g, '-');
  return `lifeos-${safeUsername}-${usernameHash(normalized)}@${AUTH_EMAIL_DOMAIN}`;
}

export function usernameToLegacyAuthEmail(username: string) {
  return `${normalizeUsername(username)}@${LEGACY_AUTH_EMAIL_DOMAIN}`;
}

export function usernameToAuthEmailCandidates(username: string) {
  const primary = usernameToAuthEmail(username);
  const legacy = usernameToLegacyAuthEmail(username);
  return primary === legacy ? [primary] : [primary, legacy];
}

export async function isUsernameAvailable(username: string) {
  const { data, error } = await supabase.rpc('profile_username_available', {
    input_username: normalizeUsername(username),
  });

  if (error) throw error;
  return data === true;
}

export async function createAuthUserForUsername(username: string, password: string) {
  const { data, error } = await supabase.functions.invoke('lifeos-auth-register', {
    body: {
      username: normalizeUsername(username),
      password,
    },
  });

  if (error) throw error;
  return data as { email?: string; userId?: string; message?: string };
}

export async function loadProfileForAuthUser(authUserId: string) {
  const profileRequest = supabase
    .from('profiles')
    .select('*')
    .or(`id.eq.${authUserId},auth_user_id.eq.${authUserId}`)
    .limit(1)
    .maybeSingle();

  const { data, error } = await profileRequest;

  if (error && error.message.toLowerCase().includes('auth_user_id')) {
    const fallback = await supabase.from('profiles').select('*').eq('id', authUserId).maybeSingle();
    if (fallback.error) throw fallback.error;
    return fallback.data as Record<string, Json | undefined> | null;
  }

  if (error) throw error;
  return data as Record<string, Json | undefined> | null;
}

export async function migrateLegacyAccount(username: string, password: string) {
  const { data, error } = await supabase.functions.invoke('lifeos-auth-migrate', {
    body: {
      username: normalizeUsername(username),
      password,
    },
  });

  if (error) throw error;
  return data as { migrated?: boolean; email?: string; message?: string };
}
