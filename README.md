# OpenClaw Agent PWA — versión reparada

Esta app es solo el **canal móvil**. El cerebro sigue estando en tu VPS: OpenClaw/ChatGPT autenticado/cola/scripts.

Arquitectura correcta:

```txt
Móvil / PWA
  ↓ /api
Cloudflare Pages Function
  ↓ OC_AGENT_SECRET
VPS agent-api
  ↓ local
OpenClaw / ChatGPT auth / scripts / cola
```

## Qué se ha reparado

- La app ya no pide IP ni token en el móvil.
- El secreto real del VPS no se guarda en `localStorage`.
- Cloudflare valida usuario/contraseña y firma una sesión temporal.
- `functions/api/[[path]].js` solo permite rutas conocidas: `/auth`, `/health`, `/chat`, `/skills`, `/remind`.
- `backend/install.sh` ya no tiene la ruta rota `/path/to/...`.
- `agent-api.js` escucha por defecto en `127.0.0.1:3000`, más seguro para poner Nginx o Cloudflare Tunnel delante.
- `agent-api.js` puede funcionar de dos formas:
  1. WebSocket directo a OpenClaw: `ws://127.0.0.1:18789`.
  2. Comando real mediante `AGENT_COMMAND`, recomendado si ya tienes un script/cola que usa el mismo flujo que Telegram.

## Variables en Cloudflare Pages

En tu proyecto de Cloudflare Pages añade:

```txt
OC_USER=tu_usuario_para_entrar_en_la_app
OC_PASS=tu_contraseña_para_entrar_en_la_app
OC_AGENT_SECRET=un_secret_largo_igual_que_en_el_vps
OC_SESSION_SECRET=otro_secret_largo_opcional
OC_API_URL=https://agent.santisystems.es
```

Para una prueba rápida, `OC_API_URL` puede ser `http://TU_IP:3000`, pero no es lo ideal para producción.

## Instalar backend en el VPS

Sube la carpeta `backend/` al VPS, por ejemplo a `/root/openclaw-app/backend`.

```bash
cd /root/openclaw-app/backend
chmod +x install.sh
./install.sh
```

El instalador te pedirá un secret. Ese mismo valor debe ir en Cloudflare como `OC_AGENT_SECRET`.

## Probar backend localmente en el VPS

Después de instalar:

```bash
systemctl status openclaw-agent-api --no-pager -l
```

Prueba `/health`:

```bash
curl http://127.0.0.1:3000/health \
-H "Authorization: Bearer TU_SECRET"
```

Prueba `/chat`:

```bash
curl -X POST http://127.0.0.1:3000/chat \
-H "Authorization: Bearer TU_SECRET" \
-H "Content-Type: application/json" \
-d '{"message":"hola"}'
```

Si responde, el puente funciona.

Si falla con WebSocket, no significa que la app esté mal: significa que OpenClaw no acepta ese formato de mensaje. En ese caso usa `AGENT_COMMAND` apuntando al mismo flujo que ya usa Telegram.

## Conectar con el mismo flujo que Telegram

Si tienes un script que recibe un mensaje y devuelve la respuesta del agente, edita:

```bash
nano /etc/systemd/system/openclaw-agent-api.service
```

Y añade/descomenta algo así:

```txt
Environment=AGENT_COMMAND=/root/agent-queue/send-message.sh
```

Luego:

```bash
systemctl daemon-reload
systemctl restart openclaw-agent-api
journalctl -u openclaw-agent-api -f
```

## Exponer el backend al Worker de Cloudflare

Opción buena:

```txt
https://agent.santisystems.es -> 127.0.0.1:3000
```

Puedes hacerlo con Nginx + certificado o con Cloudflare Tunnel.

No es recomendable dejar `3000` abierto a internet si puedes evitarlo.

## Deploy de la PWA

1. Sube el proyecto a GitHub.
2. Cloudflare Pages → conectar repo.
3. Build command vacío.
4. Output directory `/`.
5. Añade las variables anteriores.
6. Deploy.

## Archivos importantes

```txt
index.html                         interfaz
app.js                             lógica cliente
functions/api/[[path]].js          proxy seguro de Cloudflare
backend/agent-api.js               puente en VPS
backend/install.sh                 instalador systemd
backend/openclaw-agent-api.service servicio systemd
```

## Punto crítico

La app está lista como canal, pero el test decisivo es este en el VPS:

```bash
curl -X POST http://127.0.0.1:3000/chat \
-H "Authorization: Bearer TU_SECRET" \
-H "Content-Type: application/json" \
-d '{"message":"hola"}'
```

Si ahí contesta tu ChatGPT/OpenClaw, después solo queda conectar Cloudflare.

## PWA instalable

Este ZIP ya incluye lo necesario para instalar la web como app:

- `manifest.json`
- `sw.js`
- iconos en `/icons/`
- registro del service worker desde `app.js`
- botón de instalación en la cabecera cuando el navegador lo permita

Para aplicar los cambios en Cloudflare Pages:

1. Sube este proyecto o haz deploy desde GitHub.
2. Mantén las variables de Production:
   - `OC_API_URL=http://agent.santisystems.es:3000`
   - `OC_AGENT_SECRET=...`
   - `OC_USER=...`
   - `OC_PASS=...`
3. Haz Redeploy.
4. En Android Chrome abre `https://agentepersonal.pages.dev/` y pulsa **Instalar app** o menú ⋮ → **Instalar app**.

