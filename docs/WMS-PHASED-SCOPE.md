# Phase One Labz — Barcode Fulfillment scope

Status: revised implementation proposal for approval. No feature code, database migration, WordPress data, inventory, or deployment state has been changed.

Date: 2026-10-15

## Scope decision

This is **not an enterprise WMS**. It is one focused Pick & Pack module inside the existing Phase One Operations Suite for one warehouse and one operator.

The module will:

- Reuse the current products, variations, SKUs, stock, orders, payment decisions, COAs/batches, and ShipStation visibility.
- Add locations, printable barcodes, an order queue, a scanner-first picking screen, and packing confirmation.
- Record durable progress and reject duplicate or incorrect scans.
- Update a separate packing marker on the existing order without changing commercial stock or initiating shipment.

It will not become an inventory authority, stock ledger, shipping engine, employee scheduling system, or multi-warehouse platform.

## Important finding from the current code

The existing stock model can remain unchanged because this feature only verifies what is packed. WordPress and the current payment plugins keep their existing reservation and stock-deduction behavior.

The dashboard itself currently has Redis with AOF persistence but no relational database or migration layer. Redis is appropriate for caches, live presence, sessions, notifications, and telemetry; it is not the simplest safe place to guarantee all three of these requirements together:

1. The same order cannot be packed twice from two tabs or two retried requests.
2. The same scan event changes progress no more than once.
3. Accepted progress survives browser/server restarts with a complete audit trail.

The minimal safe addition is therefore a very small PostgreSQL schema for fulfillment progress only. It does **not** copy stock quantities and does **not** replace WordPress inventory.

---

# 1. Exact features to build

## A. Product locations

- Add one primary warehouse location to each product variation, such as `A-01`, `A-02`, or `B-01`.
- Products without variations use `variation_id = 0`.
- Validate and normalize location codes server-side.
- Show the location in:
  - The Product detail/editor.
  - The fulfillment order list.
  - Every picking line.
- Provide a small “Locations” management view under Products for fast bulk assignment and filtering.
- No warehouse hierarchy, maps, capacity planning, or multi-bin quantity tracking.

## B. Barcode generation and labels

- Generate Code 128 barcodes for:
  - Product/variation labels.
  - Product/variation + batch/COA labels.
- Display human-readable product, SKU, variant, lot/batch, and location on the label.
- Print from the browser using a simple thermal-label layout.
- Support reprinting the same deterministic barcode without creating a new inventory record.
- Use a versioned, signed payload so altered text cannot be treated as a valid warehouse label.
- No individual serial number for every vial in the first release.
- No barcode registry table unless the business later needs external manufacturer barcode aliases.

Suggested payloads:

- Product: `P1P.v1.<product-id>.<variation-id>.<signature>`
- Batch: `P1B.v1.<product-id>.<variation-id>.<coa-or-batch-id>.<signature>`

The printed text remains readable, but the server resolves and validates the identifiers. The client never decides whether a barcode is correct.

## C. Paid-order queue

- Add one navigation item: **Fulfillment**.
- Show only orders that meet the approved eligibility policy.
- Default MVP eligibility:
  - Current order status is `processing`.
  - Payment is approved or does not require manual approval.
  - Order is not already packed, cancelled, refunded beyond the agreed rule, or currently locked by another session.
- Show order number, age, item count, customer/shipping summary, and packing state.
- Open one order at a time.
- Refresh the selected order directly from WordPress before starting so a stale dashboard cache cannot create an incorrect packing snapshot.

`completed` orders should not automatically appear merely because they were paid; in the current dashboard, `paidOrder()` treats both `processing` and `completed` as paid. Fulfillment needs a stricter eligibility function because `completed` can mean the order has already finished its lifecycle.

## D. Scanner-first picking screen

- Large product image, name, SKU, variant, required quantity, picked quantity, location, and expected/current batch.
- Persistent scanner capture while the station is active; standard USB/Bluetooth HID scanners behave like a keyboard.
- For each scan, the browser sends:
  - Fulfillment/session ID.
  - A new client event UUID.
  - Raw barcode value.
