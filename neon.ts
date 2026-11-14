import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  functions: {
    // Slug is permanent and must match ^[a-z0-9]{1,20}$.
    lavallm: {
      name: "LAVA LLM gateway",
      source: "functions/lavallm/index.ts",
      // Function env is uploaded from the file passed to `neon deploy --env`.
      // Both keys must exist there; defineConfig throws on a missing value.
      env: {
        AGENTROUTER_API_KEY: process.env.AGENTROUTER_API_KEY!,
        LAVA_PROXY_TOKEN: process.env.LAVA_PROXY_TOKEN!,
      },
    },
  },
});
