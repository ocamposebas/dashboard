import "./affiliate.css";
import "./affiliate-hidden.css";
import "./clean-ui.css";
import logoUrl from "./phase-one-labz-logo.webp";
import type { AffiliatePortalDashboard } from "../shared/affiliates";

const byId = <T extends HTMLElement>(id: string) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing affiliate element ${id}`);
  return element as T;
};

for (const image of [byId<HTMLImageElement>("affiliate-public-logo"), byId<HTMLImageElement>("affiliate-logo")]) image.src = logoUrl;

const access = byId<HTMLElement>("affiliate-access");
const app = byId<HTMLElement>("affiliate-app");
const loginCard = byId<HTMLElement>("affiliate-login-card");
const activationCard = byId<HTMLElement>("affiliate-activation-card");
const workspace = byId<HTMLElement>("affiliate-workspace");
let dashboard: AffiliatePortalDashboard | null = null;
let activeSection: "overview" | "performance" | "payouts" = "overview";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
}

function date(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function showError(element: HTMLElement, message: string): void {
  element.textContent = message;
  element.hidden = false;
}

function statusLabel(status: string): string {
  return ({ requested: "Requested", approved: "Approved", processing: "Processing", paid: "Paid", rejected: "Declined", cancelled: "Cancelled", pending: "Pending", reversed: "Reversed" } as Record<string, string>)[status] || status;
}

function renderOverview(data: AffiliatePortalDashboard): string {
  const affiliate = data.affiliate;
  const primaryCoupon = affiliate.coupons[0];
  const couponCards = affiliate.coupons.map((coupon) => `<article class="affiliate-coupon-card"><div><span>YOUR COUPON</span><strong>${escapeHtml(coupon.code.toUpperCase())}</strong><small>${coupon.discountValue}% customer discount · ${coupon.commissionValue}% commission</small></div><button type="button" data-copy="${escapeHtml(coupon.code)}">Copy code</button><footer><span>${coupon.usageCount} uses</span><a href="${escapeHtml(coupon.referralUrl)}" target="_blank" rel="noopener">Open referral link ↗</a></footer></article>`).join("");
  const commissionRows = data.recentCommissions.length ? data.recentCommissions.slice(0, 6).map((commission) => `<tr><td><strong>#${escapeHtml(commission.orderNumber)}</strong></td><td>${date(commission.createdAt)}</td><td><span class="affiliate-status affiliate-status--${escapeHtml(commission.status)}">${escapeHtml(statusLabel(commission.status))}</span></td><td>${money(commission.amount, commission.currency)}</td></tr>`).join("") : '<tr><td colspan="4"><div class="affiliate-empty"><strong>No new commission entries yet</strong><p>New attributed orders will appear here automatically.</p></div></td></tr>';
  return `<section class="affiliate-hero"><div><p>PARTNER OVERVIEW</p><h2>Your performance,<br />without the guesswork.</h2><span>Updated with your latest approved store activity.</span></div><aside><small>Available to request</small><strong>${money(affiliate.availableBalance, data.settings.currency)}</strong><button type="button" data-open-payout ${affiliate.availableBalance < data.settings.minimumPayout ? "disabled" : ""}>Request payout →</button><em>Minimum ${money(data.settings.minimumPayout, data.settings.currency)}</em></aside></section><section class="affiliate-metrics"><article><span>Attributed sales</span><strong>${money(affiliate.grossSales, data.settings.currency)}</strong><small>Lifetime coupon revenue</small></article><article><span>Total commission</span><strong>${money(affiliate.totalCommission, data.settings.currency)}</strong><small>Earned across all orders</small></article><article><span>Pending payout</span><strong>${money(affiliate.pendingPayout, data.settings.currency)}</strong><small>Currently under review</small></article><article><span>Coupon uses</span><strong>${affiliate.coupons.reduce((sum, coupon) => sum + coupon.usageCount, 0)}</strong><small>${primaryCoupon ? escapeHtml(primaryCoupon.code.toUpperCase()) : "No coupon assigned"}</small></article></section><section class="affiliate-content-grid"><div><div class="affiliate-section-head"><div><p>SHARE & EARN</p><h3>Your affiliate tools</h3></div></div><div class="affiliate-coupons">${couponCards || '<div class="affiliate-empty"><strong>No active coupon</strong><p>Contact the Phase One team to assign your first code.</p></div>'}</div></div><article class="affiliate-panel"><div class="affiliate-section-head"><div><p>RECENT ACTIVITY</p><h3>Latest commissions</h3></div><button type="button" data-affiliate-go="performance">View all</button></div><div class="affiliate-table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Commission</th></tr></thead><tbody>${commissionRows}</tbody></table></div></article></section>`;
}

