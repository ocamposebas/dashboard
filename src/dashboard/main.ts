import "./styles.css";
import {
  PRESENCE_SECTIONS,
  emptyPresenceCounts,
  type PresenceCounts,
  type PresenceSection,
  type PresenceSnapshot,
} from "../shared/protocol";

type BaseAnalytics = PresenceSnapshot["analytics"];
type BaseSession = BaseAnalytics["recentSessions"][number];
type BaseEvent = BaseSession["events"][number];

type DashboardEvent = Omit<BaseEvent, "type"> & {
  type: "pageview" | "click" | "order";
  status?: "paid";
};

type DashboardSession = Omit<BaseSession, "events"> & {
  visitorNumber?: number;
  visitNumber?: number;
  returningVisitor?: boolean;
  orderCompleted?: boolean;
  orderCompletedAt?: string;
  events: DashboardEvent[];
};

type DashboardDailyActivity = BaseAnalytics["dailyActivity"][number] & {
  visitors?: number;
  returningSessions?: number;
  orders?: number;
};

type DashboardAnalytics = Omit<BaseAnalytics, "dailyActivity" | "recentSessions" | "timeZone"> & {
  timeZone?: string;
  returningVisitors?: number;
  returningSessions?: number;
  totalOrders?: number;
  visitorRanges?: {
    today: number;
    last7Days: number;
    last30Days: number;
    all: number;
  };
  dailyVisitors?: Array<{ date: string; visitors: number }>;
  dailyActivity: DashboardDailyActivity[];
  recentSessions: DashboardSession[];
};

type DashboardSnapshot = Omit<PresenceSnapshot, "analytics"> & {
  analytics: DashboardAnalytics;
};

const sectionLabels: Record<PresenceSection, string> = {
  HOME: "Home",
  SHOP: "Shop",
  PRODUCT: "Product",
  CART: "Cart",
  CHECKOUT: "Checkout",
  OTHER: "Other",
};

const sectionDescriptions: Record<PresenceSection, string> = {
  HOME: "Landing page",
  SHOP: "Browsing the catalog",
  PRODUCT: "Product details",
  CART: "Cart open",
  CHECKOUT: "Checkout flow",
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
const returningVisitsElement = requiredElement<HTMLElement>("#returning-visits");
const pageRankingElement = requiredElement<HTMLElement>("#page-ranking");
const totalVisitsElement = requiredElement<HTMLElement>("#total-visits");
const totalOrdersElement = requiredElement<HTMLElement>("#total-orders");
const sourceListElement = requiredElement<HTMLElement>("#source-list");
const deviceListElement = requiredElement<HTMLElement>("#device-list");
const deviceDonutElement = requiredElement<HTMLElement>("#device-donut");
const deviceTotalElement = requiredElement<HTMLElement>("#device-total");
const sessionListElement = requiredElement<HTMLElement>("#session-list");
const sessionPagination = requiredElement<HTMLElement>("#session-pagination");
const sessionsPrevious = requiredElement<HTMLButtonElement>("#sessions-previous");
const sessionsNext = requiredElement<HTMLButtonElement>("#sessions-next");
const sessionsPage = requiredElement<HTMLElement>("#sessions-page");
const trendChartElement = requiredElement<HTMLElement>("#trend-chart");
const trendTotalElement = requiredElement<HTMLElement>("#trend-total");
const visitors30Element = requiredElement<HTMLElement>("#visitors-30");
const todayVisitorsElement = requiredElement<HTMLElement>("#today-visitors");
const todayVisitsElement = requiredElement<HTMLElement>("#today-visits");
const todayOrdersElement = requiredElement<HTMLElement>("#today-orders");
const activeRangeLabel = requiredElement<HTMLElement>("#active-range-label");
const specificDateInput = requiredElement<HTMLInputElement>("#specific-date");
const specificDateLabel = requiredElement<HTMLElement>("#specific-date-label");
const datePickerControl = requiredElement<HTMLElement>("#date-picker-control");
const sessionDetailElement = requiredElement<HTMLElement>("#session-detail");
const sessionDetailTitle = requiredElement<HTMLElement>("#session-detail-title");
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
let latestSnapshot: DashboardSnapshot | undefined;
let selectedRange: "today" | "7" | "30" | "all" | "date" = "30";
let selectedDate: string | null = null;
let sessionPage = 1;
let sessionDetailTriggerId: string | undefined;
const SESSION_PAGE_SIZE = 5;
const LEGACY_ANALYTICS_TIME_ZONE = "UTC";
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

function applySnapshot(snapshot: DashboardSnapshot): void {
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
  const translations: Record<string, string> = {
    shop: "Shop",
    product: "Product",
    checkout: "Checkout",
    cart: "Cart",
    account: "Account",
    "thank you": "Order confirmation",
  };
  return path
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part).replace(/[-_]+/g, " ");
      } catch {
        return part.replace(/[-_]+/g, " ");
      }
    })
    .map((part) => translations[part.toLowerCase()] || part.replace(/\b\w/g, (letter) => letter.toUpperCase()))
    .join(" / ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function displayLabel(value: string): string {
  return value;
}

