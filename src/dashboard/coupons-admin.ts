type CouponDiscountType = "percent" | "fixed_cart" | "fixed_product";
type CouponStatus = "active" | "paused" | "expired";

interface CouponRecord {
  id: number;
  code: string;
  description: string;
  discountType: CouponDiscountType;
  amount: number;
  status: CouponStatus;
  expiresAt: string | null;
  usageCount: number;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  limitUsageToXItems: number | null;
  individualUse: boolean;
  freeShipping: boolean;
  excludeSaleItems: boolean;
  minimumAmount: number | null;
  maximumAmount: number | null;
  productIds: number[];
  excludedProductIds: number[];
  categoryIds: number[];
  excludedCategoryIds: number[];
  emailRestrictions: string[];
  createdAt: string | null;
  modifiedAt: string | null;
}

interface CouponOption {
  id: number;
  name: string;
  sku?: string;
  count?: number;
}

interface CouponDirectoryResponse {
  connected: boolean;
  writeEnabled: boolean;
  coupons: CouponRecord[];
  products: CouponOption[];
  categories: CouponOption[];
  syncedAt: string;
  error?: string;
}

let directory: CouponDirectoryResponse | null = null;
let loading = false;
let initialized = false;

function element<T extends HTMLElement>(id: string): T {
  const match = document.getElementById(id);
  if (!match) throw new Error(`Missing coupon control #${id}`);
  return match as T;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  })[character] || character);
}

