# Phase One Operations Suite — Deployment Checklist

This is the living checklist for the next production deployment. Update it as
features are completed; never place credentials or secret values in this file.

The complete credential, environment, integration and hardware inventory is in
[`REQUIRED-CONFIGURATION.md`](./REQUIRED-CONFIGURATION.md). Review it before
every staging or production deployment.

## Full-launch readiness summary

The application is locally buildable and the core automated suite is green. A
production release is **not yet a full activation** until the gates below have
been completed in Coolify and staging. A first safe deployment may still be
performed with ShipStation purchasing and packaging-evidence email delivery
disabled, while Coupon Affiliates remains the affiliate balance authority.

### Gate 1 — Production infrastructure and secrets (blocking)

- [ ] Confirm the final dashboard domain, DNS and valid HTTPS certificate.
- [ ] Configure all core runtime secrets in Coolify as protected values; store
  `MONITOR_PASSWORD_HASH` as a **Literal** so its `$` characters are preserved.
- [ ] Use unique, stable production values for `SESSION_SECRET`,
  `ANALYTICS_HMAC_SECRET`, `BARCODE_SIGNING_SECRET`,
  `AFFILIATE_SERVICE_SECRET` and `EVIDENCE_ENCRYPTION_SECRET`.
- [ ] Provision persistent PostgreSQL, Redis and private evidence-storage
  volumes. Redis must use `noeviction`.
- [ ] Prove backup **and restore** for PostgreSQL, Redis, WordPress and the
  evidence volume before enabling live operations.
- [ ] Apply PostgreSQL migrations `001` through `011` explicitly with
  `npm run db:migrate -- up`; do not rely on an application restart to migrate.
- [ ] Set the exact production `DASHBOARD_ORIGIN`, storefront
  `TRACKER_ORIGINS`, secure-cookie, proxy and America/Bogota timezone values.

### Gate 2 — WordPress bridge and commerce (blocking)

- [ ] Install and activate `wordpress/phase-one-operations-bridge.zip` version
  **1.5.0** after taking a WordPress database and `wp-content` backup.
- [ ] Configure a dedicated server-side WooCommerce Read/Write REST key and
  verify that it never reaches browser code or logs.
- [ ] Confirm COA Manager, Site Controls and Points & Rewards remain active when
  their corresponding dashboard controls are required.
- [ ] Exercise bridge writes only with controlled staging records first:
  product, COA, loyalty adjustment, Site Controls and order evidence.
- [ ] Reconcile the installed Zelle/Venmo and eDebit plugin source/version
  differences recorded in `BARCODE-FULFILLMENT-TRACKER.md`. Keep those orders
  blocked from fulfillment until their real paid/reserved-stock behavior passes.
- [ ] Validate PRISM, Zelle/Venmo, eDebit and every manual-payment fixture from
  payment eligibility through packing without double stock deduction.

### Gate 3 — One-operator fulfillment certification (blocking for fulfillment)

- [ ] Assign a valid location and registered barcode to every pilot SKU,
  variation and required batch.
- [ ] Verify current approved COAs and batch mappings for the pilot catalog.
- [ ] Complete a staged order from queue → picking → packing → saved evidence,
  then refresh/restart and confirm exact durable recovery.
- [ ] Certify 100 consecutive Code 128 reads with the selected USB/Bluetooth HID
  scanner and test camera scanning on iPhone and Android over HTTPS.
- [ ] Print readable 2×1 product/batch labels and a non-purchased 4×6 shipping
  label at exact size on the selected 203-dpi printer.
- [ ] Confirm wrong SKU, variation, batch, COA, excess quantity, repeated event
  and concurrent-tab attempts remain blocked and auditable.

### Gate 4 — Packaging evidence and email (safe to deploy disabled)

- [ ] Mount the private evidence path persistently and confirm direct public URL
  access and post-logout access are denied.
- [ ] Keep `EVIDENCE_NOTIFICATION_MODE=disabled` for the first deployment.
- [ ] With Operations Bridge 1.6.0 installed, send one controlled staging email
  through the existing WordPress SMTP setup and confirm both optimized photos
  arrive as attachments with the correct Phase One sender/template.
