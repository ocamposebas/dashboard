export interface CameraNumericCapability {
  min: number;
  max: number;
  step?: number;
}

export interface CameraTrackCapabilitiesLike {
  focusMode?: readonly string[];
  zoom?: CameraNumericCapability;
}

export interface CameraTrackSettingsLike {
  zoom?: number;
}

export interface CameraOptimizationPlan {
  focusMode?: "continuous";
  zoom?: number;
}

const roundToStep = (value: number, range: CameraNumericCapability): number => {
  if (!range.step || range.step <= 0) return value;
  const steps = Math.round((value - range.min) / range.step);
  return range.min + steps * range.step;
};

/**
 * Builds a conservative camera plan for the tiny QR printed on a vial. The
 * browser remains free to ignore unsupported controls, while capable phones
 * receive continuous focus and a modest optical/sensor zoom automatically.
 */
export function cameraOptimizationPlan(
  capabilities: CameraTrackCapabilitiesLike,
  settings: CameraTrackSettingsLike = {},
  preferredZoom = 2,
): CameraOptimizationPlan {
  const plan: CameraOptimizationPlan = {};
  if (capabilities.focusMode?.includes("continuous")) plan.focusMode = "continuous";

  const range = capabilities.zoom;
  if (
    range
    && Number.isFinite(range.min)
    && Number.isFinite(range.max)
    && range.max >= range.min
    && range.max > 1
  ) {
    const requested = Math.max(range.min, Math.min(range.max, preferredZoom));
    const stepped = roundToStep(requested, range);
    plan.zoom = Math.max(range.min, Math.min(range.max, stepped));
  } else if (typeof settings.zoom === "number" && Number.isFinite(settings.zoom) && settings.zoom > 1) {
    plan.zoom = settings.zoom;
  }

  return plan;
}

export function cameraOptimizationLabel(plan: CameraOptimizationPlan): string {
  const parts: string[] = [];
  if (plan.focusMode) parts.push("continuous focus");
  if (plan.zoom && plan.zoom > 1) parts.push(`${plan.zoom.toFixed(1).replace(/\.0$/, "")}x close-up`);
  return parts.join(" · ");
}
