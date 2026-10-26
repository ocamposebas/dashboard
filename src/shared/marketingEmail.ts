export interface MarketingEmailTemplate {
  key: "product_launch" | "restock" | "promotion" | "education";
  name: string;
  description: string;
  subject: string;
  preheader: string;
  heading: string;
  message: string;
  buttonLabel: string;
  buttonUrl: string;
  accent: string;
}

export interface MarketingEmailProduct {
  productId: number;
  name: string;
  sku: string;
  price: number;
  regularPrice: number;
  imageUrl: string;
  productUrl: string;
}

export const PHASE_ONE_EMAIL_TEMPLATES: MarketingEmailTemplate[] = [
  {
    key: "product_launch",
    name: "Product launch",
    description: "Introduce a new catalog release with one focused action.",
    subject: "New research release from Phase One Labz",
    preheader: "Explore the newest addition to the Phase One catalog.",
    heading: "A new standard has arrived.",
    message: "Meet our latest research release, prepared with the documentation and product detail you expect from Phase One Labz.",
    buttonLabel: "View the release",
    buttonUrl: "https://phaseonelabz.com/research-peptides/",
    accent: "#70def2",
  },
  {
    key: "restock",
    name: "Back in stock",
    description: "Let opted-in customers know a requested item is available.",
    subject: "Your requested Phase One item is back",
    preheader: "Inventory has been replenished while supplies last.",
    heading: "Back in the lab.",
    message: "The item you were waiting for is available again. Review the current catalog details and documentation before inventory changes.",
    buttonLabel: "Check availability",
    buttonUrl: "https://phaseonelabz.com/research-peptides/",
    accent: "#77e4bd",
  },
  {
    key: "promotion",
    name: "Private promotion",
    description: "Share a controlled offer without changing the catalog message.",
    subject: "A private Phase One Labz offer",
    preheader: "A limited opportunity prepared for our research community.",
    heading: "Research access, refined.",
    message: "A limited Phase One Labz opportunity is now available. Visit the catalog to review eligible products and current terms.",
    buttonLabel: "Explore the offer",
    buttonUrl: "https://phaseonelabz.com/research-peptides/",
    accent: "#d9b86c",
  },
  {
    key: "education",
    name: "Research education",
    description: "Send a clean educational update or documentation reminder.",
    subject: "Research notes from Phase One Labz",
    preheader: "Documentation, handling and catalog guidance in one update.",
    heading: "Clarity for every research step.",
    message: "We have prepared a concise update for the Phase One research community. Review the latest documentation and catalog guidance below.",
    buttonLabel: "Read the update",
    buttonUrl: "https://phaseonelabz.com/research/",
    accent: "#b7a7f5",
  },
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] || character);
}

