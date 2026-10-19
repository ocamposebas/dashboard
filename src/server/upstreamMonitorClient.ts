import { WebSocket, type RawData } from "ws";
import {
  PRESENCE_SECTIONS,
  type PresenceSnapshot,
} from "../shared/protocol.js";
import type { AppConfig } from "./config.js";

type UpstreamConfig = NonNullable<AppConfig["upstreamMonitor"]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isUpstreamPresenceSnapshot(value: unknown): value is PresenceSnapshot {
  if (!isRecord(value) || value.type !== "presence:snapshot") return false;
  if (!isRecord(value.counts) || !isRecord(value.analytics)) return false;
  if (!finiteNumber(value.total) || typeof value.serverTime !== "string") return false;
  const counts = value.counts;
  if (!PRESENCE_SECTIONS.every((section) => finiteNumber(counts[section]))) {
    return false;
  }

  const analytics = value.analytics;
  const requiredNumbers = [
    "totalViews",
    "uniqueVisitors",
    "returningVisitors",
    "totalSessions",
    "returningSessions",
    "totalClicks",
    "totalOrders",
    "visitorsLast30Minutes",
  ];
  if (!requiredNumbers.every((key) => finiteNumber(analytics[key]))) return false;
  if (typeof analytics.timeZone !== "string") return false;

  const requiredArrays = [
    "topPages",
    "topSources",
    "topDevices",
    "topClicks",
    "dailyViews",
    "dailyVisitors",
    "dailyActivity",
    "recentSessions",
  ];
  return requiredArrays.every((key) => Array.isArray(analytics[key]));
}

function payloadText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return data.toString("utf8");
}

export class UpstreamMonitorClient {
  private socket: WebSocket | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private snapshotDeadlineTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private stopped = true;

  constructor(
    private readonly config: UpstreamConfig,
    private readonly onSnapshot: (snapshot: PresenceSnapshot) => void,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.clearConnectionTimers();
    const socket = this.socket;
    this.socket = undefined;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, 1_000);
      socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.close(1000, "Local relay shutdown");
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    try {
      const cookie = await this.login();
      if (this.stopped) return;
      const socketUrl = new URL(this.config.baseUrl);
      socketUrl.protocol = "wss:";
      socketUrl.pathname = "/ws/dashboard";
      socketUrl.search = "";

      const socket = new WebSocket(socketUrl, {
        origin: this.config.baseUrl,
        headers: { Cookie: cookie },
        maxPayload: 2 * 1024 * 1024,
        handshakeTimeout: 10_000,
      });
      this.socket = socket;
      let awaitingPong = false;

      socket.once("open", () => {
        this.reconnectAttempt = 0;
        this.clearConnectionTimers();
        this.snapshotDeadlineTimer = setTimeout(() => {
          if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) return;
          console.warn("Upstream visitor monitor opened without sending its initial snapshot");
          socket.terminate();
        }, 15_000);
        this.snapshotDeadlineTimer.unref();
        this.heartbeatTimer = setInterval(() => {
          if (this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
            this.clearConnectionTimers();
            return;
          }
          if (awaitingPong) {
            console.warn("Upstream visitor monitor heartbeat timed out");
            socket.terminate();
            return;
          }
          awaitingPong = true;
          socket.ping();
        }, 20_000);
        this.heartbeatTimer.unref();
        console.log(`Connected to upstream visitor monitor at ${this.config.baseUrl}`);
      });
      socket.on("pong", () => { awaitingPong = false; });
      socket.on("message", (data) => {
        awaitingPong = false;
        try {
          const snapshot: unknown = JSON.parse(payloadText(data));
          if (isUpstreamPresenceSnapshot(snapshot)) {
            if (this.snapshotDeadlineTimer) clearTimeout(this.snapshotDeadlineTimer);
            this.snapshotDeadlineTimer = undefined;
            this.onSnapshot(snapshot);
          }
        } catch {
          console.warn("Ignored malformed upstream monitor frame");
        }
      });
      socket.once("close", () => {
        if (this.socket !== socket) return;
        this.clearConnectionTimers();
        this.socket = undefined;
        this.scheduleReconnect();
      });
      socket.once("error", (error) => {
        console.warn("Upstream visitor monitor connection failed", error.message);
        if (this.socket === socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
          socket.terminate();
        }
      });
      socket.once("unexpected-response", (_request, response) => {
        console.warn(`Upstream visitor monitor rejected the connection (${response.statusCode})`);
        socket.terminate();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn("Could not connect to upstream visitor monitor", message);
      this.scheduleReconnect();
    }
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.config.baseUrl}/login`, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Origin: this.config.baseUrl,
        "Sec-Fetch-Site": "same-origin",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
      }),
    });
    const location = response.headers.get("location");
    const cookie = response.headers.getSetCookie()[0]?.split(";", 1)[0];
    if (response.status !== 303 || location !== "/" || !cookie) {
      throw new Error("upstream authentication was rejected");
    }
    return cookie;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1_500 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private clearConnectionTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.snapshotDeadlineTimer) clearTimeout(this.snapshotDeadlineTimer);
    this.heartbeatTimer = undefined;
    this.snapshotDeadlineTimer = undefined;
  }
}
