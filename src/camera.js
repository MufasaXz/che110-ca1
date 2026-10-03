/* ==========================================================================
   camera.js — the fly-through camera rig
   --------------------------------------------------------------------------
   The camera tracks a point on the real glacier centreline and flies from the
   terminus (down-valley) up toward the accumulation zone as you scroll, so the
   glacier is always framed. Drag-to-look orbits around the look target.
   ========================================================================== */

import * as THREE from "three";

export function createCameraRig(sampler, meta, opts = {}) {
  /* look-target curve: tail (down-valley) -> head (up-valley) */
  const pts = meta.centerline
    .slice()
    .reverse()
    .map((p) => new THREE.Vector3(p.x, p.y + (opts.lookLift ?? 26), p.z));
  const lookCurve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);

  const state = {
    yaw: 0,
    pitch: 0,
    targetYaw: 0,
    targetPitch: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
  };

  const look = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const offset = new THREE.Vector3();

  /** Map page progress (0..1) to camera journey with a held opening vista. */
  function journey(p) {
    const hold = opts.hold ?? 0.28;
    if (p <= hold) return 0;
    return (p - hold) / (1 - hold);
  }

  function place(camera, p) {
    const s = Math.min(1, Math.max(0, journey(p)));
    lookCurve.getPoint(s, look);

    const h0 = opts.startHeight ?? 250;
    const h1 = opts.endHeight ?? 330;
    const d0 = opts.startDist ?? 560;
    const d1 = opts.endDist ?? 300;
    const l0 = opts.startLateral ?? 150;
    const l1 = opts.endLateral ?? 10;
    const height = h0 + (h1 - h0) * s;
    const dist = d0 + (d1 - d0) * s;
    const lateral = l0 + (l1 - l0) * s;

    eye.set(look.x + lateral, look.y + height, look.z - dist);

    /* drag-to-look: orbit the eye around the look target */
    offset.copy(eye).sub(look);
    const cy = Math.cos(state.yaw);
    const sy = Math.sin(state.yaw);
    const ox = offset.x * cy - offset.z * sy;
    const oz = offset.x * sy + offset.z * cy;
    offset.x = ox;
    offset.z = oz;
    offset.y += state.pitch * 180;
    eye.copy(look).add(offset);

    /* never sink the eye into a peak */
    const ground = sampler.heightAt(eye.x, eye.z) + 26;
    if (eye.y < ground) eye.y = ground;

    camera.position.copy(eye);
    camera.lookAt(look);
  }

  function updateDrag(dt) {
    const k = Math.min(1, dt * 3);
    state.yaw += (state.targetYaw - state.yaw) * k;
    state.pitch += (state.targetPitch - state.pitch) * k;
  }

  return { place, state, updateDrag, lookCurve };
}

/** Attach mouse-only drag-to-look (never hijacks touch scrolling). */
export function attachDrag(rig, target, docEl) {
  target.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    rig.state.dragging = true;
    rig.state.lastX = e.clientX;
    rig.state.lastY = e.clientY;
    docEl.classList.add("scene-dragging");
  });
  target.addEventListener("pointermove", (e) => {
    if (!rig.state.dragging) return;
    const dx = e.clientX - rig.state.lastX;
    const dy = e.clientY - rig.state.lastY;
    rig.state.lastX = e.clientX;
    rig.state.lastY = e.clientY;
    rig.state.targetYaw = Math.max(-0.9, Math.min(0.9, rig.state.targetYaw + dx * 0.004));
    rig.state.targetPitch = Math.max(-0.45, Math.min(0.45, rig.state.targetPitch + dy * 0.002));
  });
  const end = () => {
    rig.state.dragging = false;
    docEl.classList.remove("scene-dragging");
  };
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}
