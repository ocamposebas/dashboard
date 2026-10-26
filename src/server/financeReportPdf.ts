import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { summarizeFinance, type FinanceOrder, type FinanceSummary } from "../shared/financeAnalytics.js";

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 34;
const COLORS = {
  navy: rgb(0.035, 0.075, 0.13),
  ink: rgb(0.08, 0.11, 0.15),
  muted: rgb(0.38, 0.43, 0.49),
  line: rgb(0.82, 0.85, 0.87),
  soft: rgb(0.96, 0.97, 0.975),
  cyan: rgb(0.38, 0.82, 0.91),
  green: rgb(0.08, 0.55, 0.36),
  red: rgb(0.72, 0.19, 0.18),
  amber: rgb(0.76, 0.47, 0.08),
  white: rgb(1, 1, 1),
};

export interface FinanceReportOptions {
  periodLabel: string;
  generatedAt?: Date;
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function percent(value: number | null): string {
  return value === null ? "Incomplete" : `${value.toFixed(1)}%`;
}

function clean(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
}

function fit(value: string, font: PDFFont, size: number, width: number): string {
  const safe = clean(value);
  if (font.widthOfTextAtSize(safe, size) <= width) return safe;
  let output = safe;
  while (output.length > 1 && font.widthOfTextAtSize(`${output}...`, size) > width) output = output.slice(0, -1);
  return `${output.trimEnd()}...`;
}

function drawHeader(page: PDFPage, title: string, period: string, bold: PDFFont, regular: PDFFont, pageNumber: number): void {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 82, width: PAGE_WIDTH, height: 82, color: COLORS.navy });
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 86, width: PAGE_WIDTH, height: 4, color: COLORS.cyan });
  page.drawText("PHASE ONE", { x: MARGIN, y: PAGE_HEIGHT - 38, size: 18, font: bold, color: COLORS.white });
  page.drawText("LABZ", { x: MARGIN + 35, y: PAGE_HEIGHT - 53, size: 6, font: bold, color: COLORS.cyan });
  page.drawText(title, { x: 180, y: PAGE_HEIGHT - 37, size: 16, font: bold, color: COLORS.white });
  page.drawText(fit(period, regular, 7.5, 430), { x: 180, y: PAGE_HEIGHT - 54, size: 7.5, font: regular, color: COLORS.white, opacity: 0.75 });
  page.drawText(`PAGE ${pageNumber}`, { x: PAGE_WIDTH - MARGIN - 38, y: PAGE_HEIGHT - 52, size: 6.5, font: bold, color: COLORS.white, opacity: 0.7 });
}

function drawFooter(page: PDFPage, regular: PDFFont, generatedAt: Date): void {
  page.drawLine({ start: { x: MARGIN, y: 27 }, end: { x: PAGE_WIDTH - MARGIN, y: 27 }, thickness: 0.5, color: COLORS.line });
  page.drawText(`Confidential finance report  |  Generated ${generatedAt.toISOString().slice(0, 19).replace("T", " ")} UTC`, {
    x: MARGIN, y: 14, size: 6, font: regular, color: COLORS.muted,
  });
}

function drawCard(page: PDFPage, x: number, y: number, width: number, label: string, value: string, detail: string, bold: PDFFont, regular: PDFFont, accent = COLORS.cyan): void {
  page.drawRectangle({ x, y, width, height: 61, color: COLORS.soft, borderColor: COLORS.line, borderWidth: 0.6 });
  page.drawRectangle({ x, y, width: 4, height: 61, color: accent });
  page.drawText(label.toUpperCase(), { x: x + 13, y: y + 44, size: 5.8, font: bold, color: COLORS.muted });
  page.drawText(fit(value, bold, 15, width - 25), { x: x + 13, y: y + 23, size: 15, font: bold, color: COLORS.ink });
  page.drawText(fit(detail, regular, 6, width - 25), { x: x + 13, y: y + 9, size: 6, font: regular, color: COLORS.muted });
}

