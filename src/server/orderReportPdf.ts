import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import type { CommerceOrder } from "./wooCommerceGateway.js";

export interface OrderReportOptions {
  periodLabel: string;
  generatedAt?: Date;
  timeZone?: string;
}

export interface OrderFinancialBreakdown {
  productNet: number;
  itemSubtotal: number;
  discounts: number;
  shipping: number;
  taxes: number;
  fees: number;
  processingCost: number;
  refunds: number;
  orderTotal: number;
  netRetained: number;
}

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 32;
const LOGO_PNG_BASE64 = "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";
const COLORS = {
  ink: rgb(0.08, 0.10, 0.15),
  muted: rgb(0.38, 0.42, 0.49),
  line: rgb(0.86, 0.88, 0.91),
  soft: rgb(0.96, 0.97, 0.98),
  navy: rgb(0.035, 0.075, 0.14),
  blue: rgb(0.07, 0.28, 0.56),
  accent: rgb(0.88, 0.43, 0.12),
  white: rgb(1, 1, 1),
};

function amount(value: number, currency: string): string {
  try {
    return cleanText(new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value));
  } catch {
    return cleanText(`${currency} ${value.toFixed(2)}`);
  }
}

function reportDate(value: string | null, timeZone: string): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(parsed);
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gi, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u00b7\u2022\u25cf]/g, "-")
    .replace(/\u00d7/g, "x")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = cleanText(text).split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = character;
      } else chunk += character;
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

export function orderFinancialBreakdown(order: CommerceOrder): OrderFinancialBreakdown {
  const productNet = order.lineItems.reduce((sum, item) => sum + item.total, 0);
  const itemSubtotal = order.lineItems.reduce((sum, item) => sum + item.subtotal, 0);
  const fees = order.feeLines.reduce((sum, fee) => sum + fee.total, 0);
  const processingCost = Math.max(0, order.paymentOperations.processingFee);
  const refunds = Math.max(0, order.refundedTotal);
  return {
    productNet,
    itemSubtotal,
    discounts: Math.max(0, order.discountTotal),
    shipping: Math.max(0, order.shippingTotal),
    taxes: Math.max(0, order.totalTax),
    fees,
    processingCost,
    refunds,
    orderTotal: order.total,
    netRetained: Math.max(0, order.total - refunds - processingCost),
  };
}

