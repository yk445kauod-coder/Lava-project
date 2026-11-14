import { defineConfig } from "vitest/config";

// The worker's ranking primitives have no Cloudflare runtime dependency, so
// they run directly under Node. Kept as its own config so the web suite stays
// jsdom-only.
export default defineConfig({
  test: { environment: "node", root: "..", include: ["workers/lava-agent/test/**/*.test.ts"] },
});