- The server transaction validates:
  - Authenticated operations permission.
  - Fulfillment is still open.
  - Barcode signature/type is valid.
  - Product ID, variation ID, and SKU match an unfinished order line.
  - Batch/COA matches when the scanned label is batch-specific.
  - Accepted quantity will not exceed the ordered quantity.
- Correct scan: strong green confirmation, product name, progress count, optional sound.
- Incorrect scan: strong red warning, reason, no progress mutation, optional different sound.
- The screen updates immediately from the server response.
- A repeated client event UUID returns the original response and never increments quantity twice.
- Manual entry exists only as an explicit fallback and uses the same server validation.

## E. Packing confirmation

- Enable **Complete packing** only when every physical line has the exact required quantity.
- Before completion, the server refreshes the order and blocks if status, payment approval, line items, quantities, cancellation, or refund state changed after the session started.
- Save an immutable completion snapshot containing:
  - Order and order-line IDs.
  - Product/variation/SKU.
  - Required and verified quantities.
  - Verified batch/COA identifiers and lot text.
  - Operator and timestamps.
- Mark the local fulfillment record `packed` in the same transaction.
- Synchronize a separate WordPress packing marker and internal order note idempotently.
- Do **not** set the WooCommerce order to `completed`.
- Do **not** change stock, reservations, shipping status, tracking, or ShipStation state.

## F. Simple history and recovery

- Show Started, Scan accepted/rejected, Cancelled/reset, Packed, and WordPress sync state.
- Allow reopening an interrupted open session from the exact saved progress.
- Allow a permitted operator to reset/cancel an unfinished session with a mandatory reason.
- Do not silently edit or delete accepted scan events.
- If the WordPress packing-marker update fails after local completion, show “Packed · sync pending” and retry safely. The package is not scanned again.

## User-experience rules

- One primary action per screen.
- Large targets and typography suitable for standing use beside a packing table.
- Product photo, SKU, variant, location, quantity, and batch visible without opening another panel.
- Green is reserved for accepted scans/completion; red is reserved for blocking errors.
- The last result remains visible until the next scan.
- Keyboard-only operation is possible.
- Light/dark themes reuse the existing dashboard design tokens.

---

# 2. Existing code to reuse

| Existing file/capability | Reuse in barcode fulfillment |
|---|---|
| `src/server/wooCommerceGateway.ts` | Existing `CommerceProduct`, `CommerceVariation`, `CommerceOrder`, line items, payment operations, shipping metadata, `listOrders()`, `getOrder()`, COA reads, and order-COA assignment. Add only packing metadata support. |
| `src/server/httpServer.ts` | Existing authenticated HTTP server, JSON/body helpers, same-origin mutation protection, operations-role guard, commerce cache, and error conventions. Delegate fulfillment routes to a small new route module. |
| `src/server/auth.ts` | Existing users, sessions, roles, and permission context. MVP uses the current operations/admin roles; no employee scheduling model. |
| `src/server/config.ts` | Existing validated environment configuration pattern. Add database and barcode-secret settings. |
| `src/server/index.ts` | Existing service bootstrap and graceful shutdown. Add the fulfillment repository/service lifecycle. |
| `src/server/wooOrderSync.ts` | Reuse its paid-status knowledge and polling approach as reference, but not its analytics fingerprints as fulfillment state. A fresh order read remains required when starting/completing. |
| `src/dashboard/main.ts` | Existing product/order types, data loading, view navigation, order notifications, theme behavior, HTML escaping, formatting, and API/error patterns. Keep station logic in a new module because this file is already over 5,000 lines. |
| `src/dashboard/index.html` | Existing sidebar, Products workspace, Orders workspace, drawers, headers, connection state, and notification center. Add a single Fulfillment view and product location/label controls. |
| `src/dashboard/styles.css` and `premium.css` | Existing design system, responsive shell, light/dark theme, buttons, surfaces, status pills, drawers, and form styles. Add only fulfillment-specific layout rules. |
| `src/shared/protocol.ts` | Existing shared-type location. Add fulfillment DTOs or place them in a focused shared module. |
| `src/server/socketHub.ts` | Existing realtime infrastructure can announce queue changes later; scan correctness will not depend on WebSockets. The scan HTTP response is authoritative. |
| `wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php` | Existing protected operational REST bridge and order/COA routes. Add one idempotent packing-marker route that never changes stock or ShipStation. |