function renderPerformance(data: AffiliatePortalDashboard): string {
  const rows = data.recentCommissions.length ? data.recentCommissions.map((item) => `<tr><td><strong>#${escapeHtml(item.orderNumber)}</strong></td><td>${date(item.createdAt)}</td><td><span class="affiliate-status affiliate-status--${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td><td>${money(item.amount, item.currency)}</td></tr>`).join("") : '<tr><td colspan="4"><div class="affiliate-empty"><strong>No commission records yet</strong><p>This ledger will fill as attributed orders are approved.</p></div></td></tr>';
  return `<section class="affiliate-page-title"><p>PERFORMANCE</p><h2>Commission activity</h2><span>A clean, auditable view of every recorded earning.</span></section><section class="affiliate-metrics affiliate-metrics--three"><article><span>Lifetime sales</span><strong>${money(data.affiliate.grossSales, data.settings.currency)}</strong><small>Revenue attributed to your coupons</small></article><article><span>Lifetime commission</span><strong>${money(data.affiliate.totalCommission, data.settings.currency)}</strong><small>Before completed payouts</small></article><article><span>Available now</span><strong>${money(data.affiliate.availableBalance, data.settings.currency)}</strong><small>Eligible to request</small></article></section><article class="affiliate-panel affiliate-panel--wide"><div class="affiliate-section-head"><div><p>COMMISSION LEDGER</p><h3>Recent earnings</h3></div></div><div class="affiliate-table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Status</th><th>Commission</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function renderPayouts(data: AffiliatePortalDashboard): string {
  const rows = data.payouts.length ? data.payouts.map((item) => `<tr><td>${date(item.requestedAt)}</td><td>${escapeHtml(item.payoutMethod.toUpperCase())}</td><td><span class="affiliate-status affiliate-status--${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span></td><td>${money(item.amount, item.currency)}</td></tr>`).join("") : '<tr><td colspan="4"><div class="affiliate-empty"><strong>No payout requests</strong><p>Your requests and completed payments will remain visible here.</p></div></td></tr>';
  const disabled = data.affiliate.availableBalance < data.settings.minimumPayout;
  return `<section class="affiliate-page-title affiliate-page-title--action"><div><p>PAYOUTS</p><h2>Your payment history</h2><span>Request earnings and follow every review status.</span></div><button type="button" data-open-payout ${disabled ? "disabled" : ""}>Request payout</button></section><section class="affiliate-payout-balance"><div><span>Available balance</span><strong>${money(data.affiliate.availableBalance, data.settings.currency)}</strong><small>Minimum request: ${money(data.settings.minimumPayout, data.settings.currency)}</small></div><div><span>Pending review</span><strong>${money(data.affiliate.pendingPayout, data.settings.currency)}</strong><small>Requests are reviewed before payment</small></div></section><article class="affiliate-panel affiliate-panel--wide"><div class="affiliate-section-head"><div><p>PAYMENT LEDGER</p><h3>Requests and payments</h3></div></div><div class="affiliate-table-wrap"><table><thead><tr><th>Requested</th><th>Method</th><th>Status</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function payoutDialog(data: AffiliatePortalDashboard): string {
  return `<div class="affiliate-modal" id="affiliate-payout-modal"><button class="affiliate-modal-backdrop" type="button" data-close-payout aria-label="Close"></button><form id="affiliate-payout-form"><header><div><p>PAYOUT REQUEST</p><h2>Request your earnings</h2><span>Available: ${money(data.affiliate.availableBalance, data.settings.currency)}</span></div><button type="button" data-close-payout>×</button></header><label><span>Amount</span><div class="affiliate-money-field"><b>$</b><input id="affiliate-payout-amount" type="number" min="${data.settings.minimumPayout}" max="${data.affiliate.availableBalance}" step="0.01" value="${data.affiliate.availableBalance.toFixed(2)}" required /></div><small>Minimum ${money(data.settings.minimumPayout, data.settings.currency)}</small></label><label><span>Payment method</span><select id="affiliate-payout-method"><option value="zelle">Zelle</option><option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="bank">Bank transfer</option></select></label><label><span>Email, phone or account destination</span><input id="affiliate-payout-destination" type="text" maxlength="320" required /></label><label><span>Note <em>optional</em></span><textarea id="affiliate-payout-note" maxlength="500" rows="3" placeholder="Anything our payment team should know?"></textarea></label><p class="affiliate-form-error" id="affiliate-payout-error" hidden></p><footer><button type="button" data-close-payout>Cancel</button><button type="submit">Submit request →</button></footer></form></div>`;
}

function render(): void {
  if (!dashboard) return;
  workspace.innerHTML = activeSection === "overview" ? renderOverview(dashboard) : activeSection === "performance" ? renderPerformance(dashboard) : renderPayouts(dashboard);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-affiliate-section]")) button.classList.toggle("is-active", button.dataset.affiliateSection === activeSection);
}

async function loadDashboard(): Promise<boolean> {
  const response = await fetch("/api/affiliate-portal/dashboard", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error("Your affiliate workspace could not be loaded.");
  const payload = await response.json() as { dashboard: AffiliatePortalDashboard };
  dashboard = payload.dashboard;
  access.hidden = true;
  app.hidden = false;
  byId("affiliate-account-name").textContent = dashboard.affiliate.displayName;
  byId("affiliate-greeting").textContent = `Good to see you, ${dashboard.affiliate.displayName.split(" ")[0] || "partner"}`;
  byId("affiliate-avatar").textContent = dashboard.affiliate.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P1";
  render();
  return true;
}

byId<HTMLFormElement>("affiliate-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = byId("affiliate-login-error");
  error.hidden = true;
  const button = (event.currentTarget as HTMLFormElement).querySelector<HTMLButtonElement>("button[type='submit']")!;
  button.disabled = true;
  try {
    const response = await fetch("/api/affiliate-portal/login", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: byId<HTMLInputElement>("affiliate-login-email").value, password: byId<HTMLInputElement>("affiliate-login-password").value }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Sign in failed");
    await loadDashboard();
  } catch (reason) { showError(error, reason instanceof Error ? reason.message : "Sign in failed"); }
  finally { button.disabled = false; }
});

byId<HTMLFormElement>("affiliate-activation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = byId("affiliate-activation-error");
  error.hidden = true;
  const password = byId<HTMLInputElement>("affiliate-activation-password").value;
  if (password !== byId<HTMLInputElement>("affiliate-activation-confirm").value) { showError(error, "The passwords do not match"); return; }
  const token = new URLSearchParams(location.search).get("activation") || "";
  try {
    const response = await fetch("/api/affiliate-portal/activate", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Activation failed");
    history.replaceState({}, "", "/affiliates");
    await loadDashboard();
  } catch (reason) { showError(error, reason instanceof Error ? reason.message : "Activation failed"); }
});

byId("affiliate-back-login").addEventListener("click", () => { activationCard.hidden = true; loginCard.hidden = false; history.replaceState({}, "", "/affiliates"); });
byId("affiliate-refresh").addEventListener("click", () => void loadDashboard());
byId("affiliate-logout").addEventListener("click", async () => { await fetch("/api/affiliate-portal/logout", { method: "POST", credentials: "same-origin" }); location.href = "/affiliates"; });

document.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const nav = target.closest<HTMLButtonElement>("[data-affiliate-section], [data-affiliate-go]");
  if (nav) { activeSection = (nav.dataset.affiliateSection || nav.dataset.affiliateGo || "overview") as typeof activeSection; render(); return; }
  const copy = target.closest<HTMLButtonElement>("[data-copy]");
  if (copy) { await navigator.clipboard.writeText(copy.dataset.copy || ""); copy.textContent = "Copied ✓"; return; }
  if (target.closest("[data-open-payout]") && dashboard) { document.body.insertAdjacentHTML("beforeend", payoutDialog(dashboard)); return; }
  if (target.closest("[data-close-payout]")) { document.getElementById("affiliate-payout-modal")?.remove(); return; }
});

document.addEventListener("submit", async (event) => {
  if (!(event.target instanceof HTMLFormElement) || event.target.id !== "affiliate-payout-form" || !dashboard) return;
  event.preventDefault();
  const error = byId("affiliate-payout-error"); error.hidden = true;
  const submit = event.target.querySelector<HTMLButtonElement>("button[type='submit']")!; submit.disabled = true;
  try {
    const response = await fetch("/api/affiliate-portal/payouts", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientEventId: crypto.randomUUID(), amount: Number(byId<HTMLInputElement>("affiliate-payout-amount").value), payoutMethod: byId<HTMLSelectElement>("affiliate-payout-method").value, payoutDestination: byId<HTMLInputElement>("affiliate-payout-destination").value, note: byId<HTMLTextAreaElement>("affiliate-payout-note").value }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "Request failed");
    document.getElementById("affiliate-payout-modal")?.remove();
    await loadDashboard(); activeSection = "payouts"; render();
  } catch (reason) { showError(error, reason instanceof Error ? reason.message : "Request failed"); }
  finally { submit.disabled = false; }
});

const activation = new URLSearchParams(location.search).get("activation");
if (activation) { loginCard.hidden = true; activationCard.hidden = false; }
void loadDashboard().catch((error: unknown) => { if (!activation) { loginCard.hidden = false; } console.error(error); });
