#!/bin/bash
# install.sh — Ejecutar en el VPS como root desde la carpeta backend/
# Instala y arranca el backend agent-api.

set -euo pipefail

cd "$(dirname "$0")"

echo "=== Instalando OpenClaw Agent API ==="

if ! command -v node >/dev/null 2>&1; then
  echo "Instalando Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node.js: $(node --version)"

mkdir -p /root/openclaw-agent-api
cp agent-api.js package.json /root/openclaw-agent-api/

cd /root/openclaw-agent-api
npm install --omit=dev

echo ""
echo "Introduce un secret largo y aleatorio para AGENT_APP_SECRET."
echo "Este mismo valor irá en Cloudflare Pages como OC_AGENT_SECRET."
read -r -s -p "Secret: " SECRET
echo ""

if [ -z "$SECRET" ]; then
  echo "ERROR: secret vacío."
  exit 1
fi

TMP_SERVICE="/tmp/openclaw-agent-api.service"
sed "s|PON_AQUI_TU_SECRET_MUY_LARGO|$SECRET|g" "$(dirname "$0")/openclaw-agent-api.service" > "$TMP_SERVICE"
cp "$TMP_SERVICE" /etc/systemd/system/openclaw-agent-api.service
chmod 644 /etc/systemd/system/openclaw-agent-api.service

systemctl daemon-reload
systemctl enable openclaw-agent-api
systemctl restart openclaw-agent-api

echo ""
echo "=== Servicio instalado ==="
systemctl status openclaw-agent-api --no-pager -l || true

echo ""
echo "Prueba local:"
echo "curl -X POST http://127.0.0.1:3000/chat -H \"Authorization: Bearer $SECRET\" -H \"Content-Type: application/json\" -d '{\"message\":\"hola\"}'"
echo ""
echo "Si responde, configura Cloudflare/Nginx/Tunnel para llegar a este backend."
