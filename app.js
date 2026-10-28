"use strict";

/* =========================================
   SMART PARKING SYSTEM — APPLICATION LOGIC
   ========================================= */

const STORAGE_KEY = "smartParkingPrototype_v1";
const DEFAULT_RATE = 40;
const SLOT_IDS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];

let state = loadState();
let selectedExitTicket = null;
let toastTimer = null;

/* =========================================
   DATA AND STORAGE
   ========================================= */

function createInitialState() {
  return {
    rate: DEFAULT_RATE,
    slots: SLOT_IDS.map(id => ({
      id,
      sensor: "vacant",
      sessionId: null,
      reservationId: null
    })),
    sessions: []
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
      const data = JSON.parse(saved);

      if (Array.isArray(data.slots) && Array.isArray(data.sessions)) {
        data.rate = Number(data.rate) || DEFAULT_RATE;

        data.sessions.forEach(session => {
          if (session.status === "active" && !session.startAt) {
            session.startAt = session.createdAt || Date.now();
          }
        });

        // Keep active sessions linked to their slots.
        data.slots.forEach(slot => {
          const session = data.sessions.find(
            item => item.id === slot.sessionId ||
              item.ticketId === slot.reservationId
          );

          if (session && session.status === "active") {
            slot.sessionId = session.id;
            slot.reservationId = session.ticketId;
            slot.sensor = "occupied";
          }
        });

        return data;
      }
    }
  } catch (error) {
    console.error("Could not load parking data:", error);
  }

  return createInitialState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save parking data:", error);
    showToast("Could not save data in this browser.");
  }
}

function makeId() {
  let id;

  do {
    id = "SP-" + Math.floor(100000 + Math.random() * 900000);
  } while (state.sessions.some(session => session.ticketId === id));

  return id;
}