/** @deprecated Retained only for compatibility with earlier report snapshots. */
export async function buildLegacyOrderReportPdf(
  orders: CommerceOrder[],
  options: OrderReportOptions,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const timeZone = options.timeZone || "America/Bogota";
  const generatedAt = options.generatedAt || new Date();
  const currency = orders[0]?.currency || "USD";
  const totals = orders.reduce((result, order) => {
    const values = orderFinancialBreakdown(order);
    result.gross += values.orderTotal;
    result.productNet += values.productNet;
    result.shipping += values.shipping;
    result.taxes += values.taxes;
    result.fees += values.fees + values.processingCost;
    result.refunds += values.refunds;
    result.net += values.netRetained;
    return result;
  }, { gross: 0, productNet: 0, shipping: 0, taxes: 0, fees: 0, refunds: 0, net: 0 });

  let page!: PDFPage;
  let y = 0;

  const newPage = (title = "ORDER FINANCIAL REPORT") => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 92, width: PAGE_WIDTH, height: 92, color: COLORS.navy });
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 96, width: PAGE_WIDTH, height: 4, color: COLORS.accent });
    page.drawText("PHASE ONE LABZ", { x: MARGIN, y: PAGE_HEIGHT - 40, size: 10, font: bold, color: COLORS.white });
    page.drawText(title, { x: MARGIN, y: PAGE_HEIGHT - 66, size: 19, font: bold, color: COLORS.white });
    y = PAGE_HEIGHT - 124;
    return page;
  };

  const ensureSpace = (height: number, title?: string) => {
    if (y - height >= 44) return;
    newPage(title || "ORDER FINANCIAL REPORT - CONTINUED");
  };

  const drawLabelValue = (x: number, width: number, label: string, value: string) => {
    page.drawText(label.toUpperCase(), { x, y, size: 7, font: bold, color: COLORS.muted });
    const fitted = wrapText(value, bold, 12, width)[0] || "-";
    page.drawText(fitted, { x, y: y - 17, size: 12, font: bold, color: COLORS.ink });
  };

  newPage();
  page.drawText(cleanText(options.periodLabel) || "Selected period", { x: MARGIN, y, size: 14, font: bold, color: COLORS.ink });
  page.drawText(cleanText(`Generated ${reportDate(generatedAt.toISOString(), timeZone)} - ${timeZone}`), {
    x: MARGIN,
    y: y - 18,
    size: 8,
    font: regular,
    color: COLORS.muted,
  });
  y -= 52;

  const summaryCards: Array<[string, string]> = [
    ["Orders", String(orders.length)],
    ["Gross collected", amount(totals.gross, currency)],
    ["Product net", amount(totals.productNet, currency)],
    ["Shipping", amount(totals.shipping, currency)],
    ["Taxes", amount(totals.taxes, currency)],
    ["Net after fees/refunds", amount(totals.net, currency)],
  ];
  summaryCards.forEach(([label, value], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const width = (PAGE_WIDTH - MARGIN * 2 - 16) / 3;
    const x = MARGIN + column * (width + 8);
    const cardY = y - row * 64;
    page.drawRectangle({ x, y: cardY - 48, width, height: 52, color: COLORS.soft, borderColor: COLORS.line, borderWidth: 0.6 });
    page.drawText(label.toUpperCase(), { x: x + 10, y: cardY - 14, size: 6.5, font: bold, color: COLORS.muted });
    page.drawText(value, { x: x + 10, y: cardY - 34, size: 11.5, font: bold, color: COLORS.ink });
  });
  y -= 142;

  if (!orders.length) {
    page.drawRectangle({ x: MARGIN, y: y - 76, width: PAGE_WIDTH - MARGIN * 2, height: 82, color: COLORS.soft });
    page.drawText("No orders were found in this period.", { x: MARGIN + 18, y: y - 30, size: 13, font: bold, color: COLORS.ink });
    page.drawText("Change the reporting period and generate the document again.", { x: MARGIN + 18, y: y - 50, size: 9, font: regular, color: COLORS.muted });
  }

  for (const [orderIndex, order] of orders.entries()) {
    ensureSpace(240, "ORDER FINANCIAL REPORT - ORDER DETAIL");
    const breakdown = orderFinancialBreakdown(order);
    page.drawRectangle({ x: MARGIN, y: y - 34, width: PAGE_WIDTH - MARGIN * 2, height: 38, color: COLORS.navy });
    page.drawText(`#${cleanText(order.number)}`, { x: MARGIN + 12, y: y - 20, size: 14, font: bold, color: COLORS.white });
    const status = cleanText(order.status.replace(/-/g, " ").toUpperCase());
    page.drawText(status, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(status, 8) - 12, y: y - 18, size: 8, font: bold, color: COLORS.white });
    y -= 58;
    drawLabelValue(MARGIN, 175, "Customer", order.customer || "Guest customer");
    drawLabelValue(MARGIN + 188, 150, "Placed", reportDate(order.createdAt, timeZone));
    drawLabelValue(MARGIN + 350, 176, "Payment", order.paymentMethod || "Not specified");
    y -= 52;

    page.drawText("PRODUCTS", { x: MARGIN, y, size: 7, font: bold, color: COLORS.blue });
    y -= 16;
    for (const item of order.lineItems) {
      const name = `${item.quantity} x ${item.name}`;
      const nameLines = wrapText(name, regular, 8.5, 334).slice(0, 2);
      const rowHeight = Math.max(27, nameLines.length * 11 + 12);
      ensureSpace(rowHeight + 118, "ORDER FINANCIAL REPORT - ORDER DETAIL");
      page.drawLine({ start: { x: MARGIN, y: y + 3 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 3 }, thickness: 0.5, color: COLORS.line });
      nameLines.forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 11, size: 8.5, font: index === 0 ? bold : regular, color: COLORS.ink }));
      page.drawText(cleanText(item.sku || `Product ${item.productId}`), { x: MARGIN + 345, y, size: 7.5, font: regular, color: COLORS.muted });
      const lineTotal = amount(item.total + item.totalTax, order.currency);
      page.drawText(lineTotal, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(lineTotal, 8.5), y, size: 8.5, font: bold, color: COLORS.ink });
      y -= rowHeight;
    }

    ensureSpace(112, "ORDER FINANCIAL REPORT - ORDER DETAIL");
    y -= 6;
    const financialRows: Array<[string, number, boolean?]> = [
      ["Item subtotal before discounts", breakdown.itemSubtotal],
      ["Discounts", -breakdown.discounts],
      ["Product net (without shipping)", breakdown.productNet, true],
      ["Shipping (before tax)", breakdown.shipping],
      ["Taxes", breakdown.taxes],
      ["Additional fees", breakdown.fees],
      ["Order total", breakdown.orderTotal, true],
      ["Refunded", breakdown.refunds > 0 ? -breakdown.refunds : 0],
      ["Processing cost", breakdown.processingCost > 0 ? -breakdown.processingCost : 0],
      ["Net retained", breakdown.netRetained, true],
    ];
    for (const [label, value, emphasized] of financialRows) {
      page.drawText(label, { x: MARGIN + 248, y, size: 8, font: emphasized ? bold : regular, color: emphasized ? COLORS.ink : COLORS.muted });
      const formatted = amount(value, order.currency);
      page.drawText(formatted, { x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(formatted, 8), y, size: 8, font: bold, color: value < 0 ? COLORS.accent : COLORS.ink });
      y -= 14;
    }
    if (order.refunds.length) {
      y -= 4;
      for (const refund of order.refunds) {
        const copy = `Refund #${refund.id}${refund.reason ? ` - ${refund.reason}` : ""}`;
        for (const line of wrapText(copy, regular, 7, 320).slice(0, 2)) {
          page.drawText(line, { x: MARGIN, y, size: 7, font: regular, color: COLORS.muted });
          y -= 10;
        }
      }
    }
    y -= orderIndex === orders.length - 1 ? 8 : 26;
  }

  const pages = pdf.getPages();
  pages.forEach((reportPage, index) => {
    const footer = `Phase One Labz - Confidential operations report - ${index + 1} / ${pages.length}`;
    reportPage.drawLine({ start: { x: MARGIN, y: 31 }, end: { x: PAGE_WIDTH - MARGIN, y: 31 }, thickness: 0.5, color: COLORS.line });
    reportPage.drawText(footer, { x: MARGIN, y: 18, size: 6.5, font: regular, color: COLORS.muted });
  });
  pdf.setTitle(`Phase One Labz Orders - ${cleanText(options.periodLabel)}`);
  pdf.setAuthor("Phase One Labz Operations");
  pdf.setSubject("Order financial breakdown and sales operations report");
  pdf.setCreationDate(generatedAt);
  return Buffer.from(await pdf.save());
}

