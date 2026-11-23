"use strict";

const storageKey = "queencess-latest-booking";
const form = document.querySelector("#request");
const feedback = document.querySelector("#feedback");
const latest = document.querySelector("#latest");
const board = document.querySelector("#requests");

const ownerAccess = document.querySelector("#owner-access");
const ownerPanel = document.querySelector("#owner");
const ownerLaunch = document.querySelector("#open-owner-dashboard");
// The header is the single entry point; opening this panel never bypasses login.
function openOwnerPanel() {
  ownerPanel.hidden = false;
  ownerLaunch.setAttribute("aria-expanded", "true");
  document.querySelector("#owner-title").focus();
}
ownerLaunch.addEventListener("click", () => {
  if (ownerPanel.hidden) openOwnerPanel();
  else {
    ownerPanel.hidden = true;
    ownerLaunch.setAttribute("aria-expanded", "false");
    ownerLaunch.focus();
  }
});
window.addEventListener("hashchange", () => {
  if (location.hash === "#owner") openOwnerPanel();
});
if (location.hash === "#owner") openOwnerPanel();
const ownerFeedback = document.querySelector("#owner-feedback");
const signOut = document.querySelector("#owner-signout");
const report = document.querySelector("#owner-report");
const reportFilter = document.querySelector("#report-filter");
const reportMonth = reportFilter.elements.month;
const reportSummary = document.querySelector("#report-summary");
const reportServices = document.querySelector("#report-services");
// Track in-flight report requests so an earlier month cannot overwrite the latest selection.
let reportRequest = 0;
// Keep the owner session token in memory. Local storage only remembers the client's booking reference.
let ownerKey = "";
let latestId;
try {
  latestId = localStorage.getItem(storageKey);
} catch {
  // The status is still available while this page stays open.
}

// Use the same origin for the website and its API. Include the owner token only on protected requests.
async function api(path, { method = "GET", data, key } = {}) {
  const headers = {};
  if (data) headers["Content-Type"] = "application/json";
  if (key) headers.Authorization = "Bearer " + key;
  const response = await fetch(path, { method, headers, body: data && JSON.stringify(data) });
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Open the website through the booking server.");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function refreshStatus() {
  const id = latestId;
  if (!id) return;
  try {
    const { status, date, time } = await api("/api/bookings/" + encodeURIComponent(id));
    if (id === latestId) latest.textContent = `Latest booking: ${status} · ${date} at ${time} SAST.`;
  } catch (error) {
    if (id === latestId) latest.textContent = "Status unavailable. " + error.message;
  }
}

async function loadOwner(key) {
  const { bookings } = await api("/api/owner/bookings", { key });
  if (key === ownerKey) render(bookings);
}

async function loadReport(key) {
  const request = ++reportRequest;
  reportSummary.textContent = "Loading report…";
  reportServices.replaceChildren();
  try {
    const result = await api("/api/owner/reports/monthly?month=" + encodeURIComponent(reportMonth.value), { key });
    if (key !== ownerKey || request !== reportRequest) return;
    const { Completed, Pending, Accepted, Declined } = result.totals;
    reportSummary.textContent = `${result.month} · ${Completed} completed appointments · ${result.uniqueClients} unique clients · ${Pending} pending · ${Accepted} approved · ${Declined} declined · ${result.totals.Cancelled} cancelled · ${result.totals["No-show"]} no-shows.`;
    if (result.completedWithoutClient) {
      reportSummary.textContent += ` ${result.completedWithoutClient} older completed bookings have no client record.`;
    }
    for (const { style, count } of result.completedByService) {
      const item = document.createElement("li");
      item.textContent = `${style}: ${count} completed`;
      reportServices.append(item);
    }
  } catch (error) {
    if (key === ownerKey && request === reportRequest) reportSummary.textContent = error.message;
  }
}

reportMonth.value = dateInSouthAfrica().slice(0, 7);
reportFilter.addEventListener("submit", (event) => {
  event.preventDefault();
  if (ownerKey) void loadReport(ownerKey);
});

