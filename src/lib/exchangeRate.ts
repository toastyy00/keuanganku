// ============================================================
//  EXCHANGE RATE — Fetches USD/IDR rate with caching
// ============================================================

const CACHE_KEY = 'shared_usd_idr_rate_cache';
const LEGACY_EXPENSE_CACHE_KEY = 'exchange_rate_cache';
const LEGACY_PORTFOLIO_CACHE_KEY = 'portfolio_idr_rate_cache';
const FALLBACK_RATE = 16000;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface RateResult {
  rate: number;
  /** True when using fallback (offline or fetch failed) */
  isFallback: boolean;
  /** ISO timestamp when this rate was fetched/cached */
  fetchedAt?: string;
}

export interface PortfolioRateResult {
  rate: number;
  source: 'binance' | 'frankfurter' | 'cache';
  fetchedAt: string;
  isStale: boolean;
}

interface RateCache {
  rate: number;
  fetchedAt: string;
  source?: PortfolioRateResult['source'];
}

function parseRateCache(raw: string | null): RateCache | null {
  try {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateCache;
    if (!parsed.rate || !parsed.fetchedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readCache(): RateCache | null {
  return (
    parseRateCache(localStorage.getItem(CACHE_KEY))
    ?? parseRateCache(localStorage.getItem(LEGACY_PORTFOLIO_CACHE_KEY))
    ?? parseRateCache(localStorage.getItem(LEGACY_EXPENSE_CACHE_KEY))
  );
}

function writeCache(rate: number, source: 'binance' | 'frankfurter'): RateCache {
  const entry: RateCache = { rate, source, fetchedAt: new Date().toISOString() };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
    localStorage.removeItem(LEGACY_PORTFOLIO_CACHE_KEY);
    localStorage.removeItem(LEGACY_EXPENSE_CACHE_KEY);
  } catch {
    // Ignore storage errors (e.g., private mode)
  }
  return entry;
}

function isCacheFresh(cache: RateCache): boolean {
  const age = Date.now() - new Date(cache.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

async function fetchBinanceUsdtIdrRate(): Promise<number> {
  const res = await fetch(
    'https://api.binance.com/api/v3/ticker/price?symbol=USDTIDR',
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { price?: string };
  const rate = Number(data.price);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid Binance rate data');
  return rate;
}

async function fetchFrankfurterUsdIdrRate(): Promise<number> {
  const res = await fetch(
    'https://api.frankfurter.dev/v2/rate/USD/IDR',
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { rate?: number };
  const rate = data.rate;
  if (!Number.isFinite(rate) || !rate || rate <= 0) throw new Error('Invalid Frankfurter rate data');
  return rate;
}

/**
 * Returns the portfolio USD/USDT -> IDR display rate.
 *
 * Fallback order:
 * 1. Binance USDTIDR
 * 2. Frankfurter USD/IDR
 * 3. Stale local cache
 */
export async function getPortfolioIdrRate(): Promise<PortfolioRateResult | null> {
  const cached = readCache();

  if (cached && isCacheFresh(cached)) {
    return {
      rate: cached.rate,
      source: cached.source ?? 'cache',
      fetchedAt: cached.fetchedAt,
      isStale: false,
    };
  }

  try {
    const rate = await fetchBinanceUsdtIdrRate();
    const written = writeCache(rate, 'binance');
    return { rate, source: 'binance', fetchedAt: written.fetchedAt, isStale: false };
  } catch {
    // Continue to the official USD/IDR reference-rate fallback.
  }

  try {
    const rate = await fetchFrankfurterUsdIdrRate();
    const written = writeCache(rate, 'frankfurter');
    return { rate, source: 'frankfurter', fetchedAt: written.fetchedAt, isStale: false };
  } catch {
    if (!cached) return null;
    return {
      rate: cached.rate,
      source: 'cache',
      fetchedAt: cached.fetchedAt,
      isStale: true,
    };
  }
}

export function getCachedPortfolioIdrRate(): PortfolioRateResult | null {
  const cached = readCache();
  if (!cached) return null;
  return {
    rate: cached.rate,
    source: cached.source ?? 'cache',
    fetchedAt: cached.fetchedAt,
    isStale: !isCacheFresh(cached),
  };
}

/**
 * Returns the current USD → IDR exchange rate.
 *
 * - Shares the same cache used by portfolio.
 * - Uses Binance USDTIDR first, then Frankfurter USD/IDR.
 * - Falls back to stale cache if both requests fail.
 */
export async function getExchangeRate(): Promise<RateResult> {
  const result = await getPortfolioIdrRate();
  if (result) {
    return { rate: result.rate, isFallback: result.isStale, fetchedAt: result.fetchedAt };
  }
  return { rate: FALLBACK_RATE, isFallback: true };
}

/**
 * Forces a fresh fetch, ignoring the cache TTL.
 */
export async function forceRefreshRate(): Promise<RateResult> {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(LEGACY_EXPENSE_CACHE_KEY);
  localStorage.removeItem(LEGACY_PORTFOLIO_CACHE_KEY);
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
