"use strict";

const storageKey = "queencess-bookings-v1";
const form = document.querySelector("#request");
const feedback = document.querySelector("#feedback");
const latest = document.querySelector("#latest");
const board = document.querySelector("#requests");

function readRequests() {
  return JSON.parse(localStorage.getItem(storageKey) ?? "[]");
}

function dateInSouthAfrica() {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts();
  const get = (type) => parts.find((part) => part.type === type).value;
  return [get("year"), get("month"), get("day")].join("-");
}

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
    row.append(info);

    if (request.status === "Pending") {
      const controls = document.createElement("div");
      for (const decision of ["Accept", "Decline"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = decision;
        button.setAttribute("aria-label", `${decision} ${request.style} on ${request.date} at ${request.time}`);
        button.addEventListener("click", () => {
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

form.elements.date.min = dateInSouthAfrica();
for (const button of document.querySelectorAll(".pick")) {
  button.addEventListener("click", () => {
    form.elements.style.value = button.dataset.style;
    form.elements.style.focus();
  });
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (data.date < dateInSouthAfrica()) {
    feedback.textContent = "Choose today or a future date.";
    form.elements.date.focus();
    return;
  }
  const requests = readRequests();
  if (requests.some((entry) => entry.status !== "Declined" &&
    ["style", "area", "date", "time"].every((field) => entry[field] === data[field]))) {
    feedback.textContent = "A request for these details already exists.";
    return;
  }
  if (save([{ ...data, id: crypto.randomUUID(), status: "Pending" }, ...requests])) {
    form.reset();
    feedback.textContent = "Demo request saved. Open the salon-owner demo below to review it.";
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === storageKey || event.key === null) render(readRequests());
});
render(readRequests());
