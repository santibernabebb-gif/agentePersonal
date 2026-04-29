# OpenClaw Agent PWA

App móvil instalable para controlar tu agente OpenClaw desde el móvil, con autenticación biométrica.

## Características

- 🔐 Login con huella digital / Face ID (WebAuthn)
- 💬 Chat con tu agente con soporte de voz
- ⚡ Skills instaladas visibles desde la app
- 📊 Panel de estado del agente
- 📱 Instalable como app nativa (PWA)
- 🔒 Token cifrado en el dispositivo
- ✈️ Funciona offline (caché)

## Deploy en Cloudflare Pages

1. Sube este proyecto a GitHub
2. Ve a [Cloudflare Pages](https://pages.cloudflare.com)
3. Conecta tu repositorio de GitHub
4. Build settings:
   - **Framework preset**: None
   - **Build command**: (vacío)
   - **Output directory**: `/` (raíz)
5. Deploy

## Configuración de iconos

Añade tus propios iconos en la carpeta `/icons/`:
- `icon-192.png` (192x192px)
- `icon-512.png` (512x512px)

Puedes generarlos en [https://realfavicongenerator.net](https://realfavicongenerator.net)

## Uso

1. Abre la app en tu móvil
2. Introduce tu **Gateway Token** de OpenClaw
3. Introduce la **URL de tu OpenClaw** (ej: `https://tu-vps.ionos.com:48001`)
4. La primera vez guarda el token y activa biometría
5. Las siguientes veces solo necesitas la huella

## CORS en tu VPS

Para que la app pueda conectar con tu OpenClaw, puede que necesites añadir el dominio de Cloudflare Pages a los orígenes permitidos en tu VPS.

En tu OpenClaw, busca la configuración de CORS y añade:
```
https://tu-app.pages.dev
```

## Estructura

```
openclaw-app/
├── index.html      # App principal
├── style.css       # Estilos
├── app.js          # Lógica
├── sw.js           # Service Worker (offline)
├── manifest.json   # PWA manifest
├── _redirects      # Cloudflare Pages config
└── icons/          # Iconos de la app
    ├── icon-192.png
    └── icon-512.png
```

## Instalar en móvil

**Android (Chrome):**
- Abre la web en Chrome
- Menú → "Añadir a pantalla de inicio"

**iOS (Safari):**
- Abre la web en Safari
- Compartir → "Añadir a pantalla de inicio"
