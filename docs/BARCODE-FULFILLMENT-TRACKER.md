# Barcode Fulfillment — Development Tracker

Scope authority: [`WMS-PHASED-SCOPE.md`](./WMS-PHASED-SCOPE.md)

Last updated: 2026-10-18

Status legend: `[ ]` not started, `[~]` in progress, `[x]` completed, `[!]` blocked.

## Program guardrails

- WordPress remains authoritative for products, orders, payment state, commercial stock, batches/COAs, and shipping.
- The dashboard database stores only fulfillment locations, sessions, scan decisions, and basic history.
- No production migration, deployment, inventory write, live order write, payment change, or automatic ShipStation action is authorized during local development.
- Advancement between phases requires explicit approval.

## Phase 1 — Foundation & Database

Status: **completed and approved locally**

### Tasks

- [x] Review the dashboard architecture, persistence, authentication, commerce gateway, COA integration, and current test conventions.
- [x] Inspect available payment/stock evidence without modifying WordPress.
- [x] Record the payment eligibility and stock-handling matrix, including unresolved live-plugin verification.
- [x] Add minimal PostgreSQL configuration, pool lifecycle, connection check, and explicit migration command.
- [x] Add reversible migration for locations, fulfillment sessions, scan events, and fulfillment events.
- [x] Add transactional repository foundations for one fulfillment per order, row locking, optimistic versioning, and idempotent scan events.
- [x] Add conservative server-side order eligibility validation.
- [x] Verify existing `owner`, `administrator`, and `operations` roles are already protected by the server-side `canOperate` gate; `analyst` remains read-only.
- [x] Add focused unit and PostgreSQL integration tests.
- [x] Complete typecheck, unit tests, build, migration up/down test, dependency audit, and final Phase 1 review.

### Payment eligibility and stock-handling matrix

| Method | Evidence reviewed | Existing stock behavior | Future queue rule | Verification note |
| --- | --- | --- | --- | --- |
| PRISM card | Local and staging both report `1.9.1`; storefront stock-guard test passed. | Revalidates stock and reserves the last unit before redirecting to the hosted payment flow. | Eligible only after the order is freshly confirmed as `processing`, approved/paid, and not refunded. | Version matches; installed-source verification is still required before Phase 3 activation. |
| Manual Zelle/Venmo | Local canonical copy is `5.5.4`; staging reports `5.5.2`; storefront stock-guard test passed. | Locally validates and reserves before reduction; payment remains manual/pending until approved. | Never queue an `on-hold` or pending-manual order; queue only after fresh `processing` and paid/approved confirmation. | Installed version differs and WPVibe could not expose source files; resolve before Phase 3. |
| eDebit | Local canonical copy is `1.2.4`; staging reports `1.2.2`; storefront stock-guard test passed. | Locally reserves before gateway handoff and uses the existing payment-completion guard. | Eligible only after fresh `processing`, approved/paid, and no refund. | Installed version differs and must be reconciled before Phase 3. |
| Store credit / other mapped methods | Existing dashboard payment-operation mapping and order state. | Existing commerce engine remains authoritative; fulfillment adds no stock mutation. | Same conservative `processing` + paid/approved + not-refunded gate. | Confirm each installed method against a real staging order before Phase 3 acceptance. |

### Dependencies

- Node.js 22 and the existing TypeScript server.
- A local/isolated PostgreSQL instance for integration tests; no production database.
- Existing `CommerceOrder` and payment-operation mappings from `wooCommerceGateway.ts`.
- Existing authenticated-user context and operations permission in `httpServer.ts`.

### Acceptance criteria

- Database configuration fails closed when malformed and does not expose credentials.
- Migrations run explicitly, under a PostgreSQL advisory lock, and can be rolled back only with an explicit destructive flag.
- Only the four approved business tables are created.
- One commerce order ID maps to one durable fulfillment lifecycle.
- Two concurrent starts converge on the same fulfillment record.
- A duplicate client scan-event ID returns its stored response and does not apply a second progress change.
- Reusing an event ID with different request content is rejected as an idempotency conflict.
- Session updates use a row lock and version increment in one transaction.
- Eligibility rejects non-processing, unapproved/manual-pending, refunded, empty, or invalid-line orders.
- Existing dashboard typecheck, tests, and production build still pass.

### Tests required

- Configuration unit tests.
- Eligibility decision-table tests.
- Migration up/down tests against isolated PostgreSQL.
- Concurrent create/resume test.
- Idempotent accepted/rejected event replay test.
- Concurrent duplicate-event replay test.
- Event-key content-conflict test.
- Optimistic-version and packed/cancelled state guard tests.
- Full repository typecheck/test/build regression run.

### Files modified or created

- `src/shared/fulfillment.ts` — shared fulfillment contracts and typed scan decisions.
- `src/server/database.ts` — PostgreSQL pool, transaction boundary, connection check, and clean shutdown.
- `src/server/fulfillmentEligibility.ts` — conservative server-side queue eligibility decision.
- `src/server/fulfillmentRepository.ts` — transactional lifecycle, row locking, optimistic versioning, and idempotent scan persistence.
- `migrations/001_barcode_fulfillment.up.sql` — four approved business tables, constraints, and indexes.
- `migrations/001_barcode_fulfillment.down.sql` — reversible business-schema rollback.
- `scripts/migrate.ts` and `tsconfig.scripts.json` — explicit checksum-protected migration command with advisory locking.
- `test/fulfillment-config.test.ts` — database configuration tests.
- `test/fulfillment-eligibility.test.ts` — eligibility decision-table tests.
- `test/fulfillment-repository.integration.test.ts` — PostgreSQL concurrency, idempotency, replay-conflict, version, and lifecycle tests.
- `src/server/config.ts`, `src/server/index.ts`, `.env.example`, `docker-compose.yml`, and `docker-compose.override.yml` — optional runtime configuration and isolated local PostgreSQL wiring.
- `package.json` and `package-lock.json` — PostgreSQL driver/types, migration command, and audited dependency resolutions.
- `README.md` — local-only Phase 1 setup and safety boundary.
- `docs/BARCODE-FULFILLMENT-TRACKER.md` — this source-of-truth tracker.

The migration runner also creates the technical metadata table `app_migrations`; it contains only migration name/checksum/time and is not a fifth fulfillment business table.

### Verification completed

- Dashboard typecheck: passed.
- Dashboard production build: passed.
- Full dashboard test run with isolated PostgreSQL: **40 passed, 0 failed, 1 existing Redis integration skipped** because `TEST_REDIS_URL` was not supplied.
- PostgreSQL repository integration suite: **6 passed, 0 failed**, including 12 simultaneous retries of one scan event applying exactly one progress change.
- Migration apply, guarded rollback, and re-apply against disposable PostgreSQL 17: passed.
- Existing storefront payment/stock guard suite: **3 passed, 0 failed**.
- Docker Compose configuration validation: passed.
- Dependency security audit: **0 known vulnerabilities**.
- Disposable PostgreSQL container was stopped and removed after testing.
- No production migration, WordPress write, inventory mutation, payment change, shipment action, or deployment was performed.

### Remaining work

