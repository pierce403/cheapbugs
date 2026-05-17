type LogLevel = "info" | "warn" | "error";

const emit = (level: LogLevel, event: string, details?: unknown): void => {
  const message = `[cheapbugs] ${event}`;
  if (details === undefined) {
    console[level](message);
    return;
  }
  console[level](message, details);
};

export const appLog = {
  info: (event: string, details?: unknown) => emit("info", event, details),
  warn: (event: string, details?: unknown) => emit("warn", event, details),
  error: (event: string, details?: unknown) => emit("error", event, details)
};
