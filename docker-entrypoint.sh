#!/bin/sh
set -eu

node -e "const fs=require('fs'); const config={VITE_SUPABASE_URL:process.env.VITE_SUPABASE_URL||'',VITE_SUPABASE_ANON_KEY:process.env.VITE_SUPABASE_ANON_KEY||''}; fs.writeFileSync('/app/dist/config.js', 'window.__APP_CONFIG__ = ' + JSON.stringify(config, null, 2) + ';\\n');"

exec serve -s dist -l 7432