Existing data reused directly:

- Product ID, variation ID, SKU, image, name, attributes, and current stock display.
- Order ID, line-item ID, quantities, status, paid time, payment approval, refunds, and shipping address.
- COA ID, matched product/variation, batch, lot, status, and current-shipping-lot flag.
- ShipStation/carrier information for read-only context after packing.

---

# 3. Files and database changes needed

## New application files

| File | Purpose |
|---|---|
| `src/shared/fulfillment.ts` | Request/response DTOs, fulfillment states, scan-result codes, label types, and validation limits. |
| `src/server/database.ts` | Small PostgreSQL pool wrapper, transaction helper, health check, and graceful close. |
| `src/server/fulfillmentRepository.ts` | All SQL for locations, fulfillment sessions, events, row locks, idempotency, and sync retries. |
| `src/server/fulfillmentService.ts` | Eligibility, order snapshot construction, barcode verification, quantity rules, completion, and reset rules. |
| `src/server/fulfillmentRoutes.ts` | Authenticated fulfillment endpoints delegated from `httpServer.ts`. |
| `src/server/barcodeService.ts` | Signed payload encode/decode and Code 128 label rendering. |
| `src/dashboard/fulfillment.ts` | Queue, active station state, scanner capture, event UUIDs, feedback, progress, and completion UI. |
| `src/dashboard/fulfillment.css` | Focused station/queue/label styles using existing design tokens. |
| `migrations/001_barcode_fulfillment.sql` | Four-table schema, indexes, checks, and migration record. |
| `scripts/migrate.ts` | Explicit migration command; production startup does not silently change the schema. |
| `test/fulfillment-service.test.ts` | Eligibility and scan validation matrix. |
| `test/fulfillment-repository.integration.test.ts` | PostgreSQL idempotency, order lock, restart persistence, and concurrency tests. |
| `test/barcode-service.test.ts` | Payload tampering, type, version, signature, and parsing tests. |
| `test/fulfillment-routes.test.ts` | Auth, same-origin, invalid request, conflict, and response contract tests. |

## Existing files to modify

| File | Minimal change |
|---|---|
| `package.json` | Add PostgreSQL driver, barcode renderer, migration scripts, and test support. |
| `.env.example` | Add `DATABASE_URL` and `FULFILLMENT_BARCODE_SECRET`; never add real values. |
| `docker-compose.yml` / `docker-compose.override.yml` | Add local PostgreSQL or connect the monitor to an approved existing database; keep Redis unchanged. |
| `src/server/config.ts` | Validate fulfillment database/secret configuration. |
| `src/server/index.ts` | Create/close database and fulfillment services. |
| `src/server/httpServer.ts` | Delegate `/api/fulfillment/*` and barcode-label requests. Do not add another large inline route block. |
| `src/server/wooCommerceGateway.ts` | Map packing metadata and call the bridge packing endpoint. No stock write. |
| `src/dashboard/index.html` | Add Fulfillment navigation/view and small Products location/label actions. |
| `src/dashboard/main.ts` | Register the module with existing navigation/session/theme/data lifecycle. |
| `src/dashboard/styles.css` or Vite entry | Import `fulfillment.css`. |
| `wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php` | Add read/write packing metadata endpoint with idempotency and a private order note. |
| `wordpress/phase-one-operations-bridge/README.txt` | Document new endpoint and confirm it does not mutate stock/shipping. |

## Minimal PostgreSQL schema

Only four business tables are needed.

### `product_locations`

