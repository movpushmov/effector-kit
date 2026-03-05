import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: ["./lib/index.ts"],
  dts: true,
  format: ["esm", "cjs"],
  external: ["effector", "effector-action"],
});

export default config;
