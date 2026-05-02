import { appConfig } from './appConfig';

type CurrentPriceMap = Record<string, { usd: number }>;
type HistoricalPoint = [number, number];
type Timeframe = '24H' | '1W' | '1M' | '1Y' | 'ALL';
export type PriceAssetRef = { ticker: string; coingecko_id?: string };
export type CoinGeckoTickerOption = {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank?: number | null;
  thumb?: string;
};

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';
const PRICE_CACHE_TTL_MS = 2 * 60_000;
const HISTORICAL_CACHE_TTL_MS = 5 * 60_000;
const HISTORICAL_CACHE_MAX_ENTRIES = 100;
const COINGECKO_RESOLVER_CACHE_TTL_MS = 15 * 60_000;
const COINGECKO_HISTORICAL_RATE_LIMIT_COOLDOWN_MS = 60_000;
const BINANCE_INVALID_SYMBOL_CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
const BINANCE_INVALID_SYMBOL_STORAGE_KEY = 'keuanganku-binance-invalid-symbols';
const BINANCE_SYMBOL_REGISTRY_CACHE_TTL_MS = 24 * 60 * 60_000;
const BINANCE_SYMBOL_REGISTRY_STORAGE_KEY = 'keuanganku-binance-symbol-registry';

const currentPriceCache = new Map<string, { value: { usd: number }; expiresAt: number }>();
const currentPriceInflight = new Map<string, Promise<{ usd: number } | null>>();
const historicalPriceCache = new Map<string, { value: HistoricalPoint[]; expiresAt: number }>();
const historicalPriceInflight = new Map<string, Promise<HistoricalPoint[]>>();
const coingeckoSearchCache = new Map<string, { value: CoinGeckoTickerOption[]; expiresAt: number }>();
const coingeckoResolverCache = new Map<string, { value: string | null; expiresAt: number }>();
const dynamicCoingeckoToTicker = new Map<string, string>();
const binanceInvalidSymbolCache = new Map<string, number>();
let binanceSymbolRegistry: { symbols: Set<string>; expiresAt: number } | null = null;
let binanceSymbolRegistryInflight: Promise<Set<string> | null> | null = null;
let hasHydratedBinanceInvalidSymbolCache = false;
let coingeckoHistoricalCooldownUntil = 0;

const TICKER_TO_COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
  BUSD: 'binance-usd',
  FDUSD: 'first-digital-usd',
  TUSD: 'true-usd',
  USDP: 'paxos-standard',
  SOL: 'solana',
  BNB: 'binancecoin',
  JUP: 'jupiter-exchange-solana',
  PYTH: 'pyth-network',
  WEN: 'wen-4',
  TNSR: 'tensor',
  XRP: 'ripple',
  ADA: 'cardano',
  DOGE: 'dogecoin',
  TON: 'the-open-network',
  TRX: 'tron',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  SUI: 'sui',
  NEAR: 'near',
  LINK: 'chainlink',
};
const COINGECKO_TO_TICKER: Record<string, string> = Object.fromEntries(
  Object.entries(TICKER_TO_COINGECKO_ID).map(([ticker, id]) => [id, ticker])
);

const STABLECOIN_IDS = new Set([
  'tether',
  'usd-coin',
  'dai',
  'binance-usd',
  'first-digital-usd',
  'true-usd',
  'paxos-standard',
]);

function timeframeToDays(timeframe: Timeframe): number {
  switch (timeframe) {
    case '24H':
      return 1;
    case '1W':
      return 7;
    case '1M':
      return 30;
    case '1Y':
      return 365;
    case 'ALL':
      return 3650;
    default:
      return 30;
  }
}

function historicalQueryForDays(days: number): { interval: '15m' | '1h' | '4h' | '1d' | '1w'; limit: number } {
  if (days <= 1) return { interval: '15m', limit: 96 };
  if (days <= 7) return { interval: '1h', limit: 168 };
  if (days <= 30) return { interval: '4h', limit: 180 };
  if (days <= 365) return { interval: '1d', limit: 365 };
  return { interval: '1w', limit: 520 };
}

