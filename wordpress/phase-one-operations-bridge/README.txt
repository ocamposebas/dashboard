Phase One Operations Bridge
===========================

Install this small companion plugin beside Phase One COA Manager 2.7.1 and
Phase One Labz Points & Rewards 2.0.0. It adds a secure bridge used by the
local Operations Suite to edit existing COA records and read the real customer
points balance, store credit, reward audit history and redemption history.
It accepts only an existing WooCommerce API key with write or read/write
permission whose owner can edit WordPress posts.

The bridge does not expose credentials to the browser. The local Node server
sends them server-to-server over HTTPS.

Version 1.1.0 adds the customer rewards endpoint. It exposes only operational
reward fields and never returns passwords, authentication tokens or payment
credentials.

Version 1.2.0 adds governed Site Controls publishing. It delegates promotion
validation, temporary sale prices, countdown behavior and maintenance state to
the active Phase One Site Controls plugin, preserving existing variant and gift
rules. The endpoint requires an existing read/write Commerce API owner with
store-management permissions.

Version 1.3.0 adds Loyalty Control: administrators can govern future earning
and redemption economics, pause either side of the program, set order limits,
preview outstanding reward liability, adjust an individual customer's balance,
send the existing branded notification and retain a complete policy and balance
audit trail. Existing customer balances, redemption history and awarded orders
remain untouched.

Version 1.4.0 adds the protected Order Operations and Inventory bridge. The
local suite can read and upload order evidence, manage product/lot COA
assignments, read the live restock program, and trigger eligible back-in-stock
notifications without exposing store credentials to the browser.

Version 1.5.0 adds idempotent packaging-evidence email delivery. The dashboard
sends the two confirmed images server-to-server; WordPress validates the order,
creates request-scoped temporary attachments, calls wp_mail() so the site's
existing SMTP plugin remains the transport owner, and removes the temporary
files immediately. Atomic locks and a bounded sent-event ledger prevent blind
duplicate delivery.

Version 1.6.0 adds idempotent fulfillment-to-order COA assignment. The
dashboard can mirror the exact vial lots confirmed during Packing into the
existing Order COA workspace. A stable event fingerprint and atomic WordPress
ledger make retries replay-safe while the dashboard still reconciles current
assignments before requesting any missing quantity.

Version 1.7.0 adds idempotent native shipment tracking save and void support.

Version 1.7.1 fixes inventory waitlist visibility. The bridge now reads active
subscriber records from both installed notifier families, preserves exact
product and variation relationships, and exposes the existing customer list to
the Operations Suite without sending notifications or changing stock.

Version 1.8.0 completes the native shipping lifecycle. Once postage and tracking
are confirmed, the bridge stores portable tracking metadata, sends the customer
a WooCommerce tracking note through the site's configured mail transport and
marks the order Completed. Replays remain idempotent, while voiding the same
label removes tracking and returns the order to Processing.

Version 1.9.0 lets the packing workflow continue with either one or two evidence
photos. WordPress validates every supplied image and sends exactly the available
evidence through the site's existing SMTP transport without weakening replay or
size protections.

