import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90000,
  expect: { timeout: 20000 },
  reporter: [["list"]],
});
