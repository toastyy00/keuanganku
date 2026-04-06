declare global {
  interface Window {
    __APP_CONFIG__?: {
      VITE_SUPABASE_URL?: string;
      VITE_SUPABASE_ANON_KEY?: string;
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
};

