import type { IncomingMessage, Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { isPresenceSection, type PresenceSection } from "../shared/protocol.js";
import type { AppConfig } from "./config.js";
import { verifySessionCookie } from "./auth.js";
import type { PresenceStore } from "./presenceStore.js";

const VISITOR_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const CONNECTION_ID_PATTERN = /^[a-f0-9-]{16,64}$/i;
const MAX_CONNECTIONS_PER_MINUTE = 120;

interface TrackerState {
  visitorId: string;
  connectionId: string;
  section: PresenceSection;
  path: string;
  source: string;
  device: "Mobile" | "Tablet" | "Desktop";
}

function validPagePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && value.length <= 240 && !value.includes("?");
}

function validLabel(value: unknown, max = 80): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function validDevice(value: unknown): value is "Mobile" | "Tablet" | "Desktop" {
  return value === "Mobile" || value === "Tablet" || value === "Desktop";
}

interface RateEntry {
  windowStartedAt: number;
  count: number;
}

interface LiveSocket extends WebSocket {
  isAlive?: boolean;
}

function originAllowed(origin: string | undefined, allowed: Set<string>): boolean {
  if (!origin) return false;
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

function dashboardOriginAllowed(origin: string | undefined, configured: string): boolean {
  if (!origin) return false;
  try {
    const supplied = new URL(origin);
    const expected = new URL(configured);
    const suppliedHost = supplied.hostname.replace(/^www\./i, "");
    const expectedHost = expected.hostname.replace(/^www\./i, "");
    return (
      supplied.protocol === expected.protocol &&
      supplied.port === expected.port &&
      suppliedHost === expectedHost
    );
  } catch {
    return false;
  }
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function remoteAddress(request: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers["x-real-ip"];
    if (typeof forwarded === "string" && forwarded.length <= 64) return forwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

function parseMessage(data: RawData): unknown {
  let buffer: Buffer;
  if (Array.isArray(data)) buffer = Buffer.concat(data);
  else if (data instanceof ArrayBuffer) buffer = Buffer.from(new Uint8Array(data));
  else if (Buffer.isBuffer(data)) buffer = data;
  else throw new Error("Unsupported WebSocket payload");
  const raw = buffer.toString("utf8");
  return JSON.parse(raw) as unknown;
}

export class SocketHub {
  private readonly trackerServer = new WebSocketServer({
    noServer: true,
    maxPayload: 4_096,
  });
  private readonly dashboardServer = new WebSocketServer({
    noServer: true,
    maxPayload: 1_024,
  });
  private readonly dashboardSockets = new Set<LiveSocket>();
  private readonly rateEntries = new Map<string, RateEntry>();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private snapshotTimer: NodeJS.Timeout | undefined;
  private lastSnapshotSignature = "";

  constructor(
    private readonly config: AppConfig,
    private readonly store: PresenceStore,
  ) {
    this.trackerServer.on("connection", (socket) =>
      this.handleTracker(socket as LiveSocket),
    );
    this.dashboardServer.on("connection", (socket) =>
      this.handleDashboard(socket as LiveSocket),
    );
  }

  attach(server: HttpServer): void {
    server.on("upgrade", (request, socket, head) => {
      const path = requestPath(request);

      if (path === "/ws/presence") {
        if (
          !originAllowed(request.headers.origin, this.config.trackerOrigins) ||
          !this.allowConnection(remoteAddress(request, this.config.trustProxy))
        ) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        this.trackerServer.handleUpgrade(request, socket, head, (webSocket) => {
          this.trackerServer.emit("connection", webSocket, request);
        });
        return;
      }

      if (path === "/ws/dashboard") {
        const authenticated = verifySessionCookie(request.headers.cookie, {
          username: this.config.monitorUsername,
          sessionSecret: this.config.sessionSecret,
        });
        if (
          !dashboardOriginAllowed(
            request.headers.origin,
            this.config.dashboardOrigin,
          ) ||
          !authenticated
        ) {
          socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
          socket.destroy();
          return;
        }
        this.dashboardServer.handleUpgrade(request, socket, head, (webSocket) => {
          this.dashboardServer.emit("connection", webSocket, request);
        });
        return;
      }

      socket.destroy();
    });

    this.heartbeatTimer = setInterval(() => this.heartbeatSockets(), 25_000);
    this.heartbeatTimer.unref();
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    for (const socket of this.dashboardSockets) socket.close(1001, "Shutdown");
    for (const socket of this.trackerServer.clients) socket.close(1001, "Shutdown");
    this.trackerServer.close();
    this.dashboardServer.close();
  }

  scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      void this.broadcastSnapshot(false);
    }, 50);
  }

  private handleTracker(socket: LiveSocket): void {
    socket.isAlive = true;
    let state: TrackerState | undefined;
    let messageWindowStartedAt = Date.now();
    let messageCount = 0;
    const helloTimeout = setTimeout(() => socket.close(4400, "Hello required"), 5_000);

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (data) => {
      const now = Date.now();
      if (now - messageWindowStartedAt >= 60_000) {
        messageWindowStartedAt = now;
        messageCount = 0;
      }
      messageCount += 1;
      if (messageCount > 60) {
        socket.close(4408, "Message rate exceeded");
        return;
      }

      void (async () => {
        let message: unknown;
        try {
          message = parseMessage(data);
        } catch {
          socket.close(4400, "Invalid message");
          return;
        }

        if (!message || typeof message !== "object") return;
        const payload = message as Record<string, unknown>;

        if (payload.type === "presence:hello") {
          if (state) {
            socket.close(4400, "Presence already initialized");
            return;
          }
          if (
            typeof payload.visitorId !== "string" ||
            typeof payload.connectionId !== "string" ||
            !VISITOR_ID_PATTERN.test(payload.visitorId) ||
            !CONNECTION_ID_PATTERN.test(payload.connectionId) ||
            !isPresenceSection(payload.section) ||
            !validPagePath(payload.path) ||
            !validLabel(payload.source) ||
            !validDevice(payload.device)
          ) {
            socket.close(4400, "Invalid presence identity");
            return;
          }
          state = {
            visitorId: payload.visitorId,
            connectionId: payload.connectionId,
            section: payload.section,
            path: payload.path,
            source: payload.source.trim(),
            device: payload.device,
          };
          clearTimeout(helloTimeout);
          await this.store.touch(
            state.visitorId,
            state.connectionId,
            state.section,
          );
          await this.store.startSession({
            sessionId: state.visitorId,
            source: state.source,
            device: state.device,
            path: state.path,
          });
          await this.store.recordPageView(
            state.visitorId,
            state.visitorId,
            state.path,
          );
          return;
        }

        if (!state) return;

        if (
          payload.type === "presence:heartbeat" ||
          payload.type === "presence:section"
        ) {
          if (!isPresenceSection(payload.section)) return;
          state.section = payload.section;
          if (validPagePath(payload.path) && payload.path !== state.path) {
            state.path = payload.path;
            await this.store.recordPageView(
              state.visitorId,
              state.visitorId,
              state.path,
            );
          }
          await this.store.touch(
            state.visitorId,
            state.connectionId,
            state.section,
          );
          return;
        }

        if (payload.type === "presence:inactive") {
          await this.store.remove(state.visitorId, state.connectionId);
          state = undefined;
          socket.close(1000, "Inactive");
          return;
        }

        if (
          payload.type === "analytics:click" &&
          validPagePath(payload.path) &&
          validLabel(payload.label)
        ) {
          await this.store.recordClick(
            state.visitorId,
            payload.path,
            payload.label.trim(),
          );
        }
      })().catch((error: unknown) => {
        console.error("Presence message failed", error);
        socket.close(1011, "Presence unavailable");
      });
    });

    socket.on("close", () => clearTimeout(helloTimeout));
    socket.on("error", () => clearTimeout(helloTimeout));
  }

  private handleDashboard(socket: LiveSocket): void {
    socket.isAlive = true;
    this.dashboardSockets.add(socket);
    socket.on("pong", () => {
      socket.isAlive = true;
    });
    socket.on("close", () => this.dashboardSockets.delete(socket));
    socket.on("error", () => this.dashboardSockets.delete(socket));
    void this.sendSnapshot(socket);
  }

  private async sendSnapshot(socket: WebSocket): Promise<void> {
    try {
      const snapshot = await this.store.snapshot();
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(snapshot));
    } catch (error) {
      console.error("Could not send presence snapshot", error);
      socket.close(1011, "Presence unavailable");
    }
  }

  private async broadcastSnapshot(force: boolean): Promise<void> {
    if (this.dashboardSockets.size === 0) return;
    try {
      const snapshot = await this.store.snapshot();
      const signature = JSON.stringify([snapshot.counts, snapshot.analytics]);
      if (!force && signature === this.lastSnapshotSignature) return;
      this.lastSnapshotSignature = signature;
      const serialized = JSON.stringify(snapshot);
      for (const socket of this.dashboardSockets) {
        if (socket.readyState === WebSocket.OPEN) socket.send(serialized);
      }
    } catch (error) {
      console.error("Could not broadcast presence snapshot", error);
    }
  }

  private heartbeatSockets(): void {
    const sockets = [
      ...this.trackerServer.clients,
      ...this.dashboardServer.clients,
    ] as LiveSocket[];
    for (const socket of sockets) {
      if (socket.isAlive === false) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }

  private allowConnection(address: string): boolean {
    const now = Date.now();
    if (this.rateEntries.size > 1_000) {
      for (const [key, entry] of this.rateEntries) {
        if (entry.windowStartedAt + 60_000 < now) this.rateEntries.delete(key);
      }
    }
    const current = this.rateEntries.get(address);
    if (!current || now - current.windowStartedAt >= 60_000) {
      this.rateEntries.set(address, { windowStartedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= MAX_CONNECTIONS_PER_MINUTE;
  }
}