function drawExecutivePage(page: PDFPage, summary: FinanceSummary, options: FinanceReportOptions, bold: PDFFont, regular: PDFFont): void {
  drawHeader(page, "FINANCE COMMAND CENTER", options.periodLabel, bold, regular, 1);
  const cardWidth = (PAGE_WIDTH - MARGIN * 2 - 12 * 3) / 4;
  drawCard(page, MARGIN, 438, cardWidth, "Net revenue", money(summary.revenue, summary.currency), `${number(summary.orders)} paid orders`, bold, regular);
  drawCard(page, MARGIN + (cardWidth + 12), 438, cardWidth, "Net profit", summary.profit === null ? money(summary.knownProfit, summary.currency) : money(summary.profit, summary.currency), summary.profit === null ? `${summary.coverage.toFixed(0)}% cost coverage` : "All costs covered", bold, regular, summary.profit === null ? COLORS.amber : COLORS.green);
  drawCard(page, MARGIN + (cardWidth + 12) * 2, 438, cardWidth, "Margin", percent(summary.margin), summary.margin === null ? "Complete missing SKU costs" : "Profit / net revenue", bold, regular, summary.margin === null ? COLORS.amber : COLORS.green);
  drawCard(page, MARGIN + (cardWidth + 12) * 3, 438, cardWidth, "Units sold", number(summary.units), `${money(summary.averageOrderValue, summary.currency)} average order`, bold, regular);

  page.drawText("COST STRUCTURE", { x: MARGIN, y: 416, size: 6.5, font: bold, color: COLORS.muted });
  const costRows: Array<[string, number, typeof COLORS.cyan]> = [
    ["Inventory / COGS", summary.costs.costOfGoods, COLORS.navy],
    ["Packaging & operations", summary.costs.operating, COLORS.cyan],
    ["Payment processing", summary.costs.paymentFees, COLORS.amber],
    ["Affiliate commissions", summary.costs.affiliates, rgb(0.48, 0.28, 0.76)],
    ["Laboratory testing", summary.costs.testing, rgb(0.12, 0.58, 0.61)],
    ["Refunds", summary.costs.refunds, COLORS.red],
  ];
  const maxCost = Math.max(1, ...costRows.map((row) => row[1]));
  costRows.forEach(([label, value, color], index) => {
    const y = 385 - index * 34;
    page.drawText(label, { x: MARGIN, y: y + 10, size: 7.2, font: regular, color: COLORS.ink });
    page.drawText(money(value, summary.currency), { x: 176, y: y + 10, size: 7.2, font: bold, color: COLORS.ink });
    page.drawRectangle({ x: 250, y: y + 7, width: 205, height: 8, color: COLORS.soft });
    page.drawRectangle({ x: 250, y: y + 7, width: 205 * (value / maxCost), height: 8, color });
  });

  page.drawText("BUSINESS SIGNALS", { x: 497, y: 416, size: 6.5, font: bold, color: COLORS.muted });
  const signals: Array<[string, string, string, typeof COLORS.green]> = [
    ["Best seller", summary.skus[0]?.name || "No sales yet", summary.skus[0] ? `${number(summary.skus[0].units)} units` : "Waiting for orders", COLORS.green],
    ["Negative SKUs", number(summary.negativeSkus), summary.negativeSkus ? "Requires pricing or cost review" : "No losses detected", summary.negativeSkus ? COLORS.red : COLORS.green],
    ["Low-margin SKUs", number(summary.lowMarginSkus), "Below 20% margin", summary.lowMarginSkus ? COLORS.amber : COLORS.green],
    ["Missing costs", number(summary.missingCostSkus), summary.missingCostSkus ? "Profit is intentionally withheld" : "All SKU costs configured", summary.missingCostSkus ? COLORS.amber : COLORS.green],
  ];
  signals.forEach(([label, value, detail, color], index) => {
    const y = 338 - index * 68;
    page.drawRectangle({ x: 497, y, width: 261, height: 56, color: COLORS.soft, borderColor: COLORS.line, borderWidth: 0.5 });
    page.drawRectangle({ x: 497, y, width: 4, height: 56, color });
    page.drawText(label.toUpperCase(), { x: 510, y: y + 39, size: 5.5, font: bold, color: COLORS.muted });
    page.drawText(fit(value, bold, 10.5, 225), { x: 510, y: y + 22, size: 10.5, font: bold, color: COLORS.ink });
    page.drawText(fit(detail, regular, 6, 225), { x: 510, y: y + 8, size: 6, font: regular, color: COLORS.muted });
  });
}

