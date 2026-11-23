"use strict";
const board = document.querySelector("#requests");
const ownerAccess = document.querySelector("#owner-access");
const ownerFeedback = document.querySelector("#owner-feedback");
const signOut = document.querySelector("#owner-signout");
const report = document.querySelector("#owner-report");
const reportFilter = document.querySelector("#report-filter");
const reportMonth = reportFilter.elements.month;
const reportSummary = document.querySelector("#report-summary");
const reportServices = document.querySelector("#report-services");
const ownerReviews = document.querySelector("#owner-reviews");
const ownerReviewList = document.querySelector("#owner-review-list");
const ownerReviewFeedback = document.querySelector("#owner-review-feedback");
let reportRequest = 0;
let ownerKey = "";
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
      ownerAccess.hidden = true;
      document.querySelector("#site-manager").hidden = false;
      document.querySelector("#owner-navigation").hidden = false;
      await Promise.all([loadReport(key), loadOwnerReviews(key), loadContentEditor()]);
    }
  } catch (error) {
    if (key) void api("/api/owner/logout", { method: "POST", key }).catch(() => {});
    ownerKey = "";
    signOut.hidden = true;
    ownerAccess.hidden = false;
    report.hidden = true;
    ownerReviews.hidden = true;
    board.replaceChildren();
    document.querySelector("#site-manager").hidden = true;
    document.querySelector("#owner-navigation").hidden = true;
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
  ownerAccess.hidden = false;
  document.querySelector("#site-manager").hidden = true;
  document.querySelector("#owner-navigation").hidden = true;
  document.querySelector("#photo-manager-list").replaceChildren();
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

  } catch (error) {
    if (key === ownerKey) ownerFeedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

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
            await loadOwnerReviews(key);
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

const contentEditor = document.querySelector("#content-editor");
const contentFeedback = document.querySelector("#content-feedback");
const photoUpload = document.querySelector("#photo-upload");
const photoFeedback = document.querySelector("#photo-feedback");
const photoList = document.querySelector("#photo-manager-list");

async function loadContentEditor() {
  const key = ownerKey;
  const { content, photos } = await api("/api/owner/content", { key });
  if (key !== ownerKey) return;
  for (const field of ["headline", "intro", "announcement", "portfolioTitle"]) {
    contentEditor.elements[field].value = content[field];
  }
  contentEditor.elements.showOriginalPhotos.checked = content.showOriginalPhotos;
  const cover = contentEditor.elements.heroPhoto;
  cover.replaceChildren(new Option("Original cover picture", ""));
  for (const photo of photos) cover.add(new Option(photo.caption, photo.id));
  cover.value = photos.some(photo => photo.id === content.heroPhoto) ? content.heroPhoto : "";
  photoList.replaceChildren();
  if (!photos.length) photoList.textContent = "No uploaded pictures yet. Add your first picture above.";
  for (const photo of photos) {
    const item = document.createElement("article");
    const image = document.createElement("img");
    image.src = "/api/photos/" + photo.id;
    image.alt = photo.caption;
    image.loading = "lazy";
    const form = document.createElement("form");
    const label = document.createElement("label");
    label.textContent = "Picture caption";
    const input = document.createElement("input");
    input.value = photo.caption;
    input.maxLength = 180;
    input.required = true;
    label.append(input);
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save caption";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove picture";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    form.append(label, save);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      save.disabled = true;
      try {
        await api("/api/owner/photos/" + photo.id, { method: "PATCH", key, data: { caption: input.value } });
        if (key === ownerKey) {
          image.alt = input.value;
          const option = [...cover.options].find(option => option.value === photo.id);
          if (option) option.textContent = input.value;
          status.textContent = "Caption published.";
        }
      } catch (error) { status.textContent = error.message; }
      finally { save.disabled = false; }
    });
    remove.addEventListener("click", async () => {
      if (!window.confirm("Remove this picture from the website? You can upload it again later.")) return;
      remove.disabled = true;
      try {
        await api("/api/owner/photos/" + photo.id, { method: "DELETE", key });
        if (key === ownerKey) {
          item.remove();
          const option = [...cover.options].find(option => option.value === photo.id);
          option?.remove();
          if (!cover.value) cover.value = "";
          photoFeedback.textContent = "Picture removed from the website.";
        }
      } catch (error) { status.textContent = error.message; remove.disabled = false; }
    });
    item.append(image, form, remove, status);
    photoList.append(item);
  }
}

contentEditor.addEventListener("submit", async event => {
  event.preventDefault();
  const key = ownerKey;
  const button = event.submitter;
  button.disabled = true;
  contentFeedback.textContent = "Publishing…";
  const data = Object.fromEntries(new FormData(contentEditor));
  data.showOriginalPhotos = contentEditor.elements.showOriginalPhotos.checked;
  try {
    await api("/api/owner/content", { method: "PUT", key, data });
    if (key === ownerKey) contentFeedback.textContent = "Published. Open or refresh the website to see your changes.";
  } catch (error) { if (key === ownerKey) contentFeedback.textContent = error.message; }
  finally { button.disabled = false; }
});

// Decode and resize locally so large phone photos upload quickly without retaining metadata.
async function preparePhoto(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP picture.");
  if (file.size > 20 * 1024 * 1024) throw new Error("Choose a picture smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.86));
    if (!blob || blob.size > 4 * 1024 * 1024) throw new Error("This picture is too large. Choose a smaller one.");
    return blob;
  } finally { bitmap.close(); }
}

photoUpload.addEventListener("submit", async event => {
  event.preventDefault();
  const key = ownerKey;
  const button = event.submitter;
  button.disabled = true;
  photoFeedback.textContent = "Preparing and uploading picture…";
  try {
    const blob = await preparePhoto(photoUpload.elements.photo.files[0]);
    if (key !== ownerKey) return;
    const response = await fetch("/api/owner/photos?caption=" + encodeURIComponent(photoUpload.elements.caption.value.trim()), {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": blob.type }, body: blob,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Upload failed. Please try again.");
    if (key !== ownerKey) return;
    photoUpload.reset();
    await loadContentEditor();
    photoFeedback.textContent = "Picture published. It now appears in the website portfolio.";
  } catch (error) { if (key === ownerKey) photoFeedback.textContent = error.message; }
  finally { button.disabled = false; }
});

