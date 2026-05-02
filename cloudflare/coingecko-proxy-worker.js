const COINGECKO_BASE_URL = 'https://api.coingecko.com';

// Replace the production origin with your real app URL before deploying.
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'https://app.example.com',
];

const ALLOWED_ENDPOINT_PREFIXES = [
  '/api/v3/search',
  '/api/v3/simple/price',
  '/api/v3/coins/',
];

function isAllowedEndpoint(pathname) {
  return ALLOWED_ENDPOINT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getAllowedOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';

  if (ALLOWED_ORIGINS.includes(origin)) return origin;

  try {
    const refererOrigin = referer ? new URL(referer).origin : '';
    if (ALLOWED_ORIGINS.includes(refererOrigin)) return refererOrigin;
  } catch {
    // Ignore malformed referer values.
  }

  return null;
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const allowedOrigin = getAllowedOrigin(request);

    if (!allowedOrigin) {
      return new Response('Forbidden', { status: 403 });
    }

    const cors = corsHeaders(allowedOrigin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: cors,
      });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: cors,
      });
    }

    const url = new URL(request.url);

    if (!isAllowedEndpoint(url.pathname)) {
      return new Response('Not Found', {
        status: 404,
        headers: cors,
      });
    }

    const upstreamUrl = new URL(url.pathname + url.search, COINGECKO_BASE_URL);
    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        'Accept': 'application/json',
        'x-cg-demo-api-key': env.COINGECKO_DEMO_API_KEY,
      },
    });

    const responseHeaders = new Headers(upstreamResponse.headers);
    Object.entries(cors).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};
