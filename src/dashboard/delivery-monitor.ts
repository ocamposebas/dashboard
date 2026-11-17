import type {
  DeliveryMonitorItem,
  DeliveryMonitorPayload,
  DeliveryMonitorStatus,
} from "../shared/deliveryMonitor";

type DeliveryFilter = "attention" | "active" | "delivered" | "all";

let payload: DeliveryMonitorPayload | undefined;
let loading = false;
let filter: DeliveryFilter = "attention";
let search = "";

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing delivery monitor element: ${selector}`);
  return found;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] || character);
}

function formatDate(value: string | null): string {
  if (!value) return "Not reported";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not reported";
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function relativeDate(value: string | null): string {
  if (!value) return "Waiting for first check";
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  return formatDate(value);
}

function statusLabel(status: DeliveryMonitorStatus): string {
  return {
    label_created: "Awaiting first scan",
    in_transit: "In transit",
    delivery_attempt: "Delivery attempted",
    exception: "Carrier exception",
    delivered: "Delivered",
    unknown: "Carrier pending",
  }[status];
}

function trackingUrl(item: DeliveryMonitorItem): string {
  const tracking = encodeURIComponent(item.trackingNumber);
  const carrier = item.carrierCode.toLowerCase();
  if (carrier.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
  if (carrier.includes("ups")) return `https://www.ups.com/track?tracknum=${tracking}`;
  if (carrier.includes("usps") || carrier.includes("stamps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`track ${item.trackingNumber}`)}`;
}

function attention(item: DeliveryMonitorItem): boolean {
  return item.delayed || item.status === "exception" || item.status === "delivery_attempt";
}

function visibleItems(): DeliveryMonitorItem[] {
  const query = search.trim().toLocaleLowerCase("en");
  return (payload?.items || []).filter((item) => {
    const matchesFilter = filter === "all" ||
      (filter === "attention" && attention(item)) ||
      (filter === "active" && item.status !== "delivered") ||
      (filter === "delivered" && item.status === "delivered");
    const matchesSearch = !query || `${item.orderNumber} ${item.customerName} ${item.trackingNumber} ${item.carrierCode}`
      .toLocaleLowerCase("en").includes(query);
    return matchesFilter && matchesSearch;
  });
}

function renderItem(item: DeliveryMonitorItem): string {
  const isAttention = attention(item);
  const tone = item.status === "delivered" ? "delivered" : isAttention ? "critical" : "active";
  const headline = item.status === "exception"
    ? item.exceptionDescription || item.statusDescription || "Carrier exception"
    : item.delayed
      ? `${item.daysInTransit} days without delivery confirmation`
      : item.lastEventDescription || item.statusDescription || statusLabel(item.status);
  const event = item.lastEventDescription
    ? `${item.lastEventDescription}${item.lastEventAt ? ` · ${formatDate(item.lastEventAt)}` : ""}`
    : item.lastCheckError || "Waiting for the next carrier event";
  return `<article class="delivery-row is-${tone}${item.acknowledgedAt ? " is-acknowledged" : ""}" data-delivery-label="${escapeHtml(item.labelId)}">
    <span class="delivery-row-signal">${item.status === "delivered" ? "✓" : isAttention ? "!" : "→"}</span>
    <div class="delivery-row-order"><small>ORDER</small><strong>#${escapeHtml(item.orderNumber)}</strong><span>${escapeHtml(item.customerName || "Customer")}</span></div>
    <div class="delivery-row-status"><span class="delivery-status-chip">${escapeHtml(statusLabel(item.status))}</span><strong>${escapeHtml(headline)}</strong><small>${escapeHtml(event)}</small></div>
    <div class="delivery-row-days"><small>IN TRANSIT</small><strong>${item.daysInTransit}</strong><span>${item.daysInTransit === 1 ? "day" : "days"}</span></div>
    <div class="delivery-row-tracking"><small>${escapeHtml(item.carrierCode || "CARRIER")}</small><strong>${escapeHtml(item.trackingNumber)}</strong><a href="${escapeHtml(trackingUrl(item))}" target="_blank" rel="noopener noreferrer">Track package ↗</a></div>
    <div class="delivery-row-actions">${isAttention && !item.acknowledgedAt ? `<button type="button" data-delivery-ack="${escapeHtml(item.labelId)}">Mark reviewed</button>` : item.acknowledgedAt ? `<span>✓ Reviewed</span>` : ""}</div>
  </article>`;
}

function render(): void {
  if (!payload) return;
  const { summary, settings, owners, recipient } = payload;
  const critical = payload.items.filter(attention).length;
  element<HTMLElement>("#delivery-stat-attention").textContent = String(critical);
  element<HTMLElement>("#delivery-stat-transit").textContent = String(summary.inTransit);
  element<HTMLElement>("#delivery-stat-unscanned").textContent = String(summary.awaitingScan);
  element<HTMLElement>("#delivery-stat-delivered").textContent = String(summary.delivered);
  element<HTMLElement>("#delivery-last-check").textContent = relativeDate(settings.lastRunAt);

  const navCount = element<HTMLElement>("#delivery-nav-count");
  navCount.textContent = String(critical);
  navCount.hidden = critical === 0;

  const alertStrip = element<HTMLElement>("#delivery-alert-strip");
  alertStrip.classList.toggle("has-alerts", critical > 0);
  alertStrip.innerHTML = critical > 0
    ? `<span>!</span><div><strong>${critical} shipment${critical === 1 ? "" : "s"} need attention</strong><p>${summary.exceptions ? `${summary.exceptions} carrier exception${summary.exceptions === 1 ? "" : "s"}. ` : ""}${summary.delayed ? `${summary.delayed} passed the ${settings.delayDays}-day limit.` : ""}</p></div>`
    : '<span>✓</span><div><strong>No delivery emergencies detected</strong><p>The carrier queue is currently inside the configured limit.</p></div>';

  const list = element<HTMLElement>("#delivery-list");
  const items = visibleItems();
  list.innerHTML = items.length
    ? items.map(renderItem).join("")
    : '<div class="delivery-empty"><span>✓</span><strong>No shipments in this view</strong><p>Try another filter or search.</p></div>';

  const ownerSelect = element<HTMLSelectElement>("#delivery-owner-recipient");
  ownerSelect.innerHTML = owners.length
    ? owners.map((owner) => `<option value="${escapeHtml(owner.id)}"${owner.id === (settings.recipientUserId || recipient?.id) ? " selected" : ""}>${escapeHtml(owner.displayName)}</option>`).join("")
    : '<option value="">No active owner with email</option>';
  element<HTMLInputElement>("#delivery-delay-days").value = String(settings.delayDays);
  element<HTMLInputElement>("#delivery-email-enabled").checked = settings.emailEnabled;
  element<HTMLElement>("#delivery-owner-email").textContent = recipient
    ? `Alerts go only to ${recipient.email}.`
    : "Add an email to an active owner account before enabling alerts.";
  const form = element<HTMLFormElement>("#delivery-settings-form");
  for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
    control.disabled = !payload.writable;
  }
  element<HTMLButtonElement>("#delivery-settings-save").textContent = payload.writable
    ? "Save owner alerts"
    : "Administrator access required";

  const state = element<HTMLElement>("#delivery-live-state");
  state.classList.toggle("is-warning", Boolean(settings.lastRunError));
  state.title = settings.lastRunError || "Carrier tracking is connected";
}

