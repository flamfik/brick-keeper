import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:8080",
    serviceWorkers: "block"
  },
  webServer: {
    command: "node tools/server.mjs",
    url: "http://127.0.0.1:8080",
    reuseExistingServer: !process.env.CI
  }
});
