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
      ? `<a href="${escapeHtml(product.productUrl)}"><img src="${escapeHtml(product.imageUrl)}" width="148" height="148" alt="${escapeHtml(product.name)}" style="display:block;width:148px;height:148px;max-width:100%;object-fit:contain;border:0" /></a>`
      : `<div style="font:800 22px Arial,sans-serif;color:#07111e">P1</div>`;
    const salePrice = Math.max(0, Number(product.price) || 0);
    const regularPrice = Math.max(salePrice, Number(product.regularPrice) || salePrice);
    const price = regularPrice > salePrice && salePrice > 0
      ? `<span style="color:#8190a2;text-decoration:line-through;font:500 13px Arial,sans-serif;margin-right:8px">$${regularPrice.toFixed(2)}</span><strong style="color:#fff;font:800 23px Arial,sans-serif">$${salePrice.toFixed(2)}</strong>`
      : `<strong style="color:#fff;font:800 23px Arial,sans-serif">$${salePrice.toFixed(2)}</strong>`;
    return `<tr><td style="padding:0 40px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;border:1px solid #26364b;border-radius:18px;background:#111d2d"><tr><td width="188" align="center" valign="middle" style="width:188px;padding:20px;background:#edf3f5;border-radius:17px 0 0 17px">${image}</td><td valign="middle" style="padding:26px 26px 24px"><div style="color:${escapeHtml(input.accent || "#70def2")};font:800 9px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase">${escapeHtml(product.sku || "Phase One Research")}</div><div style="margin-top:8px;color:#fff;font:800 21px/1.2 Arial,sans-serif;letter-spacing:-.02em">${escapeHtml(product.name)}</div><div style="margin-top:14px">${price}</div><a href="${escapeHtml(product.productUrl)}" style="display:inline-block;margin-top:18px;background:${escapeHtml(input.accent || "#70def2")};color:#05101b;text-decoration:none;font:800 10px Arial,sans-serif;letter-spacing:.11em;text-transform:uppercase;padding:12px 16px;border-radius:8px">View product&nbsp; →</a></td></tr></table></td></tr>`;
  }).join("");
  const productSection = productRows
    ? `<tr><td style="padding:8px 40px 16px;color:#7f92a6;font:800 10px Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase">Selected products</td></tr>${productRows}`
    : "";
  const button = input.buttonLabel && input.buttonUrl
    ? `<tr><td align="center" style="padding:14px 40px 42px"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;border:1px solid ${escapeHtml(input.accent || "#70def2")};color:#fff;text-decoration:none;font:800 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:15px 24px;border-radius:9px">${escapeHtml(input.buttonLabel)}&nbsp; →</a></td></tr>`
    : "";
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="190" height="60" alt="Phase One Labz" style="display:block;width:190px;height:60px;max-width:100%;object-fit:contain;border:0;margin:0 auto;color:#fff;font:800 18px Arial,sans-serif" />`
    : `<div style="font:800 24px Arial,sans-serif;letter-spacing:.04em;color:#fff">PHASE <span style="color:${escapeHtml(input.accent || "#70def2")}">ONE</span> LABZ</div>`;
  const accent = escapeHtml(input.accent || "#70def2");
  const html = `<!doctype html><html><body style="margin:0;background:#05070c;color:#f7fbff"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#05070c;padding:30px 12px"><tr><td align="center"><table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;width:100%;background:#0a1322;border:1px solid #26364b;border-radius:22px;overflow:hidden"><tr><td align="center" style="padding:30px 40px 24px;background:#07101c;border-top:4px solid ${accent};border-bottom:1px solid #1f2e42">${logo}<div style="color:#72869a;font:800 9px Arial,sans-serif;letter-spacing:.25em;margin-top:12px">RESEARCH CATALOG</div></td></tr><tr><td style="padding:44px 40px 13px;background:#0b1626"><span style="display:inline-block;padding:7px 10px;border:1px solid #294058;border-radius:999px;color:${accent};font:800 9px Arial,sans-serif;letter-spacing:.16em;text-transform:uppercase">Curated research update</span><h1 style="margin:19px 0 0;color:#fff;font:800 38px/1.06 Arial,sans-serif;letter-spacing:-.035em">${escapeHtml(input.heading)}</h1></td></tr><tr><td style="padding:10px 40px 38px;background:#0b1626;color:#aebdcb;font:400 16px/1.72 Arial,sans-serif"><span style="display:block;color:#7f92a6;font:700 12px Arial,sans-serif;margin-bottom:12px">Hello ${escapeHtml(name)},</span>${message}</td></tr>${productSection}${button}<tr><td align="center" style="padding:28px 40px;background:#07101c;border-top:1px solid #1f2e42;color:#657b90;font:400 10px/1.7 Arial,sans-serif"><strong style="display:block;color:#e8f0f7;font:800 11px Arial,sans-serif;letter-spacing:.16em;margin-bottom:9px">PHASE ONE LABZ</strong>For research use only · {{PHASEONE_BUSINESS_ADDRESS}}<br />You opted in to Phase One Labz updates. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#9fb7cc">Unsubscribe</a>.</td></tr></table></td></tr></table></body></html>`;
  const productText = products.length
    ? `\n\nSelected products:\n${products.map((product) => `- ${product.name} — $${Math.max(0, Number(product.price) || 0).toFixed(2)} — ${product.productUrl}`).join("\n")}`
    : "";
  const text = `PHASE ONE LABZ\n\nHello ${name},\n\n${input.heading}\n\n${input.message}${productText}\n\n${input.buttonLabel && input.buttonUrl ? `${input.buttonLabel}: ${input.buttonUrl}\n\n` : ""}Unsubscribe: ${input.unsubscribeUrl}`;
  return { html, text };
}
