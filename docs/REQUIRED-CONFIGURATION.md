# Phase One Operations Suite — Required Configuration

This is the source-of-truth checklist for credentials, environment variables,
external services and physical validation still required for a complete
production installation.

Never paste real passwords, API keys, database URLs, OAuth secrets or signing
secrets into this document, Git, screenshots, browser code or frontend logs.
Store them as **runtime secrets** in Coolify.

Last reviewed: 2026-10-17

## Current known state

The status below describes only the ignored local `.env` and local Docker
override. It does **not** prove what is configured in Coolify.

| Area | Local state | Production action |
| --- | --- | --- |
| Dashboard login | Username and password hash are configured | Create final named administrator credentials and store the hash as a literal value |
| Session security | A local/development value exists | Replace with a unique production secret of at least 32 characters |
| Analytics identity | Configured locally | Confirm the same stable production secret is retained across redeployments |
| WooCommerce | URL and REST credentials are configured locally | Create/confirm a dedicated production Read/Write key for the protected dashboard service |
| Upstream live monitor | Configured locally | Confirm whether production will relay an upstream monitor or operate independently |
| PostgreSQL | Supplied by the local Docker override | Provision a persistent production database and set `DATABASE_URL` explicitly |
| Legacy barcode signing | Supplied by the local Docker override | Retain a stable value only while old 20-digit warehouse labels remain readable; new picking uses the vial COA QR |
| Google Search Console | Missing locally | Create the OAuth web client and configure the callback and verified property |
| ShipStation | Missing locally | Add the V2 API key and warehouse after the read-only connection is approved |
| Real label purchasing | Disabled | Keep disabled until a separately approved carrier/label pilot passes |
| Packaging evidence vault | Local encrypted volume configured | Create a stable production encryption secret, persistent volume and backup policy |

## 1. Required core secrets

- [ ] `MONITOR_USERNAME` — final private dashboard username.
- [ ] `MONITOR_PASSWORD_HASH` — final scrypt hash. Generate it with
  `MONITOR_PASSWORD_TO_HASH` and `npm run password:hash`; never store the plain
  password. In Coolify, save the hash as a **Literal** so `$` characters are not
  interpolated.
- [ ] `SESSION_SECRET` — unique random value with at least 32 characters. Rotate
  the local placeholder before production; rotating it later signs out all users.
- [ ] `ANALYTICS_HMAC_SECRET` — unique random value with at least 32 characters.
  Keep it stable across deployments because changing it breaks continuity for
  returning-visitor identity and future order deduplication.
- [ ] `DASHBOARD_ORIGIN` — exact public HTTPS origin of the dashboard, without a
  path or trailing route.
- [ ] `TRACKER_ORIGINS` — comma-separated allowlist of every storefront allowed
  to send telemetry. Include production `https://phaseonelabz.com` and
  `https://www.phaseonelabz.com`; include staging only while it is intentionally
  connected.
- [ ] `REDIS_URL` — persistent production Redis connection.
- [ ] `REDIS_KEY_PREFIX=phaseone:live` — keep stable unless intentionally creating
  a completely separate environment.

### Production runtime values

- [ ] `NODE_ENV=production`
- [ ] `COOKIE_SECURE=true`
- [ ] `TRUST_PROXY=true` behind Coolify's reverse proxy.
- [ ] `ANALYTICS_TIME_ZONE=America/Bogota`
- [ ] `SESSION_TTL_HOURS=12` or another explicitly approved duration.
- [ ] Redis persistence enabled with `noeviction`; back up the volume before a
  release because it contains control state, users, OAuth tokens and telemetry.

## 2. WordPress and commerce connection

- [ ] `WOOCOMMERCE_URL` — exact HTTPS WordPress origin.
- [ ] `WOOCOMMERCE_CONSUMER_KEY`
- [ ] `WOOCOMMERCE_CONSUMER_SECRET`
- [ ] `WOOCOMMERCE_ACCESS_MODE=read_write` if the dashboard must edit products,
  orders, refunds, COAs, Site Controls and loyalty. Use `read_only` only for an
  intentionally non-editing installation.
- [ ] `WOOCOMMERCE_SYNC_INTERVAL_SECONDS=15` initially.
- [ ] `WOOCOMMERCE_BACKFILL_DAYS=400` for the first reconciliation unless a
  different history window is approved.

