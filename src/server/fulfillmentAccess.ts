import type { ManagedUserRole } from "./presenceStore.js";

export interface FulfillmentAccess {
  read: boolean;
  operateQueue: boolean;
  printLabels: boolean;
  manageLocations: boolean;
}

export function fulfillmentAccessForRole(role: ManagedUserRole): FulfillmentAccess {
  const administrator = role === "owner" || role === "administrator";
  return {
    read: true,
    operateQueue: administrator || role === "operations",
    printLabels: administrator || role === "operations",
    manageLocations: administrator,
  };
}
