import "./affiliates-admin.css";
import type { AffiliateAdminDirectory, AffiliateApplicationSummary, AffiliatePayoutStatus, AffiliateSummary } from "../shared/affiliates";

let directory: AffiliateAdminDirectory | null = null;
let initialized = false;
let activeTab: "directory" | "commissions" | "applications" | "payouts" | "program" = "directory";
let managedAffiliateId: string | null = null;

const find = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
const required = <T extends HTMLElement>(selector: string): T => {
  const element = find<T>(selector);
  if (!element) throw new Error(`Missing affiliate admin element ${selector}`);
  return element;
};
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
const money = (value: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
const shortDate = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "—";
const statusLabel = (status: string) => ({ pending_invite: "Invite needed", active: "Active", suspended: "Suspended", reserved: "Awaiting payment", pending: "On hold", requested: "Requested", approved: "Approved", processing: "Processing", paid: "Paid", reversed: "Reversed", rejected: "Rejected", cancelled: "Cancelled" } as Record<string, string>)[status] || status;
const applicationSourceLabel = (source: AffiliateApplicationSummary["source"]) => source === "account_form" ? "Customer account" : "Public form";

function renderDirectory(): void {
  if (!directory) return;
  const query = required<HTMLInputElement>("#affiliate-admin-search").value.trim().toLowerCase();
  const rows = directory.affiliates.filter((affiliate) => {
    const coupons = affiliate.coupons.map((coupon) => coupon.code).join(" ");
    return !query || `${affiliate.displayName} ${affiliate.email} ${affiliate.username} ${coupons}`.toLowerCase().includes(query);
  });
  required("#affiliate-directory-count").textContent = `${rows.length} of ${directory.affiliates.length} affiliates`;
  required("#affiliate-admin-body").innerHTML = rows.length ? rows.map((affiliate) => {
    const coupon = affiliate.coupons[0];
    const initials = affiliate.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P1";
    const invite = affiliate.status === "pending_invite" ? `<button class="affiliate-row-action" type="button" data-affiliate-invite="${escapeHtml(affiliate.id)}">Create invite</button>` : "";
    return `<tr><td><div class="affiliate-person"><span>${escapeHtml(initials)}</span><div><strong>${escapeHtml(affiliate.displayName)}</strong><small>${escapeHtml(affiliate.email)}</small></div></div></td><td>${coupon ? `<div class="affiliate-coupon-cell"><strong>${escapeHtml(coupon.code.toUpperCase())}</strong><small>${coupon.discountValue}% off · ${coupon.commissionValue}% commission</small></div>` : '<span class="affiliate-none">No coupon assigned</span>'}</td><td><strong>${affiliate.coupons.reduce((sum, item) => sum + item.usageCount, 0)}</strong></td><td>${money(affiliate.grossSales, directory!.settings.currency)}<small class="affiliate-shadow-detail">Shadow ${money(affiliate.shadowSales, directory!.settings.currency)}</small></td><td>${money(affiliate.totalCommission, directory!.settings.currency)}<small class="affiliate-shadow-detail">Shadow ${money(affiliate.shadowCommission, directory!.settings.currency)} · ${affiliate.shadowOrders} orders</small></td><td><strong>${money(affiliate.availableBalance, directory!.settings.currency)}</strong></td><td><span class="affiliate-admin-status affiliate-admin-status--${escapeHtml(affiliate.status)}">${escapeHtml(statusLabel(affiliate.status))}</span></td><td><div class="affiliate-row-actions"><button class="affiliate-row-action affiliate-row-action--primary" type="button" data-affiliate-manage="${escapeHtml(affiliate.id)}">Manage</button>${invite}</div></td></tr>`;
  }).join("") : '<tr><td colspan="8"><div class="affiliate-admin-empty"><strong>No affiliates match this search</strong><p>Try a name, email address or coupon code.</p></div></td></tr>';
}

function renderCommissions(): void {
  if (!directory) return;
  const query = required<HTMLInputElement>("#affiliate-commission-search").value.trim().toLowerCase();
  const commissions = directory.commissions || [];
  const rows = commissions.filter((commission) =>
    !query || `${commission.orderNumber} ${commission.affiliateName} ${commission.affiliateEmail} ${commission.couponCode} ${commission.status}`.toLowerCase().includes(query)
  );
  const currency = directory.settings.currency;
  const visibleTotal = rows.reduce((sum, commission) => sum + commission.commissionAmount, 0);
  required("#affiliate-commission-summary").textContent = `${rows.length} entr${rows.length === 1 ? "y" : "ies"} · ${money(visibleTotal, currency)} in commission`;
  const pending = commissions.filter((commission) => commission.status === "pending" || commission.status === "reserved").length;
  required("#affiliate-commission-tab-copy").textContent = pending
    ? `${pending} earning${pending === 1 ? "" : "s"} awaiting approval`
    : `${commissions.length} attributed order${commissions.length === 1 ? "" : "s"}`;
  required("#affiliate-commission-body").innerHTML = rows.length ? rows.map((commission) => {
    const initials = commission.affiliateName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P1";
    const rule = commission.commissionType === "fixed"
      ? `${money(commission.commissionRate, commission.currency)} fixed`
      : `${commission.commissionRate}%`;
    const timing = commission.status === "pending" && commission.heldUntil
      ? `Releases ${shortDate(commission.heldUntil)}`
      : `Updated ${shortDate(commission.updatedAt)}`;
    return `<tr><td><button class="affiliate-commission-order" type="button" data-affiliate-order="${commission.orderId}"><strong>#${escapeHtml(commission.orderNumber)}</strong><small>${money(commission.orderTotal, commission.currency)} order</small></button></td><td><div class="affiliate-person affiliate-person--small"><span>${escapeHtml(initials)}</span><div><strong>${escapeHtml(commission.affiliateName)}</strong><small>${escapeHtml(commission.affiliateEmail)}</small></div></div></td><td><strong class="affiliate-commission-coupon">${escapeHtml(commission.couponCode.toUpperCase())}</strong></td><td>${money(commission.eligibleAmount, commission.currency)}</td><td>${escapeHtml(rule)}</td><td><strong class="affiliate-commission-earned">${money(commission.commissionAmount, commission.currency)}</strong></td><td><span class="affiliate-admin-status affiliate-admin-status--${escapeHtml(commission.status)}">${escapeHtml(statusLabel(commission.status))}</span><small class="affiliate-shadow-detail">${escapeHtml(timing)}</small></td><td>${shortDate(commission.attributedAt)}</td></tr>`;
  }).join("") : '<tr><td colspan="8"><div class="affiliate-admin-empty"><strong>No commission records found</strong><p>Attributed orders will appear here automatically after the shadow ledger verifies the coupon.</p></div></td></tr>';
}

function managedAffiliate(): AffiliateSummary | null {
  return directory?.affiliates.find((affiliate) => affiliate.id === managedAffiliateId) || null;
}

function setManagementNotice(message: string, error = false): void {
  const notice = required("#affiliate-manage-notice");
  notice.textContent = message;
  notice.classList.toggle("is-error", error);
  notice.hidden = !message;
}

function openAffiliateManagement(affiliate: AffiliateSummary): void {
  managedAffiliateId = affiliate.id;
  const coupon = affiliate.coupons[0];
  const initials = affiliate.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P1";
  required("#affiliate-manage-avatar").textContent = initials;
  required("#affiliate-manage-name").textContent = affiliate.displayName;
  required("#affiliate-manage-email").textContent = affiliate.email;
  required<HTMLInputElement>("#affiliate-manage-id").value = affiliate.id;
  required<HTMLInputElement>("#affiliate-manage-coupon-id").value = coupon?.id || "";
  required<HTMLInputElement>("#affiliate-manage-code").value = coupon?.code.toUpperCase() || "";
  required<HTMLInputElement>("#affiliate-manage-discount").value = String(coupon?.discountValue || 10);
  required<HTMLInputElement>("#affiliate-manage-commission").value = String(coupon?.commissionValue || directory?.settings.defaultCommissionRate || 10);
  required("#affiliate-manage-coupon-title").textContent = coupon ? `Manage ${coupon.code.toUpperCase()}` : "Assign the first coupon";
  const status = required("#affiliate-manage-status");
  status.className = `affiliate-admin-status affiliate-admin-status--${affiliate.status}`;
  status.textContent = statusLabel(affiliate.status);

  const save = required<HTMLButtonElement>("#affiliate-save-coupon");
  const couponInputs = ["#affiliate-manage-code", "#affiliate-manage-discount", "#affiliate-manage-commission"]
    .map((selector) => required<HTMLInputElement>(selector));
  const writeEnabled = Boolean(directory?.management.couponProvisioningEnabled);
  const linked = Boolean(affiliate.wpUserId);
  const canEditCoupon = writeEnabled && affiliate.status !== "suspended" && affiliate.status !== "closed";
  for (const input of couponInputs) input.disabled = !canEditCoupon;
  save.disabled = !canEditCoupon;
  save.textContent = coupon ? "Save coupon changes" : "Assign coupon";
  if (!writeEnabled) {
    setManagementNotice("Store coupon write access is disabled. Enable the approved read/write connection before changing coupons.", true);
  } else if (affiliate.status !== "active") {
    setManagementNotice(affiliate.status === "pending_invite"
      ? "The dashboard will securely match this email to an existing Phase One customer account and activate the affiliate when you assign the coupon."
      : "Reactivate this affiliate before changing or assigning a coupon.");
  } else if (!linked) {
    setManagementNotice("The dashboard will securely match this email to an existing Phase One customer account when you assign the coupon.");
  } else {
    setManagementNotice("");
  }

  const toggle = required<HTMLButtonElement>("#affiliate-toggle-status");
  const suspended = affiliate.status === "suspended";
  toggle.textContent = suspended ? "Reactivate affiliate" : "Pause affiliate";
  toggle.classList.toggle("is-danger", !suspended);
  toggle.disabled = affiliate.status === "closed";
  required("#affiliate-access-title").textContent = suspended ? "Affiliate access is paused" : affiliate.status === "pending_invite" ? "Invitation not accepted" : "Affiliate is active";
  required("#affiliate-access-copy").textContent = suspended
    ? "Reactivating restores portal access and publishes assigned coupons again."
    : "Pausing blocks portal access and disables assigned coupons while preserving every record.";
  required("#affiliate-manage-dialog").hidden = false;
}

function closeAffiliateManagement(): void {
  managedAffiliateId = null;
  required("#affiliate-manage-dialog").hidden = true;
}

async function saveAffiliateCoupon(): Promise<void> {
  const affiliate = managedAffiliate();
  if (!affiliate) return;
  const button = required<HTMLButtonElement>("#affiliate-save-coupon");
  button.disabled = true;
  button.textContent = "Saving in both systems…";
  setManagementNotice("");
  try {
    const response = await fetch("/api/affiliates/coupon", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        affiliateId: affiliate.id,
        couponId: required<HTMLInputElement>("#affiliate-manage-coupon-id").value || null,
        code: required<HTMLInputElement>("#affiliate-manage-code").value,
        discountValue: Number(required<HTMLInputElement>("#affiliate-manage-discount").value),
        commissionValue: Number(required<HTMLInputElement>("#affiliate-manage-commission").value),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "The coupon could not be saved");
    await loadAffiliateAdmin(true);
    const refreshed = directory?.affiliates.find((item) => item.id === affiliate.id);
    if (refreshed) {
      openAffiliateManagement(refreshed);
      setManagementNotice("Coupon ready. It is active on the storefront and connected to commission tracking.");
    }
  } catch (error: unknown) {
    setManagementNotice(error instanceof Error ? error.message : "The coupon could not be saved", true);
    button.disabled = false;
    button.textContent = affiliate.coupons.length ? "Save coupon changes" : "Assign coupon";
  }
}

async function toggleAffiliateStatus(): Promise<void> {
  const affiliate = managedAffiliate();
  if (!affiliate) return;
  const status = affiliate.status === "suspended" ? "active" : "suspended";
  if (status === "suspended" && !window.confirm(`Pause ${affiliate.displayName}? Their portal access and assigned coupons will be disabled.`)) return;
  const button = required<HTMLButtonElement>("#affiliate-toggle-status");
  button.disabled = true;
  button.textContent = status === "active" ? "Reactivating…" : "Pausing…";
  try {
    const response = await fetch("/api/affiliates/status", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ affiliateId: affiliate.id, status }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "The affiliate status could not be changed");
    await loadAffiliateAdmin(true);
    const refreshed = directory?.affiliates.find((item) => item.id === affiliate.id);
    if (refreshed) openAffiliateManagement(refreshed);
  } catch (error: unknown) {
    setManagementNotice(error instanceof Error ? error.message : "The affiliate status could not be changed", true);
    button.disabled = false;
    button.textContent = affiliate.status === "suspended" ? "Reactivate affiliate" : "Pause affiliate";
  }
}

