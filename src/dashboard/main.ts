import "./styles.css";
import {
  PRESENCE_SECTIONS,
  emptyPresenceCounts,
  type PresenceCounts,
  type PresenceSection,
  type PresenceSnapshot,
} from "../shared/protocol";

const sectionLabels: Record<PresenceSection, string> = {
  HOME: "Home",
  SHOP: "Shop",
  PRODUCT: "Product",
  CART: "Cart",
  CHECKOUT: "Checkout",
  OTHER: "Other",
};

const sectionDescriptions: Record<PresenceSection, string> = {
  HOME: "Landing experience",
  SHOP: "Catalog browsing",
  PRODUCT: "Product detail",
  CART: "Cart drawer open",
  CHECKOUT: "Order flow",
  OTHER: "Supporting pages",
};

function requiredElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing dashboard element: ${selector}`);
  return element;
}

const grid = requiredElement<HTMLElement>("#section-grid");
const totalElement = requiredElement<HTMLElement>("#total");
const updatedElement = requiredElement<HTMLElement>("#updated");
const footerUpdated = requiredElement<HTMLElement>("#footer-updated");
const connectionElement = requiredElement<HTMLElement>("#connection");
const connectionLabel = requiredElement<HTMLElement>("#connection-label");
const footerConnection = requiredElement<HTMLElement>("#footer-connection");
const announcement = requiredElement<HTMLElement>("#announcement");
const totalViewsElement = requiredElement<HTMLElement>("#total-views");
const uniqueVisitorsElement = requiredElement<HTMLElement>("#unique-visitors");
const onlineSummaryElement = requiredElement<HTMLElement>("#online-summary");
const topDestinationElement = requiredElement<HTMLElement>("#top-destination");
const topDestinationViewsElement = requiredElement<HTMLElement>("#top-destination-views");
const pageRankingElement = requiredElement<HTMLElement>("#page-ranking");

for (const section of PRESENCE_SECTIONS) {
  const article = document.createElement("article");
  article.className = `presence-card presence-card--${section.toLowerCase()}`;
  article.dataset.section = section;
  article.innerHTML = `
    <div class="card-heading">
      <div>
        <h2>${sectionLabels[section]}</h2>
        <p>${sectionDescriptions[section]}</p>
      </div>
      <span class="index">${String(PRESENCE_SECTIONS.indexOf(section) + 1).padStart(2, "0")}</span>
    </div>
    <div class="card-reading">
      <strong class="count" data-count>—</strong>
      <div class="change" data-change aria-hidden="true"></div>
    </div>
  `;
  grid.append(article);
}

let socket: WebSocket | undefined;
let reconnectTimer: number | undefined;
let reconnectAttempt = 0;
let previousCounts: PresenceCounts | undefined;
let displayedTotal = 0;
let hasSnapshot = false;
let lastUpdatedAt: number | undefined;
const displayedCounts = emptyPresenceCounts();
const cardTimers = new Map<PresenceSection, number>();

function setConnectionState(
  state: "connecting" | "live" | "reconnecting" | "offline",
  label: string,
): void {
  connectionElement.dataset.state = state;
  connectionLabel.textContent = label;
  footerConnection.textContent = label;
}

function animateInteger(
  element: HTMLElement,
  from: number,
  to: number,
  onValue: (value: number) => void,
): void {
  if (from === to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = String(to);
    onValue(to);
    return;
  }
  const startedAt = performance.now();
  const duration = 320;
  const tick = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(from + (to - from) * eased);
    element.textContent = String(value);
    onValue(value);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function pulseCard(
  section: PresenceSection,
  previous: number,
  current: number,
): void {
  const card = requiredElement<HTMLElement>(`[data-section="${section}"]`);
  const change = requiredElement<HTMLElement>(
    `[data-section="${section}"] [data-change]`,
  );
  const existingTimer = cardTimers.get(section);
  if (existingTimer) window.clearTimeout(existingTimer);

  card.classList.remove("is-entering", "is-entering-checkout", "is-leaving");
  void card.offsetWidth;

  const delta = current - previous;
  change.innerHTML = `<span>${previous} → ${current}</span>${
    delta > 0 ? `<b>+${delta}</b>` : ""
  }`;

  if (delta > 0) {
    card.classList.add(
      section === "CHECKOUT" ? "is-entering-checkout" : "is-entering",
    );
    announcement.textContent = `${sectionLabels[section]} increased from ${previous} to ${current}`;
  } else {
    card.classList.add("is-leaving");
  }

  cardTimers.set(
    section,
    window.setTimeout(() => {
      card.classList.remove("is-entering", "is-entering-checkout", "is-leaving");
      change.replaceChildren();
      cardTimers.delete(section);
    }, delta > 0 ? 2_000 : 1_100),
  );
}

function applySnapshot(snapshot: PresenceSnapshot): void {
  const firstSnapshot = !hasSnapshot;
  hasSnapshot = true;
  setConnectionState("live", "Live");
  reconnectAttempt = 0;
  lastUpdatedAt = Date.parse(snapshot.serverTime) || Date.now();

  for (const section of PRESENCE_SECTIONS) {
    const target = snapshot.counts[section];
    const countElement = requiredElement<HTMLElement>(
      `[data-section="${section}"] [data-count]`,
    );
    if (!firstSnapshot && previousCounts && target !== previousCounts[section]) {
      pulseCard(section, previousCounts[section], target);
    }
    const from = firstSnapshot ? target : displayedCounts[section];
    animateInteger(countElement, from, target, (value) => {
      displayedCounts[section] = value;
    });
  }

  const totalFrom = firstSnapshot ? snapshot.total : displayedTotal;
  animateInteger(totalElement, totalFrom, snapshot.total, (value) => {
    displayedTotal = value;
  });
  previousCounts = { ...snapshot.counts };
  renderAnalytics(snapshot);
  updateRelativeTime();
}

function pageLabel(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .map((part) => decodeURIComponent(part).replace(/[-_]+/g, " "))
    .map((part) => part.replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .join(" / ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] || character);
}

function renderAnalytics(snapshot: PresenceSnapshot): void {
  const { analytics } = snapshot;
  totalViewsElement.textContent = formatNumber(analytics.totalViews);
  uniqueVisitorsElement.textContent = formatNumber(analytics.uniqueVisitors);
  onlineSummaryElement.textContent = formatNumber(snapshot.total);
  const leader = analytics.topPages[0];
  topDestinationElement.textContent = leader ? pageLabel(leader.path) : "—";
  topDestinationViewsElement.textContent = leader ? `${formatNumber(leader.views)} views` : "Waiting for traffic";

  if (!leader) {
    pageRankingElement.innerHTML = '<p class="empty-state">Waiting for the first page view…</p>';
    return;
  }
  pageRankingElement.innerHTML = analytics.topPages.map((page, index) => {
    const width = Math.max(4, Math.round((page.views / leader.views) * 100));
    return `<div class="rank-row"><span class="rank-index">${String(index + 1).padStart(2, "0")}</span><div class="rank-data"><div><strong>${escapeHtml(pageLabel(page.path))}</strong><code>${escapeHtml(page.path)}</code><b>${formatNumber(page.views)}</b></div><span class="rank-track"><i style="width:${width}%"></i></span></div></div>`;
  }).join("");
}

function updateRelativeTime(): void {
  if (!lastUpdatedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1_000));
  const label =
    seconds < 5
      ? "Just now"
      : seconds < 60
        ? `${seconds}s ago`
        : `${Math.floor(seconds / 60)}m ago`;
  updatedElement.textContent = label;
  footerUpdated.textContent = label;
}

function isSnapshot(value: unknown): value is PresenceSnapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<PresenceSnapshot>;
  return (
    data.type === "presence:snapshot" &&
    typeof data.total === "number" &&
    typeof data.serverTime === "string" &&
    Boolean(data.analytics) &&
    typeof data.analytics?.totalViews === "number" &&
    typeof data.analytics?.uniqueVisitors === "number" &&
    Array.isArray(data.analytics?.topPages) &&
    Boolean(data.counts) &&
    PRESENCE_SECTIONS.every(
      (section) => typeof data.counts?.[section] === "number",
    )
  );
}

async function sessionStillValid(): Promise<boolean> {
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    return response.ok && !response.redirected;
  } catch {
    return true;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  setConnectionState("reconnecting", "Reconnecting");
  const baseDelay = Math.min(15_000, 750 * 2 ** reconnectAttempt);
  const jitter = Math.floor(Math.random() * 350);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, baseDelay + jitter);
}

function connect(): void {
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    return;
  }
  setConnectionState(hasSnapshot ? "reconnecting" : "connecting", hasSnapshot ? "Reconnecting" : "Connecting");
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws/dashboard`);

  socket.addEventListener("open", () => {
    setConnectionState("connecting", "Syncing");
  });

  socket.addEventListener("message", (event) => {
    try {
      const message: unknown = JSON.parse(String(event.data));
      if (isSnapshot(message)) applySnapshot(message);
    } catch {
      // Ignore malformed frames; the next authoritative snapshot replaces state.
    }
  });

  socket.addEventListener("close", () => {
    socket = undefined;
    void sessionStillValid().then((valid) => {
      if (!valid) {
        location.assign("/login");
        return;
      }
      scheduleReconnect();
    });
  });

  socket.addEventListener("error", () => {
    setConnectionState("offline", "Interrupted");
  });
}

window.setInterval(updateRelativeTime, 1_000);
window.addEventListener("online", connect);
window.addEventListener("offline", () => setConnectionState("offline", "Offline"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && socket?.readyState !== WebSocket.OPEN) {
    connect();
  }
});

connect();