The key must belong to a dedicated WordPress user with the minimum permissions
needed for store operations. It must never be exposed to the browser.

### Operations Bridge

- [ ] Install and activate `wordpress/phase-one-operations-bridge.zip` version
  **1.6.0** on the WordPress site.
- [ ] Confirm its PHP file passes `php -l` before packaging/deployment.
- [ ] Confirm the bridge reports the required capabilities: COA editing, Site
  Controls, loyalty policy, customer-point adjustments, order evidence and
  inventory/restock operations, plus `idempotent_order_coa_assignment`.
- [ ] Keep Phase One COA Manager, Phase One Site Controls and Phase One Labz
  Points & Rewards active when their matching dashboard controls are expected to
  work.
- [ ] Test the bridge with a non-production record before editing a real order,
  COA, promotion or customer balance.

## 3. QR fulfillment database

- [ ] Provision persistent PostgreSQL for the dashboard.
- [ ] Set `DATABASE_URL` as a protected server-side secret.
- [ ] Set `DATABASE_SSL=true` when required by the managed database provider.
- [ ] Confirm pool and timeout values: `DATABASE_POOL_MAX`,
  `DATABASE_CONNECTION_TIMEOUT_MS` and `DATABASE_IDLE_TIMEOUT_MS`.
- [ ] Run `npm run db:migrate -- up` once against the intended database before
  enabling fulfillment. Migrations `001` through `012` must be recorded.
- [ ] Back up PostgreSQL before every production migration.
- [ ] Set `WOOCOMMERCE_ACCESS_MODE=read_write` only after Operations Bridge
  `1.6.0` is active; this is required for a Packed fulfillment to mirror the
  exact vial QR lots into the customer's order COA record.
- [ ] Use an isolated test order to confirm that one scanned vial creates one
  COA-assigned unit, two lots remain separated, and retrying the same packing
  confirmation does not duplicate either assignment.
- [ ] Confirm a conflicting manual COA assignment remains blocked for review;
  the dashboard must never remove or replace it automatically.

### Legacy barcode identity secret

- [ ] Set `BARCODE_SIGNING_SECRET` to a unique random value with at least 32
  characters.
- [ ] Keep it stable while any previously registered 20-digit label remains in
  circulation. It is not used to identify the external COA QR already printed
  on current vials.
- [ ] Never reuse the local value from `docker-compose.override.yml` in
  production.

## 4. Google Search Console

- [ ] Create a Google Cloud OAuth 2.0 client of type **Web application**.
- [ ] Enable the Google Search Console API for that project.
- [ ] Add the exact production callback to Google, for example
  `https://<dashboard-domain>/api/seo/callback`.
- [ ] Set `GOOGLE_SEARCH_CONSOLE_CLIENT_ID`.
- [ ] Set `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`.
- [ ] Set `GOOGLE_SEARCH_CONSOLE_REDIRECT_URI` to the exact registered callback.
- [ ] Set `GOOGLE_SEARCH_CONSOLE_SITE_URL=sc-domain:phaseonelabz.com`.
- [ ] Confirm the Google account used by the operator has access to that verified
  Search Console property.
- [ ] Complete the OAuth connection from **SEO reports** after deployment and
  verify that the read-only sync returns queries, pages, devices and sitemaps.

## 5. ShipStation

- [ ] Confirm the account supports ShipStation API V2 carriers, rates and labels.
- [ ] Store `SHIPSTATION_API_KEY` only as a server-side Coolify secret.
- [ ] Set `SHIPSTATION_WAREHOUSE_ID` after confirming the sender warehouse in the
  account.
- [ ] Use `SHIPSTATION_RATE_MODE=mock` for local development and automated tests.
- [ ] Change to `SHIPSTATION_RATE_MODE=live` only for an approved read-only
  carrier/rate validation.
- [ ] Keep `SHIPSTATION_LABEL_PURCHASE_ENABLED=false` until a separately approved
  pilot confirms package data, addresses, carrier services, idempotency,
  uncertain-result reconciliation and 4×6 output.
- [ ] Before ever enabling purchase, confirm the existing WooCommerce/ShipStation
  synchronization does not already create a shipment for the same order.
- [ ] Install Phase One Operations Bridge **1.7.0+** so confirmed label metadata
  and later voids synchronize idempotently without changing stock or order status.
