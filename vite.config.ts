import { defineConfig, loadEnv } from "vite";
import path from "node:path";
import { execFileSync } from "node:child_process";

const shortBuildId = (value: string | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 12) : null;
};

const gitCommit = (): string | null => {
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const routerMode = env.VITE_ROUTER_MODE === "hash" ? "hash" : "history";
  const explicitBase = env.VITE_BASE_PATH || process.env.VITE_BASE_PATH;
  const buildId =
    shortBuildId(env.VITE_BUILD_ID || process.env.VITE_BUILD_ID) ||
    shortBuildId(process.env.GITHUB_SHA) ||
    gitCommit() ||
    "dev";
  const buildTime = env.VITE_BUILD_TIME || process.env.VITE_BUILD_TIME || new Date().toISOString();

  return {
    base: explicitBase || (routerMode === "hash" ? "./" : "/"),
    define: {
      __CHEAPBUGS_BUILD_ID__: JSON.stringify(buildId),
      __CHEAPBUGS_BUILD_TIME__: JSON.stringify(buildTime)
    },
    build: {
      target: "es2022",
      sourcemap: true
    },
    resolve: {
      alias: {
        "@xmtp/wasm-bindings/dist/snippets/diesel-wasm-sqlite-36e85657e47f3be3/src/js/sqlite3-worker1-bundler-friendly.mjs":
          path.resolve(__dirname, "./scripts/templates/sqlite3-worker1-bundler-friendly.mjs")
      }
    }
  };
});