- Live installed-plugin source could not be read through WPVibe because its plugin-backed route is unavailable. Local canonical payment plugin copies and tests are the current evidence; reconcile the Zelle and eDebit version differences and verify the installed source before Phase 3 queue activation.
- A staging payment-method fixture matrix is intentionally deferred to Phase 3, when the queue exists, but it remains a hard activation gate.

## Phase 2 — Storage Locations & Barcodes

Status: **completed and approved locally**

### Tasks

- [x] Add administrator location assignment for products and variation-specific overrides.
- [x] Add strict location normalization, bulk catalog view, effective inheritance, and product display.
- [x] Add a minimal barcode registry migration on the existing Phase 1 PostgreSQL database.
- [x] Generate deterministic, opaque, version/type-prefixed 20-digit identifiers using a server-side HMAC secret.
- [x] Resolve every identifier server-side to the registered product, variation, COA, and lot record.
- [x] Render scanner-compatible Code 128 labels with product, SKU, variation, lot/batch, COA, and effective location.
- [x] Add exact 2×1-inch and 3×1-inch browser print layouts, 1–50 copies, preview, copy, and reprint actions.
- [x] Replace the original all-in-one interface with three focused responsive light/dark views: **Print Labels**, **Storage Locations**, and **Registered Labels**.
- [x] Make Print Labels the default workflow with deliberate product selection, smart variation/batch defaults, automatic effective-location lookup, and advanced print settings hidden by default.
- [x] Limit location editing to one selected product at a time, including clear primary-location and inherited variation states.
- [x] Show only persisted barcode registry records in Registered Labels; do not represent them as physical print history.
- [x] Enforce existing role permissions: Owner/Administrator manage locations; Operations can print; Analyst is read-only.
- [x] Add identifier, registry, tamper, location, access-control, SVG-safety, dimension, copy, integration, and migration tests.

### Dependencies

- Phase 1 database/repository: accepted and reused.
- Location-code format: uppercase aisle/rack plus a two- or three-digit position, such as `A-01` or `RACK2-105`.
- Label sizes: 2×1 inch and 3×1 inch; browser prints at exact CSS page dimensions.
- Existing commerce products/variations and existing COA/batch records remain authoritative and read-only.
- `BARCODE_SIGNING_SECRET` must remain stable and private; it is never sent to the browser.

### Acceptance criteria

- [x] One primary location can be saved per product and one optional override per variation.
- [x] A variation without an override inherits its product location.
- [x] Reprinting the same registered entity produces the same valid identifier.
- [x] Product, variation, and batch identifiers resolve to the expected registered records.
- [x] Altered, unknown, malformed, and wrong-type identifiers are rejected server-side.
- [x] Browser output declares exact 2×1-inch or 3×1-inch pages and preserves usable Code 128 bar width in the 2×1 layout.
- [x] An operator can move through product → variation/batch → automatic location → preview → print without seeing technical barcode configuration.
- [x] A missing location links directly to the selected product's location editor and prevents label generation until corrected.
- [x] Registered-label search and reprint operate only on existing PostgreSQL registry records and respect the existing print permission.
- [ ] Physical scanner/printer certification is intentionally pending the Phase 6 hardware pilot.

### Database and safety notes

- Migration `002_barcode_labels` adds only a barcode identity registry. It contains no commercial quantity, reservation, stock, order, payment, or shipment state.
- The printed value is numeric Code 128 data, not a mutable payload. Product, variation, COA, and lot identity is resolved from PostgreSQL after authentication.
- Label creation re-reads the current catalog and COA mapping, requires an effective location and SKU, and fails closed on mismatches.
- The label endpoints do not expose commerce write operations and do not call stock, order, payment, or ShipStation mutations.

### Files modified or created

- `migrations/002_barcode_labels.up.sql` and `.down.sql` — reversible opaque barcode registry.
- `src/shared/barcodeFulfillment.ts` — Phase 2 location, registry, payload, label, and thermal-layout contracts.
- `src/shared/labelPrint.ts` — exact-size, multi-copy, escaped and SVG-hardened browser print document.
- `src/server/productLocationRepository.ts` — strict location validation, assignment, inheritance, list, and removal.
- `src/server/barcodeRegistryRepository.ts` — idempotent registration, exact server-side barcode resolution, and read-only registered-label listing.
- `src/server/barcodeLabels.ts` — deterministic opaque identifiers and Code 128 SVG rendering through `bwip-js`.
- `src/server/fulfillmentAccess.ts` — location and label role matrix.
- `src/server/httpServer.ts` and `src/server/index.ts` — authenticated location, label-generation, validation, and additive registered-label listing endpoints.
- `src/server/config.ts`, `.env.example`, `docker-compose.yml`, and `docker-compose.override.yml` — local signing-secret and database wiring.
- `src/dashboard/index.html`, `src/dashboard/main.ts`, and `src/dashboard/labels.css` — simplified three-view workspace, progressive print flow, single-product location editor, persisted-label browser, preview, copy, and printing flow.
- `test/barcode-labels.test.ts`, `test/label-print.test.ts`, `test/product-location.test.ts`, and `test/fulfillment-access.test.ts` — focused Phase 2 unit tests.
- `test/fulfillment-config.test.ts` and `test/fulfillment-repository.integration.test.ts` — secret validation plus PostgreSQL location/registry integration coverage.
- `package.json` and `package-lock.json` — official `bwip-js` Code 128 renderer dependency.
- `README.md` — local migration, role, security, and thermal-printer instructions.
- `docs/BARCODE-FULFILLMENT-TRACKER.md` and the existing WMS roadmap Canvas — completion evidence and approval gate.

### Verification completed

- Full TypeScript typecheck: passed.
- Production dashboard/server build: passed.
- Full test run with isolated PostgreSQL 17: **53 passed, 0 failed, 1 existing Redis integration skipped** because `TEST_REDIS_URL` was not supplied.
- Phase 2 PostgreSQL integration: location inheritance/update/removal plus idempotent barcode registration/resolution/listing passed.
- Migration 001 + 002 apply, 002 guarded rollback, and 002 re-apply against disposable PostgreSQL: passed.
- Local Docker image rebuild, PostgreSQL connection, and `/health` response: passed.
- Light and dark responsive workspace visual review: passed.
- Desktop review at 1440×1050: passed; the print workflow uses one centered card and exposes exactly one decision at a time.
- Tablet review at 820×1180: passed; the same three-step sequence remains readable without competing panels or horizontal overflow.
- Dependency security audit: **0 known vulnerabilities** when `bwip-js` was installed.
- Disposable PostgreSQL test container was stopped and removed.
- No production deployment, WordPress write, stock mutation, live order/payment change, shipment action, or Phase 3 code was performed.

### Phase 2 UX redesign — 2026-10-15

- Print Labels is now a strict three-step assistant: **Choose product → Confirm → Print**. Only the active step is visible; the catalog, controls, and preview never compete on screen.
- Label type is one plain-language select field that only exposes choices available for the selected product. Size and copy count remain optional and collapsed.
- Storage Locations is also sequential: search first, then edit one product. Variation overrides are collapsed because most products only need one primary shelf.
- Registered Labels is named according to the data actually stored and uses a simplified product/detail/reprint row. The numeric identifier stays hidden until requested.
- Empty, loading, unavailable, validation, permission, and success states use the existing Phase One Labz shell and remain usable in light and dark themes.
- No database schema, barcode format, stock rule, commerce write path, order, payment, shipping, or Phase 3 behavior changed during this redesign.
- The rebuilt local Docker service is healthy and serves this simplified version at `http://localhost:8080`; no production deployment was performed.

