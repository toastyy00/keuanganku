import type { PortfolioAsset } from '../types';
import { resolveCoingeckoId } from './portfolio-prices';
import { roundPortfolioAmount } from './utils';

type PriceMap = Record<string, { usd: number }>;

export interface AggregatedPortfolioAssetValue {
  key: string;
  pocket_id: string;
  ticker: string;
  coingecko_id?: string;
  totalAmount: number;
  totalUsdValue: number;
  holdings: PortfolioAsset[];
}

export interface AggregatedChartAsset {
  coingecko_id: string;
  amount: number;
}

function assetCoingeckoId(asset: PortfolioAsset): string {
  return asset.coingecko_id ?? resolveCoingeckoId(asset.ticker);
}

export function aggregateHoldingsByTicker(
  assets: PortfolioAsset[],
  prices: PriceMap,
): AggregatedPortfolioAssetValue[] {
  const map = new Map<string, AggregatedPortfolioAssetValue>();

  for (const asset of assets) {
    const coingeckoId = assetCoingeckoId(asset);
    const ticker = asset.ticker.trim().toUpperCase();
    if (!ticker || !coingeckoId) continue;

    const key = `${ticker}::${coingeckoId}`;
    const price = prices[coingeckoId]?.usd ?? 0;
    const current = map.get(key);

    if (current) {
      current.totalAmount = roundPortfolioAmount(current.totalAmount + asset.amount);
      current.totalUsdValue += asset.amount * price;
      current.holdings.push(asset);
      continue;
    }

    map.set(key, {
      key,
      pocket_id: asset.pocket_id,
      ticker,
      coingecko_id: coingeckoId,
      totalAmount: asset.amount,
      totalUsdValue: asset.amount * price,
      holdings: [asset],
    });
  }

  return Array.from(map.values()).sort((a, b) => b.totalUsdValue - a.totalUsdValue);
}

export function aggregateHoldingsByCoingeckoId(assets: PortfolioAsset[]): AggregatedChartAsset[] {
  const byId = new Map<string, number>();

  for (const asset of assets) {
    const coingeckoId = assetCoingeckoId(asset);
    if (!coingeckoId) continue;
    byId.set(coingeckoId, (byId.get(coingeckoId) ?? 0) + asset.amount);
  }

  return Array.from(byId.entries()).map(([coingecko_id, amount]) => ({
    coingecko_id,
    amount: roundPortfolioAmount(amount),
  }));
}

export function buildChartAssetFingerprint(assets: AggregatedChartAsset[]): string {
  return assets
    .map((asset) => `${asset.coingecko_id}:${asset.amount}`)
    .sort()
    .join('|');
}

export function buildPortfolioAssetFingerprint(assets: PortfolioAsset[]): string {
  return assets
    .map((asset) => `${asset.id}:${asset.amount}:${assetCoingeckoId(asset)}`)
    .sort()
    .join('|');
}
