import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    include: ["./__tests__/*.test.ts", "./__tests__/*.test.tsx"],
  },
});

export default config;
