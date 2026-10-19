# Phase One Labz — Affiliate Platform Tracker

## Product decision

Phase One Labz owns the affiliate platform. Coupon Affiliates for WooCommerce is a temporary migration source and compatibility bridge, not the long-term system of record.

## Implemented locally

- Independent PostgreSQL affiliate profiles, applications, coupons, commission ledger, payout requests, invitations and audit events.
- Storefront-linked affiliate identity using the existing secure Phase One Labz customer account.
- Affiliate portal for earnings, coupon usage, referral link and payout requests inside `phaseonelabz.com/account/#affiliate`.
- Internal admin center for program metrics, affiliate directory, a unified application inbox, payout review and secure invitations.
- Public `/affiliates/` applications and signed-in customer-account applications now enter the same PostgreSQL review queue.
- Administrators can create email-bound, single-use invitation links that expire after 72 hours and open the Phase One Labz account portal.
- Administrators can assign or edit an affiliate coupon from the dashboard, including customer discount and commission percentage.
- Coupon provisioning writes the compatibility metadata required by the current plugin while registering the same coupon in PostgreSQL.
- Existing customer accounts are linked safely by an exact verified email match during coupon assignment when an invitation has not been completed yet.
- Affiliates can be paused and reactivated without deleting sales, commission, payout or audit history; linked storefront coupons follow the same state.
- Idempotent payout requests and audited status changes.
- Read-only legacy importer for users, coupons and aggregate plugin balances.
- Read-only WooCommerce order ingestion in shadow mode while Coupon Affiliates remains active.
- Idempotent order/coupon commission records with payment eligibility, approval holds, refunds, reversals and duplicate protection.
- Commission base uses net merchandise after product discounts and excludes shipping, taxes, processing charges and protection fees.
- Side-by-side plugin delta and Phase One ledger reconciliation in the administrator dashboard.
- Existing Phase One dashboard permissions and notification center integration.
- Responsive light/dark interface for desktop, tablet and mobile.
- The dashboard `/affiliates` public route redirects to the customer-facing Phase One Labz account portal; the dashboard keeps only administration.

## Legacy data available for import

- Affiliate identity associated with a coupon.
- Coupon code and status.
- Discount and commission percentages.
- Referral URL.
- Aggregate gross sales, commission, discounts and order count.
- Aggregate unpaid and pending-payment commission balances.

## Remaining before production cutover

- Export and reconcile historical payout records that are not exposed by the current WordPress REST endpoints.
- Run the shadow ledger through a representative validation period and investigate any order-level variance before cutover.
- Validate partial-refund calculations against the plugin's real behavior; the current safe approximation prorates eligible merchandise by the retained order total.
- Configure transactional email delivery for invitations and payout notifications.
- Add the reviewed application approval/rejection workflow and controlled storefront coupon provisioning before activating newly requested coupon codes.
- Configure the server-only storefront connection using `AFFILIATE_OPERATIONS_URL`, `AFFILIATE_OPERATIONS_SECRET` and matching `AFFILIATE_SERVICE_SECRET`.
- Validate production domain, HTTPS cookies, reverse proxy and backup/restore procedures.
- Reconcile every affiliate balance and coupon before making PostgreSQL authoritative.
- Define the final payout approval and payment-provider operating procedure.
- Run user acceptance tests with a real affiliate and administrator using non-production data.

## Safety status

Local shadow foundation only. Coupon Affiliates remains the balance authority. No production deployment, real payout or live WordPress mutation has been performed.
