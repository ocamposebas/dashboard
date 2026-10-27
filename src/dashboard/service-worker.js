const APP_ICON = "/assets/phase-one-ops-icon-192-v1.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = typeof payload.title === "string" ? payload.title : "New Phase One order";
  const body = typeof payload.body === "string" ? payload.body : "Open Operations to review it.";
  const tag = typeof payload.tag === "string" ? payload.tag : "phaseone-new-order";
  const url = typeof payload.url === "string" ? payload.url : "/#orders";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: APP_ICON,
    badge: APP_ICON,
    tag,
    renotify: true,
    data: { url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/#orders", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.startsWith(self.location.origin));
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
