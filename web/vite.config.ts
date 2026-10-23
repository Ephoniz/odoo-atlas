import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves project sites from /<repo>/; CI sets ATLAS_BASE accordingly.
  base: process.env.ATLAS_BASE ?? "/",
  server: { port: 5188 },
  // The lazily loaded ELK chunk is ~1.4 MB on its own; the entry bundle stays ~0.5 MB.
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  worker: { format: "es" },
});
