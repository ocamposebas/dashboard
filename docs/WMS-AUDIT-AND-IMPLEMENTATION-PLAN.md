# Phase One Labz — WMS Audit and Implementation Plan

Status: historical architecture audit. No production data, stock, orders or
deployment state were modified during this audit.

The enterprise WMS proposal in this file has been superseded. The current,
controlling proposal is the focused one-operator Barcode Fulfillment scope in
[`WMS-PHASED-SCOPE.md`](./WMS-PHASED-SCOPE.md). Do not implement the enterprise
schema or authority-migration plan below unless it is separately requested in
the future; it remains only as architectural background.

## Executive decision

Build Warehouse Management as a native module of the existing Phase One
Operations Suite, but give it a dedicated PostgreSQL transactional core.
WordPress/WooCommerce should remain the sales channel during the migration and
receive synchronized projections; it should not own picking, physical
locations, scan events or the warehouse inventory ledger.

Redis remains appropriate for presence, short-lived caches, notifications and
control-plane state. It is not the correct source of truth for inventory
reservations or concurrent fulfillment.

## 1. Existing architecture

### Dashboard

- Node.js 22 + TypeScript HTTP server, Vite dashboard and WebSocket presence.
- Redis with AOF persistence for users, sessions, notifications, analytics,
  customer/cart/search telemetry, cached commerce data and Site Controls.
- No relational database, migration runner or transactional repository layer.
- One protected operations connection to WooCommerce and the Phase One
  Operations Bridge.
- Current roles: owner, administrator, operations and analyst. POST API calls
  are protected by origin checks and operations-level authorization.

### Store and WordPress

- Astro/React public storefront.
- WooCommerce remains the current product, variation, order and commercial
  stock source.
- Several payment paths reserve or reduce WooCommerce stock: PRISM, manual
  Zelle/Venmo, eDebit/Yodlee and gift-order synchronization.
- ShipStation and shipment-tracking state is currently read from WooCommerce
  metadata and public tracking endpoints; the dashboard does not create labels
  or carrier handoffs.
- Custom bulk-order tables exist in WordPress, but there is no WMS schema.

## 2. Functionality that already exists and should be reused

| Area | Existing capability | WMS reuse |
| --- | --- | --- |
| Products | Product/variation IDs, SKU, images, visibility, price and aggregate stock | Local product shadow records keyed to the existing IDs |
| Orders | Detail, line items, payment, fees, refunds, evidence, agreements and notes | Immutable fulfillment-order snapshots and eligibility checks |
| Inventory UI | Low stock, negative stock, restock records and waitlist notification | Keep inside Products; link exceptions to warehouse balances |
| COA | Product/variation matching, lot, current/historical records and editable manager | Lot master data and fulfillment validation |
| Order COA | Quantity-level order-item assignments with immutable COA snapshots | Mirror final physically packed lot allocations |
| Shipping | Carrier/service, ShipStation export flags, shipment IDs and tracking metadata | Read status now; add a separate shipping handoff later |
| Authentication | Managed users, secure cookies, password rotation and role checks | Reuse identity/session layer; add warehouse permissions |
| Audit surfaces | Notifications, order notes and existing operation histories | Feed immutable WMS activity events into the same UI |
| Realtime UI | WebSocket infrastructure and dashboard design system | Live task counts, assignment updates and scan feedback |

## 3. Missing functionality

- Warehouses, zones, bins and deactivated locations.
- Physical inventory by product, variation, lot and location.
- Durable inventory reservation and an immutable stock-movement ledger.
- Barcode registry, label generation and print history.
- Picking and packing task state machines.
- Scan validation, idempotency and incorrect-scan events.
- Assignment/claiming, pause/resume and authorized exceptions.
- Fine-grained warehouse permissions.
- WMS-specific order snapshots and an integration outbox.
- Reconciliation between physical WMS inventory and WooCommerce sellable stock.
- Direct ShipStation label creation/handoff.
- Warehouse performance metrics based on transactional events.

## 4. Required PostgreSQL schema

Use UUID primary keys internally. Keep WooCommerce numeric IDs as external
references with unique constraints; never use mutable SKU text as a primary key.