- `product_id bigint not null`
- `variation_id bigint not null default 0`
- `location_code varchar(20) not null`
- `updated_by varchar(100) not null`
- `updated_at timestamptz not null`
- Primary key: `(product_id, variation_id)`
- Check: normalized code matches the approved pattern, initially `^[A-Z][A-Z0-9]*-[0-9]{2,3}$`.

This table stores only a location label. It does not store quantity or own inventory.

### `order_fulfillments`

- `id uuid primary key`
- `order_id bigint not null unique`
- `order_number varchar(40) not null`
- `state varchar(20) not null` — `open`, `packed`, or `cancelled`
- `source_modified_at timestamptz`
- `source_snapshot jsonb not null`
- `progress jsonb not null`
- `completion_snapshot jsonb`
- `started_by varchar(100) not null`
- `cancelled_by varchar(100)` / `cancel_reason text`
- `started_at`, `updated_at`, `packed_at timestamptz`
- `version integer not null default 1`
- `wordpress_sync_state varchar(20) not null default 'not_needed'`
- `wordpress_sync_attempts integer not null default 0`
- `wordpress_next_retry_at timestamptz`
- `wordpress_last_error text`

The unique `order_id` is the primary duplicate-fulfillment guard. Restarting a cancelled order reuses and versions the same lifecycle rather than creating a second invisible fulfillment.

### `fulfillment_scan_events`

- `id uuid primary key`
- `fulfillment_id uuid not null references order_fulfillments(id)`
- `client_event_id uuid not null unique`
- `raw_barcode text not null`
- `barcode_type varchar(20)`
- `product_id`, `variation_id`, `order_item_id bigint`
- `coa_id varchar(120)` / `lot varchar(120)`
- `result varchar(20) not null` — `accepted` or `rejected`
- `reason_code varchar(40) not null`
- `quantity_delta integer not null default 0`
- `response_snapshot jsonb not null`
- `actor_id varchar(100) not null`
- `created_at timestamptz not null`

The stored response makes exact request replay possible. Rejected scans are recorded for troubleshooting but never mutate progress.

### `fulfillment_events`

- `id uuid primary key`
- `fulfillment_id uuid not null references order_fulfillments(id)`
- `event_type varchar(30) not null` — `started`, `resumed`, `cancelled`, `packed`, `sync_succeeded`, or `sync_failed`
- `actor_id varchar(100) not null`
- `reason text`
- `details jsonb not null default '{}'`
- `created_at timestamptz not null`

This is the basic fulfillment history. It is not an enterprise employee-activity system.

## Required transactional rules

- `POST /scan` begins a PostgreSQL transaction.
- First, look up `client_event_id`; if it exists, return its saved response.
- Lock the order fulfillment row with `SELECT ... FOR UPDATE`.
- Validate the current state and scan against the saved order snapshot/progress.
- Insert the scan event and update progress in the same transaction.
- `POST /complete` locks the same row and verifies exact quantities before changing `open → packed`.
- A stale `version` returns HTTP `409` and the current state.
- WordPress synchronization runs after the local packing transaction and is retryable from fields on the same row.

No inventory movement, stock balance, reservation, shipment, warehouse site, employee schedule, wave, or analytics tables are added.

---

# 4. Simplest safe architecture

## Data ownership

| Data | System of record |
|---|---|
| Products, variants, SKU, stock and current inventory rules | Existing WordPress/commerce system |
| Orders, payments, refunds and shipping data | Existing WordPress/commerce system |
| COAs, batches and current-shipping-lot mapping | Existing COA service/WordPress bridge |
| Product location code | Small dashboard PostgreSQL table |
| Open picking progress and accepted/rejected scans | Small dashboard PostgreSQL tables |
| Final packing snapshot | Dashboard PostgreSQL, mirrored as packing metadata to the existing order |
| ShipStation shipment and carrier handoff | Existing system; read-only to this feature |

## Request flow

