"use strict";

// Only published text and portfolio pictures are public; booking details use protected endpoints.
async function loadWebsiteContent() {
  try {
    const response = await fetch("/api/content", { cache: "no-store" });
    if (!response.ok) throw new Error("Website content unavailable");
    const { content, photos } = await response.json();
    const title = document.querySelector("#hero-title");
    if (content.headline !== "Queen look and princess treatment") {
      title.textContent = content.headline;
      title.classList.add("custom-headline");
    }
    document.querySelector(".hero .intro").textContent = content.intro;
    document.querySelector("#uploads-title").textContent = content.portfolioTitle;
    const announcement = document.querySelector("#announcement");
    announcement.textContent = content.announcement;
    announcement.hidden = !content.announcement;
    const cover = photos.find(photo => photo.id === content.heroPhoto);
    if (cover) {
      document.querySelector(".hero figure img").src = "/api/photos/" + cover.id;
      document.querySelector(".hero figure img").alt = cover.caption;
      document.querySelector(".hero figcaption").textContent = cover.caption;
    }
    const gallery = document.querySelector(".upload-grid");
    if (!content.showOriginalPhotos) gallery.replaceChildren();
    for (const photo of [...photos].reverse()) {
      const figure = document.createElement("figure");
      const link = document.createElement("a");
      link.href = "/api/photos/" + photo.id;
      const image = document.createElement("img");
      image.src = link.href;
      image.alt = photo.caption;
      image.loading = "lazy";
      const caption = document.createElement("figcaption");
      caption.textContent = photo.caption;
      link.append(image);
      figure.append(link, caption);
      gallery.prepend(figure);
    }
  } catch (error) {
    console.warn("Showing the original website content.");
  }
  initializePortfolio();
}

function initializePortfolio() {
  const slideshow = document.querySelector(".slideshow");
  const slides = [...slideshow.querySelectorAll("figure")];
  if (!slides.length) {
    const empty = document.createElement("p");
    empty.textContent = "New portfolio pictures coming soon.";
    slideshow.append(empty);
    return;
  }
  const controls = slideshow.querySelector(".slideshow-controls");
  const position = slideshow.querySelector(".slide-position");
  const strip = slideshow.querySelector(".portfolio-thumbnails");
  let active = 0;
  const thumbnails = slides.map((slide, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", slide.querySelector("figcaption").textContent);
    const image = document.createElement("img");
    image.src = slide.querySelector("img").src;
    image.alt = "";
    image.loading = "lazy";
    button.append(image);
    button.addEventListener("click", () => show(index));
    strip.append(button);
    return button;
  });
  function show(index) {
    active = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => { slide.hidden = i !== active; });
    thumbnails.forEach((button, i) => {
      if (i === active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
    position.textContent = `Photo ${active + 1} of ${slides.length}`;
  }
  for (const button of controls.querySelectorAll("button")) {
    button.addEventListener("click", () => show(active + Number(button.dataset.step)));
  }
  controls.addEventListener("keydown", event => {
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      show(active + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  slideshow.classList.add("is-ready");
  show(0);
  controls.hidden = slides.length < 2;
  strip.hidden = slides.length < 2;
}

void loadWebsiteContent();
