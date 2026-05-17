import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const chromiumExecutablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined);

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  use: {
    baseURL: "http://127.0.0.1:5177",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : undefined
      }
    }
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5177",
    url: "http://127.0.0.1:5177/",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_ROUTER_MODE: "history",
      VITE_CHAIN_RPC_URL: "https://mainnet.base.org",
      VITE_ENS_RPC_URL: "https://ethereum-rpc.publicnode.com",
      VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK: "46093316",
      VITE_ETHERSCAN_API_KEY: "",
      VITE_BASESCAN_API_KEY: ""
    }
  }
});
