/* ==========================================================================
   Hima-Drishti — application entry
   Boots the page UI and the 3D glacier experience.
   ========================================================================== */

import "./styles.css";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { initUI } from "./ui.js";
import { initScene } from "./scene.js";

gsap.registerPlugin(ScrollTrigger);

/** Shared GSAP instances so scene modules don't import their own copies. */
export { gsap, ScrollTrigger };

function boot() {
  initUI();
  initScene();
}

/* Build the scene when the browser is idle so first paint stays fast. */
if ("requestIdleCallback" in window) {
  window.requestIdleCallback(boot, { timeout: 1500 });
} else {
  window.addEventListener("load", () => setTimeout(boot, 80));
}