- [ ] Check the WordPress mail log before retrying an `uncertain` delivery and
  document bounce handling plus evidence retention/deletion policy.
- [ ] Enable `EVIDENCE_NOTIFICATION_MODE=outbox` only after that controlled test
  passes; never introduce separate SMTP credentials into the dashboard.

### Gate 5 — Integrations that stay off until separately approved

- [ ] ShipStation: add the API V2 key server-side, discover carriers/services and
  validate one persistent but non-purchasing rate request on isolated staging data.
- [ ] Install Operations Bridge 1.7.0+ and prove label tracking save/void
  idempotency without order-status or stock changes.
- [ ] Keep `SHIPSTATION_LABEL_PURCHASE_ENABLED=false` until a separately
  approved label-purchase/void pilot proves idempotency, uncertain-result
  reconciliation and no duplicate WooCommerce/ShipStation shipment.
- [ ] Google Search Console: create the OAuth web client, enable its API, register
  the exact production callback and connect the verified
  `sc-domain:phaseonelabz.com` property after deployment.
- [ ] Affiliate platform: configure the server-to-server secret, run the shadow
  commission ledger through a representative period, reconcile balances and
  historical payouts, and complete affiliate/admin UAT. Coupon Affiliates stays
  authoritative until explicit cutover approval.

### Gate 6 — Storefront, monitor and final smoke test

- [ ] Decide whether the monitor is independent or relayed; do not partially
  configure the upstream-monitor credential trio.
- [ ] Configure storefront `PUBLIC_PRESENCE_WS_URL` and
  `OPERATIONS_CONTROL_URL`; keep emergency maintenance unset/`0` normally.
- [ ] Verify allowed storefront origins, rejected unauthorized origins, WebSocket
  reconnect, cart/search telemetry and the new-order sound using staged events.
- [ ] Test desktop, tablet and mobile in light/dark modes, including readable
  errors, keyboard access and camera permissions.
- [ ] Review logs for leaked credentials, authorization headers, repeated
  retries, failed outbox jobs or unexpected production mutations.
- [ ] Keep the previous Coolify image tags and a written rollback path available.

### Recommended activation order

1. Back up and prove recovery.
2. Configure Coolify secrets, volumes, DNS and TLS.
3. Install Operations Bridge 1.7.0 and validate staging records, including one idempotent test-order COA assignment and native tracking save/void round trip.
4. Deploy the dashboard with evidence email and label purchasing disabled.
5. Apply migrations 001–011 and verify `/health`, login and core read/write views.
6. Deploy/connect the storefront, Site Controls and telemetry.
7. Certify fulfillment hardware and complete the staged end-to-end order.
8. Enable evidence outbox only after the controlled WordPress SMTP attachment test.
9. Connect Search Console and perform ShipStation read-only rate validation.
10. Approve affiliate cutover and real ShipStation purchasing as separate changes.

## Current release: independent Site Controls and customer intelligence

### Before deployment

- [ ] Take a recoverable backup of the dashboard Redis volume.
- [ ] Take a WordPress database and `wp-content` backup.
- [ ] Confirm the repaired Operations Bridge PHP file still passes `php -l`.
- [ ] Confirm the dashboard and storefront working trees contain only intended release changes.
- [ ] Run dashboard `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Run storefront `npm test` and `npm run build`.
- [ ] Confirm production `TRACKER_ORIGINS` includes `https://phaseonelabz.com` and `https://www.phaseonelabz.com`.
- [ ] Confirm production `DASHBOARD_ORIGIN` matches the real operations-domain origin.
- [ ] Confirm `WOOCOMMERCE_ACCESS_MODE=read_write` only on the protected dashboard service.
- [ ] Confirm the dashboard Redis volume is persistent and uses `noeviction`.
- [ ] Set storefront `OPERATIONS_CONTROL_URL=https://phaseonelabz.is`.
- [ ] Keep `PHASEONE_EMERGENCY_MAINTENANCE` unset or `0` during a normal release.
- [ ] Confirm Search Console credentials and callback URL if SEO synchronization is being enabled.

