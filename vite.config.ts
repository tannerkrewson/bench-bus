/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

// Fully static build for GitHub Pages served at the custom domain benchb.us.
// Local builds publish to gh-pages with .nojekyll while Actions is disabled.
export default defineConfig({
  base: "/",
  plugins: [solid(), tailwindcss()],
  server: {
    port: 2287,
  },
  build: {
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
