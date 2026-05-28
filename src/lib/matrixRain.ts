import { appLog } from "./logger";

export function initMatrixRain(): void {
  const canvas = document.getElementById("bg-matrix-canvas") as HTMLCanvasElement | null;
  if (!canvas) {
    appLog.warn("matrix: canvas element not found");
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    appLog.warn("matrix: failed to get 2d context");
    return;
  }

  // Handle resizing
  const resize = () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  window.addEventListener("resize", resize);
  resize();

  // Matrix characters - mixing binary and crypto hex characters for the theme
  const chars = "0101010101010101BUGZCHEAPBUGS01ABCDEF".split("");
  const fontSize = 13;
  
  // Calculate columns based on width
  let cols = Math.floor(canvas.width / fontSize) + 1;
  let yCoords = Array(cols).fill(0).map(() => Math.random() * -canvas.height);

  // Re-initialize columns on resize
  window.addEventListener("resize", () => {
    const newCols = Math.floor(canvas.width / fontSize) + 1;
    if (newCols !== cols) {
      const oldYCoords = [...yCoords];
      yCoords = Array(newCols).fill(0).map((_, i) => {
        return oldYCoords[i] !== undefined ? oldYCoords[i] : Math.random() * -canvas.height;
      });
      cols = newCols;
    }
  });

  // Animation draw step
  const draw = () => {
    // Fill background with extremely translucent black to fade trails
    // Using a very small alpha (0.08) so the trailing is smooth and the background gradient glows through
    ctx.fillStyle = "rgba(5, 5, 5, 0.08)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = "11px monospace";

    for (let i = 0; i < cols; i++) {
      // Pick a character
      const char = chars[Math.floor(Math.random() * chars.length)];
      const x = i * fontSize;
      const y = yCoords[i];

      // Draw character
      // Subtle, slow but dark orange:
      // The tip of the drop is a bit brighter (glow effect), the rest is a dark orange/rust color.
      const isTip = Math.random() > 0.96;
      if (isTip) {
        ctx.fillStyle = "rgba(255, 130, 40, 0.55)"; // glowing orange lead
      } else {
        ctx.fillStyle = "rgba(180, 60, 0, 0.22)"; // subtle dark orange body
      }

      ctx.fillText(char, x, y);

      // Randomly reset coordinate back to the top once offscreen, with a random delay
      if (y > canvas.height && Math.random() > 0.98) {
        yCoords[i] = -20;
      } else {
        // Move slowly! fontSize * 0.45 per frame is perfect for slow rain
        yCoords[i] = y + fontSize * 0.45;
      }
    }
  };

  // Slow frame rate throttling (18 frames per second for smooth, slow, atmospheric rain)
  let lastTime = 0;
  const fps = 18;
  const interval = 1000 / fps;

  function animate(timestamp: number) {
    requestAnimationFrame(animate);
    const delta = timestamp - lastTime;
    if (delta > interval) {
      lastTime = timestamp - (delta % interval);
      draw();
    }
  }

  // Start animation loop
  requestAnimationFrame(animate);
  appLog.info("matrix: matrix rain background initialized successfully");
}
