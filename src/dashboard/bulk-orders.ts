import type { BulkAdminWorkspace, BulkProductRule } from "../shared/bulkOrders";

interface AdminCatalogProduct {
  productId: number;
  variationId: number;
  purchasableId: number;
  name: string;
  sku: string;
  image: string;
  type: string;
  price: number;
  stockQuantity: number | null;
  stockStatus: string;
  rule: BulkProductRule | null;
}

let workspace: BulkAdminWorkspace | null = null;
let catalog: AdminCatalogProduct[] = [];
let loading: Promise<void> | null = null;
let canManage = false;

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing Bulk Orders element ${selector}`);
  return value;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!);
}

function formatDate(value: string | null): string {
  if (!value) return "No expiration";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "Unknown";
}

function ago(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (elapsed < 60_000) return "Now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}

function toast(title: string, message: string, success = true): void {
  const root = document.querySelector<HTMLElement>("#toast");
  if (!root) return;
  const titleNode = root.querySelector<HTMLElement>("#toast-title");
  const messageNode = root.querySelector<HTMLElement>("#toast-message");
  const icon = root.querySelector<HTMLElement>(":scope > span");
  if (titleNode) titleNode.textContent = title;
  if (messageNode) messageNode.textContent = message;
  if (icon) icon.textContent = success ? "✓" : "!";
  root.hidden = false;
  window.setTimeout(() => { root.hidden = true; }, 4_500);
}

async function request(path: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { cache: "no-store", ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Bulk Orders request failed");
  return payload;
}

function setTab(tab: string): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-bulk-tab]")) button.classList.toggle("is-active", button.dataset.bulkTab === tab);
  for (const panel of document.querySelectorAll<HTMLElement>("[data-bulk-panel]")) panel.hidden = panel.dataset.bulkPanel !== tab;
}

function renderOverview(): void {
  if (!workspace) return;
  const { stats, settings, recentEvents, migration } = workspace;
  element("#bulk-stat-visible").textContent = String(stats.visibleProducts);
  element("#bulk-stat-available").textContent = String(stats.availableProducts);
  element("#bulk-stat-requests").textContent = String(stats.pendingRequests);
  element("#bulk-stat-checkouts").textContent = String(stats.openCheckouts);
  element("#bulk-stat-orders").textContent = String(stats.completedBulkOrders);
  element("#bulk-global-discount").textContent = `${settings.globalDiscount}%`;
  element("#bulk-default-minimum").textContent = `${settings.defaultMinimum} units`;
  element("#bulk-session-days").textContent = `${settings.sessionDays} days`;
  element("#bulk-intent-minutes").textContent = `${settings.intentMinutes} minutes`;
  const pending = stats.pendingRequests;
  const navCount = element<HTMLElement>("#bulk-orders-nav-count");
  navCount.textContent = String(pending);
  navCount.hidden = pending === 0;
  const labels: Record<string, string> = { settings_published: "Program settings published", rule_saved: "Product rule updated", rule_deleted: "Product rule reset", code_active: "Access code activated", code_paused: "Access code paused", code_revoked: "Access code revoked" };
  element("#bulk-activity-list").innerHTML = recentEvents.length ? recentEvents.slice(0, 8).map((event) => `<div class="bulk-activity-item"><span class="bulk-activity-icon">${event.eventType.includes("rule") ? "$" : event.eventType.includes("code") ? "#" : "✓"}</span><div><strong>${escapeHtml(labels[event.eventType] || event.eventType.replaceAll("_", " "))}</strong><small>${escapeHtml(event.actor)} · ${escapeHtml(event.entityType)} ${escapeHtml(event.entityId)}</small></div><small>${escapeHtml(ago(event.createdAt))}</small></div>`).join("") : '<div class="table-loading">New activity will appear here.</div>';
  const card = element("#bulk-migration-card");
  card.classList.toggle("is-complete", migration.imported);
  element("#bulk-migration-title").textContent = migration.imported ? "WordPress history imported" : "Ready to import the existing program";
  element("#bulk-migration-copy").textContent = migration.imported ? `Imported ${migration.sourceVersion || "legacy"} on ${formatDate(migration.importedAt)}. The custom database is now authoritative.` : "Rules, customer tiers and request history will be copied before the legacy plugin is disconnected.";
  const importButton = element<HTMLButtonElement>("#bulk-import-wordpress");
  importButton.textContent = migration.imported ? "Run import again" : "Import from WordPress";
  importButton.disabled = !canManage;
}

function catalogStatus(product: AdminCatalogProduct): { catalog: string; availability: string; pricing: string } {
  const rule = product.rule;
  return {
    catalog: rule?.catalogOverride === "exclude" ? "Hidden" : rule?.catalogOverride === "include" ? "Included" : "Program default",
    availability: rule?.availabilityOverride === "unavailable" ? "Unavailable" : rule?.availabilityOverride === "available" ? "Available" : "Stock controlled",
    pricing: rule?.pricingMode === "discount" ? `${rule.discountPercent}% off` : rule?.pricingMode === "fixed" ? `$${rule.fixedUnitPrice.toFixed(2)} / unit` : rule?.pricingMode === "tiered" ? `${rule.tiers.length} tiers` : `${workspace?.settings.globalDiscount || 0}% default`,
  };
}

function renderCatalog(): void {
  const search = element<HTMLInputElement>("#bulk-catalog-search").value.trim().toLowerCase();
  const visible = catalog.filter((product) => !search || `${product.name} ${product.sku}`.toLowerCase().includes(search));
  element("#bulk-catalog-body").innerHTML = visible.length ? visible.map((product) => {
    const status = catalogStatus(product);
    const stock = product.stockQuantity === null ? (product.stockStatus === "instock" ? "In stock" : "Out of stock") : `${product.stockQuantity} units`;
    return `<tr><td><div class="bulk-catalog-product">${product.image ? `<img src="${escapeHtml(product.image)}" alt="" loading="lazy" />` : `<span>${escapeHtml(product.name.charAt(0))}</span>`}<div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)} · ${product.variationId ? `Variation ${product.variationId}` : `Product ${product.productId}`}</small></div></div></td><td><span class="bulk-status ${product.stockStatus === "instock" ? "is-good" : "is-bad"}">${escapeHtml(stock)}</span></td><td><span class="bulk-status ${status.catalog === "Hidden" ? "is-bad" : "is-good"}">${escapeHtml(status.catalog)}</span></td><td><span class="bulk-status ${status.availability === "Unavailable" ? "is-warn" : "is-good"}">${escapeHtml(status.availability)}</span></td><td><strong>${escapeHtml(status.pricing)}</strong></td><td><button class="bulk-action-menu" type="button" data-edit-bulk-rule="${product.purchasableId}" ${canManage ? "" : "disabled"}>Configure</button></td></tr>`;
  }).join("") : '<tr><td colspan="6"><div class="table-loading">No product matches this search.</div></td></tr>';
}

function renderAccess(): void {
  if (!workspace) return;
  const pending = workspace.requests.filter((request) => request.status === "pending").length;
  element("#bulk-request-count").textContent = `${pending} pending`;
  element("#bulk-request-list").innerHTML = workspace.requests.length ? workspace.requests.slice(0, 30).map((item) => `<div class="bulk-request-item"><span class="bulk-activity-icon">${escapeHtml((item.customerName || item.customerEmail).charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(item.customerName || item.customerEmail)}</strong><small>${escapeHtml(item.customerEmail)} · ${item.completedOrders} completed order${item.completedOrders === 1 ? "" : "s"} · ${escapeHtml(item.status)}</small></div>${item.status === "pending" && canManage ? `<div class="bulk-item-actions"><button class="is-primary" type="button" data-bulk-request-action="approve" data-request-id="${item.id}">Approve</button><button type="button" data-bulk-request-action="reject" data-request-id="${item.id}">Reject</button></div>` : `<small>${escapeHtml(formatDate(item.reviewedAt || item.updatedAt))}</small>`}</div>`).join("") : '<div class="table-loading">No access requests yet.</div>';
  element("#bulk-code-list").innerHTML = workspace.codes.length ? workspace.codes.slice(0, 30).map((item) => `<div class="bulk-code-item"><span class="bulk-activity-icon">#</span><div><strong>•••• ${escapeHtml(item.codeSuffix)}</strong><small>${item.uses} use${item.uses === 1 ? "" : "s"} · ${escapeHtml(formatDate(item.expiresAt))} · ${escapeHtml(item.status)}</small></div>${canManage && item.status !== "legacy" && item.status !== "revoked" ? `<div class="bulk-item-actions"><button type="button" data-bulk-code-status="${item.status === "active" ? "paused" : "active"}" data-code-id="${item.id}">${item.status === "active" ? "Pause" : "Activate"}</button><button type="button" data-bulk-code-status="revoked" data-code-id="${item.id}">Revoke</button></div>` : `<small>${item.status === "legacy" ? "Replace code" : ""}</small>`}</div>`).join("") : '<div class="table-loading">No access codes yet.</div>';
  const activeTiers = workspace.tiers.filter((tier) => tier.status === "active");
  element("#bulk-tier-list").innerHTML = activeTiers.length ? activeTiers.map((tier) => `<div class="bulk-tier-item"><span class="bulk-activity-icon">✓</span><div><strong>${escapeHtml(tier.customerName || tier.customerEmail)}</strong><small>${escapeHtml(tier.customerEmail)} · Granted ${escapeHtml(formatDate(tier.grantedAt))}</small></div>${canManage ? `<div class="bulk-item-actions"><button type="button" data-revoke-bulk-tier="${tier.customerId}">Revoke</button></div>` : ""}</div>`).join("") : '<div class="table-loading">No customers have Special Bulk Tier yet.</div>';
}