function payoutActions(status: AffiliatePayoutStatus, id: string): string {
  if (status === "requested") return `<div class="affiliate-payout-actions"><button data-payout-action="approved" data-payout-id="${id}">Approve</button><button class="is-danger" data-payout-action="rejected" data-payout-id="${id}">Reject</button></div>`;
  if (status === "approved") return `<div class="affiliate-payout-actions"><button data-payout-action="processing" data-payout-id="${id}">Start payment</button><button data-payout-action="paid" data-payout-id="${id}">Mark paid</button></div>`;
  if (status === "processing") return `<div class="affiliate-payout-actions"><button data-payout-action="paid" data-payout-id="${id}">Mark paid</button><button class="is-danger" data-payout-action="rejected" data-payout-id="${id}">Reject</button></div>`;
  return `<span class="affiliate-none">No action needed</span>`;
}

function renderPayouts(): void {
  if (!directory) return;
  const pending = directory.payouts.filter((item) => ["requested", "approved", "processing"].includes(item.status));
  required("#affiliate-payout-summary").textContent = `${pending.length} open request${pending.length === 1 ? "" : "s"} · ${money(directory.metrics.pendingPayoutAmount, directory.settings.currency)} pending`;
  required("#affiliate-payout-body").innerHTML = directory.payouts.length ? directory.payouts.map((payout) => `<tr><td><div class="affiliate-person affiliate-person--small"><span>${escapeHtml(payout.affiliateName.split(/\s+/).slice(0,2).map((part)=>part[0]).join("").toUpperCase() || "P1")}</span><div><strong>${escapeHtml(payout.affiliateName)}</strong><small>${escapeHtml(payout.affiliateEmail)}</small></div></div></td><td>${shortDate(payout.requestedAt)}</td><td>${escapeHtml(payout.payoutMethod.toUpperCase())}</td><td><span class="affiliate-destination">${escapeHtml(payout.payoutDestination)}</span></td><td><strong>${money(payout.amount, payout.currency)}</strong></td><td><span class="affiliate-admin-status affiliate-admin-status--${escapeHtml(payout.status)}">${escapeHtml(statusLabel(payout.status))}</span></td><td>${payoutActions(payout.status, payout.id)}</td></tr>`).join("") : '<tr><td colspan="7"><div class="affiliate-admin-empty"><strong>No payout requests yet</strong><p>New requests from the affiliate portal will appear here and trigger a notification.</p></div></td></tr>';
}

