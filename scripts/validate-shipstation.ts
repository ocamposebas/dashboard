import { loadShipStationConfig } from "../src/server/config.js";
import { ShipStationGateway } from "../src/server/shipStationGateway.js";

async function main(): Promise<void> {
  const gateway = new ShipStationGateway(loadShipStationConfig());
  const capabilities = await gateway.capabilities();
  const summary = {
    credentialConfigured: capabilities.credentialConfigured,
    connected: capabilities.connected,
    dataMode: capabilities.dataMode,
    rateShoppingAvailable: capabilities.rateShoppingAvailable,
    originName: capabilities.originName,
    carriers: capabilities.carriers.map((carrier) => ({
      id: carrier.id,
      code: carrier.code,
      name: carrier.name,
      nickname: carrier.nickname,
      services: carrier.services.map((service) => ({ code: service.code, name: service.name })),
      packages: carrier.packages.map((item) => ({ code: item.code, name: item.name })),
    })),
    checkedAt: capabilities.checkedAt,
    ...(capabilities.error ? { error: capabilities.error } : {}),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!capabilities.connected || !capabilities.rateShoppingAvailable) process.exitCode = 1;
}

main().catch(() => {
  console.error("ShipStation read-only validation failed safely");
  process.exitCode = 1;
});
