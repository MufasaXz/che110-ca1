import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  build: {
    outDir: "dist",
    target: "es2020",
    assetsInlineLimit: 4096,
    // three is a large single vendor chunk; keep the warning quiet.
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three"],
          gsap: ["gsap"],
        },
      },
    },
  },
  server: { host: true },
});