function renderApplications(): void {
  if (!directory) return;
  const query = required<HTMLInputElement>("#affiliate-application-search").value.trim().toLowerCase();
  const rows = directory.applications.filter((application) =>
    !query || `${application.displayName} ${application.email} ${application.preferredCoupon} ${application.platform} ${application.socialHandle}`.toLowerCase().includes(query)
  );
  const pending = directory.applications.filter((application) => application.status === "pending").length;
  required("#affiliate-application-summary").textContent = `${pending} pending · ${directory.applications.length} total`;
  required("#affiliate-application-tab-copy").textContent = pending
    ? `${pending} request${pending === 1 ? "" : "s"} waiting for review`
    : "Public and account requests";
  required("#affiliate-application-body").innerHTML = rows.length ? rows.map((application) => {
    const initials = application.displayName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "P1";
    return `<tr><td><div class="affiliate-person"><span>${escapeHtml(initials)}</span><div><strong>${escapeHtml(application.displayName)}</strong><small>${escapeHtml(application.email)}</small></div></div></td><td><strong>${escapeHtml(application.preferredCoupon)}</strong></td><td><div class="affiliate-coupon-cell"><strong>${escapeHtml(application.platform)}</strong><small>${escapeHtml(application.socialHandle)}</small></div></td><td>${escapeHtml(application.audienceSize.replaceAll("-", " "))}</td><td><span class="affiliate-source-badge">${escapeHtml(applicationSourceLabel(application.source))}</span></td><td>${shortDate(application.createdAt)}</td><td><span class="affiliate-admin-status affiliate-admin-status--${escapeHtml(application.status)}">${escapeHtml(statusLabel(application.status))}</span></td></tr>`;
  }).join("") : '<tr><td colspan="7"><div class="affiliate-admin-empty"><strong>No applications found</strong><p>Requests from the public affiliate page and customer accounts will appear together here.</p></div></td></tr>';
}

