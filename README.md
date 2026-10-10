# Phase One Live Monitor

Monitor privado de presencia y analítica propia para Phase One Labz. No guarda nombres, correo, IP ni números de orden. Redis conserva presencia temporal, agregados y recorridos anónimos recientes. El UUID aleatorio del navegador solo aparece en presencia temporal y se ingresa en bocetos HyperLogLog no enumerables; las claves persistentes que enlazan visitas y deduplican órdenes se transforman con HMAC.

## Arquitectura

```text
Phase One Astro -> WSS /ws/presence -> Node + ws -> Redis
WooCommerce ----> REST reconciliation ----^          |
monitor.domain -> sesión HttpOnly -> WSS /ws/dashboard
```

- El tracker se carga de forma independiente. Si el monitor o Redis fallan, la tienda sigue funcionando.
- El navegador conserva un UUID anónimo en `localStorage` para reconocer visitas recurrentes en ese mismo perfil. Cada visita usa además un UUID separado en `sessionStorage` y se renueva tras 30 minutos sin actividad.
- El tracker envía un heartbeat cada 15 segundos. Redis expira la presencia activa después de 45 segundos sin señal.
- Una pestaña oculta sale después de 30 segundos; una pestaña visible sin actividad sale después de 2 minutos y vuelve al detectar actividad.
- Las vistas, visitas, visitantes únicos diarios, retornos y órdenes pagadas se agrupan usando `ANALYTICS_TIME_ZONE`. Los recorridos detallados expiran a los 30 días y los bocetos diarios se conservan 400 días.
- Las órdenes pagadas se reciben inmediatamente desde la página de confirmación y se reconcilian directamente contra WooCommerce. Esto recupera Zelle y cualquier evento perdido cuando el cliente cierra la página. Redis deduplica permanentemente la referencia anónima para que ambos caminos nunca dupliquen la conversión histórica.
- Los dashboards reciben snapshots completos y autoritativos. Al reconectar nunca reutilizan contadores guardados en el navegador.
- El servidor puede escalar horizontalmente: Redis Pub/Sub invalida el snapshot en todas las instancias.

“Visitante único” significa un navegador/perfil anónimo, no una identidad humana garantizada: otro dispositivo, modo privado o almacenamiento borrado se contará como otro visitante, y un navegador compartido se contará como uno.

## Configuración

1. Instala dependencias: `npm ci`.
2. Copia `.env.example` a `.env` y sustituye todos los valores sensibles.
3. Genera el hash de la contraseña sin guardarla en código:

   ```powershell
   $env:MONITOR_PASSWORD_TO_HASH = 'una contraseña larga y única'
   npm run password:hash
   Remove-Item Env:MONITOR_PASSWORD_TO_HASH
   ```

4. Copia la salida completa a `MONITOR_PASSWORD_HASH` entre comillas simples; así los caracteres `$` permanecen literales.
5. Genera `SESSION_SECRET` y `ANALYTICS_HMAC_SECRET` con al menos 32 bytes aleatorios cada uno. Mantén estable `ANALYTICS_HMAC_SECRET`: cambiarlo reinicia la capacidad de enlazar visitas recurrentes y deduplicar órdenes futuras contra las anteriores.
6. En el entorno de build de Astro configura:

   ```text
   PUBLIC_PRESENCE_WS_URL=wss://monitor.phaseonelabz.com/ws/presence
   ```

7. Crea en WooCommerce una clave REST con permiso **Read** y configura en el monitor `WOOCOMMERCE_URL`, `WOOCOMMERCE_CONSUMER_KEY` y `WOOCOMMERCE_CONSUMER_SECRET`. Al arrancar, el monitor reconcilia por defecto los últimos 400 días; después consulta solamente las órdenes modificadas desde el último cursor, con cinco minutos de solapamiento.

El tracker está integrado en `MainLayout.astro` y en la página independiente `/checkout/thank-you`.

## Secciones reales

La clasificación está centralizada en `src/lib/presenceSections.ts` del proyecto Astro:

