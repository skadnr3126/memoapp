import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.pw.ts",
  use: { browserName: "chromium", channel: "msedge", headless: true },
  webServer: { command: "npm run dev -- --host 127.0.0.1", url: "http://localhost:1420", reuseExistingServer: true },
});
