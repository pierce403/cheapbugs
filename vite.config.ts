import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const routerMode = env.VITE_ROUTER_MODE === "hash" ? "hash" : "history";
  const explicitBase = env.VITE_BASE_PATH || process.env.VITE_BASE_PATH;

  return {
    base: explicitBase || (routerMode === "hash" ? "./" : "/"),
    build: {
      target: "es2022",
      sourcemap: true
    }
  };
});
