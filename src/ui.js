/* ==========================================================================
   Hima-Drishti — page UI layer (navigation, reveals, counters, nav highlight)
   Pure DOM work; the 3D lives in ./scene.js.
   ========================================================================== */

export function initUI() {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const docEl = document.documentElement;

  /* ---------- mobile navigation ---------- */
  const btn = document.querySelector(".nav-toggle");
  const nav = document.getElementById("nav-menu");
  if (btn && nav) {
    const setNav = (open) => {
      nav.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    btn.addEventListener("click", () => setNav(!nav.classList.contains("open")));
    nav.addEventListener("click", (e) => {
      if (e.target.tagName === "A") setNav(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setNav(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860) setNav(false);
    });
  }

  /* ---------- scroll: header state + progress bar ----------
     One passive listener -> one rAF per frame. Scrollable height is measured
     only on load/resize (reading scrollHeight per event forces layout). */
  const header = document.querySelector(".site-header");
  const progress = document.querySelector(".scroll-progress");

  let maxScroll = 0;
  const measure = () => {
    maxScroll = docEl.scrollHeight - window.innerHeight;
  };
  measure();
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

  let ticking = false;
  const frame = () => {
    ticking = false;
    const y = window.scrollY || docEl.scrollTop;
    if (header) header.classList.toggle("scrolled", y > 8);
    if (progress) {
      const p = maxScroll > 0 ? y / maxScroll : 0;
      progress.style.transform = "scaleX(" + Math.min(Math.max(p, 0), 1).toFixed(4) + ")";
    }
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(frame);
      }
    },
    { passive: true }
  );
  frame();

  /* ---------- reveal on scroll ---------- */
  const revealEls = Array.from(document.querySelectorAll("[data-reveal]"));

  revealEls.forEach((el) => {
    /* subtle stagger between siblings that reveal together */
    const sibs = el.parentElement ? el.parentElement.children : null;
    if (sibs) {
      const idx = Array.prototype.indexOf.call(sibs, el);
      el.style.setProperty("--d", Math.min(idx * 0.07, 0.42).toFixed(2) + "s");
    }
  });

  if (!("IntersectionObserver" in window) || reduceMotion) {
    revealEls.forEach((el) => el.classList.add("in"));
  } else {
    const io = new IntersectionObserver(
      (list) => {
        list.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" }
    );
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- animated counters ---------- */
  const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

  const animateCount = (el) => {
    const target = parseFloat(el.getAttribute("data-count"));
    const dec = parseInt(el.getAttribute("data-decimals") || "0", 10);
    const prefix = el.getAttribute("data-prefix") || "";
    const suffix = el.getAttribute("data-suffix") || "";
    const duration = 1500;
    const fmt = (v) => prefix + v.toFixed(dec) + suffix;

    if (reduceMotion || isNaN(target)) {
      el.textContent = fmt(target);
      return;
    }

    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      el.textContent = fmt(target * easeOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const counters = document.querySelectorAll("[data-count]");
  if (!("IntersectionObserver" in window) || reduceMotion) {
    counters.forEach(animateCount);
  } else {
    const cio = new IntersectionObserver(
      (list) => {
        list.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            cio.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- active nav link highlight ---------- */
  const links = document.querySelectorAll(".nav-links a");
  const sections = [];
  links.forEach((link) => {
    const id = link.getAttribute("href");
    if (id && id.charAt(0) === "#") {
      const sec = document.querySelector(id);
      if (sec) sections.push({ link, section: sec });
    }
  });

  if ("IntersectionObserver" in window && sections.length) {
    const aio = new IntersectionObserver(
      (list) => {
        list.forEach((entry) => {
          if (entry.isIntersecting) {
            sections.forEach((s) => s.link.classList.toggle("active", s.section === entry.target));
          }
        });
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: 0 }
    );
    sections.forEach((s) => aio.observe(s.section));
  }
}
