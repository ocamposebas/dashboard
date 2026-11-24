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

const list = document.querySelector<HTMLElement>("#customer-review-list");
const status = document.querySelector<HTMLElement>("#customer-review-status");

async function callReviews(method = "GET", payload?: object) {
  const response = await fetch("/api/customer-reviews", {
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
    const { invitations } = await callReviews() as { invitations: Invitation[] };
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
            await callReviews("PATCH", { id: entry.id, published: !entry.published_at });
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