### Labels & Locations workspace refinement — 2026-10-16

- Replaced the narrow catalog step with a responsive product browser using real thumbnails, SKU, category, variation count, stock state and effective shelf assignments.
- Added real-data category filtering, name/stock/location sorting, efficient bounded scrolling, and persistent grid/list presentation without adding API calls or fabricating inventory.
- Expanded the confirmation step into a balanced contextual workspace: selected product, inherited/effective location, actual label-service state, progressive print settings and one primary preview action.
- Rebuilt the preview around the exact existing Code 128 output and print protocol, with an operational summary for dimensions, copies and service state.
- Reorganized Storage Locations into a desktop master-detail workspace and a mobile list-to-editor flow; primary shelves and variation inheritance use the existing location endpoints.
- Added assigned/unassigned filtering to locations and persisted-type/date/name filtering to Registered Labels. The latter still represents registry records, not physical print jobs.
- Added compact ready/connecting/unavailable/error presentation driven by existing backend state, plus keyboard focus, skeleton, empty, error, hover, reduced-motion, light and dark treatment.
- Responsive layouts now cover wide desktop, laptop, tablet and mobile without changing authentication, permissions, database schemas, API contracts or thermal-printing behavior.
- Validation passed: full TypeScript typecheck, production dashboard/server build, and **101 automated tests passed, 0 failed** against isolated PostgreSQL and Redis test resources.
- No deployment, production data write, commerce mutation, shipping action or real provider request was performed.

### Remaining issues

- A physical USB/Bluetooth scanner and the target thermal printer were not available in this local run; 100-scan reliability, contrast, quiet-zone, media calibration, and actual-size output remain Phase 6 acceptance work.
- Products without a SKU, products without a location, and batch labels without an exact existing COA/lot mapping are blocked by design until their source data is corrected.
- Production must use a unique stable `BARCODE_SIGNING_SECRET`; the checked local override is development-only.
- The previously recorded installed Zelle/eDebit plugin-source differences remain a Phase 3 activation blocker, not a Phase 2 label blocker.
- This visual refinement did not alter or advance the later fulfillment phases.

## Phase 3 — Fulfillment Queue

Status: **completed locally — awaiting approval for Phase 4**

### Tasks

- [x] Add one focused Fulfillment navigation entry with Waiting, In progress, Paused, Needs attention, and Packed views.
- [x] Fetch fresh candidate orders by fulfillment-relevant status and join them to local sessions, catalog mappings, effective locations, and current COA/batch records.
- [x] Show order age, customer, product images/names, SKU/variation, required quantity, effective location, batch/lot, linked COA, and durable progress.
- [x] Add progressive disclosure: choose an order, review its items and safeguards, then start or resume from one primary action.
- [x] Revalidate the individual live order immediately before every start/resume request.
- [x] Add durable pause/resume behavior without changing WordPress, stock, payment, shipping, or order status.
- [x] Enforce one active order server-side with a PostgreSQL advisory transaction lock plus a defensive partial unique index.
- [x] Preserve idempotent same-order starts and reject conflicting starts from another tab/session.
- [x] Fail closed for pending/non-processing/refunded orders, missing SKU/product/variation/location/COA data, changed source orders, cancelled local sessions, and unverified payment gateways.
- [x] Keep PRISM eligible only after fresh `processing` + paid + no-refund verification; keep Zelle/Venmo and eDebit visibly blocked pending installed-plugin verification.
- [x] Add understandable unavailable, loading, empty, blocked, ready, active, paused, and packed states in responsive light/dark layouts.
- [x] Add unit and PostgreSQL integration coverage for payment decisions, mappings, permissions, duplicate starts, cross-order concurrency, pause/resume, and persistence.

### Dependencies

- Phases 1–2 accepted and reused without replacement.
- WordPress remains authoritative for orders, payments, products, commercial stock, and COAs.
- PostgreSQL stores only local fulfillment lifecycle state and retains Phase 1 idempotency/version controls.
- Installed Zelle/Venmo and eDebit versions must be reconciled before those gateways can be activated for fulfillment.

### Acceptance criteria

- [x] Only fresh, approved `processing` orders with complete fulfillment data can start.
- [x] Starting the same order from two tabs converges on one session.
- [x] Starting two different orders concurrently leaves exactly one active and returns an actionable conflict for the other.
- [x] Stale cache data cannot start a changed order because the start endpoint re-fetches the individual order.
- [x] Paused sessions preserve progress and resume with a new optimistic version after restart/refresh.
- [x] A changed active session can still be paused to release the single workstation lock.
- [x] Analyst access remains read-only; Owner, Administrator, and Operations may operate the queue.
- [x] No Phase 3 endpoint writes WordPress, stock, payment, shipping, ShipStation, or Woo order status.

### Database and safety notes

- Migration `003_fulfillment_queue` adds the `paused` lifecycle/event value and a partial unique index for one `open` session; it creates no new product, inventory, payment, or order-authority table.
- Start/resume acquires a transaction-scoped PostgreSQL advisory lock before inspecting existing and active sessions. The unique index remains a second database-level guard.
- A source `modifiedAt` mismatch blocks resume. The live order is fetched again before creating or reopening a session.
- Phase 3 does not run migrations automatically and was not deployed.

### Files modified or created

- `migrations/003_fulfillment_queue.up.sql` and `.down.sql` — paused lifecycle plus single-active-session guard.
- `src/shared/fulfillment.ts` — queue, line, reason, status, permission, and pause contracts.
- `src/server/fulfillmentQueue.ts` — pure live-order joining, payment/mapping/location/COA validation, safe status derivation, source snapshots, and initial progress.
- `src/server/fulfillmentRepository.ts` — list/order lookup, transaction-locked create/resume, one-active enforcement, durable pause, and lifecycle events.
- `src/server/fulfillmentAccess.ts` — queue-operation permission matrix.
- `src/server/wooCommerceGateway.ts` — fresh paginated processing/on-hold/pending fulfillment candidate retrieval.
- `src/server/httpServer.ts` — authenticated queue, fresh start/resume, and pause endpoints.
- `src/dashboard/index.html`, `src/dashboard/main.ts`, and `src/dashboard/fulfillment.css` — dedicated minimal queue and readable order review for desktop/tablet and light/dark themes.
- `test/fulfillment-queue.test.ts`, `test/fulfillment-access.test.ts`, and `test/fulfillment-repository.integration.test.ts` — decision, role, concurrency, persistence, and pause/resume coverage.
- `docs/BARCODE-FULFILLMENT-TRACKER.md` and the existing WMS roadmap Canvas — Phase 3 evidence and Phase 4 gate.

### Verification completed