function isStablecoinId(coingeckoId: string): boolean {
  return STABLECOIN_IDS.has(coingeckoId.trim().toLowerCase());
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function normalizeBinanceSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function normalizeCoingeckoId(coingeckoId: string): string {
  return coingeckoId.trim().toLowerCase();
}

function storageAvailable(): boolean {
  try {
    return typeof globalThis.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function coingeckoBaseUrl(): string {
  return (appConfig.coingeckoProxyBaseUrl ?? COINGECKO_BASE_URL).replace(/\/+$/, '');
}

function coingeckoFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!appConfig.coingeckoProxyBaseUrl && appConfig.coingeckoDemoApiKey) {
    headers.set('x-cg-demo-api-key', appConfig.coingeckoDemoApiKey);
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return fetch(`${coingeckoBaseUrl()}${normalizedPath}`, {
    ...init,
    headers,
  });
}

function isCoingeckoHistoricalCoolingDown(now = Date.now()): boolean {
  return coingeckoHistoricalCooldownUntil > now;
}

function startCoingeckoHistoricalCooldown(): void {
  coingeckoHistoricalCooldownUntil = Date.now() + COINGECKO_HISTORICAL_RATE_LIMIT_COOLDOWN_MS;
}

function hydrateBinanceInvalidSymbolCache(now = Date.now()): void {
  if (hasHydratedBinanceInvalidSymbolCache) return;
  hasHydratedBinanceInvalidSymbolCache = true;
  if (!storageAvailable()) return;

  try {
    const raw = globalThis.localStorage.getItem(BINANCE_INVALID_SYMBOL_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, number>;
    for (const [symbol, expiresAt] of Object.entries(parsed)) {
      const normalized = normalizeBinanceSymbol(symbol);
      if (normalized && Number.isFinite(expiresAt) && expiresAt > now) {
        binanceInvalidSymbolCache.set(normalized, expiresAt);
      }
    }
  } catch {
    // Ignore corrupt local cache; price fallback still works without it.
  }
}

function persistBinanceInvalidSymbolCache(now = Date.now()): void {
  if (!storageAvailable()) return;

  try {
    const payload: Record<string, number> = {};
    for (const [symbol, expiresAt] of binanceInvalidSymbolCache.entries()) {
      if (expiresAt > now) payload[symbol] = expiresAt;
    }
    globalThis.localStorage.setItem(BINANCE_INVALID_SYMBOL_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage can be unavailable or full; keep the in-memory cache.
  }
}

function isBinanceSymbolInvalid(symbol: string, now = Date.now()): boolean {
  hydrateBinanceInvalidSymbolCache(now);
  const normalized = normalizeBinanceSymbol(symbol);
  const expiresAt = binanceInvalidSymbolCache.get(normalized);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    binanceInvalidSymbolCache.delete(normalized);
    persistBinanceInvalidSymbolCache(now);
    return false;
  }
  return true;
}

function markBinanceSymbolInvalid(symbol: string): void {
  hydrateBinanceInvalidSymbolCache();
  const normalized = normalizeBinanceSymbol(symbol);
  if (!normalized) return;
  binanceInvalidSymbolCache.set(normalized, Date.now() + BINANCE_INVALID_SYMBOL_CACHE_TTL_MS);
  persistBinanceInvalidSymbolCache();
}

function hydrateBinanceSymbolRegistry(now = Date.now()): Set<string> | null {
  if (binanceSymbolRegistry && binanceSymbolRegistry.expiresAt > now) return binanceSymbolRegistry.symbols;
  if (!storageAvailable()) return null;

  try {
    const raw = globalThis.localStorage.getItem(BINANCE_SYMBOL_REGISTRY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; symbols?: string[] };
    if (!Number.isFinite(parsed.expiresAt) || (parsed.expiresAt ?? 0) <= now || !Array.isArray(parsed.symbols)) return null;
    const symbols = new Set(parsed.symbols.map(normalizeBinanceSymbol).filter(Boolean));
    binanceSymbolRegistry = { symbols, expiresAt: parsed.expiresAt ?? now };
    return symbols;
  } catch {
    return null;
  }
}

function persistBinanceSymbolRegistry(symbols: Set<string>, expiresAt: number): void {
  if (!storageAvailable()) return;

  try {
    globalThis.localStorage.setItem(
      BINANCE_SYMBOL_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        expiresAt,
        symbols: Array.from(symbols),
      }),
    );
  } catch {
    // Keep the in-memory registry if localStorage cannot accept the payload.
  }
}

async function loadBinanceSymbolRegistry(): Promise<Set<string> | null> {
  const cached = hydrateBinanceSymbolRegistry();
  if (cached) return cached;
  if (binanceSymbolRegistryInflight) return binanceSymbolRegistryInflight;

  binanceSymbolRegistryInflight = fetch(`${BINANCE_BASE_URL}/exchangeInfo`, {
    signal: AbortSignal.timeout(12_000),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as {
        symbols?: Array<{
          symbol?: string;
          status?: string;
          quoteAsset?: string;
          isSpotTradingAllowed?: boolean;
        }>;
      };
      const symbols = new Set(
        (data.symbols ?? [])
          .filter((item) => item.status === 'TRADING' && item.quoteAsset === 'USDT' && item.isSpotTradingAllowed !== false)
          .map((item) => normalizeBinanceSymbol(item.symbol ?? ''))
          .filter(Boolean),
      );
      const expiresAt = Date.now() + BINANCE_SYMBOL_REGISTRY_CACHE_TTL_MS;
      binanceSymbolRegistry = { symbols, expiresAt };
      persistBinanceSymbolRegistry(symbols, expiresAt);
      return symbols;
    })
    .catch(() => null)
    .finally(() => {
      binanceSymbolRegistryInflight = null;
    });

  return binanceSymbolRegistryInflight;
}

export async function isBinanceSpotSymbolSupported(symbol: string): Promise<boolean | null> {
  const normalized = normalizeBinanceSymbol(symbol);
  if (!normalized) return false;
  if (isBinanceSymbolInvalid(normalized)) return false;

  const symbols = await loadBinanceSymbolRegistry();
  if (!symbols) return null;
  const isSupported = symbols.has(normalized);
  if (!isSupported) markBinanceSymbolInvalid(normalized);
  return isSupported;
}

export function clearBinanceSymbolRegistryCache(): void {
  binanceSymbolRegistry = null;
  binanceSymbolRegistryInflight = null;
  if (!storageAvailable()) return;

  try {
    globalThis.localStorage.removeItem(BINANCE_SYMBOL_REGISTRY_STORAGE_KEY);
  } catch {
    // Nothing else to clear.
  }
}

async function isInvalidBinanceSymbolResponse(res: Response): Promise<boolean> {
  if (res.ok || res.status === 418 || res.status === 429 || res.status >= 500) return false;

  try {
    const data = (await res.json()) as { code?: number; msg?: string };
    return data.code === -1121 && data.msg === 'Invalid symbol.';
  } catch {
    return false;
  }
}

function resolveTickerForBinance(coingeckoId: string): string | null {
  const id = normalizeCoingeckoId(coingeckoId);
  if (!id) return null;
  const ticker = COINGECKO_TO_TICKER[id] ?? dynamicCoingeckoToTicker.get(id);
  if (ticker) return normalizeTicker(ticker);
  return /^[a-z0-9]+$/i.test(id) ? normalizeTicker(id) : null;
}

function buildUsdtSymbol(ticker: string): string {
  return `${normalizeTicker(ticker)}USDT`;
}

function buildStablecoinHistoricalPrices(days: number): HistoricalPoint[] {
  const { limit } = historicalQueryForDays(days);
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const count = Math.max(2, limit);
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => [Math.round(start + step * index), 1] as HistoricalPoint);
}