function renderSettings(): void {
  if (!workspace) return;
  const settings = workspace.settings;
  element<HTMLInputElement>("#bulk-setting-title").value = settings.publicTitle;
  element<HTMLInputElement>("#bulk-setting-discount").value = String(settings.globalDiscount);
  element<HTMLInputElement>("#bulk-setting-minimum").value = String(settings.defaultMinimum);
  element<HTMLInputElement>("#bulk-setting-session").value = String(settings.sessionDays);
  element<HTMLInputElement>("#bulk-setting-intent").value = String(settings.intentMinutes);
  element<HTMLSelectElement>("#bulk-setting-catalog-mode").value = settings.catalogMode;
  element<HTMLTextAreaElement>("#bulk-setting-intro").value = settings.publicIntro;
  element<HTMLInputElement>("#bulk-setting-revision").value = String(settings.revision);
  for (const control of element<HTMLFormElement>("#bulk-settings-form").querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>("input,select,textarea,button")) control.disabled = !canManage;
}

function render(): void { renderOverview(); renderCatalog(); renderAccess(); renderSettings(); }

export async function loadBulkOrders(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const [workspacePayload, catalogPayload] = await Promise.all([request("/api/bulk-orders"), request("/api/bulk-orders/catalog")]);
    workspace = workspacePayload.workspace as unknown as BulkAdminWorkspace;
    canManage = workspacePayload.canManage === true;
    catalog = Array.isArray(catalogPayload.products) ? catalogPayload.products as unknown as AdminCatalogProduct[] : [];
    render();
  })().catch((error: unknown) => {
    toast("Bulk Orders delayed", error instanceof Error ? error.message : "Try refreshing again.", false);
  }).finally(() => { loading = null; });
  return loading;
}

