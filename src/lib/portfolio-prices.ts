type CurrentPriceMap = Record<string, { usd: number }>;
type HistoricalPoint = [number, number];
type Timeframe = '24H' | '1W' | '1M' | '1Y' | 'ALL';

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';
const PRICE_CACHE_TTL_MS = 60_000;
const HISTORICAL_CACHE_TTL_MS = 2 * 60_000;

const currentPriceCache = new Map<string, { value: { usd: number }; expiresAt: number }>();
const currentPriceInflight = new Map<string, Promise<{ usd: number } | null>>();
const historicalPriceCache = new Map<string, { value: HistoricalPoint[]; expiresAt: number }>();
const historicalPriceInflight = new Map<string, Promise<HistoricalPoint[]>>();

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

function buildStablecoinHistoricalPrices(days: number): HistoricalPoint[] {
  const { limit } = historicalQueryForDays(days);
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const count = Math.max(2, limit);
  const step = (end - start) / (count - 1);
  return Array.from({ length: count }, (_, index) => [Math.round(start + step * index), 1] as HistoricalPoint);
}

function historicalCacheKey(coingeckoId: string, days: number): string {
  return `${coingeckoId.trim().toLowerCase()}::${days}`;
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

export async function fetchCurrentPrices(coingeckoIds: string[]): Promise<CurrentPriceMap> {
  const uniqueIds = Array.from(new Set(coingeckoIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const now = Date.now();
  const result: CurrentPriceMap = {};
  const pending: Array<Promise<void>> = [];

  for (const id of uniqueIds) {
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
      let inflight = currentPriceInflight.get(id);
      if (!inflight) {
        inflight = fetchCurrentPriceSingle(id)
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
            currentPriceInflight.delete(id);
          });
        currentPriceInflight.set(id, inflight);
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

export async function fetchHistoricalPrices(coingeckoId: string, days: number): Promise<HistoricalPoint[]> {
  if (!coingeckoId) return [];
  if (isStablecoinId(coingeckoId)) return buildStablecoinHistoricalPrices(days);

  const ticker = COINGECKO_TO_TICKER[coingeckoId] ?? coingeckoId.trim().toUpperCase();
  const { interval, limit } = historicalQueryForDays(days);
  if (ticker) {
    try {
      const params = new URLSearchParams({
        symbol: `${ticker}USDT`,
        interval,
        limit: String(limit),
      });
      const res = await fetchBinanceWithBackoff(`/klines?${params.toString()}`);
      if (res.ok) {
        const klines = (await res.json()) as Array<[number, string, string, string, string, string, number]>;
        const points = klines
          .filter((item) => Number.isFinite(item[6]) && Number.isFinite(Number(item[4])))
          .map((item) => [Math.round(item[6]), Number(item[4])] as HistoricalPoint);
        if (points.length > 0) return points;
      }
    } catch {
      // Fallback to CoinGecko below.
    }
  }

  const params = new URLSearchParams({
    vs_currency: 'usd',
    days: String(days),
  });
  const res = await fetch(`${COINGECKO_BASE_URL}/coins/${encodeURIComponent(coingeckoId)}/market_chart?${params.toString()}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Failed historical price fetch: HTTP ${res.status}`);
  const data = (await res.json()) as { prices?: [number, number][] };
  const prices = data.prices ?? [];
  return prices
    .filter((item) => Number.isFinite(item[0]) && Number.isFinite(item[1]))
    .map(([ts, price]) => [Math.round(ts), Number(price)] as HistoricalPoint);
}

async function fetchCurrentPriceSingle(coingeckoId: string): Promise<{ usd: number } | null> {
  const ticker = COINGECKO_TO_TICKER[coingeckoId] ?? coingeckoId.trim().toUpperCase();

  if (ticker) {
    try {
      const res = await fetch(
        `${BINANCE_BASE_URL}/ticker/price?symbol=${encodeURIComponent(`${ticker}USDT`)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as { price?: string };
        const price = Number(data.price);
        if (Number.isFinite(price) && price > 0) return { usd: price };
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
    const res = await fetch(`${COINGECKO_BASE_URL}/simple/price?${params.toString()}`, {
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

export async function fetchHistoricalPricesCached(coingeckoId: string, days: number): Promise<HistoricalPoint[]> {
  if (!coingeckoId) return [];

  const cacheKey = historicalCacheKey(coingeckoId, days);
  const now = Date.now();
  const cached = historicalPriceCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const inflight = historicalPriceInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = fetchHistoricalPrices(coingeckoId, days)
    .then((points) => {
      historicalPriceCache.set(cacheKey, {
        value: points,
        expiresAt: Date.now() + HISTORICAL_CACHE_TTL_MS,
      });
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

export function clearCurrentPriceCache(): void {
  currentPriceCache.clear();
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