function priceIdForRef(asset: PriceAssetRef): string {
  return normalizeCoingeckoId(asset.coingecko_id ?? resolveCoingeckoId(asset.ticker));
}

function historicalCacheKey(coingeckoId: string, days: number, ticker?: string): string {
  return `${coingeckoId.trim().toLowerCase()}::${normalizeTicker(ticker ?? '')}::${days}`;
}

function pruneHistoricalPriceCache(now = Date.now()): void {
  for (const [key, entry] of historicalPriceCache.entries()) {
    if (entry.expiresAt <= now) historicalPriceCache.delete(key);
  }

  while (historicalPriceCache.size > HISTORICAL_CACHE_MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestExpiresAt = Number.POSITIVE_INFINITY;
    for (const [key, entry] of historicalPriceCache.entries()) {
      if (entry.expiresAt < oldestExpiresAt) {
        oldestExpiresAt = entry.expiresAt;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    historicalPriceCache.delete(oldestKey);
  }
}

async function fetchBinanceWithBackoff(path: string, attempts = 3): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(`${BINANCE_BASE_URL}${path}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status !== 429) return res;
      if (i === attempts - 1) return res;
      await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Unknown Binance fetch error');
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
      }
    }
  }
  throw lastError ?? new Error('Binance request failed');
}

function targetPointCount(timeframe: Timeframe, maxAvailable: number): number {
  switch (timeframe) {
    case '24H':
      return Math.min(96, maxAvailable);
    case '1W':
      return Math.min(168, maxAvailable);
    case '1M':
      return Math.min(30, maxAvailable);
    case '1Y':
      return Math.min(365, maxAvailable);
    case 'ALL':
      return maxAvailable;
    default:
      return Math.min(30, maxAvailable);
  }
}

function interpolateAt(points: HistoricalPoint[], timestamp: number): number {
  if (points.length === 0) return 0;
  if (timestamp <= points[0][0]) return points[0][1];
  if (timestamp >= points[points.length - 1][0]) return points[points.length - 1][1];

  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTs = points[mid][0];
    if (midTs === timestamp) return points[mid][1];
    if (midTs < timestamp) low = mid + 1;
    else high = mid - 1;
  }

  const rightIdx = Math.min(low, points.length - 1);
  const leftIdx = Math.max(0, rightIdx - 1);
  const [leftTs, leftPrice] = points[leftIdx];
  const [rightTs, rightPrice] = points[rightIdx];
  if (rightTs === leftTs) return rightPrice;
  const ratio = (timestamp - leftTs) / (rightTs - leftTs);
  return leftPrice + ratio * (rightPrice - leftPrice);
}

function buildTargetTimeline(seriesList: HistoricalPoint[][], timeframe: Timeframe): number[] {
  const nonEmpty = seriesList.filter((series) => series.length > 0);
  if (nonEmpty.length === 0) return [];

  const minStart = Math.max(...nonEmpty.map((series) => series[0][0]));
  const maxEnd = Math.min(...nonEmpty.map((series) => series[series.length - 1][0]));
  if (maxEnd <= minStart) return [maxEnd];

  const roughMaxAvailable = Math.min(...nonEmpty.map((series) => series.length));
  const count = Math.max(2, targetPointCount(timeframe, roughMaxAvailable));
  if (count <= 1) return [maxEnd];

  const step = (maxEnd - minStart) / (count - 1);
  const timeline: number[] = [];
  for (let i = 0; i < count; i += 1) {
    timeline.push(Math.round(minStart + step * i));
  }
  return timeline;
}

function sortCoinGeckoOptions(options: CoinGeckoTickerOption[]): CoinGeckoTickerOption[] {
  return [...options].sort((a, b) => {
    const aRank = typeof a.market_cap_rank === 'number' && a.market_cap_rank > 0 ? a.market_cap_rank : Number.POSITIVE_INFINITY;
    const bRank = typeof b.market_cap_rank === 'number' && b.market_cap_rank > 0 ? b.market_cap_rank : Number.POSITIVE_INFINITY;
    return aRank - bRank || a.name.localeCompare(b.name);
  });
}

export async function searchCoinGeckoTickerOptions(ticker: string): Promise<CoinGeckoTickerOption[]> {
  const key = normalizeTicker(ticker);
  if (!key) return [];

  const now = Date.now();
  const cached = coingeckoSearchCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const cache = (value: CoinGeckoTickerOption[]) => {
    coingeckoSearchCache.set(key, {
      value,
      expiresAt: Date.now() + COINGECKO_RESOLVER_CACHE_TTL_MS,
    });
    return value;
  };

  try {
    const params = new URLSearchParams({ query: key });
    const res = await coingeckoFetch(`/search?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return cache([]);

    const data = (await res.json()) as {
      coins?: Array<{
        id?: string;
        symbol?: string;
        name?: string;
        market_cap_rank?: number | null;
        thumb?: string;
      }>;
    };
    const exactMatches = (data.coins ?? [])
      .filter((coin) => !!coin.id && normalizeTicker(coin.symbol ?? '') === key)
      .map((coin) => ({
        id: coin.id ?? '',
        symbol: normalizeTicker(coin.symbol ?? ''),
        name: coin.name?.trim() || coin.id || key,
        market_cap_rank: coin.market_cap_rank,
        thumb: coin.thumb,
      }));
    return cache(sortCoinGeckoOptions(exactMatches));
  } catch {
    return cache([]);
  }
}

export async function resolveCoinGeckoIdForTicker(ticker: string): Promise<string | null> {
  const key = normalizeTicker(ticker);
  if (!key) return null;

  const now = Date.now();
  const cached = coingeckoResolverCache.get(key);
  if (cached && cached.expiresAt > now) {
    if (cached.value) dynamicCoingeckoToTicker.set(cached.value, key);
    return cached.value;
  }

  const cache = (value: string | null) => {
    coingeckoResolverCache.set(key, {
      value,
      expiresAt: Date.now() + COINGECKO_RESOLVER_CACHE_TTL_MS,
    });
    if (value) dynamicCoingeckoToTicker.set(value, key);
    return value;
  };

  try {
    const exactMatches = await searchCoinGeckoTickerOptions(key);

    if (exactMatches.length === 1) return cache(exactMatches[0].id ?? null);
    if (exactMatches.length === 0) return cache(null);

    const ranked = exactMatches
      .filter((coin) => typeof coin.market_cap_rank === 'number' && Number.isFinite(coin.market_cap_rank) && coin.market_cap_rank > 0)
      .sort((a, b) => (a.market_cap_rank ?? Number.POSITIVE_INFINITY) - (b.market_cap_rank ?? Number.POSITIVE_INFINITY));
    if (ranked.length === 0) return cache(null);

    const bestRank = ranked[0].market_cap_rank;
    const bestMatches = ranked.filter((coin) => coin.market_cap_rank === bestRank);
    return cache(bestMatches.length === 1 ? bestMatches[0].id ?? null : null);
  } catch {
    return cache(null);
  }
}

export function clearBinanceInvalidSymbolCache(symbols?: string[]): void {
  hydrateBinanceInvalidSymbolCache();

  if (!symbols) {
    binanceInvalidSymbolCache.clear();
    persistBinanceInvalidSymbolCache();
    return;
  }

  for (const symbol of symbols) {
    const normalized = normalizeBinanceSymbol(symbol);
    if (normalized) binanceInvalidSymbolCache.delete(normalized);
  }
  persistBinanceInvalidSymbolCache();
}

export async function fetchCurrentAssetPrices(assets: PriceAssetRef[]): Promise<CurrentPriceMap> {
  const refsByPriceId = new Map<string, PriceAssetRef>();
  for (const asset of assets) {
    const priceId = priceIdForRef(asset);
    if (priceId && !refsByPriceId.has(priceId)) {
      refsByPriceId.set(priceId, {
        ticker: normalizeTicker(asset.ticker),
        coingecko_id: priceId,
      });
    }
  }
  if (refsByPriceId.size === 0) return {};

  const now = Date.now();
  const result: CurrentPriceMap = {};
  const pending: Array<Promise<void>> = [];

  for (const [id, asset] of refsByPriceId.entries()) {
    if (isStablecoinId(id)) {
      result[id] = { usd: 1 };
      currentPriceCache.set(id, {
        value: { usd: 1 },
        expiresAt: now + PRICE_CACHE_TTL_MS,
      });
      continue;
    }
    const cached = currentPriceCache.get(id);
    if (cached && cached.expiresAt > now) {
      result[id] = cached.value;
    } else {
      const inflightKey = `${id}::${normalizeTicker(asset.ticker)}`;
      let inflight = currentPriceInflight.get(inflightKey);
      if (!inflight) {
        inflight = fetchCurrentPriceSingle(id, asset.ticker)
          .then((price) => {
            if (price) {
              currentPriceCache.set(id, {
                value: price,
                expiresAt: Date.now() + PRICE_CACHE_TTL_MS,
              });
            }
            return price;
          })
          .finally(() => {
            currentPriceInflight.delete(inflightKey);
          });
        currentPriceInflight.set(inflightKey, inflight);
      }

      pending.push(
        inflight.then((price) => {
          if (price) result[id] = price;
        }),
      );
    }
  }

  await Promise.all(pending);

  return result;
}

export async function fetchCurrentPrices(coingeckoIds: string[]): Promise<CurrentPriceMap> {
  return fetchCurrentAssetPrices(
    coingeckoIds
      .filter(Boolean)
      .map((coingeckoId) => ({
        ticker: resolveTickerForBinance(coingeckoId) ?? coingeckoId,
        coingecko_id: coingeckoId,
      })),
  );
}

export async function fetchHistoricalPrices(coingeckoId: string, days: number, tickerHint?: string): Promise<HistoricalPoint[]> {
  if (!coingeckoId) return [];
  if (isStablecoinId(coingeckoId)) return buildStablecoinHistoricalPrices(days);

  const ticker = normalizeTicker(tickerHint ?? '') || resolveTickerForBinance(coingeckoId);
  const { interval, limit } = historicalQueryForDays(days);
  if (ticker) {
    const symbol = buildUsdtSymbol(ticker);
    try {
      const params = new URLSearchParams({
        symbol,
        interval,
        limit: String(limit),
      });
      const symbolSupport = await isBinanceSpotSymbolSupported(symbol);
      if (symbolSupport !== false && !isBinanceSymbolInvalid(symbol)) {
        const res = await fetchBinanceWithBackoff(`/klines?${params.toString()}`);
        if (res.ok) {
          const klines = (await res.json()) as Array<[number, string, string, string, string, string, number]>;
          const points = klines
            .filter((item) => Number.isFinite(item[6]) && Number.isFinite(Number(item[4])))
            .map((item) => [Math.round(item[6]), Number(item[4])] as HistoricalPoint);
          if (points.length > 0) return points;
        } else if (await isInvalidBinanceSymbolResponse(res)) {
          markBinanceSymbolInvalid(symbol);
        }
      }
    } catch {
      // Fallback to CoinGecko below.
    }
  }

  const params = new URLSearchParams({
    vs_currency: 'usd',
    days: String(days),
  });
  const res = await coingeckoFetch(`/coins/${encodeURIComponent(coingeckoId)}/market_chart?${params.toString()}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 429) {
    startCoingeckoHistoricalCooldown();
    return [];
  }
  if (!res.ok) throw new Error(`Failed historical price fetch: HTTP ${res.status}`);
  const data = (await res.json()) as { prices?: [number, number][] };
  const prices = data.prices ?? [];
  return prices
    .filter((item) => Number.isFinite(item[0]) && Number.isFinite(item[1]))
    .map(([ts, price]) => [Math.round(ts), Number(price)] as HistoricalPoint);
}

async function fetchCurrentPriceSingle(coingeckoId: string, tickerHint?: string): Promise<{ usd: number } | null> {
  const ticker = normalizeTicker(tickerHint ?? '') || resolveTickerForBinance(coingeckoId);

  if (ticker) {
    const symbol = buildUsdtSymbol(ticker);
    try {
      const symbolSupport = await isBinanceSpotSymbolSupported(symbol);
      if (symbolSupport !== false && !isBinanceSymbolInvalid(symbol)) {
        const res = await fetch(
          `${BINANCE_BASE_URL}/ticker/price?symbol=${encodeURIComponent(symbol)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (res.ok) {
          const data = (await res.json()) as { price?: string };
          const price = Number(data.price);
          if (Number.isFinite(price) && price > 0) return { usd: price };
        } else if (await isInvalidBinanceSymbolResponse(res)) {
          markBinanceSymbolInvalid(symbol);
        }
      }
    } catch {
      // Fallback to CoinGecko below.
    }
  }

  try {
    const params = new URLSearchParams({
      ids: coingeckoId,
      vs_currencies: 'usd',
    });
    const res = await coingeckoFetch(`/simple/price?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CurrentPriceMap;
    const payload = data[coingeckoId];
    if (!payload || typeof payload.usd !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

export async function fetchHistoricalPricesCached(coingeckoId: string, days: number, tickerHint?: string): Promise<HistoricalPoint[]> {
  if (!coingeckoId) return [];

  const cacheKey = historicalCacheKey(coingeckoId, days, tickerHint);
  const now = Date.now();
  const cached = historicalPriceCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  if (isCoingeckoHistoricalCoolingDown(now)) {
    return cached?.value ?? [];
  }

  pruneHistoricalPriceCache(now);

  const inflight = historicalPriceInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = fetchHistoricalPrices(coingeckoId, days, tickerHint)
    .then((points) => {
      if (points.length === 0 && cached) return cached.value;
      historicalPriceCache.set(cacheKey, {
        value: points,
        expiresAt: Date.now() + HISTORICAL_CACHE_TTL_MS,
      });
      pruneHistoricalPriceCache();
      return points;
    })
    .finally(() => {
      historicalPriceInflight.delete(cacheKey);
    });

  historicalPriceInflight.set(cacheKey, run);
  return run;
}

export function resolveCoingeckoId(ticker: string): string {
  const key = ticker.trim().toUpperCase();
  if (!key) return '';
  return TICKER_TO_COINGECKO_ID[key] ?? key.toLowerCase();
}

export function clearCurrentPriceCache(ids?: string[]): void {
  if (!ids) {
    currentPriceCache.clear();
    return;
  }

  for (const id of ids) {
    const key = id.trim();
    if (key) currentPriceCache.delete(key);
  }
}

export function clearHistoricalPriceCache(coingeckoIds?: string[], days?: number): void {
  if (!coingeckoIds) {
    historicalPriceCache.clear();
    return;
  }

  const keys = new Set(
    coingeckoIds
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => id.toLowerCase()),
  );
  for (const key of Array.from(historicalPriceCache.keys())) {
    const [id, , cachedDays] = key.split('::');
    if (!keys.has(id)) continue;
    if (typeof days === 'number') {
      if (cachedDays === String(days)) historicalPriceCache.delete(key);
    } else {
      historicalPriceCache.delete(key);
    }
  }
}

export function daysForTimeframe(timeframe: Timeframe): number {
  return timeframeToDays(timeframe);
}

export function computePortfolioValueSeries(
  assets: { coingecko_id: string; amount: number }[],
  historicalByAsset: Record<string, HistoricalPoint[]>,
  timeframe: Timeframe,
): { timestamp: number; value: number }[] {
  const validAssets = assets.filter((asset) => asset.coingecko_id && Number.isFinite(asset.amount));
  if (validAssets.length === 0) return [];

  const seriesList = validAssets
    .map((asset) => historicalByAsset[asset.coingecko_id] ?? [])
    .filter((series) => series.length > 0);
  if (seriesList.length === 0) return [];

  const timeline = buildTargetTimeline(seriesList, timeframe);
  if (timeline.length === 0) return [];

  return timeline.map((timestamp) => {
    const value = validAssets.reduce((sum, asset) => {
      const points = historicalByAsset[asset.coingecko_id] ?? [];
      const priceAtTs = interpolateAt(points, timestamp);
      return sum + asset.amount * priceAtTs;
    }, 0);
    return { timestamp, value };
  });
}