function renderMetrics(): void {
  if (!directory) return;
  const { metrics, settings } = directory;
  required("#affiliate-kpi-people").textContent = String(metrics.affiliates);
  required("#affiliate-kpi-active").textContent = `${metrics.activeAffiliates} activated · ${metrics.couponUses} coupon uses`;
  required("#affiliate-kpi-sales").textContent = money(metrics.grossSales, settings.currency);
  required("#affiliate-kpi-commission").textContent = money(metrics.totalCommission, settings.currency);
  required("#affiliate-kpi-available").textContent = money(metrics.availableBalance, settings.currency);
  required("#affiliate-kpi-payouts").textContent = money(metrics.pendingPayoutAmount, settings.currency);
  required("#affiliate-kpi-payout-count").textContent = `${metrics.pendingPayoutRequests} request${metrics.pendingPayoutRequests === 1 ? "" : "s"} waiting`;
  required("#affiliate-rule-commission").textContent = `${settings.defaultCommissionRate}%`;
  required("#affiliate-rule-minimum").textContent = money(settings.minimumPayout, settings.currency);
  required("#affiliate-rule-hold").textContent = `${settings.approvalHoldDays} days`;
  required("#affiliate-rule-currency").textContent = settings.currency;
  const navCount = required("#affiliates-nav-count");
  const pendingApplications = directory.applications.filter((application) => application.status === "pending").length;
  const attentionCount = metrics.pendingPayoutRequests + pendingApplications;
  navCount.textContent = String(attentionCount);
  navCount.hidden = attentionCount === 0;
  const sync = required("#affiliate-sync-state");
  sync.classList.add("is-ready");
  sync.querySelector("b")!.textContent = directory.shadow.enabled ? "Dual tracking active" : "Affiliate tracking paused";
  sync.querySelector("small")!.textContent = `Synced ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(directory.syncedAt))}`;
  renderShadowComparison();
}

