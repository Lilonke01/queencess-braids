"use strict";

const slideshow = document.querySelector(".slideshow");
const slides = Array.from(slideshow.querySelectorAll("figure"));
const controls = slideshow.querySelector(".slideshow-controls");
const position = slideshow.querySelector(".slide-position");
const thumbnailStrip = slideshow.querySelector(".portfolio-thumbnails");
let activeIndex = 0;

// Reuse the uploaded images and captions as accessible thumbnail buttons.
const thumbnails = slides.map((slide, index) => {
  const button = document.createElement("button");
  const thumbnail = document.createElement("img");
  const caption = slide.querySelector("figcaption").textContent;
  button.type = "button";
  button.setAttribute("aria-label", caption);
  thumbnail.src = slide.querySelector("img").src;
  thumbnail.alt = "";
  thumbnail.loading = "lazy";
  button.append(thumbnail);
  button.addEventListener("click", () => showSlide(index));
  thumbnailStrip.append(button);
  return button;
});

// Wrap in either direction so the visitor can keep browsing the whole gallery.
function showSlide(index) {
  activeIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    slide.hidden = slideIndex !== activeIndex;
  });
  thumbnails.forEach((thumbnail, thumbnailIndex) => {
    if (thumbnailIndex === activeIndex) {
      thumbnail.setAttribute("aria-current", "true");
    } else {
      thumbnail.removeAttribute("aria-current");
    }
  });
  position.textContent = `Photo ${activeIndex + 1} of ${slides.length}`;
}

for (const button of controls.querySelectorAll("button")) {
  button.addEventListener("click", () => showSlide(activeIndex + Number(button.dataset.step)));
}

// Arrow keys work while focus is on the slideshow controls.
controls.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    showSlide(activeIndex + (event.key === "ArrowLeft" ? -1 : 1));
  }
});

slideshow.classList.add("is-ready");
showSlide(0);
controls.hidden = false;
thumbnailStrip.hidden = false;
