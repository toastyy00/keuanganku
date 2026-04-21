import type { SupabaseClient } from '@supabase/supabase-js';
import { appConfig } from './appConfig';

// ============================================================
//  SUPABASE CLIENT — reads credentials from build-time env vars
//  Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env
// ============================================================

const supabaseUrl = appConfig.supabaseUrl;
const supabaseKey = appConfig.supabaseAnonKey;
const hasCredentials = Boolean(supabaseUrl && supabaseKey);

let _client: SupabaseClient | null = null;
let _clientInitPromise: Promise<SupabaseClient | null> | null = null;

async function ensureSupabaseClient(): Promise<SupabaseClient | null> {
  if (_client) return _client;
  if (!hasCredentials) return null;
  if (_clientInitPromise) return _clientInitPromise;

  _clientInitPromise = import('@supabase/supabase-js')
    .then(({ createClient }) => {
      _client = createClient(supabaseUrl as string, supabaseKey as string);
      return _client;
    })
    .catch(() => null)
    .finally(() => {
      _clientInitPromise = null;
    });

  return _clientInitPromise;
}

/**
 * Async getter for the shared Supabase client.
 * Uses lazy-loading so the Supabase SDK is only downloaded when needed.
 */
export async function getSupabaseClientAsync(): Promise<SupabaseClient | null> {
  return ensureSupabaseClient();
}

/** Warms up Supabase client in background (best-effort). */
export async function preloadSupabaseClient(): Promise<void> {
  await ensureSupabaseClient();
}

/** Returns the shared client (compat helper used by repository classes). */
export function getSupabaseClient(): SupabaseClient | null {
  return _client;
}

/** True if VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both set. */
export function hasSupabaseCredentials(): boolean {
  return hasCredentials;
}

/** Clears the in-memory singleton (mainly useful for tests). */
export function clearSupabaseClient(): void {
  _client = null;
  _clientInitPromise = null;
}