function renderShadowComparison(): void {
  if (!directory) return;
  const { shadow, settings } = directory;
  const labels = {
    not_started: "Preparing",
    collecting: "Collecting",
    aligned: "Aligned",
    review: "Needs review",
  } as const;
  const status = required("#affiliate-shadow-status");
  status.className = `affiliate-shadow-status is-${shadow.status}`;
  status.textContent = shadow.enabled ? labels[shadow.status] : "Paused";
  required("#affiliate-shadow-plugin-commission").textContent = money(shadow.pluginCommissionDelta, settings.currency);
  required("#affiliate-shadow-plugin-orders").textContent = String(shadow.pluginOrderDelta);
  required("#affiliate-shadow-plugin-sales").textContent = money(shadow.pluginSalesDelta, settings.currency);
  required("#affiliate-shadow-custom-commission").textContent = money(shadow.trackedCommission, settings.currency);
  required("#affiliate-shadow-custom-orders").textContent = String(shadow.trackedOrders);
  required("#affiliate-shadow-custom-sales").textContent = money(shadow.trackedSales, settings.currency);
  const variance = required("#affiliate-shadow-variance");
  variance.textContent = money(Math.abs(shadow.commissionVariance), settings.currency);
  const varianceCard = variance.closest(".affiliate-shadow-variance");
  varianceCard?.classList.toggle("is-review", shadow.status === "review");
  varianceCard?.classList.toggle("is-aligned", shadow.status === "aligned");
  const updated = required("#affiliate-shadow-updated");
  updated.textContent = shadow.lastSyncedAt
    ? `Last checked ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(shadow.lastSyncedAt))}`
    : shadow.startedAt ? "Waiting for the first order check" : "Preparing a safe starting baseline";
}

