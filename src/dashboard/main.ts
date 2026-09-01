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
const totalSessionsElement = requiredElement<HTMLElement>("#total-sessions");
const totalClicksElement = requiredElement<HTMLElement>("#total-clicks");
const sourceListElement = requiredElement<HTMLElement>("#source-list");
const deviceListElement = requiredElement<HTMLElement>("#device-list");
const deviceDonutElement = requiredElement<HTMLElement>("#device-donut");
const deviceTotalElement = requiredElement<HTMLElement>("#device-total");
const clickListElement = requiredElement<HTMLElement>("#click-list");
const sessionListElement = requiredElement<HTMLElement>("#session-list");
const trendChartElement = requiredElement<HTMLElement>("#trend-chart");
const trendTotalElement = requiredElement<HTMLElement>("#trend-total");
const visitors30Element = requiredElement<HTMLElement>("#visitors-30");
const todayViewsElement = requiredElement<HTMLElement>("#today-views");
const pagesPerSessionElement = requiredElement<HTMLElement>("#pages-per-session");
const sessionDetailElement = requiredElement<HTMLElement>("#session-detail");
const sessionDetailContent = requiredElement<HTMLElement>("#session-detail-content");
const closeSessionDetailButton = requiredElement<HTMLButtonElement>("#close-session-detail");
const sessionBackdrop = requiredElement<HTMLButtonElement>("#session-backdrop");

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
let latestSnapshot: PresenceSnapshot | undefined;
let selectedRange: "today" | "7" | "30" | "all" = "30";
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
  latestSnapshot = snapshot;

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
  const cutoffDays = selectedRange === "today" ? 0 : selectedRange === "all" ? null : Number(selectedRange) - 1;
  const cutoff = cutoffDays === null
    ? null
    : new Date(Date.now() - cutoffDays * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const activity = cutoff
    ? analytics.dailyActivity.filter((item) => item.date >= cutoff)
    : analytics.dailyActivity;
  const filteredViews = selectedRange === "all"
    ? analytics.totalViews
    : activity.reduce((sum, item) => sum + item.views, 0);
  const filteredSessions = selectedRange === "all"
    ? analytics.totalSessions
    : activity.reduce((sum, item) => sum + item.sessions, 0);
  const filteredClicks = selectedRange === "all"
    ? analytics.totalClicks
    : activity.reduce((sum, item) => sum + item.clicks, 0);
  totalViewsElement.textContent = formatNumber(filteredViews);
  uniqueVisitorsElement.textContent = formatNumber(analytics.uniqueVisitors);
  onlineSummaryElement.textContent = formatNumber(snapshot.total);
  totalSessionsElement.textContent = formatNumber(filteredSessions);
  totalClicksElement.textContent = formatNumber(filteredClicks);
  visitors30Element.textContent = formatNumber(analytics.visitorsLast30Minutes);
  const today = new Date().toISOString().slice(0, 10);
  const todayViews = analytics.dailyViews.find((item) => item.date === today)?.views || 0;
  todayViewsElement.textContent = formatNumber(todayViews);
  pagesPerSessionElement.textContent = filteredSessions
    ? (filteredViews / filteredSessions).toFixed(1)
    : "0.0";
  const leader = analytics.topPages[0];
  topDestinationElement.textContent = leader ? pageLabel(leader.path) : "—";
  topDestinationViewsElement.textContent = leader ? `${formatNumber(leader.views)} views` : "Waiting for traffic";

  if (!leader) {
    pageRankingElement.innerHTML = '<p class="empty-state">Waiting for the first page view…</p>';
  } else {
    pageRankingElement.innerHTML = analytics.topPages.map((page, index) => {
      const width = Math.max(4, Math.round((page.views / leader.views) * 100));
      return `<div class="rank-row"><span class="rank-index">${String(index + 1).padStart(2, "0")}</span><div class="rank-data"><div><strong>${escapeHtml(pageLabel(page.path))}</strong><code>${escapeHtml(page.path)}</code><b>${formatNumber(page.views)}</b></div><span class="rank-track"><i style="width:${width}%"></i></span></div></div>`;
    }).join("");
  }

  renderRankList(sourceListElement, analytics.topSources);
  renderRankList(deviceListElement, analytics.topDevices);
  const deviceTotal = analytics.topDevices.reduce((sum, item) => sum + item.count, 0);
  deviceTotalElement.textContent = formatNumber(deviceTotal);
  const mobile = analytics.topDevices.find((item) => item.label === "Mobile")?.count || 0;
  const tablet = analytics.topDevices.find((item) => item.label === "Tablet")?.count || 0;
  const mobileEnd = deviceTotal ? Math.round((mobile / deviceTotal) * 100) : 0;
  const tabletEnd = deviceTotal ? mobileEnd + Math.round((tablet / deviceTotal) * 100) : 0;
  deviceDonutElement.style.background = `conic-gradient(#1688ff 0 ${mobileEnd}%, #66bcff ${mobileEnd}% ${tabletEnd}%, #204c95 ${tabletEnd}% 100%)`;

  clickListElement.innerHTML = analytics.topClicks.length
    ? analytics.topClicks.map((item, index) => `<div class="click-row"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.label)}</strong><code>${escapeHtml(item.path)}</code></div><b>${formatNumber(item.count)}</b></div>`).join("")
    : '<p class="empty-state">Button and link clicks will appear here.</p>';

  const visibleSessions = cutoff
    ? analytics.recentSessions.filter((session) => session.lastSeenAt.slice(0, 10) >= cutoff)
    : analytics.recentSessions;
  sessionListElement.innerHTML = visibleSessions.length
    ? visibleSessions.map((session) => `<button type="button" class="session-row" data-session-id="${session.id}"><span class="session-dot"></span><div><strong>${escapeHtml(pageLabel(session.path))}</strong><small>${escapeHtml(session.source)} · ${escapeHtml(session.device)}</small></div><div><b>${session.pageViews} pages</b><small>${session.clicks} clicks · ${relativeDate(session.lastSeenAt)}</small></div></button>`).join("")
    : '<p class="empty-state">New visitor sessions will appear here.</p>';
  const trendItems = analytics.dailyViews.filter((item) => !cutoff || item.date >= cutoff);
  renderTrend(trendItems);
}