### Deployment order

- [ ] Deploy the dashboard/control-plane service first.
- [ ] Verify `GET /health` returns `200` and `status=ok`.
- [ ] Verify unauthenticated `GET /api/public/site-control` returns `source=operations-control-plane`.
- [ ] Open Site Controls and confirm the current WordPress configuration was imported as revision 1 or later.
- [ ] Deploy `research-peptides` after the public control endpoint is healthy.
- [ ] Confirm the storefront reads the operations endpoint and does not fall back to WordPress.

### Production smoke tests

- [ ] Sign in with an administrator account and verify role and session state.
- [ ] Load Orders, Products, Customers, COA Manager, Site Controls, Live Monitor, Loyalty and SEO.
- [ ] Create a temporary non-public Site Controls copy change and verify the revision/audit notification.
- [ ] In an approved maintenance window, enable maintenance and verify a public page returns HTTP `503`.
- [ ] Confirm `/status`, `/api/site-control`, assets and the operations dashboard remain reachable during maintenance.
- [ ] Disable maintenance and verify the public page returns HTTP `200` again.
- [ ] Confirm product images, variants, customer points, order detail, refunds and COA assignments still load.
- [ ] Confirm live visitor/search/cart telemetry reaches the dashboard.
- [ ] Confirm WordPress mirror failure does not prevent a Site Controls save.
- [ ] Review application logs for credential leakage, repeated timeouts or uncaught errors.

### Rollback

- [ ] Keep the previous dashboard and storefront image tags available in Coolify.
- [ ] Roll back the storefront first if public rendering fails.
- [ ] Roll back the dashboard only if the control API or authenticated operations fail.
- [ ] Do not delete the Redis volume during rollback; it contains control state, users and telemetry.
- [ ] If the dashboard is unavailable and the storefront must close, set `PHASEONE_EMERGENCY_MAINTENANCE=1` on the storefront and redeploy it.

## Barcode Fulfillment prerequisites

- [ ] Approve the focused one-operator scope in `docs/WMS-PHASED-SCOPE.md`.
- [ ] Confirm WordPress remains the product, order, stock, payment, batch/COA and shipping authority.
- [ ] Verify when card/PRISM, Zelle/Venmo, Yodlee/eDebit and every manual payment path reserves or reduces stock.
- [ ] Define the exact eligibility rule for an order to enter the packing queue.
- [ ] Approve a small PostgreSQL schema for locations, sessions, scan events and fulfillment history only.
- [ ] Provision the database or approve an existing managed PostgreSQL database/schema.
- [ ] Select one USB HID Code 128 scanner and one 203-dpi thermal printer for the pilot.
- [ ] Approve the label size, initially proposed as approximately 2 × 1 inches.
- [ ] Confirm the MVP uses product and batch labels, not a unique serial label for every vial.
- [ ] Assign one primary location to every product/variation included in the pilot.
- [ ] Confirm packing completion writes only a packing marker/private note and never changes stock, Woo order completion or ShipStation.

### Barcode Fulfillment production gate

- [ ] Wrong SKU, variant, batch, invalid barcode and excess quantity are rejected without changing progress.
- [ ] Replaying one scan event 100 times increments progress once.
- [ ] Two browser tabs cannot create two packing records or complete the same order twice.
- [ ] Browser/server restart restores exact accepted progress.
- [ ] A changed, cancelled or payment-ineligible order is blocked before completion.
- [ ] Final verified quantities and batches are saved in the packing snapshot.
- [ ] WordPress packing-marker retries are idempotent and do not change stock or shipping.
- [ ] Every current payment path passes the order-eligibility/reservation test.
- [ ] The certified scanner reads 100 consecutive printed labels successfully.
- [ ] The thermal label prints at the intended size with readable SKU, variant, batch and location.
- [ ] The complete pick-and-pack flow is usable without a mouse after the order is opened.
- [ ] Recovery steps are documented for WordPress, scanner, printer and workstation outages.

