# Phase One Live Monitor

Monitor privado de presencia, intención de compra y analítica propia para Phase One Labz. No guarda IP, datos de pago ni números de orden. Redis conserva presencia temporal, agregados, recorridos anónimos recientes y, durante 180 días, búsquedas y carritos. El nombre o correo solo se asocia al carrito cuando la tienda ya conoce al cliente autenticado; los visitantes anónimos permanecen identificados únicamente por un número interno. El UUID aleatorio del navegador solo aparece en presencia temporal y se ingresa en bocetos HyperLogLog no enumerables; las claves persistentes que enlazan visitas y deduplican órdenes se transforman con HMAC.

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
- Las búsquedas se registran después de una pausa de escritura y los carritos guardan solo producto, variante, cantidad, precio e identidad ya conocida. No se capturan campos de checkout ni datos financieros.
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
   PUBLIC_PRESENCE_WS_URL=https://phaseonelabz.is
   ```

7. Crea en WooCommerce una clave REST con permiso **Read** y configura en el monitor `WOOCOMMERCE_URL`, `WOOCOMMERCE_CONSUMER_KEY` y `WOOCOMMERCE_CONSUMER_SECRET`. Al arrancar, el monitor reconcilia por defecto los últimos 400 días; después consulta solamente las órdenes modificadas desde el último cursor, con cinco minutos de solapamiento.

El tracker está integrado en `MainLayout.astro` y en la página independiente `/checkout/thank-you`.

El módulo **Marketing & Customer Intent** clasifica un carrito como abandonado
después de 30 minutos sin cambios, conserva el estado comprado/limpiado para la
auditoría y muestra búsquedas sin resultados. El evento de carrito de la tienda
continúa alimentando la automatización de recuperación y su enlace seguro de
checkout; la secuencia de correo debe aprobarse y activarse en la plataforma de
entrega antes de enviar mensajes reales.

## Commerce OS y rentabilidad

El dashboard incluye una consola administrativa por módulos: Inicio, Pedidos,
Productos, Clientes, Analítica, Marketing, Monitor en vivo, Integraciones y
Configuración. WordPress y WooCommerce permanecen como motor de comercio en
segundo plano.

- `GET /api/commerce` consulta hasta 100 productos y 100 pedidos recientes con
  la clave REST de solo lectura. Las credenciales nunca se envían al navegador.
- `POST /api/product-cost` guarda en Redis el costo unitario, costo de empaque y
  porcentaje de comisión de cada producto.
- La utilidad estimada por unidad es `precio - costo - empaque - comisión`.
- La utilidad de un pedido solo se muestra cuando todos sus artículos tienen
  costo configurado. Si falta alguno, el panel muestra **Sin calcular** para no
  presentar una cifra financiera incompleta.
- El detalle de pedido reconcilia artículos, cupones, envío, impuestos, cargos,
  reembolsos, pago y saldo reembolsable. Con `WOOCOMMERCE_ACCESS_MODE=read_write`
  permite confirmar, completar, cancelar y emitir reembolsos tras una
  confirmación explícita en la interfaz.
- Crear o editar productos directamente en el motor de comercio requiere una
  credencial REST con permisos de escritura. Mientras el formulario de alta
  siga en modo borrador, conserva el trabajo en el navegador.
- Las imágenes externas del catálogo se permiten únicamente desde el origen
  configurado en `WOOCOMMERCE_URL`; las previsualizaciones locales usan
  `blob:` y nunca salen del navegador.
- COA Manager usa PostgreSQL como fuente oficial para certificados nuevos y
  editados. En una base vacía importa de forma idempotente todos los registros
  históricos de Phase One COA Manager, incluidas sus versiones, y después deja
  WordPress únicamente como respaldo histórico de transición. PDFs, enlaces,
  producto, lote, SKUs, estado de publicación y auditoría se gobiernan desde el
  dashboard. El contrato y el procedimiento de corte están documentados en
  [`docs/CUSTOM-COA-CUTOVER.md`](docs/CUSTOM-COA-CUTOVER.md).

### Loyalty control

El módulo **Loyalty control** conserva los saldos y el historial del sistema de
puntos existente, pero permite que un Owner o Administrator gobierne la política
sin editar código:

- puntos emitidos por cada dólar elegible, redondeo, mínimo de pedido y límite
  máximo por pedido;
- inclusión opcional de envío e impuestos y estados de pedido que otorgan puntos;
- valor de conversión de puntos a crédito, con simulador y cálculo de la
  responsabilidad financiera antes de publicar;
- pausa independiente de acumulación o canje;
- ajustes por cliente con operaciones Add, Deduct y Set, razón obligatoria,
  protección contra saldos negativos y correo de notificación opcional;
- auditoría completa de cambios de política y movimientos de saldo.

Instala o actualiza `wordpress/phase-one-operations-bridge.zip` a la versión
2.0.1 y usa `WOOCOMMERCE_ACCESS_MODE=read_write` para habilitar publicación,
pedidos operativos repetidos, tracking y enlaces seguros de recuperación. Los
puntos existentes, los pedidos ya premiados, el crédito y las redenciones
históricas no se recalculan ni se eliminan al cambiar una regla.

## Monitor local y monitor compartido

La tienda pública envía presencia al endpoint configurado en su build. Para que
el panel local conserve el mismo historial y la misma actividad en vivo del
monitor compartido, configura `UPSTREAM_MONITOR_URL`,
`UPSTREAM_MONITOR_USERNAME` y `UPSTREAM_MONITOR_PASSWORD`. El servidor local se
autentica y retransmite el snapshot por su WebSocket protegido; estas
credenciales nunca llegan al navegador. Si las tres variables quedan vacías,
el servicio funciona como receptor independiente con su propio Redis.

## SEO y Google Search Console

El módulo **SEO reports** usa OAuth 2.0 y solicita únicamente el permiso
de lectura de Search Console. En Google Cloud crea un cliente OAuth de tipo
aplicación web y registra esta URL de redirección local:

```text
http://localhost:8080/api/seo/callback
```

Después agrega a `.env`:

```text
GOOGLE_SEARCH_CONSOLE_CLIENT_ID=tu_client_id
GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET=tu_client_secret
GOOGLE_SEARCH_CONSOLE_REDIRECT_URI=http://localhost:8080/api/seo/callback
GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:phaseonelabz.com
```

Reconstruye con `docker compose up -d --build`, abre **SEO reports** y
pulsa **Connect search data**. Los tokens se guardan cifrados en Redis; el
navegador nunca recibe el secreto del cliente ni el token de actualización.

Para validar staging en el despliegue compartido, incluye
`https://staging.phaseonelabz.com` en `TRACKER_ORIGINS` y vuelve a desplegar el
monitor. El handshake de staging debe responder `101 Switching Protocols`, no
`403 Forbidden`.

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

