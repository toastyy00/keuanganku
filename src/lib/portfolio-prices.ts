type CurrentPriceMap = Record<string, { usd: number }>;
type HistoricalPoint = [number, number];
type Timeframe = '24H' | '1W' | '1M' | '1Y' | 'ALL';

const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';
const PRICE_CACHE_TTL_MS = 30_000;
const MAX_BATCH_SIZE = 50;

const currentPriceCache = new Map<string, { value: { usd: number }; expiresAt: number }>();

const TICKER_TO_COINGECKO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
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

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

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
  const missing: string[] = [];

  for (const id of uniqueIds) {
    const cached = currentPriceCache.get(id);
    if (cached && cached.expiresAt > now) {
      result[id] = cached.value;
    } else {
      missing.push(id);
    }
  }

  const stillMissing: string[] = [];
  await Promise.all(missing.map(async (id) => {
    const ticker = COINGECKO_TO_TICKER[id] ?? id.trim().toUpperCase();
    if (!ticker) {
      stillMissing.push(id);
      return;
    }
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(`${ticker}USDT`)}`,
        { signal: AbortSignal.timeout(10_000) }
      );
      if (!res.ok) {
        stillMissing.push(id);
        return;
      }
      const data = (await res.json()) as { price?: string };
      const price = Number(data.price);
      if (!Number.isFinite(price) || price <= 0) {
        stillMissing.push(id);
        return;
      }
      result[id] = { usd: price };
      currentPriceCache.set(id, {
        value: { usd: price },
        expiresAt: now + PRICE_CACHE_TTL_MS,
      });
    } catch {
      stillMissing.push(id);
    }
  }));

  // Fallback for tokens not listed in Binance USDT pair.
  const batches = chunk(stillMissing, MAX_BATCH_SIZE);
  for (const batch of batches) {
    if (batch.length === 0) continue;
    const params = new URLSearchParams({
      ids: batch.join(','),
      vs_currencies: 'usd',
    });
    const res = await fetch(`${COINGECKO_BASE_URL}/simple/price?${params.toString()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) continue;
    const data = (await res.json()) as CurrentPriceMap;
    for (const id of batch) {
      const payload = data[id];
      if (!payload || typeof payload.usd !== 'number') continue;
      result[id] = { usd: payload.usd };
      currentPriceCache.set(id, {
        value: { usd: payload.usd },
        expiresAt: now + PRICE_CACHE_TTL_MS,
      });
    }
  }

  return result;
}

export async function fetchHistoricalPrices(coingeckoId: string, days: number): Promise<HistoricalPoint[]> {
  if (!coingeckoId) return [];

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
