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