export function renderPhaseOneEmail(input: {
  preheader: string;
  heading: string;
  message: string;
  buttonLabel: string;
  buttonUrl: string;
  recipientName: string;
  unsubscribeUrl: string;
  accent?: string;
  logoUrl?: string;
  products?: MarketingEmailProduct[];
}): { html: string; text: string } {
  const name = input.recipientName.trim() || "Research partner";
  const message = escapeHtml(input.message).replace(/\r?\n/g, "<br />");
  const products = (input.products || []).slice(0, 4);
  const productRows = products.map((product) => {
    const image = product.imageUrl
      ? `<td width="112" valign="middle" style="width:112px;padding:14px"><a href="${escapeHtml(product.productUrl)}"><img src="${escapeHtml(product.imageUrl)}" width="84" height="84" alt="${escapeHtml(product.name)}" style="display:block;width:84px;height:84px;object-fit:contain;border:0;border-radius:10px;background:#07101c" /></a></td>`
      : "";
    const salePrice = Math.max(0, Number(product.price) || 0);
    const regularPrice = Math.max(salePrice, Number(product.regularPrice) || salePrice);
    const price = regularPrice > salePrice && salePrice > 0
      ? `<span style="color:#6f8498;text-decoration:line-through;margin-right:8px">$${regularPrice.toFixed(2)}</span><strong style="color:#fff">$${salePrice.toFixed(2)}</strong>`
      : `<strong style="color:#fff">$${salePrice.toFixed(2)}</strong>`;
    return `<tr><td style="padding:0 42px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #1b2c40;border-radius:14px;background:#0d1725"><tr>${image}<td valign="middle" style="padding:16px 16px 16px ${image ? "0" : "16px"}"><div style="font:700 16px/1.3 Arial,sans-serif;color:#fff">${escapeHtml(product.name)}</div><div style="margin-top:8px;font:400 14px Arial,sans-serif">${price}</div><a href="${escapeHtml(product.productUrl)}" style="display:inline-block;margin-top:12px;color:${escapeHtml(input.accent || "#70def2")};font:700 11px Arial,sans-serif;letter-spacing:.08em;text-decoration:none;text-transform:uppercase">View product →</a></td></tr></table></td></tr>`;
  }).join("");
  const productSection = productRows
    ? `<tr><td style="padding:4px 42px 14px;color:#7890a8;font:700 10px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase">Selected products</td></tr>${productRows}`
    : "";
  const button = input.buttonLabel && input.buttonUrl
    ? `<tr><td style="padding:8px 42px 38px"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:${escapeHtml(input.accent || "#70def2")};color:#06111c;text-decoration:none;font:700 14px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:16px 24px;border-radius:10px">${escapeHtml(input.buttonLabel)}</a></td></tr>`
    : "";
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="176" alt="Phase One Labz" style="display:block;width:176px;max-width:100%;height:auto;border:0" />`
    : `<div style="font:800 24px Arial,sans-serif;letter-spacing:.04em;color:#fff">PHASE <span style="color:${escapeHtml(input.accent || "#70def2")}">ONE</span> LABZ</div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#050914;color:#f7fbff"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050914;padding:28px 12px"><tr><td align="center"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background:#0a1220;border:1px solid #1b2c40;border-radius:18px;overflow:hidden"><tr><td style="padding:27px 42px;border-bottom:1px solid #1b2c40">${logo}<div style="font:700 10px Arial,sans-serif;letter-spacing:.26em;color:#7890a8;margin-top:9px">RESEARCH COMMUNICATION</div></td></tr><tr><td style="padding:42px 42px 12px"><div style="font:600 13px Arial,sans-serif;color:#91a8bd;margin-bottom:18px">Hello ${escapeHtml(name)},</div><h1 style="margin:0;color:#fff;font:800 34px/1.08 Arial,sans-serif;letter-spacing:-.03em">${escapeHtml(input.heading)}</h1></td></tr><tr><td style="padding:14px 42px 28px;color:#b8c8d8;font:400 16px/1.7 Arial,sans-serif">${message}</td></tr>${productSection}${button}<tr><td style="padding:26px 42px;background:#07101c;border-top:1px solid #1b2c40;color:#70869a;font:400 11px/1.6 Arial,sans-serif">Phase One Labz · For research use only.<br />{{PHASEONE_BUSINESS_ADDRESS}}<br />You are receiving this because you opted in to Phase One Labz updates. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#9fb7cc">Unsubscribe</a>.</td></tr></table></td></tr></table></body></html>`;
  const productText = products.length
    ? `\n\nSelected products:\n${products.map((product) => `- ${product.name} — $${Math.max(0, Number(product.price) || 0).toFixed(2)} — ${product.productUrl}`).join("\n")}`
    : "";
  const text = `PHASE ONE LABZ\n\nHello ${name},\n\n${input.heading}\n\n${input.message}${productText}\n\n${input.buttonLabel && input.buttonUrl ? `${input.buttonLabel}: ${input.buttonUrl}\n\n` : ""}Unsubscribe: ${input.unsubscribeUrl}`;
  return { html, text };
}
