// ============================================================
//  EXCHANGE RATE — Fetches USD/IDR rate with caching
// ============================================================

const CACHE_KEY = 'exchange_rate_cache';
const FALLBACK_RATE = 16000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface RateResult {
  rate: number;
  /** True when using fallback (offline or fetch failed) */
  isFallback: boolean;
  /** ISO timestamp when this rate was fetched/cached */
  fetchedAt?: string;
}

interface RateCache {
  rate: number;
  fetchedAt: string;
}

function readCache(): RateCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateCache;
    if (!parsed.rate || !parsed.fetchedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(rate: number): RateCache {
  const entry: RateCache = { rate, fetchedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Ignore storage errors (e.g., private mode)
  }
  return entry;
}

function isCacheFresh(cache: RateCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

/**
 * Returns the current USD → IDR exchange rate.
 *
 * - Uses frankfurter.dev (v2) as data source.
 * - Caches result in localStorage for 6 hours.
 * - Falls back to cached value if network fails.
 * - Falls back to 16000 if no cache is available.
 *
 * v2 API: GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=IDR
 * Response shape: [{ "base": "USD", "date": "...", "rates": { "IDR": 16350 } }]
 */
export async function getExchangeRate(): Promise<RateResult> {
  const cached = readCache();

  // Return fresh cache without a network request
  // Skip if rate == FALLBACK_RATE (means previous fetch failed, not a real API rate)
  if (cached && isCacheFresh(cached) && cached.rate !== FALLBACK_RATE) {
    return { rate: cached.rate, isFallback: false, fetchedAt: cached.fetchedAt };
  }

  try {
    const res = await fetch(
      'https://api.frankfurter.dev/v2/rates?base=USD&quotes=IDR',
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // v2 returns an array: [{"date":"...","base":"USD","quote":"IDR","rate":17012}]
    const data = (await res.json()) as Array<{ rate: number }>;
    const rate = data[0]?.rate;
    if (!rate || typeof rate !== 'number') throw new Error('Invalid rate data');
    const written = writeCache(rate);
    return { rate, isFallback: false, fetchedAt: written.fetchedAt };
  } catch {
    // Fallback to stale cache if available
    if (cached) {
      return { rate: cached.rate, isFallback: false, fetchedAt: cached.fetchedAt };
    }
    // Last resort: hardcoded fallback
    return { rate: FALLBACK_RATE, isFallback: true };
  }
}

/**
 * Forces a fresh fetch, ignoring the cache TTL.
 */
export async function forceRefreshRate(): Promise<RateResult> {
  localStorage.removeItem(CACHE_KEY);
  return getExchangeRate();
}

/**
 * Returns a human-readable string of how old the cached rate is.
 * e.g. "2j lalu", "45m lalu", "Baru saja"
 */
export function rateAge(fetchedAt: string): string {
  const diffMs = Date.now() - new Date(fetchedAt).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays >= 1) return `${diffDays}h lalu`;
  if (diffHours >= 1) return `${diffHours}j lalu`;
  if (diffMins >= 1) return `${diffMins}m lalu`;
  return 'Baru saja';
}

/**
 * Converts an amount from one currency to another using the provided rate.
 */
export function convertAmount(amount: number, from: string, to: string, rate: number): number {
  if (from === to) return amount;
  if (from === 'IDR' && to === 'USD') return amount / rate;
  return amount * rate; // USD → IDR
}

