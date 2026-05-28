import "./styles.css";
import { CheapBugsApp } from "./app";
import { initMatrixRain } from "./lib/matrixRain";

// Start background matrix rain animation
initMatrixRain();

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found.");
}

const cheapBugsApp = new CheapBugsApp(app);

void cheapBugsApp.start();