function makeSessionId() {
  return window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

/* =========================================
   FORMATTING AND HELPERS
   ========================================= */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(timestamp) {
  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function formatDuration(start, end = Date.now()) {
  if (!start) return "—";

  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return hours
    ? `${hours}h ${remaining}m`
    : `${remaining}m`;
}

function calculateFee(start, end = Date.now()) {
  if (!start) return 0;

  const elapsed = Math.max(0, end - start);
  const hours = Math.max(1, Math.ceil(elapsed / 3600000));

  return hours * Number(state.rate || DEFAULT_RATE);
}

function getSlotStatus(slot) {
  if (slot.sensor === "occupied") return "occupied";
  if (slot.reservationId) return "reserved";
  return "available";
}

function statusLabel(slot) {
  const status = getSlotStatus(slot);

  if (status === "occupied") return "Occupied";
  if (status === "reserved") return "Reserved";

  return "Available";
}

function getSessionForSlot(slot) {
  return state.sessions.find(session =>
    session.id === slot.sessionId
  ) || null;
}

function sessionStatusPill(session) {
  if (session.status === "active") {
    return '<span class="status-pill active">Active</span>';
  }

  if (session.status === "awaiting_payment") {
    return '<span class="status-pill reserved">Awaiting payment</span>';
  }

  if (session.status === "paid") {
    return '<span class="status-pill paid">Paid</span>';
  }

  return '<span class="status-pill">Closed</span>';
}

/* =========================================
   RENDER DASHBOARD
   ========================================= */

function renderAll() {
  renderStats();
  renderParkingLayout();
  renderRecentSessions();
  renderEntry();
  renderTicketTable();
  renderExitResult();

  document.getElementById("rate-display").textContent = state.rate;
}

function renderStats() {
  document.getElementById("total-count").textContent =
    state.slots.length;

  document.getElementById("available-count").textContent =
    state.slots.filter(slot =>
      getSlotStatus(slot) === "available"
    ).length;

  document.getElementById("occupied-count").textContent =
    state.slots.filter(slot =>
      slot.sensor === "occupied"
    ).length;

  document.getElementById("active-count").textContent =
    state.sessions.filter(session =>
      session.status === "active"
    ).length;
}

function renderParkingLayout() {
  const grid = document.getElementById("slot-grid");

  grid.innerHTML = state.slots.map(slot => {
    const status = getSlotStatus(slot);
    const session = getSessionForSlot(slot);

    let detail = "Ready to assign";

    if (status === "reserved") {
      detail = `Ticket ${slot.reservationId}`;
    } else if (status === "occupied") {
      detail = session ? session.ticketId : "Vehicle detected";
    }

    const symbol = status === "available"
      ? "✓"
      : status === "reserved"
        ? "R"
        : "V";

    return `
      <div class="slot-card ${status}">
        <div class="slot-head">
          <span class="slot-name">${escapeHtml(slot.id)}</span>
          <span class="slot-symbol">${symbol}</span>
        </div>
        <div class="slot-status">${statusLabel(slot)}</div>
        <div class="slot-detail">${escapeHtml(detail)}</div>
      </div>
    `;
  }).join("");
}

function renderRecentSessions() {
  const tbody = document.getElementById("recent-sessions");

  const sessions = [...state.sessions]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  if (!sessions.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="empty-row">
          No parking sessions yet. Create a ticket from Entry Dashboard.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sessions.map(session => `
    <tr>
      <td><strong>${escapeHtml(session.ticketId)}</strong></td>
      <td>${escapeHtml(session.slotId)}</td>
      <td>${escapeHtml(
        session.vehicleNumber ||
        session.customerName ||
        "Walk-in customer"
      )}</td>
      <td>${formatDate(session.startAt)}</td>
      <td>${sessionStatusPill(session)}</td>
    </tr>
  `).join("");
}

function renderEntry() {
  const select = document.getElementById("slot-select");
  const previous = select.value;

  const available = state.slots.filter(slot =>
    getSlotStatus(slot) === "available"
  );

  select.innerHTML = available.length
    ? available.map(slot => `
        <option value="${escapeHtml(slot.id)}">
          ${escapeHtml(slot.id)}
        </option>
      `).join("")
    : '<option value="">No available slots</option>';

  if (available.some(slot => slot.id === previous)) {
    select.value = previous;
  }

  select.disabled = available.length === 0;

  document.querySelector(
    '#entry-form button[type="submit"]'
  ).disabled = available.length === 0;

  document.getElementById("entry-slot-list").innerHTML =
    state.slots.map(slot => {
      const status = getSlotStatus(slot);
      const session = getSessionForSlot(slot);

      let detail = "Ready to assign";

      if (status === "reserved") {
        detail = `Ticket ${slot.reservationId}`;
      } else if (status === "occupied") {
        detail = session?.ticketId || "Vehicle detected";
      }

      return `
        <div class="compact-slot">
          <div>
            <strong>${escapeHtml(slot.id)}</strong>
            <small>${escapeHtml(detail)}</small>
          </div>
          <span class="mini-status ${status}">
            ${statusLabel(slot)}
          </span>
        </div>
      `;
    }).join("");
}

/* =========================================
   CREATE PARKING TICKET
   ========================================= */

document.getElementById("entry-form").addEventListener("submit", event => {
  event.preventDefault();

  const slotId = document.getElementById("slot-select").value;
  const slot = state.slots.find(item => item.id === slotId);

  if (!slot || getSlotStatus(slot) !== "available") {
    showToast("That slot is no longer available. Choose another.");
    renderAll();
    return;
  }

  const customerName = document
    .getElementById("customer-name")
    .value.trim();

  const vehicleNumber = document
    .getElementById("vehicle-number")
    .value.trim()
    .toUpperCase();

  const now = Date.now();

  const session = {
    id: makeSessionId(),
    ticketId: makeId(),
    slotId,
    customerName,
    vehicleNumber,
    status: "active",
    createdAt: now,
    startAt: now,
    endAt: null,
    fee: null,
    paidAt: null
  };

  // Assign the slot and start the timer immediately.
  slot.reservationId = session.ticketId;
  slot.sessionId = session.id;
  slot.sensor = "occupied";

  state.sessions.push(session);
  saveState();

  const result = document.getElementById("ticket-result");

  result.classList.remove("hidden");
  result.innerHTML = `
    <h3>Parking ticket created</h3>
    <div class="ticket-number">
      ${escapeHtml(session.ticketId)}
    </div>
    <p>
      <strong>Slot:</strong> ${escapeHtml(slotId)}<br>
      <strong>Customer:</strong>
      ${escapeHtml(customerName || "Walk-in customer")}<br>
      <strong>Vehicle:</strong>
      ${escapeHtml(vehicleNumber || "Not provided")}<br>
      <strong>Timer:</strong> Started automatically at ${formatDate(now)}
    </p>
    <div class="ticket-actions">
      <button class="secondary-button" id="copy-ticket" type="button">
        Copy ticket ID
      </button>
      <button class="secondary-button" id="open-created-ticket" type="button">
        Open ticket details
      </button>
    </div>
  `;

  document.getElementById("customer-name").value = "";
  document.getElementById("vehicle-number").value = "";

  document.getElementById("copy-ticket").addEventListener("click", () => {
    copyTicketId(session.ticketId);
  });

  document.getElementById("open-created-ticket").addEventListener("click", () => {
    navigate("exit");
    openTicket(session.id);
  });

  renderAll();
  showToast(`Ticket ${session.ticketId} created. Timer started.`);
});

/* =========================================
   EXIT TICKET TABLE
   ========================================= */

function renderTicketTable() {
  const tbody = document.getElementById("ticket-table");

  const sessions = [...state.sessions]
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!sessions.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="empty-row">
          No tickets yet. Create one from Entry Dashboard.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sessions.map(session => {
    const end = session.endAt || Date.now();

    const duration = session.startAt
      ? formatDuration(session.startAt, end)
      : "—";

    const fee = session.startAt
      ? `₹${session.fee ?? calculateFee(session.startAt, end)}`
      : "—";

    let action = "";

    if (session.status === "active") {
      action = `
        <button class="danger-button"
          data-action="vehicle-leaving"
          data-id="${escapeHtml(session.id)}">
          Vehicle Leaving
        </button>
      `;
    } else if (session.status === "awaiting_payment") {
      action = `
        <button class="primary-button"
          data-action="confirm-payment"
          data-id="${escapeHtml(session.id)}">
          Confirm Payment
        </button>
      `;
    } else if (session.status === "paid") {
      action = '<span class="status-pill paid">Completed</span>';
    } else {
      action = '<span class="status-pill">Closed</span>';
    }

    return `
      <tr>
        <td><strong>${escapeHtml(session.ticketId)}</strong></td>
        <td>${escapeHtml(session.slotId)}</td>
        <td>${escapeHtml(
          session.vehicleNumber ||
          session.customerName ||
          "Walk-in"
        )}</td>
        <td>${duration}</td>
        <td>${fee}</td>
        <td>${sessionStatusPill(session)}</td>
        <td><div class="row-actions">${action}</div></td>
      </tr>
    `;
  }).join("");
}

/* =========================================
   TICKET SEARCH AND AUTOCOMPLETE
   ========================================= */

const searchInput = document.getElementById("ticket-search");
const suggestionsBox = document.getElementById("ticket-suggestions");

function findMatchingTickets(query) {
  const text = query.trim().toLowerCase();

  if (!text) return [];

  return state.sessions
    .filter(session => {
      const searchable = [
        session.ticketId,
        session.customerName,
        session.vehicleNumber,
        session.slotId,
        session.status
      ].join(" ").toLowerCase();

      return searchable.includes(text);
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);
}

function renderSuggestions(query) {
  const matches = findMatchingTickets(query);

  if (!query.trim()) {
    suggestionsBox.classList.add("hidden");
    suggestionsBox.innerHTML = "";
    return;
  }

  suggestionsBox.classList.remove("hidden");

  if (!matches.length) {
    suggestionsBox.innerHTML = `
      <div class="suggestion-empty">
        No matching tickets found.
      </div>
    `;
    return;
  }

  suggestionsBox.innerHTML = matches.map(session => {
    const statusText = {
      active: "Active",
      awaiting_payment: "Awaiting payment",
      paid: "Paid"
    }[session.status] || "Closed";

    return `
      <button type="button"
        class="suggestion-item"
        data-action="select-suggestion"
        data-id="${escapeHtml(session.id)}">
        <strong>
          ${escapeHtml(session.ticketId)} · Slot ${escapeHtml(session.slotId)}
        </strong>
        <small>
          ${escapeHtml(
            session.vehicleNumber ||
            session.customerName ||
            "Walk-in customer"
          )}
          · ${statusText}
        </small>
      </button>
    `;
  }).join("");
}

searchInput.addEventListener("input", () => {
  renderSuggestions(searchInput.value);
});

searchInput.addEventListener("focus", () => {
  if (searchInput.value.trim()) {
    renderSuggestions(searchInput.value);
  }
});

document.getElementById("lookup-form").addEventListener("submit", event => {
  event.preventDefault();

  const matches = findMatchingTickets(searchInput.value);

  if (!matches.length) {
    selectedExitTicket = null;
    renderExitResult();
    renderSuggestions(searchInput.value);
    showToast("No matching ticket found.");
    return;
  }

  openTicket(matches[0].id);
});

document.addEventListener("click", event => {
  if (!event.target.closest(".search-wrapper")) {
    suggestionsBox.classList.add("hidden");
  }
});

/* =========================================
   SELECTED TICKET DETAILS
   ========================================= */

function openTicket(sessionId) {
  const session = state.sessions.find(item => item.id === sessionId);

  if (!session) {
    showToast("Ticket could not be found.");
    return;
  }

  selectedExitTicket = session.id;
  searchInput.value = session.ticketId;
  suggestionsBox.classList.add("hidden");

  renderExitResult();
}

function renderExitResult() {
  const target = document.getElementById("exit-result");

  const session = state.sessions.find(item =>
    item.id === selectedExitTicket
  );

  if (!session) {
    target.innerHTML = "";
    return;
  }

  const end = session.endAt || Date.now();

  const duration = session.startAt
    ? formatDuration(session.startAt, end)
    : "—";

  const fee = session.status === "paid" ||
    session.status === "awaiting_payment"
    ? Number(session.fee || 0)
    : calculateFee(session.startAt, end);

  let paymentStatus = "In progress";

  if (session.status === "awaiting_payment") {
    paymentStatus = "Unpaid";
  } else if (session.status === "paid") {
    paymentStatus = "Paid";
  }

  let action = "";

  if (session.status === "active") {
    action = `
      <button class="danger-button"
        data-action="vehicle-leaving"
        data-id="${escapeHtml(session.id)}">
        Vehicle Leaving
      </button>
    `;
  } else if (session.status === "awaiting_payment") {
    action = `
      <button class="primary-button"
        data-action="confirm-payment"
        data-id="${escapeHtml(session.id)}">
        Confirm Payment
      </button>
    `;
  } else {
    action = '<span class="status-pill paid">Payment completed</span>';
  }

  target.innerHTML = `
    <article class="exit-card">
      <h3>Ticket ${escapeHtml(session.ticketId)}</h3>

      <p class="muted">
        ${escapeHtml(session.customerName || "Walk-in customer")}
        · ${escapeHtml(session.vehicleNumber || "Vehicle not provided")}
      </p>

      <div class="detail-grid">
        <div class="detail-box">
          <span>Assigned slot</span>
          <strong>${escapeHtml(session.slotId)}</strong>
        </div>

        <div class="detail-box">
          <span>Parking duration</span>
          <strong>${duration}</strong>
        </div>

        <div class="detail-box">
          <span>Parking fee</span>
          <strong>₹${fee}</strong>
        </div>

        <div class="detail-box">
          <span>Payment status</span>
          <strong>${paymentStatus}</strong>
        </div>
      </div>

      <p class="muted">
        Start: ${formatDate(session.startAt)}
        ${session.endAt ? ` · End: ${formatDate(session.endAt)}` : ""}
      </p>

      <div class="exit-buttons">
        ${action}
        <button class="secondary-button"
          data-action="clear-selection"
          type="button">
          Clear selection
        </button>
      </div>
    </article>
  `;
}

/* =========================================
   VEHICLE LEAVING
   ========================================= */

function vehicleLeaving(sessionId) {
  const session = state.sessions.find(item => item.id === sessionId);

  if (!session || session.status !== "active") {
    showToast("This ticket is no longer active.");
    return;
  }

  session.endAt = Date.now();
  session.fee = calculateFee(session.startAt, session.endAt);
  session.status = "awaiting_payment";

  const slot = state.slots.find(item => item.id === session.slotId);

  if (slot) {
    // Vehicle has left. Keep the slot reserved until payment.
    slot.sensor = "vacant";
    slot.reservationId = session.ticketId;
  }

  selectedExitTicket = session.id;

  saveState();
  renderAll();

  showToast(
    `Departure recorded. Fee: ₹${session.fee}. Confirm payment.`
  );
}

/* =========================================
   CONFIRM PAYMENT
   ========================================= */

function confirmPayment(sessionId) {
  const session = state.sessions.find(item => item.id === sessionId);

  if (!session || session.status !== "awaiting_payment") {
    showToast("This ticket is not awaiting payment.");
    return;
  }

  session.status = "paid";
  session.paidAt = Date.now();

  const slot = state.slots.find(item => item.id === session.slotId);

  if (slot) {
    slot.sensor = "vacant";
    slot.reservationId = null;
    slot.sessionId = null;
  }

  saveState();
  renderAll();

  showToast(
    `Payment of ₹${session.fee} recorded. Slot is available.`
  );
}

/* =========================================
   ACTION BUTTON HANDLERS
   ========================================= */

document.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");

  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (action === "select-suggestion") {
    openTicket(id);
    return;
  }

  if (action === "vehicle-leaving") {
    vehicleLeaving(id);
    return;
  }

  if (action === "confirm-payment") {
    confirmPayment(id);
    return;
  }

  if (action === "clear-selection") {
    selectedExitTicket = null;
    searchInput.value = "";
    suggestionsBox.classList.add("hidden");
    renderExitResult();
  }
});

/* =========================================
   NAVIGATION
   ========================================= */

function navigate(view) {
  const pages = {
    overview: [
      "Overview",
      "Monitor availability and manage parking sessions."
    ],
    entry: [
      "Entry dashboard",
      "Assign a vacant slot and issue a parking ticket."
    ],
    exit: [
      "Exit dashboard",
      "Find tickets, calculate charges, and record payment."
    ]
  };

  if (!pages[view]) return;

  document.querySelectorAll(".view").forEach(section => {
    section.classList.add("hidden");
  });

  document.getElementById(`view-${view}`).classList.remove("hidden");

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  document.getElementById("page-title").textContent = pages[view][0];
  document.getElementById("page-subtitle").textContent = pages[view][1];

  renderAll();
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    navigate(button.dataset.view);
  });
});