- [ ] During the pilot verify that the persistent `/v2/rates` total includes the
  account's expected surcharges and that reprinting does not create another charge.

Setting an API key does not authorize purchasing postage. Real purchase requires
the separate server flag and explicit approval.

## 6. Packaging evidence vault

- [ ] Set `EVIDENCE_STORAGE_PATH=/app/data/evidence` (or an equivalent private
  persistent mount) and confirm that it is not served as a public static folder.
- [ ] Generate a unique `EVIDENCE_ENCRYPTION_SECRET` with at least 32 random
  characters. Keep it stable: losing or rotating this value without a controlled
  re-encryption process makes existing evidence unreadable.
- [ ] Attach a persistent Coolify volume to the evidence path and include it in
  encrypted backups together with PostgreSQL metadata.
- [ ] Test a restore of both the PostgreSQL records and evidence volume; neither
  side alone is a complete recoverable record.
- [ ] Keep `EVIDENCE_NOTIFICATION_MODE=disabled` locally. Production may use
  `outbox` only after Phase One Operations Bridge `1.6.0+` is installed and its
  read/write WordPress connection is healthy.
- [ ] Verify the existing WordPress `wp_mail()` SMTP/delivery plugin, sender
  domain and Phase One template with a controlled staging recipient. The
  dashboard does not require or store separate SMTP credentials.
- [ ] Confirm that the WordPress mail provider accepts two image attachments at
  the expected optimized sizes. WordPress creates temporary attachment copies,
  sends them through the configured SMTP transport and deletes the copies after
  `wp_mail()` returns.
- [ ] Review the WordPress mail log before retrying any delivery marked
  `uncertain`; this state deliberately blocks blind retries and duplicate mail.
- [ ] Define bounce handling and a retention/deletion policy before production.
- [ ] Confirm mobile camera capture over HTTPS on iPhone and Android and verify
  that photos remain private after browser logout.

## 7. Live monitor and storefront connection

Choose one monitor model:

- **Independent:** leave `UPSTREAM_MONITOR_URL`,
  `UPSTREAM_MONITOR_USERNAME` and `UPSTREAM_MONITOR_PASSWORD` all empty.
- **Relayed:** configure all three together. The URL must use HTTPS.

Storefront configuration still required:

- [ ] `PUBLIC_PRESENCE_WS_URL` points to the deployed dashboard/monitor origin.
- [ ] `OPERATIONS_CONTROL_URL` points to the independent Site Controls service.
- [ ] `PHASEONE_EMERGENCY_MAINTENANCE` remains unset or `0` during normal service.
- [ ] Production and staging origins receive the intended telemetry and an
  unauthorized origin receives `403`.

## 8. Infrastructure and physical validation

- [ ] Production DNS and TLS certificate are valid for the dashboard domain.
- [ ] Coolify health check `/health` returns HTTP 200 after a clean restart.
- [ ] PostgreSQL and Redis use persistent volumes with recoverable backups.
- [ ] Logs and error responses contain no credentials or authorization headers.
- [ ] Browser camera scanning is tested over HTTPS on iPhone and Android.
- [ ] A 2D USB/Bluetooth HID scanner reads 100 consecutive vial QR codes from
  Freedom Diagnostics, ILS and Kovera, including the complete URL fragment.
- [ ] A 203-dpi thermal printer prints 4×6 test shipping labels at exact size.
- [ ] The complete one-operator flow survives browser refresh and service restart.
- [ ] Staging payment fixtures cover PRISM, Zelle/Venmo, eDebit and every manual
  payment path before those orders can enter production fulfillment.

## 9. Final activation order

1. Back up WordPress, Redis and PostgreSQL.
2. Configure secrets in Coolify without committing them.
3. Deploy the dashboard with real label purchasing still disabled.
4. Apply PostgreSQL migrations.
5. Verify `/health`, login, WooCommerce read/write access and Operations Bridge 1.6.0.
6. Verify Products, Orders, Customers, COAs, Loyalty, Site Controls and storage locations.
7. Connect Google Search Console.
8. Validate ShipStation carriers and rates read-only.
9. Complete vial QR scanner, camera and shipping-printer certification.
10. Approve any real ShipStation label pilot separately; do not enable it as part
    of a normal dashboard deployment.

