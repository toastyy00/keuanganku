import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from './appConfig';

// ============================================================
//  SUPABASE CLIENT — reads credentials from build-time env vars
//  Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
// ============================================================

const supabaseUrl = appConfig.supabaseUrl;
const supabaseKey = appConfig.supabaseAnonKey;

let _client: SupabaseClient | null = null;

if (supabaseUrl && supabaseKey) {
  _client = createClient(supabaseUrl, supabaseKey);
}

/** The shared Supabase client. Null if env vars are not set. */
export const supabase = _client;

/** Returns the shared client (compat helper used by repository classes). */
export function getSupabaseClient(): SupabaseClient | null {
  return _client;
}

/** True if VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both set. */
export function hasSupabaseCredentials(): boolean {
  return _client !== null;
}

/**
 * No-op kept for import compatibility.
 * Client is now eagerly initialized from env vars; clearing is not needed.
 */
export function clearSupabaseClient(): void {
  // intentional no-op
}