1. Dashboard loads candidate orders through the existing commerce gateway and joins local packing state.
2. Operator selects an order.
3. Server performs a fresh `getOrder(orderId)` plus COA/batch read and validates payment/status.
4. Server creates or resumes the unique fulfillment row with an immutable source snapshot.
5. Scanner sends a barcode and client event UUID.
6. Server validates and updates progress under a row lock in one PostgreSQL transaction.
7. Browser shows the authoritative accepted/rejected result.
8. Completion refreshes the source order, detects changes, locks the fulfillment row, and stores the exact final snapshot.
9. Server mirrors only packing metadata/order note to WordPress. A failed mirror is retried without reopening the package.
10. Shipping remains a separate action outside the module.

## Why this is simpler than the previous plan

- No inventory ledger.
- No WMS reservations.
- No stock-authority migration or shadow mode.
- No warehouse/zone/bin hierarchy.
- No station registry.
- No waves, workload balancing, return system, or carrier automation.
- No duplicated product, stock, batch, COA, customer, or shipping tables.
- No new WebSocket correctness protocol.
- Four small tables instead of an independent WMS data model.

## Minimal prerequisite for the existing stock model

Before implementation, test each current payment path—card/PRISM, Zelle/Venmo, Yodlee/eDebit, and any manual flow—to document exactly when WordPress reserves or reduces stock.

The barcode module must not fix or duplicate these rules. It only needs a reliable eligibility signal:

- If the current payment flow reserves stock before an order becomes `processing`, no stock-model change is needed.
- If a manual payment can become eligible for picking before stock is reserved, the minimal fix belongs in that existing payment flow: reserve first, then mark payment approved/processing.
- If a plugin releases stock while an order is being packed, the completion refresh will block. The plugin rule must be corrected rather than adding a second reservation engine.

The queue should not open until this payment-path matrix has been verified.

## API surface

- `GET /api/fulfillment/orders`
- `POST /api/fulfillment/orders/:orderId/start`
- `GET /api/fulfillment/:id`
- `POST /api/fulfillment/:id/scan`
- `POST /api/fulfillment/:id/complete`
- `POST /api/fulfillment/:id/cancel`
- `GET /api/fulfillment/:id/history`
- `GET /api/fulfillment/locations`
- `PUT /api/fulfillment/locations/:productId/:variationId`
- `GET /api/fulfillment/labels/product/:productId/:variationId`
- `GET /api/fulfillment/labels/batch/:coaId`

All mutations reuse current session authorization, operations permission, same-origin enforcement, input limits, and structured errors.

---

# 5. Realistic development time

Assumptions: one experienced engineer, one warehouse, one operator, one supported scanner/printer combination, existing WordPress credentials available, and no redesign of payment/inventory plugins.

| Work | Estimate |
|---|---:|
| Confirm payment eligibility, batch mapping, label size and operator flow | 1 day |
| PostgreSQL setup, migration, repository and transaction tests | 1.5–2 days |
| Product locations and label generation/printing | 1.5–2 days |
| Paid-order queue and session start/resume | 1–1.5 days |
| Scanner station and server verification | 2–3 days |
| Packing completion, history and WordPress packing marker | 1.5–2 days |
| Visual polish, keyboard/scanner behavior, errors and accessibility | 1–1.5 days |
| End-to-end, retry, concurrency, restart and hardware testing | 2 days |

**Engineering estimate: 10–14 working days.**

**Realistic calendar: 2–3 weeks**, including feedback and a controlled pilot. If the payment-path audit exposes inconsistent reservation behavior, correcting that existing behavior is separately estimated after the exact plugin/path is identified.

---

# 6. Hardware requirements

## Required

- One Windows desktop or laptop already used for the dashboard.
- Chromium-based browser kept in a supported version.
- One USB HID barcode scanner that supports Code 128 and sends an Enter/CR suffix.
- Optional Bluetooth scanner only if it supports standard HID keyboard mode.
- One direct-thermal label printer, 203 dpi or better.
- Thermal labels; recommended MVP size is approximately **2 × 1 inches**, subject to a real print test.
- Reliable network connection to the dashboard server.

