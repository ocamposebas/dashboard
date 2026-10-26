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
}): { html: string; text: string } {
  const name = input.recipientName.trim() || "Research partner";
  const message = escapeHtml(input.message).replace(/\r?\n/g, "<br />");
  const button = input.buttonLabel && input.buttonUrl
    ? `<tr><td style="padding:8px 42px 38px"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:${escapeHtml(input.accent || "#70def2")};color:#06111c;text-decoration:none;font:700 14px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;padding:16px 24px;border-radius:10px">${escapeHtml(input.buttonLabel)}</a></td></tr>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#050914;color:#f7fbff"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050914;padding:28px 12px"><tr><td align="center"><table role="presentation" width="620" cellspacing="0" cellpadding="0" style="max-width:620px;width:100%;background:#0a1220;border:1px solid #1b2c40;border-radius:18px;overflow:hidden"><tr><td style="padding:30px 42px;border-bottom:1px solid #1b2c40"><div style="font:800 24px Arial,sans-serif;letter-spacing:.04em;color:#fff">PHASE <span style="color:${escapeHtml(input.accent || "#70def2")}">ONE</span> LABZ</div><div style="font:700 10px Arial,sans-serif;letter-spacing:.26em;color:#7890a8;margin-top:6px">RESEARCH COMMUNICATION</div></td></tr><tr><td style="padding:42px 42px 12px"><div style="font:600 13px Arial,sans-serif;color:#91a8bd;margin-bottom:18px">Hello ${escapeHtml(name)},</div><h1 style="margin:0;color:#fff;font:800 34px/1.08 Arial,sans-serif;letter-spacing:-.03em">${escapeHtml(input.heading)}</h1></td></tr><tr><td style="padding:14px 42px 28px;color:#b8c8d8;font:400 16px/1.7 Arial,sans-serif">${message}</td></tr>${button}<tr><td style="padding:26px 42px;background:#07101c;border-top:1px solid #1b2c40;color:#70869a;font:400 11px/1.6 Arial,sans-serif">Phase One Labz · For research use only.<br />{{PHASEONE_BUSINESS_ADDRESS}}<br />You are receiving this because you opted in to Phase One Labz updates. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#9fb7cc">Unsubscribe</a>.</td></tr></table></td></tr></table></body></html>`;
  const text = `PHASE ONE LABZ\n\nHello ${name},\n\n${input.heading}\n\n${input.message}\n\n${input.buttonLabel && input.buttonUrl ? `${input.buttonLabel}: ${input.buttonUrl}\n\n` : ""}Unsubscribe: ${input.unsubscribeUrl}`;
  return { html, text };
}
