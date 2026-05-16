import fs from "fs";
import path from "path";
import url from "url";
import { createRequire } from "module";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const sourceFile = path.join(projectRoot, "scripts/templates/sqlite3-worker1-bundler-friendly.mjs");
const require = createRequire(import.meta.url);

const resolveModulePath = (specifier) => {
  try {
    return require.resolve(specifier, { paths: [projectRoot] });
  } catch {
    return null;
  }
};

const resolvePackageDir = (specifier) => {
  const resolved = resolveModulePath(specifier);
  return resolved ? path.resolve(path.dirname(resolved), "..") : null;
};

let bindingsRoot = resolvePackageDir("@xmtp/wasm-bindings");
if (!bindingsRoot) {
  const browserSdkRoot = resolvePackageDir("@xmtp/browser-sdk");
  if (browserSdkRoot) {
    const sibling = path.resolve(browserSdkRoot, "..", "wasm-bindings");
    const nested = path.join(browserSdkRoot, "node_modules", "@xmtp", "wasm-bindings");
    if (fs.existsSync(sibling)) {
      bindingsRoot = sibling;
    } else if (fs.existsSync(nested)) {
      bindingsRoot = nested;
    }
  }
}

if (!bindingsRoot) {
  console.warn("[fix-xmtp-wasm-worker] @xmtp/wasm-bindings not installed; skipping worker shim.");
  process.exit(0);
}

const targetDir = path.join(
  bindingsRoot,
  "dist",
  "snippets",
  "diesel-wasm-sqlite-36e85657e47f3be3",
  "src",
  "js"
);
const targetFile = path.join(targetDir, "sqlite3-worker1-bundler-friendly.mjs");

fs.mkdirSync(targetDir, { recursive: true });
const sourceContent = fs.readFileSync(sourceFile, "utf8");
const current = fs.existsSync(targetFile) ? fs.readFileSync(targetFile, "utf8") : "";
if (current !== sourceContent) {
  fs.writeFileSync(targetFile, sourceContent, "utf8");
  console.log("[fix-xmtp-wasm-worker] Wrote worker shim to", targetFile);
}