function switchTab(tab: typeof activeTab): void {
  activeTab = tab;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-affiliate-admin-tab]")) {
    const active = button.dataset.affiliateAdminTab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const panel of document.querySelectorAll<HTMLElement>("[data-affiliate-admin-panel]")) panel.hidden = panel.dataset.affiliateAdminPanel !== tab;
}

async function inviteAffiliate(affiliate: AffiliateSummary): Promise<void> {
  const response = await fetch("/api/affiliates/invite", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ affiliateId: affiliate.id }) });
  const payload = await response.json() as { activationUrl?: string; expiresAt?: string; error?: string };
  if (!response.ok || !payload.activationUrl) throw new Error(payload.error || "Invitation could not be created");
  required<HTMLInputElement>("#affiliate-invite-url").value = payload.activationUrl;
  required("#affiliate-invite-expiry").textContent = payload.expiresAt ? `Expires ${shortDate(payload.expiresAt)} · one-time use` : "Expires in 72 hours";
  required("#affiliate-invite-result").hidden = false;
}

async function createDirectInvitation(): Promise<void> {
  const displayName = required<HTMLInputElement>("#affiliate-invite-name").value.trim();
  const email = required<HTMLInputElement>("#affiliate-invite-email").value.trim();
  const button = required<HTMLButtonElement>("#affiliate-create-invite");
  button.disabled = true;
  button.textContent = "Generating…";
  try {
    const response = await fetch("/api/affiliates/invite", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email }),
    });
    const payload = await response.json() as { activationUrl?: string; expiresAt?: string; error?: string };
    if (!response.ok || !payload.activationUrl) throw new Error(payload.error || "Invitation could not be created");
    required<HTMLInputElement>("#affiliate-invite-url").value = payload.activationUrl;
    required("#affiliate-invite-expiry").textContent = payload.expiresAt ? `Expires ${shortDate(payload.expiresAt)} · one-time use` : "Expires in 72 hours";
    required("#affiliate-invite-dialog").hidden = true;
    required("#affiliate-invite-result").hidden = false;
    required<HTMLButtonElement>("#affiliate-copy-invite").textContent = "Copy link";
    required<HTMLFormElement>("#affiliate-invite-form").reset();
    await loadAffiliateAdmin(true);
  } finally {
    button.disabled = false;
    button.textContent = "Generate invitation link";
  }
}

async function updatePayout(id: string, status: string): Promise<void> {
  const response = await fetch("/api/affiliates/payout-status", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payoutId: id, status }) });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Payout could not be updated");
  await loadAffiliateAdmin(true);
}