- Full TypeScript typecheck: passed.
- Full production dashboard/server build: passed.
- Full test run with isolated PostgreSQL 17 and isolated Redis: **61 passed, 0 failed, 0 skipped**.
- PostgreSQL integration passed concurrent same-order starts, concurrent different-order exclusion, pause/resume versioning, durable progress, scan idempotency, state transitions, locations, and barcode registry behavior.
- Desktop review at 1440×1050: queue, blocked cards, product imagery, status navigation, and detailed review passed.
- Tablet review at 820×1180: responsive order detail and readable item hierarchy passed in light and dark modes.
- No production migration, deployment, WordPress write, live order/payment change, commercial stock mutation, ShipStation action, shipment creation, or Phase 4 scan implementation was performed.

### Remaining issues / production blockers

- Zelle/Venmo stays blocked because local canonical `5.5.4` and installed staging `5.5.2` differ and installed source could not be verified.
- eDebit stays blocked because local canonical `1.2.4` and installed staging `1.2.2` differ.
- Other payment methods stay blocked until a real staging-order fixture proves their paid/stock behavior.
- Products without exact catalog/variation mapping, SKU, effective location, or current COA lot are intentionally shown in Needs attention and cannot start.
- Physical scanner behavior is Phase 4/6 work and was not implemented or simulated as production capability.

## Phase 4 — Barcode Picking Station

Status: **completed locally — awaiting approval for Phase 5**

### Tasks

- [x] Add HID keyboard-wedge scanner capture with Enter/CR handling, global focused-station capture, and controlled manual fallback.
- [x] Verify registered/active barcode, product, variation, exact batch/COA, current shipping-lot approval, unfinished quantity, live order eligibility, secured source snapshot, session state, and role server-side.
- [x] Require batch-specific labels whenever the secured line contains a physical batch; product-only and variation-only labels never imply a lot.
- [x] Add immediate accessible green/red visual feedback, optional sound, mobile vibration, and clear reason text without relying on color alone.
- [x] Persist accepted and rejected scan events transactionally; accepted scans update durable progress in the same row-locked transaction.
- [x] Restore progress after browser refresh, repository recreation, and application restart.
- [x] Reuse one client event UUID across automatic network retry and return durable replays before depending on WordPress availability.
- [x] Serialize concurrent distinct scans and prevent quantities from exceeding the order requirement.
- [x] Add a premium one-operator station with large locations, product cards, remaining quantity, batch instructions, sticky scanner controls, and Ready for Packing completion state.
- [x] Optimize and visually review desktop, tablet, and 390px mobile layouts in light and dark modes.
- [x] Add a mobile **Scan with Camera** flow using the rear camera and an on-device Code 128 decoder loaded only when requested.
- [x] Route camera results through the existing idempotent server verification endpoint; no image or video frame is uploaded or stored.
- [x] Preserve brand-independent USB/Bluetooth HID input, including Enter/CR and Tab suffix handling for Zebra and standard keyboard-wedge scanners.
- [x] Stop camera capture after the first valid warehouse barcode so repeated video frames cannot enqueue duplicate scan events.

### Dependencies

- Phases 1–3 accepted and revalidated with 61/61 passing tests before Phase 4 work began.
- Existing 20-digit Code 128 registry, PostgreSQL fulfillment sessions, source snapshots, locations, live orders, and COA records.
- Standard USB/Bluetooth scanner in HID keyboard mode; no scanner SDK.

### Acceptance criteria

- [x] Wrong item, variation, batch, inactive/unknown label, invalid COA, product-only batch ambiguity, and excess scans never change progress.
- [x] Replaying one event increments once and returns the stored decision; conflicting event reuse is rejected.
- [x] Two different concurrent events serialize against current progress and cannot exceed required quantity.
- [x] Accepted progress and scan audit survive browser refresh and repository/application recreation.
- [x] Database write failure rolls back both progress and scan history.
- [x] Analyst access remains read-only; Owner, Administrator, and Operations may scan.
- [x] The primary flow is keyboard/scanner operable and the manual fallback is touch-friendly.
- [x] WordPress outages fail closed without incrementing progress; a previously committed event can still be replayed from PostgreSQL.
- [x] No Phase 4 path writes stock, payment, order status, shipping, ShipStation, or WordPress.
- [x] Camera input accepts only Code 128 values with the existing 20-digit warehouse identifier shape before sending them to the authoritative server checks.
- [x] Denied permission, missing camera, insecure context and camera-in-use states provide an actionable fallback to HID or manual entry.

### Database and safety notes

- Migration `004_barcode_picking` adds only `barcode_labels.is_active` plus an active-label lookup index. Existing scan-event and progress tables from Phase 1 are reused.
- Every new scan re-fetches the individual live order and current COA list before entering the transaction. A changed/ineligible order is stored as a rejected audit event and never increments progress.
- The transaction locks the fulfillment row, recomputes against the latest stored counters, stores the scan decision, and increments progress/version only for an accepted scan.
- Client event IDs are UUIDs. Automatic retry reuses the same UUID, and a durable replay is returned before requiring another WordPress call.
- Without individual vial serial numbers, two scans of the same batch label cannot prove whether they came from two vials or the same vial twice. The station states this limitation explicitly and maintains only safe required/verified counters.

### Files modified or created

- `migrations/004_barcode_picking.up.sql` and `.down.sql` — active/inactive registry state and lookup index.
- `src/shared/barcodeFulfillment.ts` and `src/shared/fulfillment.ts` — active-label and typed scan feedback/API contracts.
- `src/server/fulfillmentPicking.ts` — pure server-side picking decision engine.
- `src/server/barcodeRegistryRepository.ts` — active-state persistence and resolution.
- `src/server/fulfillmentRepository.ts` — preflight durable replay plus existing row-locked idempotent recording.
- `src/server/fulfillmentQueue.ts` — approved current-shipping COA requirement.
- `src/server/httpServer.ts` — authenticated, origin-protected `/api/fulfillment/scan` endpoint with fresh live verification.
- `src/dashboard/main.ts` and `src/dashboard/fulfillment.css` — HID/manual capture, retry-safe scan queue, feedback/sound/vibration, durable progress updates, and responsive Picking Station.
- `src/dashboard/index.html` — Fulfillment command-palette entry and accessible mobile camera dialog.
- `src/shared/cameraBarcode.ts` — strict on-device Code 128 candidate normalization before server verification.
- `src/server/httpServer.ts` — same-origin camera permission and local media CSP without relaxing microphone or geolocation access.
- `package.json` and `package-lock.json` — on-demand ZXing browser decoder for consistent iPhone/Android support.
- `test/camera-barcode.test.ts`, `test/fulfillment-picking.test.ts`, `test/fulfillment-repository.integration.test.ts`, and existing Phase 3 tests — camera input and full Phase 4 decision/reliability coverage.

### Verification completed