- `/` -> `HOME`
- `/shop` -> `SHOP`
- `/product/:slug` -> `PRODUCT`
- drawer del carrito abierto (`phase-cart-state`) -> `CART`
- `/checkout` y `/checkout/*` -> `CHECKOUT`
- cualquier otra ruta -> `OTHER`

## Desarrollo y validación

```powershell
Copy-Item .env.example .env
docker compose up -d redis
npm run dev
```

El monitor completo queda en `http://localhost:8080`. `npm run dev` carga `.env`, compila el dashboard en modo watch e inicia el servidor realtime. Para que el Astro local envíe presencia, usa `PUBLIC_PRESENCE_WS_URL=ws://localhost:8080/ws/presence` y ejecútalo en `http://localhost:4321`.

Validación independiente:

```text
npm run typecheck
npm test
npm run build
```

## Producción en Coolify

Despliega este directorio como una aplicación Git con build pack **Docker Compose**. Coolify debe leer `docker-compose.yml`; no uses el override local. Asigna al servicio `monitor` el dominio `https://monitor.phaseonelabz.com:8080`. El sufijo `:8080` indica el puerto interno; públicamente seguirá usando HTTPS normal.

Configura en Coolify:

```text
TRACKER_ORIGINS=https://phaseonelabz.com,https://www.phaseonelabz.com
DASHBOARD_ORIGIN=https://monitor.phaseonelabz.com
MONITOR_USERNAME=tu_usuario
MONITOR_PASSWORD_HASH=scrypt$...
SESSION_SECRET=una_cadena_aleatoria_de_32_o_mas_caracteres
ANALYTICS_HMAC_SECRET=otra_cadena_aleatoria_estable_de_32_o_mas_caracteres
REDIS_KEY_PREFIX=phaseone:live
PRESENCE_TTL_SECONDS=45
SESSION_TTL_HOURS=12
ANALYTICS_TIME_ZONE=America/Bogota
WOOCOMMERCE_URL=https://tu-wordpress.example
WOOCOMMERCE_CONSUMER_KEY=ck_clave_de_solo_lectura
WOOCOMMERCE_CONSUMER_SECRET=cs_secreto_de_solo_lectura
WOOCOMMERCE_SYNC_INTERVAL_SECONDS=60
WOOCOMMERCE_BACKFILL_DAYS=400
```

Marca `MONITOR_PASSWORD_HASH` como **Literal** en Coolify para conservar sus caracteres `$`. Todas estas variables son solo runtime; no contienen datos para el frontend.

Después, despliega Phase One Labz como una segunda aplicación Dockerfile, puerto interno `4321`, y configura `PUBLIC_PRESENCE_WS_URL=wss://monitor.phaseonelabz.com/ws/presence` como **Build Variable**. Al cambiar esta URL debes reconstruir/redeployar Phase One.

Despliega primero el monitor y después la tienda. Conserva siempre el mismo `ANALYTICS_HMAC_SECRET`. La primera reconciliación puede tardar varios minutos según el historial de WooCommerce, pero corre en segundo plano y el dashboard permanece disponible. Los totales y días se corrigen de forma idempotente; las órdenes históricas recuperadas sin una sesión vigente no pueden enlazarse retroactivamente a un recorrido anónimo.

Requisitos importantes:

- HTTPS/WSS obligatorio.
- `DASHBOARD_ORIGIN` debe coincidir exactamente con el dominio del monitor.
- `TRACKER_ORIGINS` debe listar únicamente los orígenes reales de Phase One Labz.
- Redis permanece dentro de la red privada del stack y no publica ningún puerto en Coolify.
- La presencia activa es temporal. Redis sí usa AOF/volumen para conservar los agregados y recorridos anónimos recientes entre despliegues.
- Los agregados históricos, los contadores de visitantes y las huellas anónimas de órdenes se conservan; vigila el uso de memoria de Redis y aumenta `maxmemory` antes de acercarte al límite configurado.
- No agregues un port mapping público para Redis ni para el monitor; el dominio de Coolify debe ser la única entrada.