function openSessionDetail(sessionId: string): void {
  const session = latestSnapshot?.analytics.recentSessions.find((item) => item.id === sessionId);
  if (!session) return;
  const events = session.events || [];
  sessionDetailContent.innerHTML = `<div class="session-facts"><div><span>Source</span><strong>${escapeHtml(session.source)}</strong></div><div><span>Device</span><strong>${escapeHtml(session.device)}</strong></div><div><span>Pages</span><strong>${session.pageViews}</strong></div><div><span>Clicks</span><strong>${session.clicks}</strong></div></div><div class="journey-timeline">${events.length ? events.map((event) => `<div class="journey-event journey-event--${event.type}"><i></i><div><span>${event.type === "click" ? "Click" : "Page view"} · ${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><strong>${escapeHtml(event.type === "click" ? event.label || "Interaction" : pageLabel(event.path))}</strong><code>${escapeHtml(event.path)}</code></div></div>`).join("") : '<p class="empty-state">The detailed journey begins with the visitor’s next action.</p>'}</div>`;
  sessionDetailElement.hidden = false;
  sessionBackdrop.hidden = false;
  document.body.classList.add("detail-open");
}

function closeSessionDetail(): void {
  sessionDetailElement.hidden = true;
  sessionBackdrop.hidden = true;
  document.body.classList.remove("detail-open");
}

function renderRankList(element: HTMLElement, items: Array<{ label: string; count: number }>): void {
  const maximum = items[0]?.count || 1;
  element.innerHTML = items.length
    ? items.map((item) => `<div class="insight-row"><div><strong>${escapeHtml(item.label)}</strong><b>${formatNumber(item.count)}</b></div><span><i style="width:${Math.max(4, Math.round((item.count / maximum) * 100))}%"></i></span></div>`).join("")
    : '<p class="empty-state">Waiting for visitor data.</p>';
}

function relativeDate(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function renderTrend(items: Array<{ date: string; views: number }>): void {
  const total = items.reduce((sum, item) => sum + item.views, 0);
  trendTotalElement.textContent = `${formatNumber(total)} views`;
  if (!items.length) {
    trendChartElement.innerHTML = '<p class="empty-state">The trend begins with the next page view.</p>';
    return;
  }
  const max = Math.max(...items.map((item) => item.views), 1);
  const points = items.map((item, index) => {
    const x = items.length === 1 ? 50 : (index / (items.length - 1)) * 100;
    const y = 86 - (item.views / max) * 68;
    return `${x},${y}`;
  }).join(" ");
  trendChartElement.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Daily page views"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1688ff" stop-opacity=".35"/><stop offset="1" stop-color="#1688ff" stop-opacity="0"/></linearGradient></defs><polygon points="0,100 ${points} 100,100" fill="url(#trend-fill)"/><polyline points="${points}" fill="none" stroke="#42a4ff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="trend-labels">${items.map((item) => `<span>${item.date.slice(5)}</span>`).join("")}</div>`;
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
    typeof data.analytics?.totalSessions === "number" &&
    typeof data.analytics?.totalClicks === "number" &&
    typeof data.analytics?.visitorsLast30Minutes === "number" &&
    Array.isArray(data.analytics?.topSources) &&
    Array.isArray(data.analytics?.topDevices) &&
    Array.isArray(data.analytics?.topClicks) &&
    Array.isArray(data.analytics?.dailyViews) &&
    Array.isArray(data.analytics?.dailyActivity) &&
    Array.isArray(data.analytics?.recentSessions) &&
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

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
  button.addEventListener("click", () => {
    const range = button.dataset.range;
    if (range !== "today" && range !== "7" && range !== "30" && range !== "all") return;
    selectedRange = range;
    for (const item of document.querySelectorAll("[data-range]")) item.classList.toggle("is-active", item === button);
    if (latestSnapshot) renderAnalytics(latestSnapshot);
  });
}

sessionListElement.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-session-id]")
    : null;
  if (target?.dataset.sessionId) openSessionDetail(target.dataset.sessionId);
});
closeSessionDetailButton.addEventListener("click", closeSessionDetail);
sessionBackdrop.addEventListener("click", closeSessionDetail);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sessionDetailElement.hidden) closeSessionDetail();
});

connect();
