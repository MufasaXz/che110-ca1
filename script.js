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

  /* ---------- scroll: header state + progress bar ----------
     One passive listener -> one rAF per frame. Scrollable height is measured
     only on load/resize (reading scrollHeight per event forces layout). */
  var header = document.querySelector(".site-header");
  var progress = document.querySelector(".scroll-progress");

  var maxScroll = 0;
  function measure() {
    maxScroll = docEl.scrollHeight - window.innerHeight;
  }
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  var ticking = false;
  function frame() {
    ticking = false;
    var y = window.scrollY || docEl.scrollTop;
    if (header) header.classList.toggle("scrolled", y > 8);
    if (progress) {
      var p = maxScroll > 0 ? y / maxScroll : 0;
      progress.style.transform = "scaleX(" + Math.min(Math.max(p, 0), 1).toFixed(4) + ")";
    }
  }
  window.addEventListener(
    "scroll",
    function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(frame);
      }
    },
    { passive: true }
  );
  frame();

  /* ---------- reveal on scroll ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));

  revealEls.forEach(function (el) {
    /* subtle stagger between siblings that reveal together */
    var sibs = el.parentElement ? el.parentElement.children : null;
    if (sibs) {
      var idx = Array.prototype.indexOf.call(sibs, el);
      el.style.setProperty("--d", Math.min(idx * 0.07, 0.42).toFixed(2) + "s");
    }
  });

  if (!("IntersectionObserver" in window) || reduceMotion) {
    revealEls.forEach(function (el) {
      el.classList.add("in");
    });
  } else {
    var io = new IntersectionObserver(
      function (list) {
        list.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" }
    );
    revealEls.forEach(function (el) {
      io.observe(el);
    });
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
  if (!("IntersectionObserver" in window) || reduceMotion) {
    Array.prototype.forEach.call(counters, animateCount);
  } else {
    var cio = new IntersectionObserver(
      function (list) {
        list.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            cio.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    Array.prototype.forEach.call(counters, function (el) {
      cio.observe(el);
    });
  }

  /* ---------- active nav link highlight ---------- */
  var links = document.querySelectorAll(".nav-links a");
  var sections = [];
  Array.prototype.forEach.call(links, function (link) {
    var id = link.getAttribute("href");
    if (id && id.charAt(0) === "#") {
      var sec = document.querySelector(id);
      if (sec) sections.push({ link: link, section: sec });
    }
  });

  if ("IntersectionObserver" in window && sections.length) {
    var aio = new IntersectionObserver(
      function (list) {
        list.forEach(function (entry) {
          if (entry.isIntersecting) {
            sections.forEach(function (s) {
              s.link.classList.toggle("active", s.section === entry.target);
            });
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    sections.forEach(function (s) {
      aio.observe(s.section);
    });
  }
})();
