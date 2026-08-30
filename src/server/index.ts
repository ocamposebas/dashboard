import { loadConfig } from "./config.js";
import { createMonitorServer } from "./httpServer.js";
import { PresenceStore } from "./presenceStore.js";
import { SocketHub } from "./socketHub.js";

const config = loadConfig();
const store = new PresenceStore(
  config.redisUrl,
  config.redisKeyPrefix,
  config.presenceTtlMs,
);
const server = createMonitorServer(config, store);
const hub = new SocketHub(config, store);

await store.connect(() => hub.scheduleSnapshot());
hub.attach(server);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Phase One Live Monitor listening on port ${config.port}`);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down`);
  server.close();
  await hub.close();
  await store.disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
