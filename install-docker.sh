#!/bin/bash
# ============================================================
#  install-docker.sh — Keuanganku Auto-Install Script
#  Supports: ARM64/aarch64 (STB HG680p), x86_64, macOS (ARM/Intel)
# ============================================================

set -e

YELLOW="\033[1;33m"
GREEN="\033[0;32m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${YELLOW}"
echo "  ██╗  ██╗███████╗██╗   ██╗ █████╗ ███╗   ██╗ ██████╗"
echo "  ██║ ██╔╝██╔════╝██║   ██║██╔══██╗████╗  ██║██╔════╝"
echo "  █████╔╝ █████╗  ██║   ██║███████║██╔██╗ ██║██║  ███╗"
echo "  ██╔═██╗ ██╔══╝  ██║   ██║██╔══██║██║╚██╗██║██║   ██║"
echo "  ██║  ██╗███████╗╚██████╔╝██║  ██║██║ ╚████║╚██████╔╝"
echo "  ╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝"
echo -e "${NC}"
echo "  Self-hosting installer — port 7432"
echo ""

# ── Detect Docker ──────────────────────────────────────────────
if ! command -v docker &> /dev/null; then
  echo -e "${YELLOW}Docker tidak terdeteksi. Menginstall...${NC}"

  ARCH=$(uname -m)
  OS=$(uname -s)

  if [ "$OS" == "Linux" ]; then
    curl -fsSL https://get.docker.com | sh
    # Add current user to docker group
    sudo usermod -aG docker "$USER" || true
  elif [ "$OS" == "Darwin" ]; then
    echo -e "${RED}Silakan install Docker Desktop dari https://docker.com/get-started${NC}"
    exit 1
  fi
fi

# ── Detect docker compose (v1 vs v2) ──────────────────────────
if docker compose version &> /dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
  COMPOSE="docker-compose"
else
  echo -e "${YELLOW}docker compose plugin tidak ditemukan. Menginstall...${NC}"
  DOCKER_COMPOSE_VERSION="2.24.5"
  ARCH=$(uname -m)
  if [ "$ARCH" == "aarch64" ]; then
    ARCH_TAG="aarch64"
  else
    ARCH_TAG="x86_64"
  fi
  sudo curl -SL "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${ARCH_TAG}" \
    -o /usr/local/bin/docker-compose
  sudo chmod +x /usr/local/bin/docker-compose
  COMPOSE="docker-compose"
fi

echo -e "${GREEN}✓ Docker: $(docker --version)${NC}"
echo -e "${GREEN}✓ Compose: $($COMPOSE version)${NC}"

# ── Build + start ──────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Membangun dan menjalankan Keuanganku...${NC}"
$COMPOSE up -d

# Wait for container to be healthy
sleep 3
if docker ps | grep -q keuanganku; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")
  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ✅ Keuanganku berjalan di:${NC}"
  echo -e "${GREEN}     http://localhost:7432${NC}"
  echo -e "${GREEN}     http://${LOCAL_IP}:7432  (dari perangkat lain)${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
else
  echo -e "${RED}✗ Container gagal berjalan. Cek: docker logs keuanganku${NC}"
  exit 1
fi