document.querySelectorAll("[data-go]").forEach(button => {
  button.addEventListener("click", () => {
    navigate(button.dataset.go);
  });
});

document.querySelectorAll(".brand[data-view]").forEach(link => {
  link.addEventListener("click", event => {
    event.preventDefault();
    navigate(link.dataset.view);
  });
});

/* =========================================
   PARKING RATE SETTINGS
   ========================================= */

document.getElementById("edit-rate").addEventListener("click", () => {
  const answer = prompt(
    "Enter the hourly parking rate in rupees:",
    String(state.rate)
  );

  if (answer === null) return;

  const rate = Number(answer);

  if (!Number.isFinite(rate) || rate <= 0 || rate > 100000) {
    showToast("Enter a valid positive parking rate.");
    return;
  }

  state.rate = Math.round(rate);

  saveState();
  renderAll();

  showToast(`Hourly rate changed to ₹${state.rate}.`);
});

/* =========================================
   COPY TICKET ID
   ========================================= */

async function copyTicketId(ticketId) {
  try {
    if (!navigator.clipboard) {
      throw new Error("Clipboard unavailable");
    }

    await navigator.clipboard.writeText(ticketId);
    showToast("Ticket ID copied.");
  } catch (error) {
    showToast(`Ticket ID: ${ticketId}`);
  }
}

/* =========================================
   TOAST NOTIFICATIONS
   The toast is hidden when empty and after
   each notification timeout.
   ========================================= */

function showToast(message) {
  const toast = document.getElementById("toast");

  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  // Keep it hidden if there is no message.
  toast.classList.remove("show");
  toast.textContent = "";

  if (!message) return;

  toast.textContent = message;
  toast.classList.add("show");

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    toast.textContent = "";
    toastTimer = null;
  }, 2800);
}

/* =========================================
   LIVE DURATION AND FEE REFRESH
   ========================================= */

setInterval(() => {
  renderStats();
  renderTicketTable();

  if (selectedExitTicket) {
    renderExitResult();
  }
}, 1000);

/* Initial dashboard render */

renderAll();