function openRuleDialog(id: number): void {
  const product = catalog.find((item) => item.purchasableId === id);
  if (!product) return;
  const rule = product.rule;
  element("#bulk-rule-dialog-title").textContent = product.name;
  element("#bulk-rule-dialog-subtitle").textContent = `${product.sku} · $${product.price.toFixed(2)} retail`;
  element<HTMLInputElement>("#bulk-rule-purchasable").value = String(product.purchasableId);
  element<HTMLInputElement>("#bulk-rule-product").value = String(product.productId);
  element<HTMLInputElement>("#bulk-rule-variation").value = String(product.variationId);
  element<HTMLSelectElement>("#bulk-rule-catalog").value = rule?.catalogOverride || "inherit";
  element<HTMLSelectElement>("#bulk-rule-availability").value = rule?.availabilityOverride || "inherit";
  element<HTMLInputElement>("#bulk-rule-minimum").value = rule?.minimumQuantity ? String(rule.minimumQuantity) : "";
  element<HTMLInputElement>("#bulk-rule-maximum").value = rule?.maximumQuantity ? String(rule.maximumQuantity) : "";
  element<HTMLSelectElement>("#bulk-rule-mode").value = rule?.pricingMode || "inherit";
  element<HTMLInputElement>("#bulk-rule-discount").value = rule?.discountPercent ? String(rule.discountPercent) : "";
  element<HTMLInputElement>("#bulk-rule-fixed").value = rule?.fixedUnitPrice ? String(rule.fixedUnitPrice) : "";
  element<HTMLTextAreaElement>("#bulk-rule-tiers").value = rule?.tiers.map((tier) => `${tier.minimum}: ${tier.unitPrice.toFixed(2)}`).join("\n") || "";
  element<HTMLButtonElement>("#bulk-delete-rule").hidden = !rule;
  updateRuleFields();
  element<HTMLDialogElement>("#bulk-rule-dialog").showModal();
}

