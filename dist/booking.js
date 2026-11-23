"use strict";

const storageKey = "queencess-latest-booking";
const form = document.querySelector("#request");
const feedback = document.querySelector("#feedback");
const latest = document.querySelector("#latest");
let latestId;
try {
  latestId = localStorage.getItem(storageKey);
} catch {
  // The status is still available while this page stays open.
}

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

function dateInSouthAfrica() {
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts();
  const get = (type) => parts.find((part) => part.type === type).value;
  return [get("year"), get("month"), get("day")].join("-");
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
    feedback.textContent = "Your booking request has been saved. It is awaiting confirmation. You can also send the details on WhatsApp.";

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
  } catch (error) {
    reviewFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

void loadReviews();