function numberText(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function shortDate(value: string | null): string {
  if (!value) return "No expiration";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No expiration";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function typeLabel(type: CouponDiscountType): string {
  if (type === "fixed_cart") return "Fixed order discount";
  if (type === "fixed_product") return "Fixed product discount";
  return "Percentage discount";
}

function discountLabel(coupon: CouponRecord): string {
  return coupon.discountType === "percent" ? `${coupon.amount}% off` : `${money(coupon.amount)} off`;
}

function statusLabel(status: CouponStatus): string {
  if (status === "expired") return "Expired";
  if (status === "paused") return "Paused";
  return "Active";
}

function showNotice(message: string, state: "info" | "success" | "error" = "info"): void {
  const notice = element<HTMLElement>("coupon-form-notice");
  notice.textContent = message;
  notice.dataset.state = state;
}

function optionMarkup(option: CouponOption, kind: "product" | "category"): string {
  const detail = kind === "product" && option.sku
    ? ` · ${option.sku}`
    : kind === "category" && typeof option.count === "number"
      ? ` · ${numberText(option.count)} products`
      : "";
  return `<option value="${option.id}">${escapeHtml(option.name)}${escapeHtml(detail)}</option>`;
}

function populateRestrictions(): void {
  if (!directory) return;
  const productOptions = directory.products
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((option) => optionMarkup(option, "product"))
    .join("");
  const categoryOptions = directory.categories
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((option) => optionMarkup(option, "category"))
    .join("");
  element<HTMLSelectElement>("coupon-product-ids").innerHTML = productOptions;
  element<HTMLSelectElement>("coupon-excluded-product-ids").innerHTML = productOptions;
  element<HTMLSelectElement>("coupon-category-ids").innerHTML = categoryOptions;
  element<HTMLSelectElement>("coupon-excluded-category-ids").innerHTML = categoryOptions;
}

function couponRules(coupon: CouponRecord): string[] {
  const rules: string[] = [];
  if (coupon.minimumAmount !== null) rules.push(`Min ${money(coupon.minimumAmount)}`);
  if (coupon.maximumAmount !== null) rules.push(`Max ${money(coupon.maximumAmount)}`);
  if (coupon.individualUse) rules.push("No stacking");
  if (coupon.freeShipping) rules.push("Free shipping");
  if (coupon.excludeSaleItems) rules.push("No sale items");
  const productRules = coupon.productIds.length + coupon.excludedProductIds.length;
  const categoryRules = coupon.categoryIds.length + coupon.excludedCategoryIds.length;
  if (productRules) rules.push(`${productRules} product rule${productRules === 1 ? "" : "s"}`);
  if (categoryRules) rules.push(`${categoryRules} category rule${categoryRules === 1 ? "" : "s"}`);
  if (coupon.emailRestrictions.length) rules.push(`${coupon.emailRestrictions.length} customer rule${coupon.emailRestrictions.length === 1 ? "" : "s"}`);
  return rules.slice(0, 4);
}

function couponCard(coupon: CouponRecord): string {
  const usage = coupon.usageLimit === null
    ? `${numberText(coupon.usageCount)} uses`
    : `${numberText(coupon.usageCount)} / ${numberText(coupon.usageLimit)} uses`;
  const rules = couponRules(coupon);
  return `<article class="coupon-directory-row" data-coupon-row="${coupon.id}">
    <div class="coupon-directory-value"><strong>${escapeHtml(discountLabel(coupon))}</strong><small>${escapeHtml(typeLabel(coupon.discountType))}</small></div>
    <div class="coupon-directory-copy"><div><code>${escapeHtml(coupon.code)}</code><span class="coupon-status coupon-status--${coupon.status}">${statusLabel(coupon.status)}</span></div><p>${escapeHtml(coupon.description || "No internal description")}</p><footer><span>${escapeHtml(usage)}</span><span>${escapeHtml(shortDate(coupon.expiresAt))}</span>${rules.map((rule) => `<span>${escapeHtml(rule)}</span>`).join("")}</footer></div>
    <div class="coupon-directory-actions"><button type="button" data-coupon-edit="${coupon.id}">Edit</button><button type="button" data-coupon-duplicate="${coupon.id}">Duplicate</button><button type="button" data-coupon-status="${coupon.id}" data-active="${coupon.status !== "active"}">${coupon.status === "active" ? "Pause" : "Activate"}</button></div>
  </article>`;
}

function filteredCoupons(): CouponRecord[] {
  if (!directory) return [];
  const query = element<HTMLInputElement>("coupon-search").value.trim().toLowerCase();
  const status = element<HTMLSelectElement>("coupon-status-filter").value;
  return directory.coupons.filter((coupon) => {
    const matchesQuery = !query || `${coupon.code} ${coupon.description}`.toLowerCase().includes(query);
    const matchesStatus = status === "all" || coupon.status === status;
    return matchesQuery && matchesStatus;
  });
}

function renderDirectory(): void {
  const list = element<HTMLElement>("coupon-directory-list");
  if (!directory) return;
  const coupons = filteredCoupons();
  const active = directory.coupons.filter((coupon) => coupon.status === "active").length;
  const uses = directory.coupons.reduce((total, coupon) => total + coupon.usageCount, 0);
  const attention = directory.coupons.length - active;
  element<HTMLElement>("coupon-kpi-total").textContent = numberText(directory.coupons.length);
  element<HTMLElement>("coupon-kpi-active").textContent = numberText(active);
  element<HTMLElement>("coupon-kpi-uses").textContent = numberText(uses);
  element<HTMLElement>("coupon-kpi-attention").textContent = numberText(attention);
  const navCount = element<HTMLElement>("coupons-nav-count");
  navCount.textContent = numberText(active);
  navCount.hidden = active <= 0;
  element<HTMLElement>("coupon-directory-summary").textContent = coupons.length === directory.coupons.length
    ? `${numberText(coupons.length)} coupons synchronized with checkout`
    : `${numberText(coupons.length)} of ${numberText(directory.coupons.length)} coupons shown`;
  list.innerHTML = coupons.length
    ? coupons.map(couponCard).join("")
    : `<div class="coupon-empty"><span>％</span><strong>No coupons found</strong><p>Create a new checkout code or change the current filters.</p></div>`;
  const sync = element<HTMLElement>("coupon-sync-state");
  sync.classList.toggle("is-readonly", !directory.writeEnabled);
  sync.querySelector("b")!.textContent = directory.writeEnabled ? "Live store" : "View only";
  sync.querySelector("small")!.textContent = directory.writeEnabled ? "Synchronized now" : "Write access is disabled";
}

function setSelected(id: string, values: number[]): void {
  const selected = new Set(values.map(String));
  for (const option of element<HTMLSelectElement>(id).options) option.selected = selected.has(option.value);
}

function selectedValues(id: string): number[] {
  return Array.from(element<HTMLSelectElement>(id).selectedOptions)
    .map((option) => Number(option.value))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
}

function setOptionalNumber(id: string, value: number | null): void {
  element<HTMLInputElement>(id).value = value === null ? "" : String(value);
}

function syncAmountControl(): void {
  const type = element<HTMLSelectElement>("coupon-discount-type").value;
  const amount = element<HTMLInputElement>("coupon-amount");
  element<HTMLElement>("coupon-amount-prefix").textContent = type === "percent" ? "%" : "$";
  amount.max = type === "percent" ? "100" : "1000000";
}

function resetEditor(focus = false): void {
  element<HTMLFormElement>("coupon-editor-form").reset();
  element<HTMLInputElement>("coupon-id").value = "";
  element<HTMLSelectElement>("coupon-status").value = "active";
  element<HTMLSelectElement>("coupon-discount-type").value = "percent";
  element<HTMLElement>("coupon-editor-kicker").textContent = "NEW COUPON";
  element<HTMLElement>("coupon-editor-title").textContent = "Create a checkout code";
  element<HTMLElement>("coupon-editor-copy").textContent = "Set the discount and only add restrictions when needed.";
  element<HTMLButtonElement>("coupon-save").textContent = "Create coupon";
  showNotice("This coupon will be saved directly to the live checkout.");
  syncAmountControl();
  document.querySelectorAll<HTMLElement>("[data-coupon-row]").forEach((row) => row.classList.remove("is-selected"));
  element<HTMLElement>("coupon-editor-card").classList.add("is-editor-open");
  if (focus) {
    element<HTMLElement>("coupon-editor-card").scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => element<HTMLInputElement>("coupon-code").focus(), 250);
  }
}

