type Invitation = {
  id: string;
  order_number: string;
  delivery_state: "sent" | "sending" | "uncertain" | "failed";
  rating: number | null;
  body: string | null;
  submitted_at: string | null;
  published_at: string | null;
  automatic: boolean;
};

const form = document.querySelector<HTMLFormElement>("#customer-review-invite");
const list = document.querySelector<HTMLElement>("#customer-review-list");
const status = document.querySelector<HTMLElement>("#customer-review-status");
const automationToggle = document.querySelector<HTMLButtonElement>("#customer-review-toggle");
const automationStatus = document.querySelector<HTMLElement>("#customer-review-automation-status");
let automationEnabled = false;

function renderAutomation(enabled: boolean) {
  automationEnabled = enabled;
  if (automationToggle) {
    automationToggle.disabled = false;
    automationToggle.textContent = enabled ? "Pause automatic invitations" : "Enable automatic invitations";
  }
  if (automationStatus) automationStatus.textContent = enabled ? "Active for new deliveries." : "Paused.";
}

async function callReviews(path: string, method = "GET", payload?: object) {
  const response = await fetch(`/api/customer-reviews${path}`, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : {},
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not update customer reviews.");
  return data;
}

export async function loadCustomerReviews() {
  if (!list) return;
  try {
    const { invitations, automation } = await callReviews("") as {
      invitations: Invitation[];
      automation: { enabled: boolean };
    };
    renderAutomation(automation.enabled);
    list.replaceChildren();
    if (!invitations.length) list.textContent = "No invitations yet.";
    for (const entry of invitations) {
      const row = document.createElement("article");
      row.className = "surface";
      row.style.padding = "12px 16px";
      const order = document.createElement("strong");
      order.textContent = `Order #${entry.order_number}`;
      const details = document.createElement("p");
      details.textContent = entry.submitted_at
        ? `${entry.rating} / 5 · ${entry.published_at ? "Published" : "Awaiting moderation"}`
        : `${entry.automatic ? "Automatic" : "Manual"} invitation: ${entry.delivery_state}`;
      row.append(order, details);
      if (entry.body) {
        const review = document.createElement("p");
        review.textContent = entry.body;
        row.append(review);
      }
      if (entry.submitted_at) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button--secondary";
        button.textContent = entry.published_at ? "Unpublish" : "Publish";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            await callReviews("", "PATCH", { id: entry.id, published: !entry.published_at });
            await loadCustomerReviews();
          } catch (error) {
            if (status) status.textContent = (error as Error).message;
          } finally {
            button.disabled = false;
          }
        });
        row.append(button);
      }
      list.append(row);
    }
  } catch (error) {
    list.textContent = (error as Error).message;
  }
}

automationToggle?.addEventListener("click", async () => {
  if (!automationStatus) return;
  automationToggle.disabled = true;
  try {
    const { enabled } = await callReviews("/automation", "PUT", { enabled: !automationEnabled });
    renderAutomation(enabled);
  } catch (error) {
    automationToggle.disabled = false;
    automationStatus.textContent = (error as Error).message;
  }
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!button || !status) return;
  const orderId = Number(new FormData(form).get("orderId"));
  button.disabled = true;
  status.textContent = "Sending invitation…";
  try {
    const { state } = await callReviews("/invite", "POST", { orderId });
    status.textContent = state === "sent"
      ? "Invitation accepted by the mail provider."
      : state === "failed"
        ? "The mail provider rejected the invitation. You can retry."
        : "Delivery is unconfirmed. Check the mail log before trying again.";
    if (state === "sent") form.reset();
  } catch (error) {
    status.textContent = (error as Error).message;
  } finally {
    button.disabled = false;
    void loadCustomerReviews();
  }
});
