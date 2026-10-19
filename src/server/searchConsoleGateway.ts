import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { PresenceStore } from "./presenceStore.js";

type SearchConsoleConfig = NonNullable<AppConfig["googleSearchConsole"]>;

interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface SearchConsoleSite {
  siteUrl: string;
  permissionLevel: string;
}

interface StoredConnection {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  siteUrl: string;
  sites: SearchConsoleSite[];
  connectedAt: string;
}

interface AnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

interface AnalyticsResponse { rows?: AnalyticsRow[]; responseAggregationType?: string; metadata?: Record<string, unknown>; }

function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }
function shiftDays(date: Date, days: number): Date { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function finite(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

export class SearchConsoleGateway {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly config: SearchConsoleConfig,
    private readonly store: PresenceStore,
    sessionSecret: string,
  ) {
    this.encryptionKey = createHash("sha256").update(sessionSecret).digest();
  }

  authorizationUrl(state: string): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<StoredConnection> {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok) throw new Error(`Google token exchange failed (${response.status})`);
    const token = await response.json() as OAuthTokenResponse;
    if (!token.access_token || !token.refresh_token) throw new Error("Google did not return an offline refresh token");
    const sites = await this.listSitesWithToken(token.access_token);
    const preferred = this.config.preferredSiteUrl;
    const siteUrl = sites.find((site) => site.siteUrl === preferred)?.siteUrl || sites[0]?.siteUrl || preferred;
    if (!siteUrl) throw new Error("No Search Console property is available for this account");
    const connection: StoredConnection = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1_000,
      siteUrl,
      sites,
      connectedAt: new Date().toISOString(),
    };
    await this.saveConnection(connection);
    return connection;
  }

  async status(): Promise<{ configured: true; connected: boolean; siteUrl: string | null; sites: SearchConsoleSite[]; connectedAt: string | null }> {
    const connection = await this.loadConnection();
    return {
      configured: true,
      connected: Boolean(connection),
      siteUrl: connection?.siteUrl || null,
      sites: connection?.sites || [],
      connectedAt: connection?.connectedAt || null,
    };
  }

  async selectSite(siteUrl: string): Promise<void> {
    const connection = await this.requireConnection();
    if (!connection.sites.some((site) => site.siteUrl === siteUrl)) throw new Error("Unknown Search Console property");
    await this.saveConnection({ ...connection, siteUrl });
  }

  async sync(): Promise<Record<string, unknown>> {
    const connection = await this.ensureAccessToken(await this.requireConnection());
    const now = new Date();
    const end = shiftDays(now, -1);
    const start = shiftDays(end, -27);
    const previousEnd = shiftDays(start, -1);
    const previousStart = shiftDays(previousEnd, -27);
    const [currentTotal, previousTotal, daily, queries, pages, countries, devices, sitemaps] = await Promise.all([
      this.query(connection, start, end, [], 1),
      this.query(connection, previousStart, previousEnd, [], 1),
      this.query(connection, start, end, ["date"], 100),
      this.query(connection, start, end, ["query"], 250),
      this.query(connection, start, end, ["page"], 250),
      this.query(connection, start, end, ["country"], 100),
      this.query(connection, start, end, ["device"], 10),
      this.listSitemaps(connection),
    ]);
    const current = currentTotal.rows?.[0] || {};
    const previous = previousTotal.rows?.[0] || {};
    const totals = {
      clicks: finite(current.clicks), impressions: finite(current.impressions),
      ctr: finite(current.ctr), position: finite(current.position),
    };
    const previousTotals = {
      clicks: finite(previous.clicks), impressions: finite(previous.impressions),
      ctr: finite(previous.ctr), position: finite(previous.position),
    };
    const row = (item: AnalyticsRow) => ({
      key: item.keys?.[0] || "Unknown", clicks: finite(item.clicks), impressions: finite(item.impressions),
      ctr: finite(item.ctr), position: finite(item.position),
    });
    const queryRows = (queries.rows || []).map(row);
    const pageRows = (pages.rows || []).map(row);
    const opportunities = [
      ...queryRows.filter((item) => item.impressions >= 100 && item.ctr < .035 && item.position <= 20).slice(0, 8).map((item) => ({
        type: "query", title: item.key, message: `${Math.round(item.impressions).toLocaleString("en-US")} impressions with ${(item.ctr * 100).toFixed(1)}% CTR`, impact: "Improve title and search intent match", ...item,
      })),
      ...pageRows.filter((item) => item.impressions >= 100 && item.position > 4 && item.position <= 20).slice(0, 6).map((item) => ({
        type: "page", title: item.key, message: `Average position ${item.position.toFixed(1)}`, impact: "Strengthen content and internal links", ...item,
      })),
    ].sort((left, right) => right.impressions - left.impressions).slice(0, 10);
    const report: Record<string, unknown> = {
      connected: true, siteUrl: connection.siteUrl, period: { start: dateKey(start), end: dateKey(end), days: 28 },
      totals, previousTotals,
      changes: {
        clicks: percentChange(totals.clicks, previousTotals.clicks),
        impressions: percentChange(totals.impressions, previousTotals.impressions),
        ctr: percentChange(totals.ctr, previousTotals.ctr),
        position: totals.position && previousTotals.position ? previousTotals.position - totals.position : null,
      },
      daily: (daily.rows || []).map(row), topQueries: queryRows.slice(0, 25), topPages: pageRows.slice(0, 25),
      countries: (countries.rows || []).map(row), devices: (devices.rows || []).map(row), opportunities,
      sitemaps, syncedAt: new Date().toISOString(), dataState: daily.metadata || null,
    };
    const earlierReport = await this.store.getSeoReport();
    const earlierOpportunityCount = Array.isArray(earlierReport?.opportunities)
      ? earlierReport.opportunities.length
      : -1;
    await this.store.saveSeoReport(report);
    if (opportunities.length && opportunities.length !== earlierOpportunityCount) {
      await this.store.addNotification({
        type: "seo", severity: "warning", title: `${opportunities.length} SEO opportunities detected`,
        message: "High-impression searches and pages can gain traffic with focused optimization.", actionView: "seo",
      });
    }
    return report;
  }

  async disconnect(): Promise<void> { await this.store.clearSeoConnection(); }

  private async listSitesWithToken(accessToken: string): Promise<SearchConsoleSite[]> {
    const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
    if (!response.ok) throw new Error(`Search Console properties could not be loaded (${response.status})`);
    const payload = await response.json() as { siteEntry?: SearchConsoleSite[] };
    return payload.siteEntry || [];
  }

  private async query(connection: StoredConnection, start: Date, end: Date, dimensions: string[], rowLimit: number): Promise<AnalyticsResponse> {
    const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.siteUrl)}/searchAnalytics/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${connection.accessToken}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ startDate: dateKey(start), endDate: dateKey(end), dimensions, type: "web", rowLimit, dataState: "all" }),
    });
    if (!response.ok) throw new Error(`Search analytics request failed (${response.status})`);
    return response.json() as Promise<AnalyticsResponse>;
  }

  private async listSitemaps(connection: StoredConnection): Promise<Array<Record<string, unknown>>> {
    const response = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(connection.siteUrl)}/sitemaps`, {
      headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: "application/json" },
    });
    if (!response.ok) return [];
    const payload = await response.json() as { sitemap?: Array<Record<string, unknown>> };
    return payload.sitemap || [];
  }

  private async ensureAccessToken(connection: StoredConnection): Promise<StoredConnection> {
    if (connection.expiresAt > Date.now() + 60_000) return connection;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: connection.refreshToken, grant_type: "refresh_token" }),
    });
    if (!response.ok) throw new Error(`Google access token refresh failed (${response.status})`);
    const token = await response.json() as OAuthTokenResponse;
    const updated = { ...connection, accessToken: token.access_token, expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1_000 };
    await this.saveConnection(updated);
    return updated;
  }

  private async requireConnection(): Promise<StoredConnection> {
    const connection = await this.loadConnection();
    if (!connection) throw new Error("Search Console is not connected");
    return connection;
  }

  private async saveConnection(connection: StoredConnection): Promise<void> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(connection), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    await this.store.saveSeoConnection(Buffer.concat([iv, tag, encrypted]).toString("base64url"));
  }

  private async loadConnection(): Promise<StoredConnection | null> {
    const encoded = await this.store.getSeoConnection();
    if (!encoded) return null;
    try {
      const payload = Buffer.from(encoded, "base64url");
      const iv = payload.subarray(0, 12); const tag = payload.subarray(12, 28); const encrypted = payload.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, iv); decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")) as StoredConnection;
    } catch { return null; }
  }
}