1. `warehouse_sites` — name, timezone, status.
2. `warehouse_locations` — site, code, label, type, parent location, active flag.
3. `catalog_items` — Woo product/variation IDs, SKU snapshot, name and sync version.
4. `inventory_lots` — item, lot code, COA external ID/snapshot, received/expiry dates, approval/block status.
5. `inventory_balances` — location + lot, on-hand, reserved and row version; unique by location/lot.
6. `inventory_movements` — immutable receive, transfer, reserve, release, pick, pack, ship, return and adjustment events.
7. `barcode_identifiers` — globally unique code, entity type/id, symbology, active flag and print metadata.
8. `fulfillment_orders` — Woo order ID, number, eligibility/payment state, priority, source version and address snapshot.
9. `fulfillment_order_lines` — Woo item ID, item snapshot, requested, cancelled and fulfilled quantities.
10. `inventory_reservations` — order line, lot/location, quantity, status and expiry.
11. `picking_tasks` and `picking_task_lines` — assignment, state, progress, expected source and quantities.
12. `packing_tasks` and `packing_verifications` — station, packer, verified lot/quantity and completion state.
13. `fulfillment_lot_allocations` — final order-line-to-lot quantities and immutable COA snapshot.
14. `scan_events` — client event ID, barcode, result code, task, actor, station and timestamp.
15. `warehouse_exceptions` — shortage, wrong item/lot/location, damage and supervisor resolution.
16. `warehouse_employee_profiles` / `warehouse_permissions` — fine-grained capabilities tied to existing user UUIDs.
17. `integration_outbox` and `integration_inbox` — retryable/idempotent WordPress and ShipStation events.
18. `sync_cursors` — order/product/stock reconciliation checkpoints.

Critical constraints:

- Unique barcode value.
- Unique Woo order and order-item references.
- Unique `client_event_id` for every scan/mutation retry.
- Check constraints preventing negative on-hand/reserved quantities.
- `reserved <= on_hand` enforced within locked transactions.
- State-transition guards and row locking (`SELECT … FOR UPDATE`) on reservation and scan completion.

## 5. APIs to add

All mutation endpoints require same-origin authentication, a warehouse
permission and an idempotency key.

### Overview and locations

- `GET /api/warehouse/overview`
- `GET|POST /api/warehouse/locations`
- `GET|PATCH /api/warehouse/locations/:id`
- `POST /api/warehouse/locations/:id/deactivate`
- `GET /api/warehouse/locations/:id/history`
- `POST /api/warehouse/locations/:id/labels`

### Barcodes and inventory

- `POST /api/warehouse/barcodes`
- `POST /api/warehouse/barcodes/resolve`
- `POST /api/warehouse/barcodes/:id/reprint`
- `GET /api/warehouse/inventory`
- `POST /api/warehouse/inventory/receive`
- `POST /api/warehouse/inventory/transfer`
- `POST /api/warehouse/inventory/adjust`
- `GET /api/warehouse/inventory/movements`
- `POST /api/warehouse/inventory/reconcile`

### Picking

- `GET /api/warehouse/picking-tasks`
- `POST /api/warehouse/picking-tasks/:id/claim`
- `POST /api/warehouse/picking-tasks/:id/start`
- `POST /api/warehouse/picking-tasks/:id/pause`
- `POST /api/warehouse/picking-tasks/:id/scan`
- `POST /api/warehouse/picking-tasks/:id/exception`
- `POST /api/warehouse/picking-tasks/:id/complete`

### Packing and shipping handoff

- `GET /api/warehouse/packing-tasks`
- `POST /api/warehouse/packing-tasks/:id/start`
- `POST /api/warehouse/packing-tasks/:id/scan`
- `POST /api/warehouse/packing-tasks/:id/complete`
- `POST /api/warehouse/shipments/:orderId/create`
- `POST /api/warehouse/shipments/:orderId/handoff`

### Integrations

- Authenticated/HMAC WordPress order webhook plus polling fallback.
- Product, variation and COA synchronization jobs.
- Retryable outbox handlers for final COA assignment, stock projection, order
  notes/status and ShipStation actions.

## 6. Barcode communication and validation

Start with scanners in keyboard-wedge mode. They type a value into one large,
always-focused field and finish with Enter; this works with standard USB and
Bluetooth scanners without manufacturer SDKs.

Recommended identifier format: a short `P1L` prefix, entity discriminator and
opaque generated identifier with checksum. Store the identifier in
`barcode_identifiers`; never infer product/lot/location authority from visible
barcode text alone.

Each scan sends `{ taskId, barcode, stationId, clientEventId }`. The server:

1. Resolves the active barcode.
2. Locks the task, line, reservation and balance rows.
3. Validates order item, SKU/variation, lot status, COA, required quantity and expected location.
4. Writes an immutable scan event.
5. Applies the permitted transition/movement atomically.
6. Returns a result code, human explanation, updated progress and sound cue.

The browser shows green/red plus text/icon feedback; color is never the only
signal. A duplicate `clientEventId` returns the original result without applying
inventory twice.

## 7. Reservation and deduction model