- Phase 3 gate before implementation: **61 passed, 0 failed, 0 skipped** against isolated PostgreSQL and Redis.
- Full Phase 4 automated suite after the camera extension: **76 passed, 0 failed, 0 skipped** against isolated PostgreSQL 17 and isolated Redis.
- Full TypeScript typecheck: passed.
- Production dashboard/server build: passed.
- Dependency audit: **0 vulnerabilities** at high severity or above.
- Camera candidate tests cover valid Code 128, unsupported symbology and malformed warehouse identifiers.
- The production bundle keeps the camera decoder in a separate on-demand chunk; operators who use only Zebra/USB/Bluetooth HID scanners do not load it during normal dashboard startup.
- Database failure rollback, duplicate replay, event-content conflict, concurrent distinct scans, and restart/refresh persistence: passed.
- Desktop 1440×1050, tablet 820×1180, and mobile 390×844 visual review: passed.
- Light and dark mobile review: passed; scanner controls remain fixed and touch targets remain readable.
- Local migration `004` and local Docker rebuild: passed. No production or Coolify deployment was performed.

### Outstanding blockers / Phase 5 prerequisites

- A physical scanner was not available for the 100-scan hardware certification. Logic and HID keyboard behavior are covered, but final scanner model, suffix configuration, Bluetooth sleep/reconnect behavior, and real thermal-label readability remain Phase 6 pilot work.
- Real iPhone and Android camera permission, autofocus and sample-label readability still require a device pilot over HTTPS. Camera APIs are intentionally unavailable from a phone opened through an insecure LAN `http://` address.
- Automated Windows browser review stopped before interaction because the review tool could not verify Chrome's current URL. No browser permission prompt was accepted; responsive camera layout therefore still needs the real-device pilot above.
- Zelle/Venmo and eDebit orders remain intentionally blocked by the Phase 3 gateway-version safeguards.
- Phase 5 requires explicit approval before adding packing confirmation, completion snapshots, local packed transition, or any idempotent WordPress packing marker.
- Phase 5 must revalidate the live order immediately before completion and must continue to avoid stock deduction, Woo order completion, shipment creation, and ShipStation actions.

## Phase 5A — Packing

Status: **completed locally — awaiting approval**

### Tasks

- [x] Replace the end-of-picking dead end with one clear **Review & confirm packing** action.
- [x] Show a focused confirmation with product, verified-unit and verified-batch totals.
- [x] Re-fetch and revalidate the live order and current COAs immediately before completion.
- [x] Require every secured line to match product, variation, SKU, quantity, location and exact COA/lot.
- [x] Reject incomplete, manipulated, changed, ineligible, paused or cancelled sessions.
- [x] Store an immutable product/quantity/location/COA/batch completion snapshot in the existing fulfillment row.
- [x] Mark only the local fulfillment session Packed and add one existing `packed` lifecycle event.
- [x] Make confirmation idempotent with a client UUID, row lock, optimistic version and replay-safe retry.
- [x] Show the persisted packing snapshot as a read-only record after refresh or restart.
- [x] Keep the flow responsive and single-action on desktop, tablet and mobile.

### Database and safety notes

- No migration or new table was required. Phase 5A reuses `order_fulfillments.completion_snapshot`, `packed_at`, `version`, `wordpress_sync_state`, and `fulfillment_events` from Phase 1.
- The completion transaction locks the fulfillment row. Concurrent retries with one event ID converge on one Packed transition and one lifecycle event; a different event ID is rejected after completion.
- The stored snapshot preserves the exact picked SKU, variation, quantity, location, COA number, COA ID, lot and batch even if live catalog presentation changes later.
- `wordpress_sync_state = pending` remains an internal durable marker only. No worker or endpoint writes it to WordPress in Phase 5A.
- No stock, Woo order status, payment, shipment, tracking or ShipStation API mutation is performed.

### Acceptance criteria

- [x] Every quantity and exact verified COA/batch must still be valid before packing.
- [x] Incomplete, changed or ineligible orders cannot be packed.
- [x] One logical confirmation cannot complete twice, including concurrent/network retries.
- [x] The Packed record survives refresh/application restart and remains auditable.
- [x] Owner, Administrator and Operations reuse the existing operate-queue permission; Analyst remains read-only.
- [x] Stock, live Woo status, payments and ShipStation remain unchanged.

### Files modified or created

- `src/shared/fulfillment.ts` — typed immutable packing snapshot and response contracts.
- `src/server/fulfillmentPacking.ts` — pure fail-closed packing validation and snapshot creation.
- `src/server/fulfillmentRepository.ts` — transaction-locked idempotent packing completion and event persistence.
- `src/server/httpServer.ts` — authenticated, origin-protected `/api/fulfillment/pack` endpoint with fresh live verification.
- `src/dashboard/index.html`, `src/dashboard/main.ts`, and `src/dashboard/fulfillment.css` — simple confirmation dialog, retry-safe client action and responsive read-only Packed record.
- `test/fulfillment-packing.test.ts` and `test/fulfillment-repository.integration.test.ts` — quantity, order, COA, concurrency and idempotency coverage.

### Verification completed

- Full TypeScript typecheck: passed.
- Production dashboard/server build: passed.
- Full automated suite against disposable PostgreSQL 17: **82 passed, 0 failed, 1 existing Redis test skipped** because `TEST_REDIS_URL` was not supplied.
- New PostgreSQL concurrency coverage proves two simultaneous retries create exactly one Packed event and a second logical confirmation is rejected.
- Desktop visual review passed for the final confirmation dialog and immutable Packed record; tablet and 390px mobile breakpoints preserve the same single-action hierarchy and touch-sized controls.
- The disposable visual-review database, isolated session keys and review container were removed after validation.
- No production deployment, WordPress write, commercial stock mutation, live order/payment change or ShipStation request was performed.

## Phase 5B — Native ShipStation workflow

Status: **production workflow implemented locally — real API validation and purchasing remain disabled**

### Confirmed API contract

- [x] Use ShipStation API v2 at `https://api.shipstation.com/v2`.
- [x] Authenticate server-to-server with the `API-Key` request header.
- [x] Keep the credential exclusively in the server runtime environment; it is absent from browser bundles, JSON responses, logs, tracked source values and generated documentation.
- [x] Use `GET /v2/carriers` with extended details for connected carrier/service discovery.
- [x] Use `GET /v2/warehouses` to select the configured or first complete ship-from origin.
- [x] Use persistent `POST /v2/rates` shipment quotes so the reviewed total includes carrier fees/surcharges and returns the exact purchasable `rate_id`.
- [x] Prepare `POST /v2/labels/rates/{rate_id}` and `GET /v2/labels?rate_id=...` behind the server-only `SHIPSTATION_LABEL_PURCHASE_ENABLED=false` interlock.
- [x] Prepare authenticated 4×6 PDF retrieval and `PUT /v2/labels/{label_id}/void` behind the same interlock.
- [x] Preserve the actual live `rate_id` required for future label creation; mocked rates remain deterministic and clearly identified.
- [x] Account for the ShipStation Platform limitation that production credentials have no general sandbox and real label calls can incur costs.

### Implemented locally

