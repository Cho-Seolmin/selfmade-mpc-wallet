/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@selfmade/mpc-crypto": path.resolve(
        __dirname,
        "../../packages/mpc-crypto/src/index.ts",
      ),
    },
  },
  optimizeDeps: {
    exclude: ["@silencelaboratories/dkls-wasm-ll-web"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
