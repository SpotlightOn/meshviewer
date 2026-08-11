import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.js"],
        },
      },
      {
        test: {
          name: "main",
          environment: "node",
          include: ["tests/main/**/*.test.js"],
        },
      },
      {
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["tests/renderer/**/*.test.js"],
        },
      },
    ],
  },
});