function drawSkuPage(page: PDFPage, summary: FinanceSummary, options: FinanceReportOptions, bold: PDFFont, regular: PDFFont): void {
  drawHeader(page, "SKU PROFITABILITY", `${options.periodLabel} | Exact product and variation performance`, bold, regular, 2);
  const columns = [34, 64, 250, 340, 390, 475, 558, 646, 724];
  const widths = [30, 180, 86, 48, 80, 78, 84, 74, 34];
  const headers = ["#", "PRODUCT / SKU", "UNITS", "ORDERS", "NET SALES", "TOTAL COST", "NET PROFIT", "MARGIN", "COVER"];
  page.drawRectangle({ x: MARGIN, y: 484, width: PAGE_WIDTH - MARGIN * 2, height: 24, color: COLORS.navy });
  headers.forEach((header, index) => page.drawText(header, { x: columns[index]! + 4, y: 493, size: 5.5, font: bold, color: COLORS.white }));
  const rows = summary.skus.slice(0, 16);
  rows.forEach((sku, index) => {
    const y = 458 - index * 26;
    if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - 5, width: PAGE_WIDTH - MARGIN * 2, height: 26, color: COLORS.soft });
    page.drawText(String(index + 1).padStart(2, "0"), { x: columns[0]! + 4, y: y + 5, size: 6.5, font: bold, color: COLORS.muted });
    page.drawText(fit(sku.name, bold, 6.7, widths[1]! - 8), { x: columns[1]! + 4, y: y + 8, size: 6.7, font: bold, color: COLORS.ink });
    page.drawText(fit(sku.sku || `Product ${sku.productId}`, regular, 5.5, widths[1]! - 8), { x: columns[1]! + 4, y: y - 1, size: 5.5, font: regular, color: COLORS.muted });
    const values = [
      number(sku.units), number(sku.orders), money(sku.allocatedRevenue - sku.refunds, summary.currency),
      money(sku.costs.total, summary.currency), sku.profit === null ? "Incomplete" : money(sku.profit, summary.currency),
      percent(sku.margin), `${sku.coverage.toFixed(0)}%`,
    ];
    values.forEach((value, valueIndex) => {
      const color = valueIndex === 4 && sku.profit !== null && sku.profit < 0 ? COLORS.red : valueIndex >= 4 && sku.profit === null ? COLORS.amber : COLORS.ink;
      page.drawText(fit(value, valueIndex >= 4 ? bold : regular, 6.2, widths[valueIndex + 2]! - 7), {
        x: columns[valueIndex + 2]! + 4, y: y + 4, size: 6.2, font: valueIndex >= 4 ? bold : regular, color,
      });
    });
  });
  if (!rows.length) page.drawText("No paid SKU sales were found for this period.", { x: MARGIN, y: 450, size: 10, font: regular, color: COLORS.muted });
  page.drawText("HOW TO READ THIS TABLE", { x: MARGIN, y: 49, size: 6, font: bold, color: COLORS.muted });
  page.drawText("Net sales reconcile order revenue and refunds to the exact SKU. Total cost includes inventory, packaging, processing, affiliate and testing costs. Incomplete rows never invent profit.", {
    x: MARGIN, y: 37, size: 6, font: regular, color: COLORS.muted,
  });
}

export async function buildFinanceReportPdf(orders: FinanceOrder[], options: FinanceReportOptions): Promise<Buffer> {
  const summary = summarizeFinance(orders);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const generatedAt = options.generatedAt || new Date();
  const executive = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawExecutivePage(executive, summary, options, bold, regular);
  const skus = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawSkuPage(skus, summary, options, bold, regular);
  for (const page of pdf.getPages()) drawFooter(page, regular, generatedAt);
  pdf.setTitle(`Phase One Labz Finance - ${clean(options.periodLabel)}`);
  pdf.setAuthor("Phase One Labz Operations");
  pdf.setSubject("Executive finance, costs and SKU profitability report");
  pdf.setCreationDate(generatedAt);
  return Buffer.from(await pdf.save());
}
