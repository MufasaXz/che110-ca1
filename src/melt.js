/* ==========================================================================
   melt.js — GSAP ScrollTrigger binding for the melt + camera timelines
   --------------------------------------------------------------------------
   ScrollTrigger caches layout, so nothing here reads the DOM per frame. It
   only records a target progress; the render loop damps toward it, which keeps
   the melt buttery even while scrolling fast.
   ========================================================================== */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export function createMeltController(opts = {}) {
  gsap.registerPlugin(ScrollTrigger);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    meltTarget: reduceMotion ? (opts.fixedMelt ?? 0.45) : 0,
    melt: reduceMotion ? (opts.fixedMelt ?? 0.45) : 0,
    camTarget: reduceMotion ? 0.5 : 0,
    cam: reduceMotion ? 0.5 : 0,
  };

  const triggers = [];

  if (!reduceMotion) {
    /* the melt follows the pinned #glacier showcase section */
    triggers.push(
      ScrollTrigger.create({
        trigger: "#glacier",
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => {
          state.meltTarget = self.progress;
        },
      })
    );

    /* the camera flies over the whole page */
    triggers.push(
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          state.camTarget = self.progress;
        },
      })
    );
  }

  const damp = (cur, target, dt, halfLife) => cur + (target - cur) * (1 - Math.pow(halfLife, dt));

  return {
    state,
    triggers,
    /** Advance the damped values; returns true once they have settled. */
    update(dt) {
      if (reduceMotion) return false;
      const prevMelt = state.melt;
      const prevCam = state.cam;
      state.melt = damp(state.melt, state.meltTarget, dt, 0.0006);
      state.cam = damp(state.cam, state.camTarget, dt, 0.002);
      return (
        Math.abs(state.melt - prevMelt) > 0.00005 || Math.abs(state.cam - prevCam) > 0.00005
      );
    },
    refresh() {
      ScrollTrigger.refresh();
    },
  };
}

/** Update the on-screen scenario-year / volume HUD. */
export function applyHud(melt) {
  const yearEl = document.getElementById("hud-year");
  const volEl = document.getElementById("hud-volume");
  if (yearEl) {
    const year = Math.round(1990 + melt * 110);
    if (yearEl.textContent !== String(year)) yearEl.textContent = String(year);
  }
  if (volEl) {
    const txt = "\u2212" + Math.round(melt * 68) + "%";
    if (volEl.textContent !== txt) volEl.textContent = txt;
  }
}
