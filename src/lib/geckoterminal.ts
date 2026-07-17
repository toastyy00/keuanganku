export interface GeckoTerminalTokenInfo {
  name: string;
  symbol: string;
  priceUsd: number;
  mcapUsd?: number;
  networkId: string; // e.g. "base", "solana", "eth"
}

/**
 * Resolves token metadata and current USD price from GeckoTerminal using a Contract Address (CA).
 * Tries direct lookup first (if network is specified), then falls back to pool searching.
 */
export async function fetchGeckoTerminalToken(
  address: string,
  network?: string
): Promise<GeckoTerminalTokenInfo | null> {
  const cleanAddress = address.trim();
  if (!cleanAddress) return null;

  // 1. Direct fetch if network is provided
  if (network && network.trim()) {
    const net = network.toLowerCase().trim();
    let gtNetwork = net;
    if (net === 'ethereum' || net === 'mainnet') gtNetwork = 'eth';
    if (net === 'avalanche') gtNetwork = 'avax';
    if (net === 'polygon') gtNetwork = 'polygon_pos';
    if (net === 'bsc' || net === 'binance smart chain') gtNetwork = 'bsc';

    try {
      const url = `https://api.geckoterminal.com/api/v2/networks/${gtNetwork}/tokens/${cleanAddress}`;
      const res = await fetch(url);
      if (res.ok) {
        const json = await res.json();
        const attrs = json?.data?.attributes;
        if (attrs) {
          return {
            name: attrs.name || '',
            symbol: attrs.symbol || '',
            priceUsd: parseFloat(attrs.price_usd || '0'),
            mcapUsd: attrs.market_cap_usd
              ? parseFloat(attrs.market_cap_usd)
              : attrs.fdv_usd
              ? parseFloat(attrs.fdv_usd)
              : undefined,
            networkId: gtNetwork,
          };
        }
      }
    } catch (e) {
      console.warn('Direct GeckoTerminal fetch failed, trying search fallback:', e);
    }
  }

  // 2. Pool Search fallback (without chain preference)
  try {
    const url = `https://api.geckoterminal.com/api/v2/search/pools?query=${cleanAddress}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const pool = json?.data?.[0];
    if (!pool) return null;

    const poolId = pool.id || '';
    const networkId = poolId.split('_')[0] || 'eth';

    const poolAttrs = pool.attributes;
    const priceUsd = parseFloat(poolAttrs?.price_in_usd || '0');

    const baseTokenId = pool.relationships?.base_token?.data?.id;
    let name = '';
    let symbol = '';
    let mcapUsd: number | undefined;

    interface GTIncludedItem {
      id: string;
      type: string;
      attributes?: {
        name?: string;
        symbol?: string;
      };
    }

    const included = (json?.included || []) as GTIncludedItem[];
    const tokenObj = included.find((item) => item.id === baseTokenId && item.type === 'token');
    if (tokenObj) {
      name = tokenObj.attributes?.name || '';
      symbol = tokenObj.attributes?.symbol || '';
    }

    // Try secondary direct fetch to get FDV/Mcap details
    try {
      const tokenUrl = `https://api.geckoterminal.com/api/v2/networks/${networkId}/tokens/${cleanAddress}`;
      const tokenRes = await fetch(tokenUrl);
      if (tokenRes.ok) {
        const tokenJson = await tokenRes.json();
        const attrs = tokenJson?.data?.attributes;
        if (attrs) {
          name = attrs.name || name;
          symbol = attrs.symbol || symbol;
          mcapUsd = attrs.market_cap_usd
            ? parseFloat(attrs.market_cap_usd)
            : attrs.fdv_usd
            ? parseFloat(attrs.fdv_usd)
            : undefined;
        }
      }
    } catch {
      // Ignore secondary failures
    }

    return {
      name,
      symbol,
      priceUsd,
      mcapUsd,
      networkId,
    };
  } catch (e) {
    console.error('GeckoTerminal pool search failed:', e);
    return null;
  }
}