async function requestPayload(url: string, init?: RequestInit): Promise<DeliveryMonitorPayload> {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const result: unknown = await response.json();
  if (!response.ok || !result || typeof result !== "object" || !("items" in result)) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error
      : "Delivery monitoring could not be loaded";
    throw new Error(message);
  }
  return result as DeliveryMonitorPayload;
}

export async function loadDeliveryMonitor(silent = false): Promise<void> {
  if (loading) return;
  loading = true;
  const refresh = element<HTMLButtonElement>("#delivery-refresh");
  if (!silent) {
    refresh.disabled = true;
    refresh.textContent = "Checking carriers…";
  }
  try {
    payload = await requestPayload("/api/delivery-monitor");
    render();
  } catch (error) {
    element<HTMLElement>("#delivery-list").innerHTML = `<div class="delivery-empty is-error"><span>!</span><strong>Delivery monitor unavailable</strong><p>${escapeHtml(error instanceof Error ? error.message : "Try again shortly.")}</p></div>`;
  } finally {
    loading = false;
    refresh.disabled = false;
    refresh.textContent = "Refresh tracking";
  }
}

async function refreshTracking(): Promise<void> {
  if (loading) return;
  loading = true;
  const button = element<HTMLButtonElement>("#delivery-refresh");
  button.disabled = true;
  button.textContent = "Checking carriers…";
  try {
    payload = await requestPayload("/api/delivery-monitor/refresh", { method: "POST", body: "{}" });
    render();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "Carrier tracking could not be refreshed");
  } finally {
    loading = false;
    button.disabled = false;
    button.textContent = "Refresh tracking";
  }
}

export function initDeliveryMonitor(): void {
  element<HTMLButtonElement>("#delivery-refresh").addEventListener("click", () => void refreshTracking());
  element<HTMLInputElement>("#delivery-search").addEventListener("input", (event) => {
    search = (event.currentTarget as HTMLInputElement).value;
    if (payload) render();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-delivery-filter]")) {
    button.addEventListener("click", () => {
      filter = (button.dataset.deliveryFilter || "attention") as DeliveryFilter;
      for (const candidate of document.querySelectorAll<HTMLButtonElement>("[data-delivery-filter]")) {
        candidate.classList.toggle("is-active", candidate === button);
      }
      if (payload) render();
    });
  }
  element<HTMLSelectElement>("#delivery-owner-recipient").addEventListener("change", (event) => {
    const selected = payload?.owners.find((owner) => owner.id === (event.currentTarget as HTMLSelectElement).value);
    element<HTMLElement>("#delivery-owner-email").textContent = selected
      ? `Alerts go only to ${selected.email}.`
      : "Choose an active owner account.";
  });
  element<HTMLFormElement>("#delivery-settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const save = element<HTMLButtonElement>("#delivery-settings-save");
    save.disabled = true;
    save.textContent = "Saving…";
    try {
      payload = await requestPayload("/api/delivery-monitor/settings", {
        method: "PUT",
        body: JSON.stringify({
          delayDays: Number(element<HTMLInputElement>("#delivery-delay-days").value),
          recipientUserId: element<HTMLSelectElement>("#delivery-owner-recipient").value || null,
          emailEnabled: element<HTMLInputElement>("#delivery-email-enabled").checked,
        }),
      });
      render();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Owner alerts could not be saved");
    } finally {
      save.disabled = !payload?.writable;
      save.textContent = payload?.writable ? "Save owner alerts" : "Administrator access required";
    }
  });
  element<HTMLElement>("#delivery-list").addEventListener("click", async (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-delivery-ack]")
      : null;
    if (!button?.dataset.deliveryAck) return;
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const response = await fetch(`/api/delivery-monitor/${encodeURIComponent(button.dataset.deliveryAck)}/acknowledge`, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("The delivery alert could not be acknowledged");
      await loadDeliveryMonitor(true);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Mark reviewed";
      window.alert(error instanceof Error ? error.message : "The delivery alert could not be acknowledged");
    }
  });
}