- [x] Add optional `SHIPSTATION_API_KEY`, explicit `SHIPSTATION_RATE_MODE`, and optional `SHIPSTATION_WAREHOUSE_ID` server configuration and Compose passthrough.
- [x] Add a credential-safe ShipStation gateway with bounded responses, timeouts, normalized errors and a five-minute carrier/origin cache.
- [x] Add safe mock carrier/rate fixtures for local UI testing without contacting ShipStation.
- [x] Add authenticated capabilities, existing-label, rate-comparison, mock-label generation and 4×6 print routes.
- [x] Re-read the Packed fulfillment and live source order before rating or generating a test label.
- [x] Source the destination from the existing order and reject incomplete or changed addresses.
- [x] Validate weight/dimensions server-side and restrict carrier IDs to the connected account response.
- [x] Sign each selected quote with an expiring HMAC token so browser-side price, service, package or order tampering is rejected.
- [x] Add `fulfillment_shipping_labels` with one-label-per-fulfillment and one-client-event constraints for durable mock-label idempotency.
- [x] Render a simple Packed → Carrier → Compare → Confirm → Label workflow directly inside the existing Fulfillment detail.
- [x] Make the generated 4×6 document unmistakably non-postage with `TEST ONLY` and `NOT VALID POSTAGE` markings.
- [x] Preserve light/dark desktop, tablet and mobile behavior with one primary action at each step.
- [x] Persist `purchase_pending`, `purchase_unknown`, `failed`, `label_ready`, and `voided` states with an immutable event trail.
- [x] Reconcile interrupted or uncertain attempts before permitting any retry.
- [x] Save carrier, service, rate, shipment ID, label ID, tracking number, label URL metadata, package, destination and source-shipping snapshot.
- [x] Reprint the same persisted label and audit every print without creating another label.
- [x] Block native creation when the source order is already exported, shipped, linked to a shipment ID, or has tracking.
- [x] Proxy the purchased 4×6 PDF through the authenticated backend; the browser never receives the API credential or an untrusted download redirect.
- [x] Distinguish mock, live-but-locked and real-purchase modes visually, with an explicit final-charge confirmation for live postage.
- [x] Add real label voiding with carrier-policy warnings, idempotent preflight status checks and no automatic order cancellation.
- [x] Add idempotent WordPress writeback for carrier, service, label, shipment and tracking metadata without changing order status or commercial stock.
- [x] Persist and display WordPress synchronization failures independently from the purchased label so a successful charge is never misreported as failed.

### Database and safety notes

- Migrations `005_fulfillment_shipping`, `006_shipping_reliability` and `015_shipstation_production` store the local attempt, lifecycle, print/void audit and source-order synchronization state. They do not store commercial inventory.
- The fulfillment row is locked before attempt insertion. One fulfillment ID, one client-event ID and one stable external shipment key can create at most one record; identical retries replay and unresolved outcomes cannot submit again.
- Full destination and package snapshots are persisted; live reprints retrieve the already-purchased PDF and never repeat the purchase endpoint.
- Live carrier/rate reads are possible only when the server credential is present and `SHIPSTATION_RATE_MODE=live`.
- Real purchase code is prepared but unreachable by default. It requires live mode, a server credential, and the exact server-only feature flag `SHIPSTATION_LABEL_PURCHASE_ENABLED=true`; local Compose forces it to `false`.
- Network interruption or an HTTP 5xx after submission becomes `purchase_unknown`. The workflow performs a read-only lookup by provider `rate_id`; it never blindly repeats the POST.
- The prepared WordPress bridge writes only native shipping metadata and an order note after a confirmed label result; it never changes order status, commercial stock, payment state, carrier handoff or delivery state.

### Files modified or created

- `src/shared/shipping.ts` — carrier, capability, package, rate and mock-label contracts.
- `src/server/shipStationGateway.ts` — protected API v2 authentication, carrier/origin discovery, live estimates and local mock rates.
- `src/server/shippingQuoteToken.ts` — expiring, tamper-evident rate selections.
- `src/server/fulfillmentShipping.ts` — package/address validation, destination fingerprint and safe 4×6 test document.
- `src/server/fulfillmentShippingRepository.ts` — transaction-locked, idempotent mock-label persistence and reprint retrieval.
- `src/server/fulfillmentShippingWorkflow.ts` — protected purchase state machine, reconciliation and duplicate-source guards.
- `migrations/005_fulfillment_shipping.up.sql` and `.down.sql` — reversible shipping-label audit schema.
- `migrations/006_shipping_reliability.up.sql` and `.down.sql` — attempt states, saved shipment details, lifecycle events and audited reprinting.
- `migrations/015_shipstation_production.up.sql` and `.down.sql` — short external shipment IDs, WordPress sync state, void timestamps and lifecycle events.
- `src/server/config.ts`, `.env.example`, `docker-compose.yml` and `docker-compose.override.yml` — server-only secret wiring and explicit live/mock rate mode.
- `src/server/httpServer.ts` — authenticated rate/create/reconcile/reprint endpoints using the protected workflow.
- `wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php` — idempotent native tracking save/void bridge without order-status or stock changes.
- `src/dashboard/main.ts` and `src/dashboard/fulfillment.css` — responsive integrated shipping assistant for Packed orders.
- `test/shipstation-gateway.test.ts`, `test/fulfillment-shipping-workflow.test.ts`, `test/fulfillment-repository.integration.test.ts`, `test/shipping-quote-token.test.ts`, `test/fulfillment-shipping.test.ts` and `test/fulfillment-config.test.ts` — disabled-flag isolation, endpoint mapping, simulated failures, interruption recovery, concurrency, reprinting, duplicate-source guards and print safety.
- Existing WMS roadmap Canvas — updated Phase 5B safety flow and approval gate.

### Verification completed

- Full TypeScript typecheck: passed.
- Production build: passed.
- Full automated suite: **170 tests, 139 passed, 0 failed, 31 optional integration tests skipped** when their isolated services were not supplied.
- Isolated PostgreSQL fulfillment suite: **21 passed, 0 failed, 0 skipped**, including concurrency, uncertain outcomes, reconciliation and reprint idempotency.
- Local migration `015_shipstation_production` applied successfully; the rebuilt local Docker stack is healthy with `SHIPSTATION_RATE_MODE=mock` and `SHIPSTATION_LABEL_PURCHASE_ENABLED=false`.
- Dependency audit: **0 vulnerabilities**.
- New focused tests confirm the API key appears only in the outbound server header and never in URLs, request bodies, returned capability objects or rejected-error output.
- New focused tests confirm missing/rejected credentials fail closed, mock rates perform no network request, quote tampering/expiry is rejected, incomplete addresses/packages are blocked and 4×6 test output is visibly non-postage.
- Concurrent PostgreSQL coverage confirms identical retry events return one durable mock label while a second logical purchase attempt is rejected.
- Mocked end-to-end coverage confirms an interrupted response creates one provider call, persists `purchase_unknown`, replays safely, reconciles the existing label by rate ID, and never repurchases.
- Reprint coverage confirms repeated prints increment the audit counter while preserving the same label, shipment and tracking record.
- The responsive Phase 5B flow was reviewed against the existing desktop/tablet/mobile layout rules; the final browser pass reached the protected login boundary and did not automate or expose credentials.
- No live ShipStation request was made because `SHIPSTATION_API_KEY` is not currently present in the local process or ignored `.env` file.

### Remaining live-account requirements

