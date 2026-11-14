import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Point the dev proxy at a local `wrangler dev` with VITE_WORKER_URL=http://localhost:8799
const WORKER = process.env.VITE_WORKER_URL || "https://lava-agent.yk445kauod.workers.dev";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  server: {
    proxy: {
      "/api": {
        target: WORKER,
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"] },
});
