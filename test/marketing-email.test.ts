import assert from "node:assert/strict";
import test from "node:test";

import { PHASE_ONE_EMAIL_TEMPLATES, renderPhaseOneEmail } from "../src/shared/marketingEmail.js";

test("provides the four governed Phase One campaign templates", () => {
  assert.deepEqual(PHASE_ONE_EMAIL_TEMPLATES.map((template) => template.key), [
    "product_launch", "restock", "promotion", "education",
  ]);
});

test("renders branded email content safely with an unsubscribe link", () => {
  const rendered = renderPhaseOneEmail({
    preheader: "Private preview",
    heading: "New <script>alert(1)</script>",
    message: "Line one\nLine two & more",
    buttonLabel: "Review",
    buttonUrl: "https://phaseonelabz.com/research-peptides/",
    recipientName: "Researcher <One>",
    unsubscribeUrl: "https://phaseonelabz.is/api/public/marketing/unsubscribe?token=safe",
  });
  assert.match(rendered.html, /PHASE/);
  assert.match(rendered.html, /ONE/);
  assert.match(rendered.html, /Unsubscribe/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
  assert.match(rendered.text, /Line one\nLine two & more/);
});

test("renders the real Phase One logo and governed catalog product cards", () => {
  const rendered = renderPhaseOneEmail({
    preheader: "Product preview",
    heading: "Selected research products",
    message: "Review the current catalog.",
    buttonLabel: "",
    buttonUrl: "",
    recipientName: "Research partner",
    unsubscribeUrl: "https://phaseonelabz.is/api/public/marketing/unsubscribe?token=safe",
    logoUrl: "https://phaseonelabz.is/assets/phase-one-email-logo.webp",
    products: [{
      productId: 42,
      name: "KPV <30MG>",
      sku: "KPV-30-MG",
      price: 40,
      regularPrice: 50,
      imageUrl: "https://phaseonelabz.com/wp-content/uploads/kpv.webp",
      productUrl: "https://phaseonelabz.com/product/kpv-30mg/",
    }],
  });
  assert.match(rendered.html, /phase-one-email-logo\.webp/);
  assert.match(rendered.html, /<img[^>]+kpv\.webp/);
  assert.match(rendered.html, /\$50\.00/);
  assert.match(rendered.html, /\$40\.00/);
  assert.match(rendered.html, /KPV &lt;30MG&gt;/);
  assert.match(rendered.text, /KPV <30MG> — \$40\.00/);
});
