type LogLevel = "info" | "warn" | "error";

const DEBUG_LOGS_KEY = "cheapbugs.debugLogs";

const envDebugLogs = String(import.meta.env.VITE_DEBUG_LOGS ?? "").toLowerCase();

const debugLogsEnabled = (): boolean => {
  if (envDebugLogs === "1" || envDebugLogs === "true") {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  try {
    const stored = window.localStorage.getItem(DEBUG_LOGS_KEY);
    return stored === "1" || stored === "true";
  } catch {
    return false;
  }
};

const argumentText = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const isThirdwebWalletConnectNoListenerNoise = (args: unknown[]): boolean => {
  const hasClientContext = args.some(
    (arg) => typeof arg === "object" && arg !== null && (arg as { context?: unknown }).context === "client"
  );
  return hasClientContext && args.some((arg) => /^emitting session_request:\d+ without any listeners/.test(argumentText(arg)));
};

const installConsoleNoiseFilter = (): void => {
  if (typeof console === "undefined") {
    return;
  }

  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    if (!debugLogsEnabled() && isThirdwebWalletConnectNoListenerNoise(args)) {
      return;
    }
    originalError(...args);
  };
};

installConsoleNoiseFilter();

const emit = (level: LogLevel, event: string, details?: unknown): void => {
  if (level === "info" && !debugLogsEnabled()) {
    return;
  }

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