- [ ] Place the candidate V2 credential in the ignored server `.env` or deployment secret store; do not paste it into the browser, repository or chat.
- [ ] Run the read-only carrier/origin check and record the actual connected carriers and service counts.
- [ ] Run one persistent but non-purchasing rate request for an isolated Packed test order to confirm account/plan access and the complete surcharge-inclusive total.
- [ ] Select the intended warehouse explicitly if the account returns more than one complete origin.
- [x] Define the stable external shipment key and read-only rate-ID reconciliation lookup.
- [x] Real purchase and void code paths are implemented behind the server-only safety flag.
- [ ] Install Phase One Operations Bridge 1.7.0 on staging and verify one idempotent tracking save/void round trip.
- [ ] Add the real V2 API credential and identify whether it is a test (`TEST_`) credential or a production ShipStation Platform credential.
- [ ] Perform one controlled staging label purchase, print, reprint and void; production credentials can create real charges, so this remains a human-observed pilot.

## Packaging Evidence — Integrated Fulfillment refinement

Status: **complete locally — WordPress SMTP attachments prepared; delivery intentionally disabled**

### Implemented locally

- [x] Place the workflow inside each Packed fulfillment instead of adding another sidebar destination.
- [x] Guide one operator through exactly two required captures: packed contents and sealed package with visible label.
- [x] Support direct rear-camera capture on mobile and the normal photo picker on desktop/tablet.
- [x] Resize photos to a maximum 2200-pixel edge, convert to bounded JPEG and strip source metadata in the browser before upload.
- [x] Store only metadata and audit history in PostgreSQL; store photo bytes in a separate private persistent filesystem vault.
- [x] Encrypt every stored photo with AES-256-GCM, verify its SHA-256 digest on read and reject altered ciphertext.
- [x] Add server-side MIME/signature, size, dimension, fulfillment-state, role and same-origin validation.
- [x] Make photo uploads and final confirmation idempotent with client UUIDs and PostgreSQL constraints.
- [x] Allow retake/remove while draft; lock both images after final confirmation to preserve the fulfillment audit.
- [x] Extend the WordPress operations bridge without changing the legacy evidence vault or customer gallery.
- [x] Reuse WordPress `wp_mail()` and its existing SMTP/delivery plugin; no SMTP credentials are stored in the dashboard.
- [x] Attach both optimized evidence photos as request-scoped temporary files and delete them immediately after the mail attempt.
- [x] Prevent duplicate email requests with a stable event ID, an atomic WordPress lock and a bounded sent-event ledger.
- [x] Distinguish sent, failed and uncertain delivery; uncertain attempts require mail-log reconciliation instead of a blind retry.
- [x] Add premium compact, loading, empty, error, in-progress and confirmed states for light/dark desktop, tablet and mobile.
- [x] Configure a dedicated local Docker volume and apply migration `010_fulfillment_evidence` only to local PostgreSQL.

### Safety and production boundary

- Evidence capture does not modify WordPress orders, commercial stock, payments, shipping, tracking or ShipStation.
- The encrypted vault is independent from the WordPress media library and cannot be accessed without an authenticated dashboard session.
- A confirmed evidence set records the actor, time, exact required photo roles and an immutable event trail.
- Customer notification status is explicit. Local mode reports that email is disabled and never claims a customer message was sent.
- The real WordPress SMTP call is wired behind `EVIDENCE_NOTIFICATION_MODE=outbox`; local Docker keeps the flag disabled, so tests cannot contact or email a real customer.
- Production activation still requires a controlled staging recipient, WordPress mail-log verification, attachment-size validation, bounce handling and an approved retention policy.
- Production requires a stable `EVIDENCE_ENCRYPTION_SECRET`, a persistent `EVIDENCE_STORAGE_PATH` volume and a tested joint PostgreSQL/filesystem backup restore.

### Files modified or created

- `migrations/010_fulfillment_evidence.up.sql` and `.down.sql` — evidence sets, active photo roles and append-only audit events.
- `migrations/011_fulfillment_evidence_email.up.sql` and `.down.sql` — safe uncertain-delivery state and email audit event support.
- `src/shared/fulfillmentEvidence.ts` — browser/server evidence contracts.
- `src/server/fulfillmentEvidenceStorage.ts` — private AES-256-GCM filesystem vault with path and integrity protections.
- `src/server/fulfillmentEvidenceRepository.ts` — packed-order validation, draft replacement, idempotency, confirmation locking and notification state transitions.
- `src/server/fulfillmentEvidenceService.ts` — image signature/limit checks, hashing and storage coordination.
- `src/server/fulfillmentEvidenceNotification.ts` — WordPress SMTP attachment orchestration and conservative failure reconciliation.
- `src/server/httpServer.ts` — authenticated load/upload/remove/confirm/retry/stream routes.
- `src/server/wooCommerceGateway.ts` and `wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php` — protected multipart delivery, temporary attachments and `wp_mail()` integration.
- `src/server/config.ts`, `.env.example`, `docker-compose.yml` and `docker-compose.override.yml` — vault secret/path and persistent local volume.
- `src/dashboard/main.ts` and `src/dashboard/fulfillment.css` — integrated two-photo operator experience.
- `test/fulfillment-evidence-storage.test.ts`, `test/fulfillment-evidence-notification.test.ts`, `test/fulfillment-evidence-repository.integration.test.ts` and `test/woo-commerce-gateway.test.ts` — encryption, tamper rejection, multipart attachments, delivery reconciliation, idempotency and confirmation locking.
- `docs/REQUIRED-CONFIGURATION.md` — exact production secrets, storage, backup, email and mobile validation still required.

### Verification completed

- Full TypeScript typecheck: passed.
- Production dashboard/server build: passed.
- Full default suite: **130 tests, 106 passed, 0 failed, 24 environment-gated integrations skipped**.
- Focused PostgreSQL evidence integration against isolated `phaseone_fulfillment_test`: **1 passed, 0 failed**.
- Encryption tests confirm plaintext is absent at rest, exact decryption succeeds, altered ciphertext and wrong keys fail closed, and traversal keys are rejected.
- Migrations `010_fulfillment_evidence` and `011_fulfillment_evidence_email` applied successfully to local PostgreSQL; no production database was touched.
- WordPress bridge PHP 8.2 syntax validation passed; the bridge was not installed or called on staging/production.
- Local Docker image rebuilt with the named evidence volume; `/health` returned `200` and all three local services are healthy.
- Visual browser review passed in the compact/mobile viewport for the two-photo draft state, privacy explanation, progress counter, disabled confirmation and integrated transition into Shipping.
- The temporary local visual-review fulfillment row was verified, deleted by its exact UUID and confirmed absent after review.
- No evidence photo was uploaded from a real order, no customer email was sent and no WordPress, stock, payment, order-status or ShipStation mutation occurred.

## Multi-lab vial QR transition — Picking refinement

Status: **complete locally — physical-vial pilot still required**

### Implemented locally

