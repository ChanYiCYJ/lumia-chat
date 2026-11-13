import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:3000/",
      },
    },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // vitest 4.1.10 + jsdom 30.0.1: localStorage is not auto-exposed as global
    // Workaround: polyfill via setup file
    setupFiles: ["src/test-setup.ts"],
  },
});
