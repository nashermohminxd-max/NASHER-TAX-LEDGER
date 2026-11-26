import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

/**
 * Ephemeral non-persisting client used strictly when an authenticated Admin
 * provisions a new Client auth user via signUp without overwriting the Admin's session.
 */
export function createEphemeralSignUpClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
