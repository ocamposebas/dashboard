# Custom COA Library — cutover record

## Authority model

- PostgreSQL `coa_certificates` is the authority for all new and edited COAs.
- WordPress Phase One COA Manager is a read-only historical source during the transition.
- The first empty-database startup imports every legacy record idempotently, including the embedded version history.
- A protected administrator endpoint can repeat the historical import without duplicating records: `POST /api/extensions/coa/import-wordpress`.
- The storefront and fulfillment scanner read the custom repository. They do not fall back to the old WordPress COA endpoint.

Do not deactivate or delete the WordPress COA plugins until production reconciliation confirms the same record count, documents, product mappings, current lots and historical versions in PostgreSQL.

## API

Public, read-only endpoints:

- `GET /api/public/v1/coas`
- `GET /api/public/v1/coas?productId=123`
- `GET /api/public/v1/coas?variationId=456`
- `GET /api/public/v1/coas?sku=P1-SKU`
- `GET /api/public/v1/coas?search=retatrutide`
- `GET /api/public/v1/coas?current=1`
- `GET /api/public/v1/coas/:id/document`

Only records with `status=Available` and a publication timestamp are returned. Review drafts and archived records are never exposed by the public API.

Dashboard-only endpoints require an authenticated Operations, Administrator or Owner session:

- `POST /api/extensions/coa/intake` for HTTPS laboratory links.
- `POST /api/extensions/coa/intake-pdf` for PDF bytes up to 12 MB.
- `POST /api/extensions/coa` for reviewed metadata, product mapping and publication.
- `POST /api/extensions/coa/import-wordpress` additionally requires Administrator or Owner.

## Production variables

Dashboard/Coolify:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=true
DASHBOARD_ORIGIN=https://operations.phaseonelabz.com
COA_PUBLIC_ORIGIN=https://operations.phaseonelabz.com
TRACKER_ORIGINS=https://phaseonelabz.com,https://www.phaseonelabz.com
```

Storefront (`research-peptide` / `violet-visual`):

```text
COA_API_URL=https://operations.phaseonelabz.com
```

`COA_API_URL` is server-only. The storefront intentionally has no WordPress COA fallback.

## Safe cutover checklist

1. Back up the WordPress database, uploads and dashboard PostgreSQL database.
2. Deploy the dashboard first. Startup migrations run under a PostgreSQL advisory lock.
3. Confirm `/health` is healthy and `/api/public/v1/coas` carries `X-COA-Source: phase-one-postgresql`.
4. Compare WordPress legacy count with the custom library count and review all current-lot mappings.
5. Verify at least one Freedom Diagnostics, ILS and Kovera QR against Fulfillment.
6. Configure `COA_API_URL` and deploy the storefront second.
7. Verify product detail COA links and `/coa-library` on desktop and mobile.
8. Run in observation mode before disabling the WordPress manager UI. Keep its tables and uploads intact as a rollback source.

## Data protections

- URL and PDF SHA-256 fingerprints prevent duplicate intake.
- PDF magic bytes, MIME type and a 12 MB limit are validated server-side.
- Publication requires a final COA number, product, lot, document and product/SKU mapping.
- Only an Available record can be marked as the current shipping lot.
- Updates use revisions to reject stale concurrent saves.
- Every import, intake and update writes an append-only audit event.

