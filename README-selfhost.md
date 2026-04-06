# Keuanganku — Self-Hosting Guide

> Expense tracker offline-first. Bisa jalan di STB, VPS, atau laptopmu.

---

## Cara Install di STB HG680p (ARM64/aarch64)

STB HG680p menggunakan prosesor ARM 64-bit. Docker mendukung ARM64 secara native.

```bash
# 1. Clone repository
git clone https://github.com/yourusername/keuanganku.git
cd keuanganku

# 2. Jalankan installer otomatis (auto-detects ARM64)
chmod +x install-docker.sh
./install-docker.sh
```

Akses dari HP kamu: `http://[IP_STB]:7432`

Cek IP STB:
```bash
hostname -I | awk '{print $1}'
```

---

## Cara Install di MacBook M1/M2

```bash
# Pastikan Docker Desktop sudah terinstall dari https://docker.com/get-started

git clone https://github.com/yourusername/keuanganku.git
cd keuanganku

docker compose up -d
```

Akses: `http://localhost:7432`

---

## Cara Install di VPS / Server x86

```bash
# Install Docker (jika belum ada)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Clone dan jalankan
git clone https://github.com/yourusername/keuanganku.git
cd keuanganku
docker compose up -d
```

Akses: `http://[IP_SERVER]:7432`

> **Tip:** Gunakan Nginx/Caddy sebagai reverse proxy + SSL di port 80/443.

---

## Akses dari Device Lain di Jaringan Lokal

Pastikan port 7432 tidak diblokir firewall:

```bash
# Ubuntu/Debian
sudo ufw allow 7432

# OpenWrt (STB)
iptables -I INPUT -p tcp --dport 7432 -j ACCEPT
```

Lalu akses dari HP atau laptop lain: `http://[IP_HOST]:7432`

---

## Expose via Cloudflared Tunnel (opsional)

Agar bisa diakses dari internet tanpa VPS:

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64 \
  -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Login dan buat tunnel
cloudflared tunnel login
cloudflared tunnel create keuanganku
cloudflared tunnel route dns keuanganku keuanganku.yourdomain.com

# Buat config
cat > ~/.cloudflared/config.yml << EOF
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: keuanganku.yourdomain.com
    service: http://localhost:7432
  - service: http_status:404
EOF

# Jalankan sebagai service
cloudflared service install
systemctl start cloudflared
```

---

## Update Aplikasi

```bash
cd keuanganku

# Pull kode terbaru
git pull

# Pull image terbaru dan restart
docker compose up -d
```

---

## Reset Semua Data

> ⚠️ **PERINGATAN**: Menghapus semua data lokal yang tersimpan di browser.

Data disimpan di `localStorage` browser masing-masing device. Untuk reset:

1. Buka Keuanganku di browser
2. Buka DevTools → Application → Local Storage
3. Hapus semua key dengan prefix `keuanganku`

Atau dari konsol browser:
```javascript
Object.keys(localStorage)
  .filter(k => k.startsWith('keuanganku'))
  .forEach(k => localStorage.removeItem(k));
location.reload();
```

Untuk reset Docker volume:
```bash
docker compose down -v   # WARNING: menghapus volume data
docker compose up -d
```

---

## Troubleshooting Port 7432

**Port sudah dipakai?**
```bash
# Cek proses di port 7432
ss -tlnp | grep 7432

# Ganti port di docker-compose.yml
ports:
  - "8080:7432"   # akses via port 8080
```

**Container tidak mau start?**
```bash
docker logs keuanganku
docker compose ps
```

**Build gagal di ARM64?**
```bash
# Pastikan menggunakan Node 20 dan npm ci berhasil
docker compose build --no-cache
```

**Tidak bisa akses dari HP?**
- Pastikan HP dan STB dalam satu WiFi yang sama
- Pastikan firewall tidak memblokir port 7432
- Coba `ping [IP_STB]` dari HP