type OrderTableLine = { text: string; muted?: boolean };

export async function buildOrderReportPdf(
  orders: CommerceOrder[],
  options: OrderReportOptions,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const timeZone = options.timeZone || "America/Bogota";
  const generatedAt = options.generatedAt || new Date();
  const periodLabel = cleanText(options.periodLabel) || "Selected period";
  const currency = cleanText(orders[0]?.currency || "USD") || "USD";
  const totals = orders.reduce((result, order) => {
    const values = orderFinancialBreakdown(order);
    result.gross += values.orderTotal;
    result.productNet += values.productNet;
    result.shipping += values.shipping;
    result.taxes += values.taxes;
    result.fees += values.fees + values.processingCost;
    result.refunds += values.refunds;
    result.net += values.netRetained;
    return result;
  }, { gross: 0, productNet: 0, shipping: 0, taxes: 0, fees: 0, refunds: 0, net: 0 });

  const columnWidths = [70, 110, 200, 90, 64, 64, 64, 66];
  const columnTitles = ["ORDER", "CUSTOMER", "PRODUCTS", "PAYMENT / STATUS", "PRODUCT NET", "SHIP / TAX", "FEES / REFUNDS", "TOTAL / NET"];
  const columnX: number[] = [];
  let nextX = MARGIN;
  for (const width of columnWidths) {
    columnX.push(nextX);
    nextX += width;
  }

  let page!: PDFPage;
  let y = 0;
  let visualRow = 0;

  const drawHeader = (continued: boolean) => {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 90, width: PAGE_WIDTH, height: 90, color: COLORS.navy });
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 94, width: PAGE_WIDTH, height: 4, color: COLORS.accent });
    const logoWidth = 154;
    const logoHeight = logo.height * (logoWidth / logo.width);
    page.drawImage(logo, { x: MARGIN, y: PAGE_HEIGHT - 69, width: logoWidth, height: logoHeight });
    page.drawLine({
      start: { x: 207, y: PAGE_HEIGHT - 73 },
      end: { x: 207, y: PAGE_HEIGHT - 22 },
      thickness: 0.7,
      color: rgb(1, 1, 1),
      opacity: 0.24,
    });
    page.drawText(continued ? "FINANCIAL ORDER REPORT - CONTINUED" : "FINANCIAL ORDER REPORT", {
      x: 226,
      y: PAGE_HEIGHT - 39,
      size: 16,
      font: bold,
      color: COLORS.white,
    });
    const period = wrapText(periodLabel, regular, 7.5, 330)[0] || "Selected period";
    page.drawText(period, { x: 226, y: PAGE_HEIGHT - 57, size: 7.5, font: regular, color: COLORS.white, opacity: 0.78 });
    const generated = cleanText(`Generated ${reportDate(generatedAt.toISOString(), timeZone)}`);
    page.drawText(generated, {
      x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(generated, 6.5),
      y: PAGE_HEIGHT - 70,
      size: 6.5,
      font: regular,
      color: COLORS.white,
      opacity: 0.68,
    });
    y = PAGE_HEIGHT - 119;
  };

  const drawSummary = () => {
    page.drawText("REPORT SUMMARY", { x: MARGIN, y, size: 6.5, font: bold, color: COLORS.blue });
    y -= 11;
    const cards: Array<[string, string]> = [
      ["Orders", String(orders.length)],
      ["Gross collected", amount(totals.gross, currency)],
      ["Product net", amount(totals.productNet, currency)],
      ["Shipping + tax", amount(totals.shipping + totals.taxes, currency)],
      ["Fees + refunds", amount(totals.fees + totals.refunds, currency)],
      ["Net retained", amount(totals.net, currency)],
    ];
    const gap = 7;
    const width = (PAGE_WIDTH - MARGIN * 2 - gap * 5) / 6;
    cards.forEach(([label, value], index) => {
      const x = MARGIN + index * (width + gap);
      page.drawRectangle({ x, y: y - 48, width, height: 48, color: COLORS.soft, borderColor: COLORS.line, borderWidth: 0.55 });
      page.drawRectangle({ x, y: y - 48, width: 3, height: 48, color: index === 5 ? COLORS.accent : COLORS.blue });
      page.drawText(label.toUpperCase(), { x: x + 10, y: y - 15, size: 5.3, font: bold, color: COLORS.muted });
      const fitted = wrapText(value, bold, 10, width - 18)[0] || "-";
      page.drawText(fitted, { x: x + 10, y: y - 34, size: 10, font: bold, color: COLORS.ink });
    });
    y -= 67;
  };

  const drawTableHeader = (continued = false) => {
    page.drawText(continued ? "ORDER LEDGER - CONTINUED" : "ORDER LEDGER", { x: MARGIN, y, size: 6.5, font: bold, color: COLORS.blue });
    y -= 10;
    page.drawRectangle({ x: MARGIN, y: y - 23, width: PAGE_WIDTH - MARGIN * 2, height: 23, color: COLORS.navy });
    columnTitles.forEach((title, index) => {
      const lines = wrapText(title, bold, 5.5, columnWidths[index]! - 10).slice(0, 2);
      lines.forEach((line, lineIndex) => page.drawText(line, {
        x: columnX[index]! + 5,
        y: y - 9 - lineIndex * 7,
        size: 5.5,
        font: bold,
        color: COLORS.white,
      }));
    });
    y -= 23;
  };

  const addPage = (first: boolean) => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(!first);
    if (first) drawSummary();
    drawTableHeader(!first);
  };

  const drawLines = (
    lines: OrderTableLine[],
    x: number,
    top: number,
    width: number,
    firstLineBold = false,
  ) => {
    let renderedLine = 0;
    lines.forEach((line, index) => {
      const font = firstLineBold && index === 0 ? bold : regular;
      const size = firstLineBold && index === 0 ? 7.5 : 6.25;
      for (const wrapped of wrapText(line.text, font, size, width - 12)) {
        page.drawText(wrapped, {
          x: x + 6,
          y: top - 13 - renderedLine * 9,
          size,
          font,
          color: line.muted ? COLORS.muted : COLORS.ink,
        });
        renderedLine += 1;
      }
    });
  };

  const drawMetrics = (
    metrics: Array<[string, number, boolean?]>,
    x: number,
    top: number,
    width: number,
    currencyCode: string,
  ) => {
    metrics.forEach(([label, value, emphasized], index) => {
      const metricY = top - 11 - index * 18;
      page.drawText(label.toUpperCase(), { x: x + 5, y: metricY, size: 4.8, font: bold, color: COLORS.muted });
      const formatted = amount(value, currencyCode);
      page.drawText(formatted, {
        x: x + width - 5 - bold.widthOfTextAtSize(formatted, emphasized ? 7.2 : 6.6),
        y: metricY - 8,
        size: emphasized ? 7.2 : 6.6,
        font: bold,
        color: value < 0 ? COLORS.accent : COLORS.ink,
      });
    });
  };

  addPage(true);

  if (!orders.length) {
    page.drawRectangle({ x: MARGIN, y: y - 72, width: PAGE_WIDTH - MARGIN * 2, height: 72, color: COLORS.soft, borderColor: COLORS.line, borderWidth: 0.5 });
    page.drawText("No orders were found in this period.", { x: MARGIN + 18, y: y - 30, size: 12, font: bold, color: COLORS.ink });
    page.drawText("Choose another date range and generate the report again.", { x: MARGIN + 18, y: y - 49, size: 7.5, font: regular, color: COLORS.muted });
  }

  for (const order of orders) {
    const breakdown = orderFinancialBreakdown(order);
    const itemLines: OrderTableLine[] = [];
    for (const item of order.lineItems) {
      const itemName = cleanText(`${item.quantity} x ${item.name}`) || `Product ${item.productId}`;
      wrapText(itemName, bold, 6.6, columnWidths[2]! - 12).forEach((line) => itemLines.push({ text: line }));
      const reference = cleanText(item.sku || `Product ${item.productId}`);
      const itemTotal = amount(item.total + item.totalTax, order.currency);
      wrapText(`${reference} | ${itemTotal}`, regular, 5.7, columnWidths[2]! - 12).forEach((line) => itemLines.push({ text: line, muted: true }));
    }
    if (!itemLines.length) itemLines.push({ text: "No products recorded", muted: true });

    const chunks: OrderTableLine[][] = [];
    for (let index = 0; index < itemLines.length; index += 22) chunks.push(itemLines.slice(index, index + 22));
    for (const [chunkIndex, chunk] of chunks.entries()) {
      const rowHeight = Math.max(66, chunk.length * 9 + 18);
      if (y - rowHeight < 36) addPage(false);
      const rowBottom = y - rowHeight;
      page.drawRectangle({
        x: MARGIN,
        y: rowBottom,
        width: PAGE_WIDTH - MARGIN * 2,
        height: rowHeight,
        color: visualRow % 2 === 0 ? COLORS.white : COLORS.soft,
        borderColor: COLORS.line,
        borderWidth: 0.45,
      });
      for (let index = 1; index < columnX.length; index += 1) {
        page.drawLine({
          start: { x: columnX[index]!, y: rowBottom },
          end: { x: columnX[index]!, y },
          thickness: 0.35,
          color: COLORS.line,
        });
      }

      const orderLines: OrderTableLine[] = chunkIndex === 0
        ? [
          { text: `#${order.number}` },
          { text: reportDate(order.createdAt, timeZone), muted: true },
          { text: cleanText(order.status.replace(/-/g, " ").toUpperCase()), muted: true },
        ]
        : [{ text: `#${order.number}` }, { text: "PRODUCTS CONTINUED", muted: true }];
      const customerLines: OrderTableLine[] = [
        { text: order.customer || "Guest customer" },
        { text: order.billing.email || order.location || "Contact not recorded", muted: true },
        ...(order.billing.email && order.location ? [{ text: order.location, muted: true }] : []),
      ];
      const paymentReference = order.transactionId || order.paymentOperations.reference;
      const paymentLines: OrderTableLine[] = [
        { text: order.paymentMethod || "Not specified" },
        ...(paymentReference ? [{ text: paymentReference, muted: true }] : []),
        ...(order.shippingOperations.trackingNumber ? [{ text: `Track ${order.shippingOperations.trackingNumber}`, muted: true }] : []),
      ];

      drawLines(orderLines, columnX[0]!, y, columnWidths[0]!, true);
      drawLines(customerLines, columnX[1]!, y, columnWidths[1]!, true);
      drawLines(chunk, columnX[2]!, y, columnWidths[2]!, false);
      drawLines(paymentLines, columnX[3]!, y, columnWidths[3]!, true);
      drawMetrics([["Products", breakdown.productNet, true]], columnX[4]!, y, columnWidths[4]!, order.currency);
      drawMetrics([["Shipping", breakdown.shipping], ["Tax", breakdown.taxes]], columnX[5]!, y, columnWidths[5]!, order.currency);
      drawMetrics([
        ["Fees", breakdown.fees],
        ["Processing", breakdown.processingCost > 0 ? -breakdown.processingCost : 0],
        ["Refunds", breakdown.refunds > 0 ? -breakdown.refunds : 0],
      ], columnX[6]!, y, columnWidths[6]!, order.currency);
      drawMetrics([["Total", breakdown.orderTotal, true], ["Net", breakdown.netRetained, true]], columnX[7]!, y, columnWidths[7]!, order.currency);
      y = rowBottom;
      visualRow += 1;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((reportPage, index) => {
    const pageNumber = `${index + 1} / ${pages.length}`;
    const footerLeft = cleanText(`Phase One Labz - Confidential operations report - ${periodLabel}`);
    reportPage.drawLine({ start: { x: MARGIN, y: 25 }, end: { x: PAGE_WIDTH - MARGIN, y: 25 }, thickness: 0.45, color: COLORS.line });
    reportPage.drawText(footerLeft, { x: MARGIN, y: 13, size: 5.6, font: regular, color: COLORS.muted });
    reportPage.drawText(pageNumber, { x: PAGE_WIDTH - MARGIN - regular.widthOfTextAtSize(pageNumber, 5.6), y: 13, size: 5.6, font: regular, color: COLORS.muted });
  });
  pdf.setTitle(`Phase One Labz - Order Report - ${periodLabel}`);
  pdf.setAuthor("Phase One Labz Operations");
  pdf.setSubject("Complete order ledger and financial breakdown");
  pdf.setCreationDate(generatedAt);
  return Buffer.from(await pdf.save());
}