function fillEditor(coupon: CouponRecord, duplicate = false): void {
  resetEditor(false);
  const copiedCode = `${coupon.code.replace(/-COPY-?\d*$/i, "")}-COPY-${Math.floor(10 + Math.random() * 90)}`.slice(0, 120);
  element<HTMLInputElement>("coupon-id").value = duplicate ? "" : String(coupon.id);
  element<HTMLInputElement>("coupon-code").value = duplicate ? copiedCode : coupon.code;
  element<HTMLInputElement>("coupon-description").value = coupon.description;
  element<HTMLSelectElement>("coupon-discount-type").value = coupon.discountType;
  element<HTMLInputElement>("coupon-amount").value = String(coupon.amount);
  element<HTMLSelectElement>("coupon-status").value = coupon.status === "active" ? "active" : "paused";
  element<HTMLInputElement>("coupon-expires-at").value = coupon.expiresAt?.slice(0, 10) || "";
  setOptionalNumber("coupon-minimum", coupon.minimumAmount);
  setOptionalNumber("coupon-maximum", coupon.maximumAmount);
  setOptionalNumber("coupon-usage-limit", coupon.usageLimit);
  setOptionalNumber("coupon-user-limit", coupon.usageLimitPerUser);
  setOptionalNumber("coupon-item-limit", coupon.limitUsageToXItems);
  element<HTMLInputElement>("coupon-individual-use").checked = coupon.individualUse;
  element<HTMLInputElement>("coupon-free-shipping").checked = coupon.freeShipping;
  element<HTMLInputElement>("coupon-exclude-sale").checked = coupon.excludeSaleItems;
  setSelected("coupon-product-ids", coupon.productIds);
  setSelected("coupon-excluded-product-ids", coupon.excludedProductIds);
  setSelected("coupon-category-ids", coupon.categoryIds);
  setSelected("coupon-excluded-category-ids", coupon.excludedCategoryIds);
  element<HTMLTextAreaElement>("coupon-email-restrictions").value = coupon.emailRestrictions.join("\n");
  element<HTMLElement>("coupon-editor-kicker").textContent = duplicate ? "DUPLICATE COUPON" : "EDIT LIVE COUPON";
  element<HTMLElement>("coupon-editor-title").textContent = duplicate ? `Copy ${coupon.code}` : coupon.code;
  element<HTMLElement>("coupon-editor-copy").textContent = duplicate
    ? "Review the new code before creating this independent copy."
    : `Used ${numberText(coupon.usageCount)} time${coupon.usageCount === 1 ? "" : "s"}. Changes apply to checkout immediately.`;
  element<HTMLButtonElement>("coupon-save").textContent = duplicate ? "Create copy" : "Save changes";
  showNotice(duplicate ? "The original coupon will not be changed." : "Saving updates this coupon directly in the live checkout.");
  syncAmountControl();
  if (!duplicate) document.querySelector<HTMLElement>(`[data-coupon-row="${coupon.id}"]`)?.classList.add("is-selected");
  element<HTMLElement>("coupon-editor-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function optionalNumber(id: string): number | null {
  const value = element<HTMLInputElement>(id).value.trim();
  return value ? Number(value) : null;
}

function formPayload(): Record<string, unknown> {
  return {
    code: element<HTMLInputElement>("coupon-code").value,
    description: element<HTMLInputElement>("coupon-description").value,
    discountType: element<HTMLSelectElement>("coupon-discount-type").value,
    amount: Number(element<HTMLInputElement>("coupon-amount").value),
    status: element<HTMLSelectElement>("coupon-status").value,
    expiresAt: element<HTMLInputElement>("coupon-expires-at").value || null,
    minimumAmount: optionalNumber("coupon-minimum"),
    maximumAmount: optionalNumber("coupon-maximum"),
    usageLimit: optionalNumber("coupon-usage-limit"),
    usageLimitPerUser: optionalNumber("coupon-user-limit"),
    limitUsageToXItems: optionalNumber("coupon-item-limit"),
    individualUse: element<HTMLInputElement>("coupon-individual-use").checked,
    freeShipping: element<HTMLInputElement>("coupon-free-shipping").checked,
    excludeSaleItems: element<HTMLInputElement>("coupon-exclude-sale").checked,
    productIds: selectedValues("coupon-product-ids"),
    excludedProductIds: selectedValues("coupon-excluded-product-ids"),
    categoryIds: selectedValues("coupon-category-ids"),
    excludedCategoryIds: selectedValues("coupon-excluded-category-ids"),
    emailRestrictions: element<HTMLTextAreaElement>("coupon-email-restrictions").value.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean),
  };
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function saveCoupon(): Promise<void> {
  if (!directory?.writeEnabled) {
    showNotice("Coupon write access is not enabled for the live store.", "error");
    return;
  }
  const id = Number(element<HTMLInputElement>("coupon-id").value) || null;
  const button = element<HTMLButtonElement>("coupon-save");
  button.disabled = true;
  button.textContent = id ? "Saving…" : "Creating…";
  showNotice("Synchronizing the coupon with checkout…");
  try {
    const response = await fetch(id ? `/api/coupons/${id}` : "/api/coupons", {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formPayload()),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The coupon could not be saved.");
    const coupon = payload.coupon as CouponRecord | undefined;
    showNotice(`${coupon?.code || "Coupon"} is live and synchronized with checkout.`, "success");
    await loadCoupons();
    if (coupon) fillEditor(coupon);
  } catch (error: unknown) {
    showNotice(error instanceof Error ? error.message : "The coupon could not be saved.", "error");
  } finally {
    button.disabled = false;
    button.textContent = id ? "Save changes" : "Create coupon";
  }
}

async function changeCouponStatus(coupon: CouponRecord, active: boolean): Promise<void> {
  const action = active ? "Activating" : "Pausing";
  showNotice(`${action} ${coupon.code} in checkout…`);
  try {
    const response = await fetch(`/api/coupons/${coupon.id}/status`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active, clearExpiredDate: active && coupon.status === "expired" }),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The status could not be changed.");
    await loadCoupons();
    showNotice(`${coupon.code} is now ${active ? "active" : "paused"}.`, "success");
  } catch (error: unknown) {
    showNotice(error instanceof Error ? error.message : "The status could not be changed.", "error");
  }
}

export async function loadCoupons(): Promise<void> {
  if (loading) return;
  loading = true;
  const list = element<HTMLElement>("coupon-directory-list");
  if (!directory) list.innerHTML = `<div class="table-loading">Synchronizing coupons…</div>`;
  try {
    const response = await fetch("/api/coupons", { credentials: "same-origin", cache: "no-store" });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Coupons could not be loaded.");
    if (!Array.isArray(payload.coupons) || !Array.isArray(payload.products) || !Array.isArray(payload.categories)) {
      throw new Error("The live coupon service did not return a valid directory.");
    }
    directory = payload as unknown as CouponDirectoryResponse;
    populateRestrictions();
    renderDirectory();
    element<HTMLButtonElement>("coupon-save").disabled = !directory.writeEnabled;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Coupons could not be loaded.";
    list.innerHTML = `<div class="coupon-empty coupon-empty--error"><span>!</span><strong>Coupon directory unavailable</strong><p>${escapeHtml(message)}</p><button type="button" id="coupon-retry">Try again</button></div>`;
    document.getElementById("coupon-retry")?.addEventListener("click", () => { void loadCoupons(); }, { once: true });
  } finally {
    loading = false;
  }
}

export function initCouponAdmin(): void {
  if (initialized) return;
  initialized = true;
  element<HTMLButtonElement>("coupon-refresh").addEventListener("click", () => { void loadCoupons(); });
  element<HTMLButtonElement>("coupon-create").addEventListener("click", () => resetEditor(true));
  element<HTMLButtonElement>("coupon-reset").addEventListener("click", () => resetEditor());
  element<HTMLButtonElement>("coupon-editor-close").addEventListener("click", () => {
    resetEditor();
    element<HTMLElement>("coupon-editor-card").classList.remove("is-editor-open");
  });
  element<HTMLButtonElement>("coupon-generate-code").addEventListener("click", () => {
    const stamp = new Date().toLocaleString("en-US", { month: "short" }).replace(/[^a-z]/gi, "").toUpperCase();
    element<HTMLInputElement>("coupon-code").value = `${stamp}${Math.floor(1000 + Math.random() * 9000)}`;
    element<HTMLInputElement>("coupon-code").focus();
  });
  element<HTMLSelectElement>("coupon-discount-type").addEventListener("change", syncAmountControl);
  element<HTMLInputElement>("coupon-search").addEventListener("input", renderDirectory);
  element<HTMLSelectElement>("coupon-status-filter").addEventListener("change", renderDirectory);
  element<HTMLFormElement>("coupon-editor-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveCoupon();
  });
  element<HTMLElement>("coupon-directory-list").addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
    if (!target || !directory) return;
    const editId = Number(target.dataset.couponEdit);
    const duplicateId = Number(target.dataset.couponDuplicate);
    const statusId = Number(target.dataset.couponStatus);
    const coupon = directory.coupons.find((item) => item.id === (editId || duplicateId || statusId));
    if (!coupon) return;
    if (editId) fillEditor(coupon);
    else if (duplicateId) fillEditor(coupon, true);
    else if (statusId) void changeCouponStatus(coupon, target.dataset.active === "true");
  });
  syncAmountControl();
}