function dateKey(
  value = new Date(),
  timeZone = LEGACY_ANALYTICS_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shiftDateKey(value: string, days: number): string {
  const parts = value.split("-").map(Number);
  const year = parts[0] ?? 1970;
  const month = parts[1] ?? 1;
  const day = parts[2] ?? 1;
  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
}

function formatDateLabel(value: string): string {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00.000Z`));
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

function rankLabels(values: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 8);
}

function pagesForSessions(
  sessions: DashboardSession[],
  cutoff: string | null,
  timeZone: string,
  exactDate: string | null = null,
): Array<{ path: string; views: number }> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const allPageEvents = (session.events || []).filter(
      (event) => event.type === "pageview",
    );
    const pageEvents = allPageEvents.filter((event) => {
      const eventDate = dateKey(new Date(event.at), timeZone);
      return exactDate ? eventDate === exactDate : !cutoff || eventDate >= cutoff;
    });
    if (pageEvents.length) {
      for (const event of pageEvents) counts.set(event.path, (counts.get(event.path) || 0) + 1);
    } else if (allPageEvents.length === 0 && session.pageViews > 0) {
      const sessionDate = dateKey(new Date(session.startedAt), timeZone);
      const sessionMatches = exactDate
        ? sessionDate === exactDate
        : !cutoff || sessionDate >= cutoff;
      if (sessionMatches) {
        counts.set(session.path, (counts.get(session.path) || 0) + session.pageViews);
      }
    }
  }
  return [...counts.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((left, right) => right.views - left.views || left.path.localeCompare(right.path))
    .slice(0, 8);
}

function visitorCountForRange(
  analytics: DashboardAnalytics,
  sessions: DashboardSession[],
): number {
  if (selectedRange === "date") {
    if (!selectedDate) return 0;
    return dailyVisitorSeries(analytics).find(
      (item) => item.date === selectedDate,
    )?.visitors ?? 0;
  }
  const ranges = analytics.visitorRanges;
  if (ranges) {
    return {
      today: ranges.today,
      "7": ranges.last7Days,
      "30": ranges.last30Days,
      all: ranges.all,
    }[selectedRange];
  }
  if (selectedRange === "all") return analytics.uniqueVisitors;

  // Legacy snapshots did not include server-computed range totals. This is a
  // best-effort fallback over the recent-session window only.
  return new Set(
    sessions.map((session) =>
      session.visitorNumber
        ? `visitor:${session.visitorNumber}`
        : `session:${session.id}`,
    ),
  ).size;
}

function dailyVisitorSeries(
  analytics: DashboardAnalytics,
): Array<{ date: string; visitors: number }> {
  if (analytics.dailyVisitors?.length) return analytics.dailyVisitors;
  return analytics.dailyActivity.map((item) => ({
    date: item.date,
    visitors: item.visitors ?? item.sessions,
  }));
}

function isReturningSession(session: DashboardSession): boolean {
  return session.returningVisitor ?? (session.visitNumber ?? 1) > 1;
}

function sessionHasCompletedOrder(session: DashboardSession): boolean {
  return Boolean(
    session.orderCompleted ||
    session.events?.some((event) => event.type === "order" && event.status === "paid"),
  );
}

function renderSessionRow(session: DashboardSession): string {
  const visitorNumber = session.visitorNumber;
  const visitNumber = session.visitNumber ?? 1;
  const identity = visitorNumber
    ? `Visitor #${visitorNumber} · Visit ${visitNumber}`
    : session.number
      ? `Session #${session.number} · Visit ${visitNumber}`
      : `Anonymous visitor · Visit ${visitNumber}`;
  const returning = isReturningSession(session);
  const completedOrder = sessionHasCompletedOrder(session);
  const badges = [
    returning
      ? '<span class="session-badge session-badge--returning">Returned</span>'
      : "",
    completedOrder
      ? '<span class="session-badge session-badge--order">Purchased</span>'
      : "",
  ].join("");
  const accessibilityStatus = [
    returning ? "returning visitor" : "new visitor",
    completedOrder ? "completed order" : "no completed order",
  ].join(", ");

  return `<button type="button" class="session-row${completedOrder ? " has-order" : ""}" data-session-id="${escapeHtml(session.id)}" aria-haspopup="dialog" aria-controls="session-detail" aria-label="Open ${escapeHtml(identity)}, ${accessibilityStatus}"><span class="session-dot" aria-hidden="true"></span><div class="session-row-main"><div class="session-row-heading"><strong>${escapeHtml(identity)}</strong><span class="session-badges">${badges}</span></div><small>${escapeHtml(displayLabel(session.source))} · ${escapeHtml(displayLabel(session.device))} · ${escapeHtml(pageLabel(session.path))}</small><div class="session-row-meta"><b>${formatNumber(session.pageViews)} page${session.pageViews === 1 ? "" : "s"}</b><small>${formatNumber(session.clicks)} click${session.clicks === 1 ? "" : "s"} · ${relativeDate(session.lastSeenAt)}</small></div></div></button>`;
}

function renderAnalytics(snapshot: DashboardSnapshot): void {
  const { analytics } = snapshot;
  const timeZone = analytics.timeZone || LEGACY_ANALYTICS_TIME_ZONE;
  const currentDate = dateKey(new Date(snapshot.serverTime), timeZone);
  const visitorSeries = dailyVisitorSeries(analytics);
  const earliestDate = visitorSeries[0]?.date ?? currentDate;
  const latestDate = visitorSeries[visitorSeries.length - 1]?.date ?? currentDate;
  specificDateInput.min = earliestDate;
  specificDateInput.max = latestDate;
  specificDateInput.title = `Available from ${formatDateLabel(earliestDate)} to ${formatDateLabel(latestDate)}`;
  const exactDate = selectedRange === "date" ? selectedDate : null;
  const cutoffDays = selectedRange === "today"
    ? 0
    : selectedRange === "7"
      ? 6
      : selectedRange === "30"
        ? 29
        : null;
  const cutoff = cutoffDays === null
    ? null
    : shiftDateKey(currentDate, -cutoffDays);
  const activity = analytics.dailyActivity.filter((item) =>
    exactDate ? item.date === exactDate : !cutoff || item.date >= cutoff,
  );
  const sessionsInRange = analytics.recentSessions.filter((session) => {
    const sessionDate = dateKey(new Date(session.startedAt), timeZone);
    return exactDate ? sessionDate === exactDate : !cutoff || sessionDate >= cutoff;
  });
  const sessionsStartedInRange = sessionsInRange;
  const filteredViews = selectedRange === "all"
    ? analytics.totalViews
    : activity.reduce((sum, item) => sum + item.views, 0);
  let filteredSessions = selectedRange === "all"
    ? analytics.totalSessions
    : activity.reduce((sum, item) => sum + item.sessions, 0);
  const recentReturningSessions = sessionsInRange.filter(
    (session) => isReturningSession(session),
  ).length;
  const recentOrders = sessionsInRange.filter(sessionHasCompletedOrder).length;
  const hasDailyReturningSessions = activity.some(
    (item) => typeof item.returningSessions === "number",
  );
  const hasDailyOrders = activity.some((item) => typeof item.orders === "number");
  const filteredReturningSessions = selectedRange === "all"
    ? analytics.returningSessions ?? recentReturningSessions
    : hasDailyReturningSessions
      ? activity.reduce((sum, item) => sum + (item.returningSessions ?? 0), 0)
      : recentReturningSessions;
  const filteredOrders = selectedRange === "all"
    ? analytics.totalOrders ?? recentOrders
    : hasDailyOrders
      ? activity.reduce((sum, item) => sum + (item.orders ?? 0), 0)
      : recentOrders;
  totalViewsElement.textContent = formatNumber(filteredViews);
  uniqueVisitorsElement.textContent = formatNumber(
    visitorCountForRange(analytics, sessionsInRange),
  );
  returningVisitsElement.textContent = formatNumber(filteredReturningSessions);
  totalVisitsElement.textContent = formatNumber(filteredSessions);
  totalOrdersElement.textContent = formatNumber(filteredOrders);
  visitors30Element.textContent = formatNumber(analytics.visitorsLast30Minutes);
  const today = currentDate;
  const todayActivity = analytics.dailyActivity.find((item) => item.date === today);
  const todayVisitors = visitorSeries.find(
    (item) => item.date === today,
  )?.visitors ?? analytics.visitorRanges?.today ?? 0;
  todayVisitorsElement.textContent = formatNumber(todayVisitors);
  todayVisitsElement.textContent = formatNumber(todayActivity?.sessions ?? 0);
  todayOrdersElement.textContent = formatNumber(todayActivity?.orders ?? 0);
  const filteredPages = selectedRange === "all"
    ? analytics.topPages
    : pagesForSessions(analytics.recentSessions, cutoff, timeZone, exactDate);
  const filteredSources = selectedRange === "all"
    ? analytics.topSources
    : rankLabels(sessionsStartedInRange.map((session) => session.source));
  const filteredDevices = selectedRange === "all"
    ? analytics.topDevices
    : rankLabels(sessionsStartedInRange.map((session) => session.device));
  const leader = filteredPages[0];

  if (!leader) {
    pageRankingElement.innerHTML = '<p class="empty-state">No page views for this period yet.</p>';
  } else {
    pageRankingElement.innerHTML = filteredPages.map((page, index) => {
      const width = Math.max(4, Math.round((page.views / leader.views) * 100));
      return `<div class="rank-row"><span class="rank-index">${String(index + 1).padStart(2, "0")}</span><div class="rank-data"><div><strong>${escapeHtml(pageLabel(page.path))}</strong><code>${escapeHtml(page.path)}</code><b>${formatNumber(page.views)}</b></div><span class="rank-track"><i style="width:${width}%"></i></span></div></div>`;
    }).join("");
  }

  renderRankList(sourceListElement, filteredSources);
  renderRankList(deviceListElement, filteredDevices);
  const deviceTotal = filteredDevices.reduce((sum, item) => sum + item.count, 0);
  deviceTotalElement.textContent = formatNumber(deviceTotal);
  const mobile = filteredDevices.find((item) => item.label === "Mobile")?.count || 0;
  const tablet = filteredDevices.find((item) => item.label === "Tablet")?.count || 0;
  const mobileEnd = deviceTotal ? Math.round((mobile / deviceTotal) * 100) : 0;
  const tabletEnd = deviceTotal ? mobileEnd + Math.round((tablet / deviceTotal) * 100) : 0;
  deviceDonutElement.style.background = deviceTotal
    ? `conic-gradient(#1688ff 0 ${mobileEnd}%, #66bcff ${mobileEnd}% ${tabletEnd}%, #204c95 ${tabletEnd}% 100%)`
    : "rgba(18, 48, 94, .42)";

  const visibleSessions = [...sessionsInRange].sort((left, right) =>
    Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt) ||
    (right.number || 0) - (left.number || 0),
  );
  const sessionPageCount = Math.max(1, Math.ceil(visibleSessions.length / SESSION_PAGE_SIZE));
  sessionPage = Math.min(sessionPage, sessionPageCount);
  const pageSessions = visibleSessions.slice(
    (sessionPage - 1) * SESSION_PAGE_SIZE,
    sessionPage * SESSION_PAGE_SIZE,
  );
  sessionListElement.innerHTML = pageSessions.length
    ? pageSessions.map(renderSessionRow).join("")
    : '<p class="empty-state">New visits will appear here.</p>';
  sessionPagination.hidden = visibleSessions.length <= SESSION_PAGE_SIZE;
  sessionsPage.textContent = `Page ${sessionPage} of ${sessionPageCount}`;
  sessionsPrevious.disabled = sessionPage <= 1;
  sessionsNext.disabled = sessionPage >= sessionPageCount;
  const trendItems = visitorSeries.filter(
    (item) => exactDate ? item.date === exactDate : !cutoff || item.date >= cutoff,
  );
  renderTrend(trendItems);
}

