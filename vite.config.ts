/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// Fully static build for GitHub Pages served at the custom domain benchb.us.
// Deployment uses the Actions artifact flow (no gh-pages branch).
export default defineConfig({
  base: "/",
  plugins: [solid(), tailwindcss()],
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
