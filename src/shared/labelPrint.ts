import type { BarcodeLabel, ThermalLabelLayout, ThermalLabelSize } from "./barcodeFulfillment.js";

const LABEL_SIZES: Record<ThermalLabelSize, Omit<ThermalLabelLayout, "copies">> = {
  "2x1": {
    size: "2x1",
    widthInches: 2,
    heightInches: 1,
    barcodeHeightMillimeters: 7,
  },
  "3x1": {
    size: "3x1",
    widthInches: 3,
    heightInches: 1,
    barcodeHeightMillimeters: 8,
  },
};

export function normalizeThermalLabelLayout(
  size: unknown,
  copies: unknown,
): ThermalLabelLayout {
  const normalizedSize: ThermalLabelSize = size === "3x1" ? "3x1" : "2x1";
  const requestedCopies = Number(copies);
  const normalizedCopies = Number.isSafeInteger(requestedCopies)
    ? Math.min(50, Math.max(1, requestedCopies))
    : 1;
  return { ...LABEL_SIZES[normalizedSize], copies: normalizedCopies };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] || character);
}

function safeBarcodeSvg(svg: string): string {
  const normalized = svg.trim();
  if (
    !normalized.startsWith("<svg") ||
    !normalized.endsWith("</svg>") ||
    /<(?:script|foreignObject|iframe)|\son\w+\s*=/i.test(normalized)
  ) {
    throw new Error("The barcode artwork is not a safe SVG document");
  }
  return normalized;
}

export function buildThermalLabelDocument(label: BarcodeLabel, styleNonce = ""): string {
  const { widthInches, heightInches, copies } = label.layout;
  const title = label.variantName
    ? `${label.productName} · ${label.variantName}`
    : label.productName;
  const batchLine = label.lot
    ? `<div class="batch"><span>LOT</span><b>${escapeHtml(label.lot)}</b>${label.coaNumber ? `<i>${escapeHtml(label.coaNumber)}</i>` : ""}</div>`
    : "";
  const item = `<section class="label">
    <header><span>PHASE ONE LABZ</span><b>${escapeHtml(label.locationCode)}</b></header>
    <main><h1>${escapeHtml(title)}</h1><p>SKU ${escapeHtml(label.sku)}</p>${batchLine}</main>
    <div class="barcode">${safeBarcodeSvg(label.svg)}<small>${escapeHtml(label.token)}</small></div>
  </section>`;
  const labels = Array.from({ length: copies }, () => item).join("");
  const nonceAttribute = styleNonce ? ` nonce="${escapeHtml(styleNonce)}"` : "";
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Phase One labels</title><style${nonceAttribute}>
    @page { size: ${widthInches}in ${heightInches}in; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #080808; font-family: Arial, Helvetica, sans-serif; }
    .label { width: ${widthInches}in; height: ${heightInches}in; padding: .06in .1in .045in; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: .16in .27in minmax(0, 1fr); overflow: hidden; page-break-after: always; break-after: page; }
    .label:last-child { page-break-after: auto; break-after: auto; }
    header { display: flex; align-items: start; justify-content: space-between; border-bottom: 1px solid #111; font-size: 6.5pt; letter-spacing: .08em; }
    header b { font-size: 8pt; letter-spacing: .04em; }
    main { min-width: 0; padding-top: .035in; }
    h1 { margin: 0 0 .018in; font-size: ${widthInches === 2 ? "8pt" : "9.5pt"}; line-height: 1.05; max-height: .16in; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    p { margin: 0; font-size: 6.5pt; font-weight: 700; }
    .batch { display: flex; align-items: baseline; gap: .035in; margin-top: .02in; font-size: 5.5pt; white-space: nowrap; overflow: hidden; }
    .batch span { border: 1px solid #111; padding: 1px 2px; font-weight: 700; }
    .batch b { overflow: hidden; text-overflow: ellipsis; }
    .batch i { font-style: normal; color: #333; overflow: hidden; text-overflow: ellipsis; }
    .barcode { display: flex; flex-direction: column; align-items: center; justify-content: end; min-width: 0; overflow: hidden; }
    .barcode svg { width: 100%; height: auto; max-height: .38in; display: block; }
    .barcode small { margin-top: 1px; font: 5pt/1 Arial, Helvetica, sans-serif; letter-spacing: .11em; }
  </style></head><body>${labels}</body></html>`;
}