function updateRuleFields(): void {
  const mode = element<HTMLSelectElement>("#bulk-rule-mode").value;
  for (const row of document.querySelectorAll<HTMLElement>("[data-bulk-rule-field]")) row.hidden = row.dataset.bulkRuleField !== mode;
}

async function saveRule(): Promise<void> {
  const tiers = element<HTMLTextAreaElement>("#bulk-rule-tiers").value.split(/\r?\n/).map((line) => line.split(/\s*[:=,]\s*/)).filter((parts) => parts.length >= 2).map((parts) => ({ minimum: Number(parts[0]), unitPrice: Number(parts[1]) }));
  await request("/api/bulk-orders/rules", { method: "POST", body: JSON.stringify({
    purchasableId: Number(element<HTMLInputElement>("#bulk-rule-purchasable").value), productId: Number(element<HTMLInputElement>("#bulk-rule-product").value), variationId: Number(element<HTMLInputElement>("#bulk-rule-variation").value),
    catalogOverride: element<HTMLSelectElement>("#bulk-rule-catalog").value, availabilityOverride: element<HTMLSelectElement>("#bulk-rule-availability").value,
    minimumQuantity: element<HTMLInputElement>("#bulk-rule-minimum").value ? Number(element<HTMLInputElement>("#bulk-rule-minimum").value) : null,
    maximumQuantity: Number(element<HTMLInputElement>("#bulk-rule-maximum").value || 0), pricingMode: element<HTMLSelectElement>("#bulk-rule-mode").value,
    discountPercent: Number(element<HTMLInputElement>("#bulk-rule-discount").value || 0), fixedUnitPrice: Number(element<HTMLInputElement>("#bulk-rule-fixed").value || 0), tiers,
  }) });
  element<HTMLDialogElement>("#bulk-rule-dialog").close();
  toast("Bulk rule saved", "The private catalog now uses this SKU configuration.");
  await loadBulkOrders(true);
}

