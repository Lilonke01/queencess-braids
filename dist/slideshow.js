"use strict";

const slideshow = document.querySelector(".slideshow");
const slides = Array.from(slideshow.querySelectorAll("figure"));
const controls = slideshow.querySelector(".slideshow-controls");
const position = slideshow.querySelector(".slide-position");
let activeIndex = 0;

// Wrap in either direction so the visitor can keep browsing the whole gallery.
function showSlide(index) {
  activeIndex = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => {
    slide.hidden = slideIndex !== activeIndex;
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
