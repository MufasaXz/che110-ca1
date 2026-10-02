(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var docEl = document.documentElement;

  /* ---------- mobile navigation ---------- */
  var btn = document.querySelector(".nav-toggle");
  var nav = document.getElementById("nav-menu");
  if (btn && nav) {
    function setNav(open) {
      nav.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function () {
      setNav(!nav.classList.contains("open"));
    });
    nav.addEventListener("click", function (e) {
      if (e.target.tagName === "A") setNav(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") setNav(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 860) setNav(false);
    });
  }

  /* ---------- header + scroll progress ---------- */
  var header = document.querySelector(".site-header");
  var progress = document.querySelector(".scroll-progress");

  function onScroll() {
    var y = window.scrollY || docEl.scrollTop;
    if (header) header.classList.toggle("scrolled", y > 8);
    if (progress) {
      var max = docEl.scrollHeight - window.innerHeight;
      var p = max > 0 ? y / max : 0;
      progress.style.transform = "scaleX(" + Math.min(Math.max(p, 0), 1) + ")";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- hero ridge parallax ---------- */
  var layers = [
    { el: document.querySelector(".ridge-back"), speed: 0.08 },
    { el: document.querySelector(".ridge-mid"), speed: 0.16 },
    { el: document.querySelector(".ridge-front"), speed: 0.28 },
    { el: document.querySelector(".ridge-line"), speed: 0.28 }
  ].filter(function (l) { return l.el; });

  var ticking = false;
  function parallax() {
    ticking = false;
    var y = window.scrollY;
    if (y > window.innerHeight * 1.2) return;
    for (var i = 0; i < layers.length; i++) {
      layers[i].el.style.transform = "translateY(" + (y * layers[i].speed).toFixed(1) + "px)";
    }
  }
  if (!reduceMotion && layers.length) {
    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(parallax);
      }
    }, { passive: true });
  }

  /* ---------- snow particles ---------- */
  var snowLayer = document.querySelector(".snow");
  if (snowLayer && !reduceMotion) {
    var isSmall = window.matchMedia("(max-width: 620px)").matches;
    var count = isSmall ? 16 : 28;
    var frag = document.createDocumentFragment();
    for (var s = 0; s < count; s++) {
      var f = document.createElement("span");
      f.className = "flake";
      var size = (Math.random() * 3 + 1.5).toFixed(1);
      f.style.width = size + "px";
      f.style.height = size + "px";
      f.style.left = (Math.random() * 100).toFixed(2) + "%";
      f.style.animationDuration = (Math.random() * 11 + 9).toFixed(2) + "s";
      f.style.animationDelay = (-Math.random() * 18).toFixed(2) + "s";
      f.style.setProperty("--dx", (Math.random() * 80 - 40).toFixed(0) + "px");
      f.style.opacity = (Math.random() * 0.4 + 0.4).toFixed(2);
      frag.appendChild(f);
    }
    snowLayer.appendChild(frag);
  }

  /* ---------- reveal on scroll ---------- */
  var targets = document.querySelectorAll(".section .container > *, .site-footer .foot");
  var revealEls = [];
  for (var i = 0; i < targets.length; i++) {
    var el = targets[i];
    el.classList.add("reveal");
    // subtle stagger for siblings within the same container
    var sibs = el.parentElement.children;
    var idx = Array.prototype.indexOf.call(sibs, el);
    el.style.transitionDelay = Math.min(idx * 0.06, 0.36) + "s";
    revealEls.push(el);
  }

  if (!("IntersectionObserver" in window) || reduceMotion) {
    for (var r = 0; r < revealEls.length; r++) revealEls[r].classList.add("in");
  } else {
    var io = new IntersectionObserver(function (list) {
      list.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    for (var o = 0; o < revealEls.length; o++) io.observe(revealEls[o]);
  }

  /* ---------- animated counters ---------- */
  function easeOutCubic(p) {
    return 1 - Math.pow(1 - p, 3);
  }

  function animateCount(el) {
    var target = parseFloat(el.getAttribute("data-count"));
    var dec = parseInt(el.getAttribute("data-decimals") || "0", 10);
    var prefix = el.getAttribute("data-prefix") || "";
    var suffix = el.getAttribute("data-suffix") || "";
    var duration = 1500;

    function fmt(v) {
      return prefix + v.toFixed(dec) + suffix;
    }

    if (reduceMotion || isNaN(target)) {
      el.textContent = fmt(target);
      return;
    }

    var start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      el.textContent = fmt(target * easeOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  var counters = document.querySelectorAll("[data-count]");
  if (!("IntersectionObserver" in window)) {
    for (var c = 0; c < counters.length; c++) animateCount(counters[c]);
  } else {
    var cio = new IntersectionObserver(function (list) {
      list.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target);
          cio.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });
    for (var c2 = 0; c2 < counters.length; c2++) cio.observe(counters[c2]);
  }

  /* ---------- active nav link highlight ---------- */
  var links = document.querySelectorAll(".nav-links a");
  var sections = [];
  for (var li = 0; li < links.length; li++) {
    var id = links[li].getAttribute("href");
    if (id && id.charAt(0) === "#") {
      var sec = document.querySelector(id);
      if (sec) sections.push({ link: links[li], section: sec });
    }
  }

  if ("IntersectionObserver" in window && sections.length) {
    var aio = new IntersectionObserver(function (list) {
      list.forEach(function (entry) {
        if (entry.isIntersecting) {
          for (var a = 0; a < sections.length; a++) {
            sections[a].link.classList.toggle("active", sections[a].section === entry.target);
          }
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px", threshold: 0 });
    for (var ai = 0; ai < sections.length; ai++) aio.observe(sections[ai].section);
  }
})();