export function initBulkOrders(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-bulk-tab]")) button.addEventListener("click", () => setTab(button.dataset.bulkTab || "overview"));
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-open-bulk-tab]")) button.addEventListener("click", () => setTab(button.dataset.openBulkTab || "overview"));
  element<HTMLButtonElement>("#bulk-refresh").addEventListener("click", () => { void loadBulkOrders(true); });
  element<HTMLInputElement>("#bulk-catalog-search").addEventListener("input", renderCatalog);
  element("#bulk-catalog-body").addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-edit-bulk-rule]"); if (button) openRuleDialog(Number(button.dataset.editBulkRule)); });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-close-bulk-dialog]")) button.addEventListener("click", () => element<HTMLDialogElement>("#bulk-rule-dialog").close());
  element<HTMLSelectElement>("#bulk-rule-mode").addEventListener("change", updateRuleFields);
  element<HTMLFormElement>("#bulk-rule-form").addEventListener("submit", (event) => { event.preventDefault(); void saveRule().catch((error: unknown) => toast("Unable to save rule", error instanceof Error ? error.message : "Try again.", false)); });
  element<HTMLButtonElement>("#bulk-delete-rule").addEventListener("click", () => { const id = Number(element<HTMLInputElement>("#bulk-rule-purchasable").value); void request(`/api/bulk-orders/rules/${id}`, { method: "DELETE" }).then(() => { element<HTMLDialogElement>("#bulk-rule-dialog").close(); toast("Rule reset", "This SKU now inherits the program defaults."); return loadBulkOrders(true); }).catch((error: unknown) => toast("Unable to reset rule", error instanceof Error ? error.message : "Try again.", false)); });
  element<HTMLFormElement>("#bulk-settings-form").addEventListener("submit", (event) => { event.preventDefault(); void request("/api/bulk-orders/settings", { method: "POST", body: JSON.stringify({ expectedRevision: Number(element<HTMLInputElement>("#bulk-setting-revision").value), publicTitle: element<HTMLInputElement>("#bulk-setting-title").value, globalDiscount: Number(element<HTMLInputElement>("#bulk-setting-discount").value), defaultMinimum: Number(element<HTMLInputElement>("#bulk-setting-minimum").value), sessionDays: Number(element<HTMLInputElement>("#bulk-setting-session").value), intentMinutes: Number(element<HTMLInputElement>("#bulk-setting-intent").value), catalogMode: element<HTMLSelectElement>("#bulk-setting-catalog-mode").value, publicIntro: element<HTMLTextAreaElement>("#bulk-setting-intro").value }) }).then(() => { toast("Bulk settings published", "New quotes use the updated policy immediately."); return loadBulkOrders(true); }).catch((error: unknown) => toast("Unable to publish", error instanceof Error ? error.message : "Try again.", false)); });
  const openCode = () => { element<HTMLFormElement>("#bulk-code-form").reset(); element("#bulk-generated-code").hidden = true; element<HTMLButtonElement>("#bulk-create-code-submit").hidden = false; element<HTMLDialogElement>("#bulk-code-dialog").showModal(); };
  element<HTMLButtonElement>("#bulk-new-code").addEventListener("click", openCode);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-bulk-create-code]")) button.addEventListener("click", openCode);
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-close-bulk-code]")) button.addEventListener("click", () => element<HTMLDialogElement>("#bulk-code-dialog").close());
  element<HTMLFormElement>("#bulk-code-form").addEventListener("submit", (event) => { event.preventDefault(); void request("/api/bulk-orders/codes", { method: "POST", body: JSON.stringify({ expiresAt: element<HTMLInputElement>("#bulk-code-expires").value ? new Date(element<HTMLInputElement>("#bulk-code-expires").value).toISOString() : null, usageLimit: Number(element<HTMLInputElement>("#bulk-code-limit").value || 0) || null, notes: element<HTMLTextAreaElement>("#bulk-code-notes").value }) }).then((payload) => { element("#bulk-generated-code").hidden = false; element("#bulk-generated-code-value").textContent = String(payload.code || ""); element<HTMLButtonElement>("#bulk-create-code-submit").hidden = true; void loadBulkOrders(true); }).catch((error: unknown) => toast("Unable to create code", error instanceof Error ? error.message : "Try again.", false)); });
  element<HTMLButtonElement>("#bulk-copy-code").addEventListener("click", () => { void navigator.clipboard.writeText(element("#bulk-generated-code-value").textContent || "").then(() => toast("Code copied", "The access code is ready to share securely.")); });
  element("#bulk-request-list").addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-bulk-request-action]"); if (!button) return; void request(`/api/bulk-orders/requests/${button.dataset.requestId}`, { method: "POST", body: JSON.stringify({ operation: button.dataset.bulkRequestAction }) }).then(() => { toast(button.dataset.bulkRequestAction === "approve" ? "Access approved" : "Request updated", "The customer access state changed immediately."); return loadBulkOrders(true); }).catch((error: unknown) => toast("Unable to update request", error instanceof Error ? error.message : "Try again.", false)); });
  element("#bulk-code-list").addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-bulk-code-status]"); if (!button) return; void request(`/api/bulk-orders/codes/${button.dataset.codeId}`, { method: "POST", body: JSON.stringify({ status: button.dataset.bulkCodeStatus }) }).then(() => loadBulkOrders(true)).catch((error: unknown) => toast("Unable to update code", error instanceof Error ? error.message : "Try again.", false)); });
  element("#bulk-tier-list").addEventListener("click", (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-revoke-bulk-tier]"); if (!button) return; void request(`/api/bulk-orders/tiers/${button.dataset.revokeBulkTier}/revoke`, { method: "POST", body: "{}" }).then(() => { toast("Special Tier revoked", "Existing account-bound sessions were closed."); return loadBulkOrders(true); }).catch((error: unknown) => toast("Unable to revoke tier", error instanceof Error ? error.message : "Try again.", false)); });
  element<HTMLButtonElement>("#bulk-import-wordpress").addEventListener("click", () => { const button = element<HTMLButtonElement>("#bulk-import-wordpress"); button.disabled = true; button.textContent = "Importing…"; void request("/api/bulk-orders/migrate-wordpress", { method: "POST", body: "{}" }).then(() => { toast("WordPress program imported", "The custom Bulk Orders database is ready."); return loadBulkOrders(true); }).catch((error: unknown) => toast("Import could not finish", error instanceof Error ? error.message : "Try again.", false)).finally(() => { button.disabled = false; }); });
}
