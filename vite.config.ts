import { defineConfig, loadEnv } from "vite";
import path from "node:path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const routerMode = env.VITE_ROUTER_MODE === "hash" ? "hash" : "history";
  const explicitBase = env.VITE_BASE_PATH || process.env.VITE_BASE_PATH;

  return {
    base: explicitBase || (routerMode === "hash" ? "./" : "/"),
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
