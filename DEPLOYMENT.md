# Keuanganku Deployment Guide

This guide covers advanced deployment scenarios. For the fastest setup, start with `README.md`.

The project uses the Docker Hub image `toastty/keuanganku:latest`, so most users do not need to build the image locally.

## Before You Start

Make sure you already have:

- Docker
- Docker Compose
- a Supabase project
- a `.env` file in the project directory

Minimal `.env` example:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
IMAGE_NAME=toastty/keuanganku:latest
```

You also need to run the SQL migrations in order from `supabase/migrations/` (`001_init.sql`, then `002_local_first_sync.sql`) in the Supabase SQL editor.

## Deploy on ARM64 Devices

Example for ARM64 devices such as HG680p:

```bash
git clone https://github.com/toastyy00/keuanganku.git
cd keuanganku
docker compose up -d
```

Check the device IP address:

```bash
hostname -I
```

Open the app from another device on the same network:

```text
http://DEVICE_IP:7432
```

## Deploy on MacBook M1 or M2

```bash
git clone https://github.com/toastyy00/keuanganku.git
cd keuanganku
docker compose up -d
```

Open:

```text
http://localhost:7432
```

## Deploy on a VPS or Linux Server

If Docker is not installed yet:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Then run the app:

```bash
git clone https://github.com/toastyy00/keuanganku.git
cd keuanganku
docker compose up -d
```

Open:

```text
http://SERVER_IP:7432
```

Tips:

- Use Nginx or Caddy if you want a domain and HTTPS
- Make sure port `7432` is allowed by your firewall

## Access from Other Devices on the Same Network

If the app does not open from your phone or another laptop, check the host firewall:

```bash
# Ubuntu/Debian
sudo ufw allow 7432

# OpenWrt or some set-top boxes
iptables -I INPUT -p tcp --dport 7432 -j ACCEPT
```

Then open:

```text
http://HOST_IP:7432
```

## Expose the App to the Internet with Cloudflared

If you want external access without opening a public port:

```bash
cloudflared tunnel login
cloudflared tunnel create keuanganku
cloudflared tunnel route dns keuanganku keuanganku.yourdomain.com
```

Example config:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: keuanganku.yourdomain.com
    service: http://localhost:7432
  - service: http_status:404
```

Then run the tunnel as a service.

## Update the App

When a new image is available on Docker Hub:

```bash
cd keuanganku
git pull
docker compose pull
docker compose up -d
```

Because the compose file uses `pull_policy: always`, `docker compose up -d` is often enough, but `docker compose pull` makes the update step explicit.

## Reset Local Browser Data

Warning: this only removes browser-local data, not data stored in Supabase.

Reset from the browser:

1. Open the app
2. Open DevTools
3. Go to `Application` > `Local Storage`
4. Delete keys that start with `keuanganku`

Or use the browser console:

```javascript
Object.keys(localStorage)
  .filter((k) => k.startsWith('keuanganku'))
  .forEach((k) => localStorage.removeItem(k));
location.reload();
```

## Troubleshooting

### The container does not start

```bash
docker compose ps
docker logs keuanganku
```

### The app is not reachable from another device

- Make sure both devices are on the same network
- Make sure port `7432` is not blocked
- Make sure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set correctly

### You want to use a different image or tag

Update `IMAGE_NAME` in `.env`, for example:

```env
IMAGE_NAME=toastty/keuanganku:latest
```
