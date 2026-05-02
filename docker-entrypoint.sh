#!/bin/sh
set -eu

# Inject runtime environment variables into config.js using pure shell
# (no Node.js needed — works on any base image including nginx:alpine)
cat > /usr/share/nginx/html/config.js << EOF
window.__APP_CONFIG__ = {
  "VITE_SUPABASE_URL": "${VITE_SUPABASE_URL:-}",
  "VITE_SUPABASE_ANON_KEY": "${VITE_SUPABASE_ANON_KEY:-}",
  "VITE_COINGECKO_DEMO_API_KEY": "${VITE_COINGECKO_DEMO_API_KEY:-}"
};
EOF

# Start nginx in foreground
exec nginx -g 'daemon off;'