export async function loadAffiliateAdmin(force = false): Promise<void> {
  const sync = required("#affiliate-sync-state");
  sync.classList.remove("is-ready");
  sync.querySelector("b")!.textContent = "Synchronizing affiliates";
  sync.querySelector("small")!.textContent = "Reading the migration bridge";
  const response = await fetch(`/api/affiliates${force ? "?refresh=1" : ""}`, { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as AffiliateAdminDirectory & { error?: string };
  if (!response.ok || !payload.affiliates) {
    sync.querySelector("b")!.textContent = "Affiliate service unavailable";
    sync.querySelector("small")!.textContent = payload.error || "Try again";
    required("#affiliate-admin-body").innerHTML = `<tr><td colspan="8"><div class="affiliate-admin-empty is-error"><strong>Affiliate data could not be loaded</strong><p>${escapeHtml(payload.error || "The platform is temporarily unavailable.")}</p></div></td></tr>`;
    return;
  }
  directory = payload;
  renderMetrics(); renderDirectory(); renderCommissions(); renderApplications(); renderPayouts();
}

export function initAffiliateAdmin(): void {
  if (initialized || !find("[data-view-panel='affiliates']")) return;
  initialized = true;
  required("#affiliate-admin-search").addEventListener("input", renderDirectory);
  required("#affiliate-commission-search").addEventListener("input", renderCommissions);
  required("#affiliate-application-search").addEventListener("input", renderApplications);
  required("#affiliate-admin-refresh").addEventListener("click", () => void loadAffiliateAdmin(true));
  required("#affiliate-new-invite").addEventListener("click", () => {
    required("#affiliate-invite-dialog").hidden = false;
    required<HTMLInputElement>("#affiliate-invite-name").focus();
  });
  required("#affiliate-invite-dialog").addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-close-affiliate-dialog]") || event.target === required("#affiliate-invite-dialog")) {
      required("#affiliate-invite-dialog").hidden = true;
    }
  });
  required("#affiliate-manage-dialog").addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-close-affiliate-manage]") || event.target === required("#affiliate-manage-dialog")) {
      closeAffiliateManagement();
    }
  });
  required<HTMLFormElement>("#affiliate-manage-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveAffiliateCoupon();
  });
  required("#affiliate-toggle-status").addEventListener("click", () => void toggleAffiliateStatus());
  required<HTMLInputElement>("#affiliate-manage-code").addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  });
  required<HTMLFormElement>("#affiliate-invite-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void createDirectInvitation().catch((error: unknown) => alert(error instanceof Error ? error.message : "Invitation failed"));
  });
  required("#affiliate-copy-invite").addEventListener("click", async () => {
    await navigator.clipboard.writeText(required<HTMLInputElement>("#affiliate-invite-url").value);
    required("#affiliate-copy-invite").textContent = "Copied ✓";
  });
  required("#affiliate-invite-result").addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("[data-close-affiliate-invite]")) required("#affiliate-invite-result").hidden = true;
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-affiliate-admin-tab]")) button.addEventListener("click", () => switchTab((button.dataset.affiliateAdminTab || "directory") as typeof activeTab));
  required("[data-view-panel='affiliates']").addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const commissionOrderId = Number(target.closest<HTMLElement>("[data-affiliate-order]")?.dataset.affiliateOrder);
    if (Number.isSafeInteger(commissionOrderId) && commissionOrderId > 0) {
      window.dispatchEvent(new CustomEvent("phaseone:open-order", { detail: { orderId: commissionOrderId } }));
      return;
    }
    const manageId = target.closest<HTMLElement>("[data-affiliate-manage]")?.dataset.affiliateManage;
    if (manageId && directory) {
      const affiliate = directory.affiliates.find((item) => item.id === manageId);
      if (affiliate) openAffiliateManagement(affiliate);
      return;
    }
    const inviteId = target.closest<HTMLElement>("[data-affiliate-invite]")?.dataset.affiliateInvite;
    if (inviteId && directory) {
      const affiliate = directory.affiliates.find((item) => item.id === inviteId);
      if (affiliate) void inviteAffiliate(affiliate).catch((error: unknown) => alert(error instanceof Error ? error.message : "Invitation failed"));
      return;
    }
    const action = target.closest<HTMLElement>("[data-payout-action]");
    if (action?.dataset.payoutAction && action.dataset.payoutId) void updatePayout(action.dataset.payoutId, action.dataset.payoutAction).catch((error: unknown) => alert(error instanceof Error ? error.message : "Payout update failed"));
  });
}
