import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: "tests/browser",
  use: {
    baseURL: "http://127.0.0.1:4183",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
  ],
  webServer: {
    command:
      "npm run fixtures && PORT=4183 SERVE_DIST=1 npm run fixture-server",
    url: "http://127.0.0.1:4183/api/session",
    reuseExistingServer: false,
  },
})