## Barcode fulfillment — Phase 1 foundation

Phase 1 adds the local PostgreSQL foundation for warehouse locations,
fulfillment sessions, idempotent scan events, and lifecycle history. It does
not add a queue or scanning UI yet and does not write to WordPress, stock,
payments, orders, or ShipStation.

For isolated local development, Docker Compose reads
`docker-compose.override.yml` automatically and starts the private `postgres`
service:

```powershell
docker compose up -d postgres
$env:DATABASE_URL='postgresql://phaseone:local-development-only@127.0.0.1:5433/phaseone_fulfillment'
npm run db:migrate -- up
Remove-Item Env:DATABASE_URL
docker compose up -d --build
```

To run the server outside Docker, set a local `DATABASE_URL` in `.env`, for
example `postgresql://phaseone:phaseone-local-only@127.0.0.1:5432/phaseone_dashboard`,
then run `npm run db:migrate -- up` before starting the app. Rollback is always
explicit:

```powershell
npm run db:migrate -- down --allow-destructive
```

Do not add PostgreSQL to production or run this migration in Coolify until a
separate deployment phase is approved. The implementation status, safeguards,
test evidence, and phase gates live in
[`docs/BARCODE-FULFILLMENT-TRACKER.md`](docs/BARCODE-FULFILLMENT-TRACKER.md).

## Barcode fulfillment — Phase 2 labels and locations

Phase 2 adds the **Labels & locations** workspace without changing commercial
inventory. An Owner or Administrator can assign a primary location such as
`A-01` to a product and optional overrides to its variations. Operations users
can generate and reprint product, variation, and existing COA/batch labels;
Analyst users remain read-only.

Every printed Code 128 value is a compact 20-digit opaque identifier registered
in PostgreSQL. The identifier resolves server-side to the existing product,
variation, COA and lot records. It does not contain a writable stock value and
cannot create or update a product, order, payment, shipment, or inventory record.
Keep `BARCODE_SIGNING_SECRET` stable and private so newly registered identifiers
remain deterministic across restarts:

```text
BARCODE_SIGNING_SECRET=a-unique-random-secret-with-at-least-32-characters
```

Apply the second migration explicitly in a local environment before opening the
workspace:

```powershell
$env:DATABASE_URL='postgresql://phaseone:local-development-only@127.0.0.1:5433/phaseone_fulfillment'
npm run db:migrate -- up
Remove-Item Env:DATABASE_URL
docker compose up -d --build monitor
```

The print dialog supports 2×1-inch and 3×1-inch thermal media, 1–50 copies, and
declares the exact paper size with zero page margins. In the browser printer
dialog select the matching label stock, use **100% / Actual size**, disable
headers and footers, and keep margins at **None**. Physical scanner and printer
certification remains a hardware-pilot task; the software output has automated
coverage for Code 128 structure, exact page dimensions, copies, and safe SVG.

Do not run these migrations in Coolify or add the PostgreSQL and barcode secrets
to production until a separate deployment phase is approved.

## Producción en Coolify

Despliega este directorio como una aplicación Git con build pack **Docker Compose**. Coolify debe leer `docker-compose.yml`; no uses el override local. Asigna al servicio `monitor` el dominio `https://monitor.phaseonelabz.com:8080`. El sufijo `:8080` indica el puerto interno; públicamente seguirá usando HTTPS normal.

Configura en Coolify:

```text
TRACKER_ORIGINS=https://phaseonelabz.com,https://www.phaseonelabz.com
DASHBOARD_ORIGIN=https://monitor.phaseonelabz.com
COA_PUBLIC_ORIGIN=https://monitor.phaseonelabz.com
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
GOOGLE_SEARCH_CONSOLE_CLIENT_ID=tu_client_id
GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET=tu_client_secret
GOOGLE_SEARCH_CONSOLE_REDIRECT_URI=https://monitor.phaseonelabz.com/api/seo/callback
GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:phaseonelabz.com
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
