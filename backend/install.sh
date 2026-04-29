#!/bin/bash
# install.sh — Ejecutar en el VPS como root
# Instala y arranca el backend agent-api

set -e

echo "=== Instalando OpenClaw Agent API ==="

# 1. Comprobar Node.js
if ! command -v node &> /dev/null; then
  echo "Instalando Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "Node.js: $(node --version)"

# 2. Crear directorio
mkdir -p /root/openclaw-agent-api
cp agent-api.js /root/openclaw-agent-api/
cp package.json /root/openclaw-agent-api/

# 3. Instalar dependencias
cd /root/openclaw-agent-api
npm install --production

# 4. Pedir el secret
echo ""
echo "Introduce un secret largo y aleatorio para AGENT_APP_SECRET:"
echo "(Este mismo valor lo pondrás en Cloudflare Pages como variable OC_AGENT_SECRET)"
read -s -p "Secret: " SECRET
echo ""

# 5. Instalar servicio systemd
sed "s/PON_AQUI_TU_SECRET_MUY_LARGO/$SECRET/" /path/to/openclaw-agent-api.service > /etc/systemd/system/openclaw-agent-api.service

# 6. Arrancar
systemctl daemon-reload
systemctl enable openclaw-agent-api
systemctl start openclaw-agent-api

echo ""
echo "=== Listo ==="
systemctl status openclaw-agent-api --no-pager
echo ""
echo "El API está corriendo en http://127.0.0.1:3000"
echo "Ahora configura el túnel Cloudflare o Nginx para exponerlo."
