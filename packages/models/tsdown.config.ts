import { defineConfig, type UserConfig } from "tsdown";
import swc from "unplugin-swc";

const config: UserConfig = defineConfig({
  entry: ["./lib/index.ts"],
  dts: true,
  format: ["esm", "cjs"],
  external: ["effector", "effector-action"],
  plugins: [swc.rolldown()],
});

export default config;
