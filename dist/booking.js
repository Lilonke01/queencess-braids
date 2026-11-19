"use strict";

// Store demo requests in this browser so reviewers can reload and keep their progress.
const storageKey = "queencess-bookings-v1";
const form = document.querySelector("#request");
const feedback = document.querySelector("#feedback");
const latest = document.querySelector("#latest");
const board = document.querySelector("#requests");

function readRequests() {
  return JSON.parse(localStorage.getItem(storageKey) ?? "[]");
}

// Use the salon time zone when deciding which appointment dates are in the past.
function dateInSouthAfrica() {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts();
  const get = (type) => parts.find((part) => part.type === type).value;
  return [get("year"), get("month"), get("day")].join("-");
}

// Update the client status and rebuild the owner panel from the saved requests.
function render(requests) {
  board.replaceChildren();
  latest.textContent = requests.length ? `Latest demo request: ${requests[0].status}.` : "";
  if (!requests.length) {
    board.textContent = "No requests yet. Save a demo request above to get started.";
    return;
  }

  for (const request of requests) {
    const row = document.createElement("div");
    row.className = "request-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `${request.style} · ${request.status}`;
    const slot = document.createElement("div");
    slot.textContent = `${request.date} at ${request.time} SAST · ${request.area}`;
    info.append(title, slot);
    if (request.mapLink) {
      const map = document.createElement("a");
      map.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(request.mapLink);
      map.textContent = "View location on Google Maps";
      map.target = "_blank";
      map.rel = "noopener noreferrer";
      info.append(map);
    }
    row.append(info);

    // The owner can decide on a pending request once.
    if (request.status === "Pending") {
      const controls = document.createElement("div");
      for (const decision of ["Accept", "Decline"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = decision;
        button.setAttribute("aria-label", `${decision} ${request.style} on ${request.date} at ${request.time}`);
        button.addEventListener("click", () => {
          // Reload the saved request before applying a decision in case another tab changed it.
          const requests = readRequests();
          const current = requests.find((entry) => entry.id === request.id);
          if (current?.status === "Pending") {
            current.status = decision === "Accept" ? "Accepted" : "Declined";
            save(requests);
          }
          document.querySelector("#owner summary").focus();
        });
        controls.append(button);
      }
      row.append(controls);
    }
    board.append(row);
  }
}

// Update the screen only after the browser successfully stores the change.
function save(requests) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(requests));
  } catch {
    feedback.textContent = "This browser could not save the change. Check your browser storage settings.";
    return false;
  }
  render(requests);
  return true;
}

// Search the entered area without needing a Maps API key.
const mapSearch = document.querySelector("#map-search");
const sendBooking = document.querySelector("#send-booking");
form.elements.area.addEventListener("input", () => {
  const area = form.elements.area.value.trim() || "Plettenberg Bay";
  mapSearch.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(area + ", Plettenberg Bay, South Africa");
});
form.addEventListener("input", () => { sendBooking.hidden = true; });
form.elements.date.min = dateInSouthAfrica();
// Selecting a card fills the style field and moves focus to the form.
for (const button of document.querySelectorAll(".pick")) {
  button.addEventListener("click", () => {
    form.elements.style.value = button.dataset.style;
    form.elements.style.focus();
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.area = data.area.trim();
  if (!data.area) {
    feedback.textContent = "Enter your area around Plettenberg Bay.";
    form.elements.area.focus();
    return;
  }
  if (data.date < dateInSouthAfrica()) {
    feedback.textContent = "Choose today or a future date.";
    form.elements.date.focus();
    return;
  }
  const requests = readRequests();
  // Declined requests can be submitted again with the same appointment details.
  if (requests.some((entry) => entry.status !== "Declined" &&
    ["style", "area", "date", "time"].every((field) => entry[field] === data[field]))) {
    feedback.textContent = "A request for these details already exists.";
    return;
  }
  if (save([{ ...data, id: crypto.randomUUID(), status: "Pending" }, ...requests])) {
    const location = data.mapLink || "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.area + ", Plettenberg Bay, South Africa");
    const message = `Hi Alicia, I'd like to request ${data.style} on ${data.date} at ${data.time} SAST. Area: ${data.area}. Location: ${location}`;
    sendBooking.href = "https://wa.me/27798418297?text=" + encodeURIComponent(message);
    sendBooking.hidden = false;
    form.reset();
    feedback.textContent = "Demo request saved in this browser. Use the WhatsApp button to send Alicia your request and location.";
  }
});

// Refresh the display when another tab changes the stored requests.
window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) render(readRequests());
});
render(readRequests());