The physical ledger follows this sequence:

1. Eligible paid order imported idempotently.
2. Reservation chooses approved lots/locations (FEFO where expiry exists).
3. Picking transfers reserved quantity from storage to a staging location.
4. Packing verifies the exact staged lot and creates final lot allocation.
5. Packing completion marks `ready_for_shipment`; it does not mark the order shipped.
6. Carrier handoff creates a `ship` movement, reduces physical on-hand and closes reservations.

`available_to_sell = on_hand - active_reservations - quarantine - safety_stock`.

### Safe cutover

Initially run WMS in shadow mode. WooCommerce continues its existing stock
behavior while WMS compares expected and physical balances. Do not decrement Woo
again on WMS pick/pack because existing payment plugins already reserve/reduce
stock. After reconciliation is stable, make WMS authoritative and publish an
absolute sellable quantity to WooCommerce. Disable conflicting legacy mutation
paths before that cutover.

## 8. Batch and COA linkage

- Every physical balance belongs to an `inventory_lot`.
- Every lot points to a COA ID plus an immutable COA snapshot.
- Blocked, review-only or expired lots cannot be reserved or scanned without a supervisor exception.
- Packing writes `fulfillment_lot_allocations` for the exact quantities shipped.
- The integration outbox mirrors those allocations through the existing order-COA assignment API.
- Historical lots and snapshots are never overwritten when a new current lot arrives.
- If WordPress is unavailable, fulfillment can continue from local snapshots and the mirror action retries later.

## 9. Dashboard pages/components

Add one navigation group, **Warehouse Management**, using the existing visual
system:

1. Overview — live queues, exceptions, accuracy and processing times.
2. Storage Locations — hierarchy, balances, history and label printing.
3. Barcode Management — generate, search, reprint and deactivate identifiers.
4. Picking Orders — queue, assignment, priority and exceptions.
5. Picking Station — scan-first focused workflow with keyboard shortcuts.
6. Packing Station — independent second verification and ready-for-shipment transition.
7. Inventory Movements — immutable ledger, receiving, transfer and adjustments.
8. Employee Activity — task, scan, override and adjustment audit.

Keep restocks and customer waitlists inside Products. Link them to WMS balance
and receiving data rather than creating a competing inventory screen.

## 10. Architectural risks to resolve first

1. Multiple WordPress payment plugins currently reserve/reduce stock; adding a second deduction path would oversell or understate inventory.
2. Redis is the only dashboard data store and cannot provide the required relational transactions and durable constraints.
3. Current order synchronization records analytics only; it does not persist fulfillment-order snapshots.
4. Woo order status currently mixes payment and fulfillment concerns. WMS needs an independent state machine.
5. COA current-lot status does not represent quantity by location; WMS must add lot/location balances.
6. ShipStation is observable but not yet a governed label/handoff integration.
7. Current roles are too broad for overrides and inventory adjustments.
8. Dashboard server/UI files are already large; WMS must be implemented as separate domain modules, repositories and view components.
9. WordPress outages and 30-second upstream timeouts require local snapshots, an outbox and non-blocking retries.
10. Bundle/gift stock behavior must be mapped to physical components before WMS becomes stock authority.

## 11. Recommended delivery phases

| Phase | Deliverable | Estimate |
| --- | --- | --- |
| 0 | Production data audit, stock mutation map, hardware/label decision and acceptance criteria | 2–3 days |
| 1 | PostgreSQL, migrations, repositories, permissions, local product/order/COA shadows, inbox/outbox | 4–6 days |
| 2 | Locations, receiving, lot balances, barcode registry and printable labels | 5–7 days |
| 3 | Paid-order import, atomic reservation, picking queue and scan-first Picking Station | 7–10 days |
| 4 | Packing Station, final lot/COA allocation, exceptions and immutable employee audit | 5–7 days |
| 5 | Inventory reconciliation, cancellations/returns and separate ShipStation handoff | 5–8 days |
| 6 | Analytics, concurrency/load tests, warehouse pilot, shadow mode and controlled cutover | 5–7 days |

Realistic total for one strong full-stack engineer with warehouse feedback:
approximately 6–9 weeks. Two engineers can shorten calendar time, but the
shadow-mode and physical inventory validation period should not be compressed.

## Approval gates before implementation

1. Confirm PostgreSQL ownership and backup policy.
2. Choose lot-level versus individually serialized vial labels.
3. Approve the source-of-truth/cutover model.
4. Confirm actual warehouse zones, bin format and label dimensions.
5. Confirm ShipStation scope: observe only, create labels, or full handoff.
6. Approve roles and which actions require supervisor override.

