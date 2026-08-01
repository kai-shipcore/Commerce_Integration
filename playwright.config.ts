import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Code Guide: Playwright config for browser end-to-end tests (e2e/**).
// Separate from Vitest (tests/**/*.test.ts, unit-level, mocked repositories) —
// these actually launch a browser against a running dev server and a real
// login. Requires E2E_TEST_EMAIL / E2E_TEST_PASSWORD (see e2e/support/login.ts),
// read from .env.e2e.local (gitignored via the .env* pattern) so credentials
// never need to be typed into a prompt or committed anywhere.
// `quiet: true` suppresses dotenv's stdout "tip" ads (one of which is a
// prompt-injection-style message aimed at AI agents reading logs) — see
// https://github.com/motdotla/dotenv/blob/master/lib/main.js's TIPS array.
loadEnv({ path: ".env.e2e.local", quiet: true });

// baseURL needs a trailing slash — the app is served under the /forecast
// basePath, and page.goto() with a leading "/" resolves from the domain
// root (dropping /forecast) per standard URL resolution. Always goto()
// relative paths without a leading slash (e.g. "auth/signin").
const DEFAULT_BASE_URL = "http://localhost:3000/forecast/";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "html",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? DEFAULT_BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