## Recommended pilot configuration

- A mainstream USB scanner with no proprietary SDK requirement.
- Zebra, Brother, Rollo, or equivalent thermal printer using the normal Windows driver.
- Scanner configured with Code 128 enabled, a single Enter suffix, and no custom prefix.
- Browser print preset with margins disabled, scale 100%, correct label size, headers/footers off.

## Not required

- Rugged Android warehouse computers.
- Native scanner application.
- RFID equipment.
- Industrial print server or ZPL integration.
- Multiple packing stations.

The exact scanner model, printer model, Windows driver, label stock, browser, and barcode density must be tested together before purchase in quantity.

---

# 7. Step-by-step employee workflow

1. **Open Fulfillment.** The employee sees paid, eligible, unpacked orders oldest first.
2. **Choose one order.** The dashboard refreshes the live order and opens or resumes its saved session.
3. **Read the pick list.** Each line shows product photo, SKU/variant, quantity, location, and expected batch/COA.
4. **Go to the location.** Example: `A-02`.
5. **Scan the product or batch label.** The scanner types the code and Enter; no mouse interaction is needed.
6. **Follow the response.** Green means accepted and advances the count. Red explains wrong product, variant, batch, excess quantity, invalid label, or changed order.
7. **Repeat until complete.** Progress survives refresh, browser closure, or server restart.
8. **Review the summary.** The dashboard shows each verified quantity and lot/batch before sealing the package.
9. **Select Complete packing.** The server refreshes the order, verifies exact quantities, saves the final snapshot, and marks it packed.
10. **Continue shipping separately.** The employee uses the existing ShipStation/shipping process. Packing completion does not buy a label, mark shipped, or change stock.

## Recovery behavior

- Accidental repeated scanner submission: returns the first result; no second increment.
- Browser closes: reopen the same order and resume.
- Dashboard restarts: progress remains in PostgreSQL.
- WordPress is unavailable before starting: do not start a new order from stale data.
- WordPress becomes unavailable after start: scans can continue from the saved snapshot, but final completion waits until a fresh order verification succeeds. If WordPress fails only during the subsequent packing-marker write, the already completed local record remains `packed · sync pending` and retries safely.
- Order changes before completion: block completion, show what changed, and require review/reset.
- Scanner fails: permitted manual entry uses the same validation.

---

# Production acceptance criteria

The feature is safe for its intended one-person production use only after all criteria pass:

- Wrong SKU, variant, batch, invalid signature, and excess quantity are rejected without progress changes.
- Replaying the same event UUID at least 100 times produces one accepted increment.
- Opening the same order in two tabs still produces one fulfillment state and no duplicate packing.
- Refresh/restart restores the exact accepted progress.
- A changed, cancelled, or payment-ineligible order cannot be completed from an old snapshot.
- Exact verified quantities and batches are stored at completion.
- Packing metadata sync is idempotent and never changes stock, WooCommerce fulfillment status, or ShipStation.
- Card and every manual payment path pass the eligibility/reservation matrix.
- The certified scanner reads 100 consecutive printed labels without a decoding error.
- The label prints at the intended dimensions with readable human text.
- The complete employee flow is usable without a mouse after the order is opened.

## Production safety decision

**Yes—safe for a one-person warehouse after the acceptance criteria pass.**

This conclusion applies only to barcode verification and packing confirmation. Existing WordPress/plugin inventory rules remain responsible for stock reservation and deduction, and the existing shipping process remains responsible for carrier handoff.

## Explicitly out of scope

- Independent inventory authority or stock ledger.
- New inventory reservations.
- Multiple warehouses or location quantities.
- Multi-employee scheduling, performance scoring, or workload balancing.
- Multiple packing-station optimization.
- Waves, totes, zone picking, replenishment, receiving, returns, or purchase orders.
- Automatic ShipStation label purchase, shipment creation, tracking, or carrier status changes.
- Advanced warehouse analytics or enterprise exception management.