function renderJourneyEvent(event: DashboardEvent, index: number): string {
  const time = new Date(event.at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const paidOrder = event.type === "order" && event.status === "paid";
  const action = event.type === "order"
    ? paidOrder ? "Order completed" : "Order event"
    : event.type === "click"
      ? "Clicked"
      : "Visited";
  const detail = event.type === "order"
    ? paidOrder ? "Payment confirmed" : "Order status unavailable"
    : event.type === "click"
      ? event.label || "Interaction"
      : pageLabel(event.path);
  const icon = paidOrder ? "✓" : event.type === "order" ? "•" : String(index + 1);
  const eventClass = paidOrder
    ? "order"
    : event.type === "order"
      ? "summary"
      : event.type;

  return `<div class="journey-event journey-event--${eventClass}"><i>${icon}</i><div><span>${action} · ${time}</span><strong>${escapeHtml(detail)}</strong><code>${escapeHtml(event.path)}</code></div></div>`;
}

function openSessionDetail(sessionId: string): void {
  const session = latestSnapshot?.analytics.recentSessions.find((item) => item.id === sessionId);
  if (!session) return;
  const events = [...(session.events || [])].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const visitorNumber = session.visitorNumber;
  const visitNumber = session.visitNumber ?? 1;
  const returning = isReturningSession(session);
  const completedOrder = sessionHasCompletedOrder(session);
  const detailedOrder = events.find(
    (event) => event.type === "order" && event.status === "paid",
  );
  const orderCompletedAt = session.orderCompletedAt ?? detailedOrder?.at;
  const detailedPageViews = events.filter((event) => event.type === "pageview").length;
  const detailedClicks = events.filter((event) => event.type === "click").length;
  const earlierPageViews = Math.max(0, session.pageViews - detailedPageViews);
  const earlierClicks = Math.max(0, session.clicks - detailedClicks);
  sessionDetailTitle.textContent = visitorNumber
    ? `Visitor #${visitorNumber} · Visit ${visitNumber}`
    : session.number
      ? `Session #${session.number} · Visit ${visitNumber}`
      : `Anonymous visitor · Visit ${visitNumber}`;
  const durationMs = Math.max(0, Date.parse(session.lastSeenAt) - Date.parse(session.startedAt));
  const durationLabel = durationMs < 60_000 ? `${Math.floor(durationMs / 1_000)}s` : `${Math.floor(durationMs / 60_000)}m ${Math.floor((durationMs % 60_000) / 1_000)}s`;
  const summaryEvents = [
    earlierPageViews
      ? `<div class="journey-event journey-event--summary"><i>↗</i><div><span>Earlier activity</span><strong>${earlierPageViews} page view${earlierPageViews === 1 ? "" : "s"}</strong><code>Last page: ${escapeHtml(session.path)}</code></div></div>`
      : "",
    earlierClicks
      ? `<div class="journey-event journey-event--summary"><i>+</i><div><span>Earlier interactions</span><strong>${earlierClicks} click${earlierClicks === 1 ? "" : "s"}</strong><code>Count retained for this visit</code></div></div>`
      : "",
  ].join("");
  const detailedEvents = events.map(renderJourneyEvent).join("");
  const inferredOrderEvent = completedOrder && !detailedOrder
    ? `<div class="journey-event journey-event--order"><i>✓</i><div><span>Order completed${orderCompletedAt ? ` · ${new Date(orderCompletedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}</span><strong>Payment confirmed</strong><code>Purchase confirmation</code></div></div>`
    : "";
  const journey = summaryEvents || detailedEvents || inferredOrderEvent
    ? `${summaryEvents}${detailedEvents}${inferredOrderEvent}`
    : `<div class="journey-event journey-event--summary"><i>•</i><div><span>Visit activity</span><strong>${escapeHtml(pageLabel(session.path))}</strong><code>${escapeHtml(session.path)}</code></div></div>`;
  const totalActions = session.pageViews + session.clicks + (completedOrder ? 1 : 0);
  const conversionBanner = completedOrder
    ? `<section class="conversion-banner" aria-label="Order conversion"><span aria-hidden="true">✓</span><div><strong>Order completed</strong><small>${orderCompletedAt ? `Confirmed ${new Date(orderCompletedAt).toLocaleString("en-US")}` : "Confirmed during this visit"}</small></div></section>`
    : "";
  sessionDetailContent.innerHTML = `<div class="session-status"><i></i><span>Last interaction ${relativeDate(session.lastSeenAt)} · started ${new Date(session.startedAt).toLocaleString("en-US")}</span></div>${conversionBanner}<div class="session-facts"><div><span>Visitor</span><strong>${visitorNumber ? `#${visitorNumber}` : "Anonymous"}</strong></div><div><span>Visit</span><strong>#${visitNumber}</strong></div><div><span>Type</span><strong>${returning ? "Returning" : "New"}</strong></div><div><span>Order</span><strong>${completedOrder ? "Completed" : "Not completed"}</strong></div><div><span>Source</span><strong>${escapeHtml(displayLabel(session.source))}</strong></div><div><span>Device</span><strong>${escapeHtml(displayLabel(session.device))}</strong></div><div><span>Duration</span><strong>${durationLabel}</strong></div><div><span>Activity</span><strong>${formatNumber(session.pageViews)} pages · ${formatNumber(session.clicks)} clicks</strong></div></div><section class="journey-panel"><div class="journey-heading"><span>Full journey</span><b>${formatNumber(totalActions)} action${totalActions === 1 ? "" : "s"}</b></div><div class="journey-timeline">${journey}</div></section>`;
  sessionDetailElement.hidden = false;
  sessionBackdrop.hidden = false;
  setBackgroundInert(true);
  document.body.classList.add("detail-open");
  closeSessionDetailButton.focus();
}

function closeSessionDetail(): void {
  if (sessionDetailElement.hidden) return;
  sessionDetailElement.hidden = true;
  sessionBackdrop.hidden = true;
  setBackgroundInert(false);
  document.body.classList.remove("detail-open");
  const trigger = [...sessionListElement.querySelectorAll<HTMLButtonElement>("[data-session-id]")]
    .find((button) => button.dataset.sessionId === sessionDetailTriggerId);
  (trigger || document.querySelector<HTMLButtonElement>("[data-range].is-active"))?.focus();
  sessionDetailTriggerId = undefined;
}

const backgroundElements = [
  requiredElement<HTMLElement>(".masthead"),
  ...[...requiredElement<HTMLElement>("main").children].filter(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element !== sessionDetailElement &&
      element !== sessionBackdrop,
  ),
];

function setBackgroundInert(inert: boolean): void {
  for (const element of backgroundElements) element.inert = inert;
}

function renderRankList(element: HTMLElement, items: Array<{ label: string; count: number }>): void {
  const maximum = items[0]?.count || 1;
  element.innerHTML = items.length
    ? items.map((item) => `<div class="insight-row"><div><strong>${escapeHtml(displayLabel(item.label))}</strong><b>${formatNumber(item.count)}</b></div><span><i style="width:${Math.max(4, Math.round((item.count / maximum) * 100))}%"></i></span></div>`).join("")
    : '<p class="empty-state">No data to show yet.</p>';
}

function relativeDate(value: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} d ago`;
}

function renderTrend(items: Array<{ date: string; visitors: number }>): void {
  if (selectedRange === "date" && selectedDate) {
    const visitors = items[0]?.visitors ?? 0;
    trendTotalElement.textContent = `${formatNumber(visitors)} visitor${visitors === 1 ? "" : "s"}`;
    trendChartElement.innerHTML = `<div class="single-day-result"><span>${escapeHtml(formatDateLabel(selectedDate))}</span><strong>${formatNumber(visitors)}</strong><small>unique visitor${visitors === 1 ? "" : "s"}</small></div>`;
    return;
  }
  const peak = Math.max(...items.map((item) => item.visitors), 0);
  trendTotalElement.textContent = selectedRange === "all"
    ? `Last 30 days · Peak ${formatNumber(peak)}`
    : `Peak ${formatNumber(peak)} per day`;
  if (!items.length || peak === 0) {
    trendChartElement.innerHTML = '<p class="empty-state">The chart will begin with the next person who visits the store.</p>';
    return;
  }
  const max = Math.max(...items.map((item) => item.visitors), 1);
  const points = items.map((item, index) => {
    const x = items.length === 1 ? 50 : (index / (items.length - 1)) * 100;
    const y = 86 - (item.visitors / max) * 68;
    return `${x},${y}`;
  }).join(" ");
  const accessibleSummary = items
    .map((item) => `${item.date}: ${item.visitors}`)
    .join(", ");
  const labelStep = Math.max(1, Math.ceil((items.length - 1) / 6));
  const labels = items.filter(
    (_item, index) => index === 0 || index === items.length - 1 || index % labelStep === 0,
  );
  trendChartElement.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Unique visitors by day. ${accessibleSummary}"><defs><linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4d9cff" stop-opacity=".3"/><stop offset="1" stop-color="#4d9cff" stop-opacity="0"/></linearGradient></defs><polygon points="0,100 ${points} 100,100" fill="url(#trend-fill)"/><polyline points="${points}" fill="none" stroke="#64adff" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="trend-labels">${labels.map((item) => `<span title="${item.date}: ${formatNumber(item.visitors)} unique visitors">${item.date.slice(5)}</span>`).join("")}</div>`;
}

function updateRelativeTime(): void {
  if (!lastUpdatedAt) return;
  const seconds = Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1_000));
  const label =
    seconds < 5
      ? "Now"
      : seconds < 60
        ? `${seconds} s ago`
        : `${Math.floor(seconds / 60)} min ago`;
  updatedElement.textContent = label;
  footerUpdated.textContent = label;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isDateKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T12:00:00.000Z`))
  );
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function optionalFinite(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || isFiniteNumber(record[key]);
}

function isSnapshot(value: unknown): value is DashboardSnapshot {
  if (!isRecord(value) || value.type !== "presence:snapshot") return false;
  if (!isFiniteNumber(value.total) || !isTimestamp(value.serverTime)) return false;
  if (!isRecord(value.counts) || !isRecord(value.analytics)) return false;
  const counts = value.counts;
  const analytics = value.analytics;
  if (!PRESENCE_SECTIONS.every((section) => isFiniteNumber(counts[section]))) {
    return false;
  }

  const requiredTotals = [
    "totalViews",
    "uniqueVisitors",
    "totalSessions",
    "totalClicks",
    "visitorsLast30Minutes",
  ];
  if (!requiredTotals.every((key) => isFiniteNumber(analytics[key]))) return false;
  if (
    !["returningVisitors", "returningSessions", "totalOrders"].every(
      (key) => optionalFinite(analytics, key),
    ) ||
    (analytics.timeZone !== undefined && !isTimeZone(analytics.timeZone))
  ) {
    return false;
  }

  if (analytics.visitorRanges !== undefined) {
    if (!isRecord(analytics.visitorRanges)) return false;
    const visitorRanges = analytics.visitorRanges;
    if (
      !["today", "last7Days", "last30Days", "all"].every((key) =>
        isFiniteNumber(visitorRanges[key]),
      )
    ) {
      return false;
    }
  }

  const validRank = (item: unknown): boolean =>
    isRecord(item) && typeof item.label === "string" && isFiniteNumber(item.count);
  const validPage = (item: unknown): boolean =>
    isRecord(item) && typeof item.path === "string" && isFiniteNumber(item.views);
  const validClick = (item: unknown): boolean =>
    isRecord(item) &&
    typeof item.path === "string" &&
    typeof item.label === "string" &&
    isFiniteNumber(item.count);
  const validDailyView = (item: unknown): boolean =>
    isRecord(item) && isDateKey(item.date) && isFiniteNumber(item.views);
  const validDailyVisitor = (item: unknown): boolean =>
    isRecord(item) && isDateKey(item.date) && isFiniteNumber(item.visitors);
  const validDailyActivity = (item: unknown): boolean =>
    isRecord(item) &&
    isDateKey(item.date) &&
    isFiniteNumber(item.views) &&
    isFiniteNumber(item.sessions) &&
    isFiniteNumber(item.clicks) &&
    optionalFinite(item, "visitors") &&
    optionalFinite(item, "returningSessions") &&
    optionalFinite(item, "orders");
  const validEvent = (item: unknown): boolean =>
    isRecord(item) &&
    (item.type === "pageview" || item.type === "click" || item.type === "order") &&
    isTimestamp(item.at) &&
    typeof item.path === "string" &&
    (item.label === undefined || typeof item.label === "string") &&
    (item.status === undefined || item.status === "paid");
  const validSession = (item: unknown): boolean =>
    isRecord(item) &&
    typeof item.id === "string" &&
    isFiniteNumber(item.number) &&
    typeof item.source === "string" &&
    typeof item.device === "string" &&
    typeof item.path === "string" &&
    isTimestamp(item.startedAt) &&
    isTimestamp(item.lastSeenAt) &&
    isFiniteNumber(item.pageViews) &&
    isFiniteNumber(item.clicks) &&
    optionalFinite(item, "visitorNumber") &&
    optionalFinite(item, "visitNumber") &&
    (item.returningVisitor === undefined || typeof item.returningVisitor === "boolean") &&
    (item.orderCompleted === undefined || typeof item.orderCompleted === "boolean") &&
    (item.orderCompletedAt === undefined || isTimestamp(item.orderCompletedAt)) &&
    Array.isArray(item.events) &&
    item.events.every(validEvent);

  return (
    Array.isArray(analytics.topPages) && analytics.topPages.every(validPage) &&
    Array.isArray(analytics.topSources) && analytics.topSources.every(validRank) &&
    Array.isArray(analytics.topDevices) && analytics.topDevices.every(validRank) &&
    Array.isArray(analytics.topClicks) && analytics.topClicks.every(validClick) &&
    Array.isArray(analytics.dailyViews) && analytics.dailyViews.every(validDailyView) &&
    (analytics.dailyVisitors === undefined ||
      (Array.isArray(analytics.dailyVisitors) &&
        analytics.dailyVisitors.every(validDailyVisitor))) &&
    Array.isArray(analytics.dailyActivity) &&
    analytics.dailyActivity.every(validDailyActivity) &&
    Array.isArray(analytics.recentSessions) &&
    analytics.recentSessions.every(validSession)
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
    selectedDate = null;
    sessionPage = 1;
    specificDateInput.value = "";
    specificDateLabel.textContent = "Choose date";
    specificDateInput.setCustomValidity("");
    datePickerControl.classList.remove("is-active");
    activeRangeLabel.textContent = {
      today: "Today",
      "7": "Last 7 days",
      "30": "Last 30 days",
      all: "All time",
    }[range];
    for (const item of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
      const selected = item === button;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-pressed", String(selected));
    }
    if (latestSnapshot) renderAnalytics(latestSnapshot);
  });
}

specificDateInput.addEventListener("change", () => {
  const value = specificDateInput.value;
  if (!value) return;
  if (
    (specificDateInput.min && value < specificDateInput.min) ||
    (specificDateInput.max && value > specificDateInput.max)
  ) {
    specificDateInput.setCustomValidity(
      `Choose a date between ${formatDateLabel(specificDateInput.min)} and ${formatDateLabel(specificDateInput.max)}.`,
    );
    specificDateInput.reportValidity();
    return;
  }

  specificDateInput.setCustomValidity("");
  selectedRange = "date";
  selectedDate = value;
  sessionPage = 1;
  specificDateLabel.textContent = formatShortDateLabel(value);
  activeRangeLabel.textContent = formatDateLabel(value);
  datePickerControl.classList.add("is-active");
  for (const item of document.querySelectorAll<HTMLButtonElement>("[data-range]")) {
    item.classList.remove("is-active");
    item.setAttribute("aria-pressed", "false");
  }
  if (latestSnapshot) renderAnalytics(latestSnapshot);
});

sessionListElement.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>("[data-session-id]")
    : null;
  if (target?.dataset.sessionId) {
    sessionDetailTriggerId = target.dataset.sessionId;
    openSessionDetail(target.dataset.sessionId);
  }
});
sessionsPrevious.addEventListener("click", () => {
  if (sessionPage <= 1) return;
  sessionPage -= 1;
  if (latestSnapshot) renderAnalytics(latestSnapshot);
});
sessionsNext.addEventListener("click", () => {
  sessionPage += 1;
  if (latestSnapshot) renderAnalytics(latestSnapshot);
});
closeSessionDetailButton.addEventListener("click", closeSessionDetail);
sessionBackdrop.addEventListener("click", closeSessionDetail);
window.addEventListener("keydown", (event) => {
  if (sessionDetailElement.hidden) return;
  if (event.key === "Escape") {
    closeSessionDetail();
    return;
  }
  if (event.key === "Tab") {
    const focusable = [...sessionDetailElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

connect();
