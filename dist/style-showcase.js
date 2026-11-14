"use strict";

const showcase = document.querySelector(".style-showcase");
const styleSlides = Array.from(showcase.querySelectorAll("article"));
const styleControls = showcase.querySelector(".style-controls");
const dots = showcase.querySelector(".style-dots");
const playback = showcase.querySelector(".style-play");
const styleStatus = showcase.querySelector(".style-status");
let currentStyle = 0;
let slideshowTimer;

const styleDots = styleSlides.map((slide, index) => {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.setAttribute("aria-label", slide.querySelector("h3").textContent);
  dot.addEventListener("click", () => selectStyle(index));
  dots.append(dot);
  return dot;
});

function showStyle(index) {
  currentStyle = (index + styleSlides.length) % styleSlides.length;
  styleSlides.forEach((slide, slideIndex) => {
    const active = slideIndex === currentStyle;
    slide.hidden = !active;
    styleDots[slideIndex].setAttribute("aria-current", String(active));
  });
  styleStatus.textContent = styleDots[currentStyle].getAttribute("aria-label");
}

function stopPlayback() {
  clearInterval(slideshowTimer);
  slideshowTimer = undefined;
  playback.textContent = "▶";
  playback.setAttribute("aria-label", "Play slideshow");
}

function selectStyle(index) {
  stopPlayback();
  showStyle(index);
}

playback.addEventListener("click", () => {
  if (slideshowTimer) {
    stopPlayback();
    return;
  }
  playback.textContent = "Ⅱ";
  playback.setAttribute("aria-label", "Pause slideshow");
  slideshowTimer = setInterval(() => showStyle(currentStyle + 1), 5500);
});

showcase.querySelector(".style-slides").addEventListener("focusin", stopPlayback);
for (const button of styleControls.querySelectorAll("[data-step]")) {
  button.addEventListener("click", () => selectStyle(currentStyle + Number(button.dataset.step)));
}
styleControls.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    selectStyle(currentStyle + (event.key === "ArrowLeft" ? -1 : 1));
  }
});

showStyle(0);
styleControls.hidden = false;
