declare global {
  interface Window {
    __APP_CONFIG__?: {
      VITE_SUPABASE_URL?: string;
      VITE_SUPABASE_ANON_KEY?: string;
      VITE_COINGECKO_DEMO_API_KEY?: string;
      VITE_COINGECKO_PROXY_BASE_URL?: string;
      VITE_APP_MODE?: string;
      VITE_APP_BASE_PATH?: string;
    };
  }
}

function readConfigValue(
  runtimeValue: string | undefined,
  buildValue: string | undefined
): string | undefined {
  if (runtimeValue && runtimeValue.trim()) return runtimeValue;
  if (buildValue && buildValue.trim()) return buildValue;
  return undefined;
}

const runtimeConfig = typeof window !== 'undefined' ? window.__APP_CONFIG__ : undefined;

export const appConfig = {
  supabaseUrl: readConfigValue(
    runtimeConfig?.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_URL as string | undefined
  ),
  supabaseAnonKey: readConfigValue(
    runtimeConfig?.VITE_SUPABASE_ANON_KEY,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  ),
  coingeckoDemoApiKey: readConfigValue(
    runtimeConfig?.VITE_COINGECKO_DEMO_API_KEY,
    import.meta.env.VITE_COINGECKO_DEMO_API_KEY as string | undefined
  ),
  coingeckoProxyBaseUrl: readConfigValue(
    runtimeConfig?.VITE_COINGECKO_PROXY_BASE_URL,
    import.meta.env.VITE_COINGECKO_PROXY_BASE_URL as string | undefined
  ),
  appMode: readConfigValue(
    runtimeConfig?.VITE_APP_MODE,
    import.meta.env.VITE_APP_MODE as string | undefined
  ) ?? 'default',
  basePath: readConfigValue(
    runtimeConfig?.VITE_APP_BASE_PATH,
    import.meta.env.VITE_APP_BASE_PATH as string | undefined
  ) ?? '/',
};

export function isDemoMode(): boolean {
  return appConfig.appMode === 'demo';
}