- [x] Retire the operator-facing custom barcode creation and reprint workflow; the warehouse page now opens directly to Storage locations.
- [x] Read the QR already printed on each vial with the phone camera or any 2D USB/Bluetooth HID scanner.
- [x] Accept full Freedom Diagnostics PDF URLs, ILS verification URLs and Kovera hash-token URLs without opening the laboratory website during picking.
- [x] Preserve URL fragments such as Kovera's `#/verify?t=...` token and normalize the confirmed ILS HTTP-to-HTTPS redirect.
- [x] Resolve every QR locally against the governed current COA, product, variation and lot; unknown or ambiguous URLs fail closed.
- [x] Register the two confirmed ILS vial QR aliases in PostgreSQL migration `012_coa_scan_identifiers` while continuing to use WordPress COA/catalog data as the source of truth.
- [x] Reuse the existing transactional, idempotent scan ledger and order-level locking. No stock, payment, order status or shipping behavior changed.
- [x] Add a ten-second in-process COA cache for consecutive vial scans; this avoids repeating the full COA download while retaining frequent status refreshes.
- [x] Show a prominent mismatch panel with the scanned product, the product/SKU required by the order and an explicit “nothing was added” instruction.
- [x] Keep legacy 20-digit Code 128 reads as a hidden transition fallback so previously registered records do not break; no custom label generator is exposed to the operator.

### Validation completed

- Focused camera, multi-lab resolver and picking-decision suite: **16 passed, 0 failed**.
- TypeScript server, dashboard and scripts typecheck: passed.
- Unknown URLs, ambiguous mappings, historical links, wrong products, wrong variations and wrong batches are rejected without incrementing quantity.
- Real laboratory pages are never fetched as part of a scan, avoiding provider latency and preventing arbitrary URLs from becoming fulfillment proof.

### Remaining physical validation

- [ ] Apply migration `012_coa_scan_identifiers` to the target environment before starting the updated application.
- [ ] Scan one real vial from Freedom Diagnostics, ILS and Kovera on the warehouse phone over HTTPS.
- [ ] Confirm the warehouse's physical scanner supports 2D QR symbols (a 1D-only laser scanner cannot read vial QR codes).
- [ ] Run a deliberate wrong-product scan against a test order and verify the audible/visual rejection at the packing table.
- [ ] Register any additional printed vendor URL that is not already the current COA `fileUrl` or `verifyUrl` before using that lot.

## Vial QR → customer order COA assignment

Status: **complete locally — WordPress bridge 1.6.0 deployment and isolated staging validation required**

### Implemented locally

- [x] Treat the approved vial QR as the physical source of truth for the lot selected during picking; a valid alternate current-shipping lot for the same product/variation is accepted even when it differs from the queue's initial suggestion.
- [x] Persist the exact `order item + COA + lot + quantity` allocation inside durable picking progress and the existing accepted scan ledger.
- [x] Support multiple lots on one order line without flattening them into a fabricated single batch.
- [x] Preserve the final per-lot distribution in the immutable Packing snapshot.
- [x] Mirror only the final Packed distribution into the existing WordPress Order COA assignment workspace; abandoned or paused picking sessions never create customer-facing assignments.
- [x] Compare the WordPress workspace before every write, assign only a missing quantity and re-read the result before declaring success.
- [x] Add a stable per-allocation event identity plus an atomic WordPress bridge ledger to prevent duplicate assignment on retries or uncertain responses.
- [x] Never delete or overwrite a conflicting manual COA assignment; mark synchronization failed and show a clear retry/review state while keeping the local Packed record intact.
- [x] Add a protected manual retry action inside the Packed order and expose `pending`, `synced` and `failed` states to the operator.
- [x] Keep commercial stock, payment, order status, shipping and ShipStation untouched.

### Files modified or created

- `src/server/fulfillmentPicking.ts` — accepts any approved matching physical lot and accumulates per-lot quantities.
- `src/server/fulfillmentPacking.ts` and `src/shared/fulfillment.ts` — immutable multi-lot packing allocations and sync response contracts.
- `src/server/fulfillmentCoaSync.ts` — read-before-write reconciliation, stable event identity, missing-delta assignment and conflict protection.
- `src/server/fulfillmentRepository.ts` — durable WordPress sync result, attempts, retry time and audit events.
- `src/server/httpServer.ts` and `src/server/wooCommerceGateway.ts` — packing-time synchronization, protected retry endpoint and idempotency key transport.
- `wordpress/phase-one-operations-bridge/phase-one-operations-bridge.php` — version 1.6.0 atomic idempotency ledger for order COA assignments.
- `src/dashboard/main.ts` and `src/dashboard/fulfillment.css` — customer-lot capture, multi-lot Packed record and assignment-status UI.
- `test/fulfillment-picking.test.ts`, `test/fulfillment-packing.test.ts` and `test/fulfillment-coa-sync.test.ts` — alternate-lot, multi-lot, replay and manual-conflict coverage.
- `docs/QR-FULFILLMENT-PLAN.html` and `docs/REQUIRED-CONFIGURATION.md` — updated operating model and deployment gate.

### Activation gate

- [ ] Install Operations Bridge 1.6.0 on staging and confirm `idempotent_order_coa_assignment` is reported.
- [ ] Enable the dashboard WordPress connection in `read_write` mode only for the isolated validation.
- [ ] Pack a test order containing two units from different approved lots and confirm both quantities appear on the correct WordPress order item.
- [ ] Replay the same confirmation and verify WordPress quantities do not change.
- [ ] Create a deliberate conflicting manual assignment and verify the dashboard blocks automatic replacement and surfaces the review state.
- [ ] Do not activate against real customer orders until the staging checks pass.

### Validation completed

- Full TypeScript typecheck and production build: passed.
- Default automated suite: **141 tests, 116 passed, 0 failed, 25 environment-gated integrations skipped**.
- Isolated PostgreSQL fulfillment suite: **21 passed, 0 failed**, including durable failed/succeeded COA sync attempts and audit events.
- Focused vial allocation/sync coverage: approved alternate lot, multi-lot packing, stable retry identity, no-op replay and manual-assignment conflict all passed.
- Operations Bridge 1.6.0 PHP 8.2 syntax validation and packaged ZIP content check: passed.
- Local Docker rebuild and `/health`: passed; monitor, PostgreSQL and Redis are healthy.
- Desktop and 390px mobile Fulfillment review showed no horizontal overflow; no order was packed and no WordPress write was triggered during review.

## Phase 6 — Testing, UI Polish & Hardware Pilot

Status: **not started — approval required**

### Tasks

- [ ] Run the complete order-to-packed test matrix.
- [ ] Test cancellation, refunds, source-order changes, retries, outages, and restarts.
- [ ] Test 100 consecutive physical scans and representative incorrect scans.
- [ ] Verify thermal output, dimensions, contrast, and readable human text.
- [ ] Polish responsive light/dark station UI and accessibility.
- [ ] Prepare local, staging, production, rollback, and operator documentation.

### Dependencies

- Phases 1–5 accepted.
- Final pilot hardware and staging WordPress access.

### Acceptance criteria

- All scope acceptance criteria pass in staging with production-like data.
- Hardware matrix is documented and signed off.
- Deployment does not run migrations implicitly.
- Rollback and recovery instructions are verified.

## Current approval boundary

Phases 1–4 and Phase 5A are completed locally. Phase 5B is complete locally with mocked carriers, rates, label creation, reconciliation and reprinting. Vial QR lot capture and packing-time customer COA assignment are complete locally, but require Operations Bridge 1.6.0 plus isolated staging validation before activation. The prepared real shipping integration remains disabled by a server-only feature flag; no live API request, production deployment or real purchase is authorized. Phase 6 has not started.