ownerAccess.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = ownerAccess.querySelector('button[type="submit"]');
  const credentials = Object.fromEntries(new FormData(ownerAccess));
  button.disabled = true;
  let key;
  const previousKey = ownerKey;
  ownerKey = "";
  ownerAccess.reset();
  if (previousKey) void api("/api/owner/logout", { method: "POST", key: previousKey }).catch(() => {});
  report.hidden = true;
  ownerReviews.hidden = true;
  ownerReviewList.replaceChildren();
  ownerReviewFeedback.textContent = "";
  board.replaceChildren();
  signOut.hidden = true;
  ownerFeedback.textContent = "Signing in…";
  try {
    ({ token: key } = await api("/api/owner/login", { method: "POST", data: credentials }));
    ownerKey = key;
    await loadOwner(key);
    signOut.hidden = false;
    if (key === ownerKey) {
      ownerFeedback.textContent = "";
      report.hidden = false;
      ownerReviews.hidden = false;
      await Promise.all([loadReport(key), loadOwnerReviews(key)]);
    }
  } catch (error) {
    ownerKey = "";
    signOut.hidden = true;
    ownerFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

signOut.addEventListener("click", () => {
  const key = ownerKey;
  ownerKey = "";
  void api("/api/owner/logout", { method: "POST", key }).catch(() => {});
  signOut.hidden = true;
  report.hidden = true;
  ownerReviews.hidden = true;
  ownerReviewList.replaceChildren();
  ownerReviewFeedback.textContent = "";
  reportRequest++;
  reportSummary.textContent = "";
  reportServices.replaceChildren();
  ownerAccess.reset();
  ownerFeedback.textContent = "";
  board.replaceChildren();
});

// Use the salon time zone when deciding which appointment dates are in the past.
function dateInSouthAfrica() {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts();
  const get = (type) => parts.find((part) => part.type === type).value;
  return [get("year"), get("month"), get("day")].join("-");
}

// Rebuild the owner panel from the saved requests.
function render(requests) {
  board.replaceChildren();
  if (!requests.length) {
    board.textContent = "No requests yet.";
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
    if (request.clientPhone) {
      const contact = document.createElement("a");
      contact.href = "tel:" + request.clientPhone;
      contact.textContent = request.clientName + " · " + request.clientPhone;
      const line = document.createElement("div");
      line.append(contact);
      info.append(line);
    } else {
      const note = document.createElement("div");
      note.textContent = "No client details on this older booking.";
      info.append(note);
    }
    if (request.mapLink) {
      const map = document.createElement("a");
      map.href = request.mapLink;
      map.textContent = "Open map link";
      map.target = "_blank";
      map.rel = "noopener noreferrer";
      info.append(map);
    }
    row.append(info);

    // Match the actions shown to the owner to the booking's current status and SAST appointment time.
    const actions = [];
    const started = Date.parse(request.date + "T" + request.time + ":00+02:00") <= Date.now();
    const open = ["Pending", "Accepted"].includes(request.status);
    if (request.status === "Pending") {
      if (!started) actions.push(["Approve", "Accepted"]);
      actions.push(["Decline", "Declined"]);
    }
    if (request.status === "Accepted" && started) {
      actions.push(["Mark completed", "Completed"], ["Mark no-show", "No-show"]);
    }
    if (open) actions.push(["Cancel booking", "Cancelled"]);
    if (actions.length) {
      const controls = document.createElement("div");
      for (const [label, status] of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.setAttribute("aria-label", `${label} for ${request.style} on ${request.date} at ${request.time}`);
        button.addEventListener("click", () => updateBooking(request.id, { status }, button));
        controls.append(button);
      }
      row.append(controls);
    }
    if (open) {
      const editor = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Reschedule";
      const schedule = document.createElement("form");
      schedule.innerHTML = '<label>New date <input name="date" type="date" required></label> ' +
        '<label>New time (SAST) <input name="time" type="time" required></label> ' +
        '<button type="submit">Save new time</button>';
      schedule.elements.date.min = dateInSouthAfrica();
      schedule.elements.date.value = request.date;
      schedule.elements.time.value = request.time;
      schedule.addEventListener("submit", (event) => {
        event.preventDefault();
        void updateBooking(request.id, { action: "reschedule", ...Object.fromEntries(new FormData(schedule)) }, event.submitter);
      });
      editor.append(summary, schedule);
      row.append(editor);
    }
    board.append(row);
  }
}

async function updateBooking(id, data, button) {
  const key = ownerKey;
  button.disabled = true;
  ownerFeedback.textContent = "";
  try {
    await api("/api/owner/bookings/" + id, { method: "PATCH", key, data });
    await loadOwner(key);
    if (key === ownerKey) {
      ownerFeedback.textContent = "Booking updated.";
      document.querySelector("#owner-title").focus();
      void loadReport(key);
    }
    await refreshStatus();
  } catch (error) {
    if (key === ownerKey) ownerFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

const checkAvailability = document.querySelector("#check-availability");
checkAvailability.addEventListener("click", async () => {
  const slot = new URLSearchParams();
  for (const field of ["style", "date", "time"]) {
    const input = form.elements[field];
    if (!input.reportValidity()) return;
    slot.set(field, input.value);
  }
  checkAvailability.disabled = true;
  try {
    const { available } = await api("/api/availability?" + slot);
    const current = [...slot].every(([field, value]) => form.elements[field].value === value);
    if (current) feedback.textContent = available ? "This slot is available to request." : "This slot is unavailable. Choose another time.";
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    checkAvailability.disabled = false;
  }
});

// Search the entered area without needing a Maps API key.
const mapSearch = document.querySelector("#map-search");
const sendBooking = document.querySelector("#send-booking");
form.elements.area.addEventListener("input", () => {
  const area = form.elements.area.value.trim() || "Plettenberg Bay";
  mapSearch.href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(area + ", Plettenberg Bay, South Africa");
});
form.addEventListener("input", () => { sendBooking.hidden = true; feedback.textContent = ""; });
form.elements.date.min = dateInSouthAfrica();
// Selecting a card fills the style field and moves focus to the form.
for (const button of document.querySelectorAll(".pick")) {
  button.addEventListener("click", () => {
    form.elements.style.value = button.dataset.style;
    form.elements.style.focus();
  });
}

form.addEventListener("submit", async (event) => {
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
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  feedback.textContent = "Submitting request…";
  try {
    const { id, status } = await api("/api/bookings", { method: "POST", data });
    latestId = id;
    latest.textContent = "Latest booking: " + status + ".";
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // The booking has already been saved on the server.
    }
    const location = data.mapLink || "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(data.area + ", Plettenberg Bay, South Africa");
    const message = `Hi Alicia, this is ${data.name}. I'd like to request ${data.style} on ${data.date} at ${data.time} SAST. Area: ${data.area}. Location: ${location}`;
    sendBooking.href = "https://wa.me/27798418297?text=" + encodeURIComponent(message);
    sendBooking.hidden = false;
    form.reset();
    feedback.textContent = "Demo request submitted. You can also send the details on WhatsApp.";
    if (ownerKey) {
      const key = ownerKey;
      Promise.all([loadOwner(key), loadReport(key)]).catch((error) => {
        if (key === ownerKey) ownerFeedback.textContent = error.message;
      });
    }
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

// Pick up owner decisions made on another device without requiring the client to reload.
window.addEventListener("focus", refreshStatus);
window.setInterval(refreshStatus, 15000);
refreshStatus();

const reviewForm = document.querySelector("#review-form");
const reviewFeedback = document.querySelector("#review-feedback");
const publicReviewList = document.querySelector("#review-list");
const publicReviewFeedback = document.querySelector("#review-list-feedback");
const ownerReviews = document.querySelector("#owner-reviews");
const ownerReviewList = document.querySelector("#owner-review-list");
const ownerReviewFeedback = document.querySelector("#owner-review-feedback");

function reviewItem(review) {
  const item = document.createElement("li");
  const rating = document.createElement("strong");
  rating.textContent = review.rating + " out of 5 stars";
  const comment = document.createElement("p");
  comment.textContent = review.comment;
  const name = document.createElement("p");
  name.textContent = review.displayName || "Anonymous client";
  item.append(rating, name, comment);
  return item;
}

async function loadReviews() {
  try {
    const { reviews } = await api("/api/reviews");
    publicReviewList.replaceChildren(...reviews.map(reviewItem));
    publicReviewFeedback.textContent = reviews.length ? "" : "No published reviews yet.";
  } catch (error) {
    publicReviewFeedback.textContent = error.message;
  }
}

async function loadOwnerReviews(key) {
  try {
    const { reviews } = await api("/api/owner/reviews", { key });
    if (key !== ownerKey) return;
    ownerReviewList.replaceChildren();
    ownerReviewFeedback.textContent = reviews.length ? "" : "No reviews to moderate.";
    for (const review of reviews) {
      const item = reviewItem(review);
      const status = document.createElement("p");
      status.textContent = review.status;
      item.append(status);
      const actions = review.status === "Pending" ? ["Published", "Hidden"] : ["Hidden"];
      for (const decision of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = decision === "Published" ? "Publish review" : "Hide review";
        button.addEventListener("click", async () => {
          const buttons = item.querySelectorAll("button");
          for (const control of buttons) control.disabled = true;
          try {
            await api("/api/owner/reviews/" + review.id, { method: "PATCH", key, data: { status: decision } });
            await Promise.all([loadOwnerReviews(key), loadReviews()]);
          } catch (error) {
            if (key === ownerKey) ownerReviewFeedback.textContent = error.message;
          } finally {
            for (const control of buttons) control.disabled = false;
          }
        });
        item.append(button);
      }
      ownerReviewList.append(item);
    }
  } catch (error) {
    if (key === ownerKey) ownerReviewFeedback.textContent = error.message;
  }
}

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = reviewForm.querySelector('button[type="submit"]');
  const comment = reviewForm.elements.comment.value.trim();
  if (comment.length < 10) {
    reviewFeedback.textContent = "Enter at least 10 characters about your visit.";
    reviewForm.elements.comment.focus();
    return;
  }

  button.disabled = true;
  reviewFeedback.textContent = "Submitting review…";
  try {
    await api("/api/reviews", {
      method: "POST",
      data: {
        rating: Number(reviewForm.elements.rating.value),
        displayName: reviewForm.elements.displayName.value.trim(),
        comment,
      },
    });
    reviewForm.reset();
    reviewFeedback.textContent = "Thank you. Your review is waiting for owner approval.";
    if (ownerKey) void loadOwnerReviews(ownerKey);
  } catch (error) {
    reviewFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

void loadReviews();
