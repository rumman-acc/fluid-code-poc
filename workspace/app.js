// Sample purchase order data (no backend — in-memory only)
let purchaseOrders = [
  { id: "PO-1001", vendor: "Acme Supplies", amount: 1250.0, status: "Pending", date: "2026-09-01" },
  { id: "PO-1002", vendor: "Globex Corp", amount: 4800.5, status: "Pending", date: "2026-09-02" },
  { id: "PO-1003", vendor: "Initech Ltd", amount: 320.75, status: "Approved", date: "2026-09-03" },
  { id: "PO-1004", vendor: "Umbrella Inc", amount: 999.99, status: "Rejected", date: "2026-09-04" },
  { id: "PO-1005", vendor: "Hooli Tech", amount: 2150.0, status: "Pending", date: "2026-09-05" },
  { id: "PO-1006", vendor: "Stark Industries", amount: 7600.0, status: "Approved", date: "2026-09-06" },
];

const poListEl = document.getElementById("po-list");
const statTotalEl = document.getElementById("stat-total");
const statPendingEl = document.getElementById("stat-pending");
const statApprovedEl = document.getElementById("stat-approved");
const statRejectedEl = document.getElementById("stat-rejected");
const vendorSearchEl = document.getElementById("vendor-search");

function formatAmount(amount) {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function updateStatus(id, newStatus) {
  const po = purchaseOrders.find((p) => p.id === id);
  if (po) {
    po.status = newStatus;
  }
  render();
}

function renderPOCard(po) {
  const card = document.createElement("div");
  card.className = "po-card";

  const statusClass = po.status.toLowerCase();
  const isPending = po.status === "Pending";

  card.innerHTML = `
    <div class="po-info">
      <div class="po-field">
        <span class="label">PO Number</span>
        <span class="value">${po.id}</span>
      </div>
      <div class="po-field">
        <span class="label">Vendor</span>
        <span class="value">${po.vendor}</span>
      </div>
      <div class="po-field">
        <span class="label">Amount</span>
        <span class="value">${formatAmount(po.amount)}</span>
      </div>
      <div class="po-field">
        <span class="label">Date</span>
        <span class="value">${po.date}</span>
      </div>
      <div class="po-field">
        <span class="label">Status</span>
        <span class="status-badge ${statusClass}">${po.status}</span>
      </div>
    </div>
    <div class="po-actions">
      <button class="btn btn-approve" data-action="approve" data-id="${po.id}" ${!isPending ? "disabled" : ""}>Approve</button>
      <button class="btn btn-reject" data-action="reject" data-id="${po.id}" ${!isPending ? "disabled" : ""}>Reject</button>
    </div>
  `;

  return card;
}

function renderDashboard() {
  const total = purchaseOrders.length;
  const pending = purchaseOrders.filter((p) => p.status === "Pending").length;
  const approved = purchaseOrders.filter((p) => p.status === "Approved").length;
  const rejected = purchaseOrders.filter((p) => p.status === "Rejected").length;

  statTotalEl.textContent = total;
  statPendingEl.textContent = pending;
  statApprovedEl.textContent = approved;
  statRejectedEl.textContent = rejected;
}

function render() {
  const searchTerm = vendorSearchEl.value.trim().toLowerCase();
  const filteredPOs = searchTerm
    ? purchaseOrders.filter((po) => po.vendor.toLowerCase().includes(searchTerm))
    : purchaseOrders;

  poListEl.innerHTML = "";
  filteredPOs.forEach((po) => {
    poListEl.appendChild(renderPOCard(po));
  });
  renderDashboard();
}

poListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;
  updateStatus(id, action === "approve" ? "Approved" : "Rejected");
});

vendorSearchEl.addEventListener("input", render);

render();
