type CachedRecord<T> = {
  value: T;
  expiresAt: number;
};

type FailureRecord = {
  error: unknown;
  retryAt: number;
};

const INITIAL_RATE_LIMIT_COOLDOWN_MS = 5_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 60_000;
const ERROR_COOLDOWN_MS = 10_000;
const BASE_RPC_QUEUE_MIN_DELAY_MS = 300;

let globalRateLimitFailure: FailureRecord | null = null;
let globalRateLimitCooldownMs = 0;
let baseRpcQueue: Promise<unknown> = Promise.resolve();
let baseRpcNextReadAt = 0;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const rateLimitPattern = /\b429\b|too many requests|rate.?limit/i;

const collectErrorText = (error: unknown, seen = new Set<unknown>(), depth = 0): string => {
  if (error === null || error === undefined || depth > 4) {
    return "";
  }
  if (typeof error === "string" || typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }
  if (error instanceof Error) {
    return [
      error.name,
      error.message,
      collectErrorText((error as Error & { code?: unknown }).code, seen, depth + 1),
      collectErrorText((error as Error & { cause?: unknown }).cause, seen, depth + 1),
      ...Object.entries(error).map(([, value]) => collectErrorText(value, seen, depth + 1))
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (typeof error !== "object") {
    return String(error);
  }
  if (seen.has(error)) {
    return "";
  }
  seen.add(error);
  return Object.entries(error)
    .map(([key, value]) => `${key} ${collectErrorText(value, seen, depth + 1)}`)
    .filter(Boolean)
    .join(" ");
};

export const isRateLimitError = (error: unknown): boolean => rateLimitPattern.test(collectErrorText(error));

const rateLimitCooldownError = (retryAt: number): Error => {
  const retrySeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000));
  return new Error(`Base RPC is temporarily rate-limiting reads. Try again in ${retrySeconds}s.`);
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

const recordGlobalRateLimit = (error: unknown): number => {
  globalRateLimitCooldownMs = globalRateLimitCooldownMs
    ? Math.min(globalRateLimitCooldownMs * 2, MAX_RATE_LIMIT_COOLDOWN_MS)
    : INITIAL_RATE_LIMIT_COOLDOWN_MS;
  const retryAt = Date.now() + globalRateLimitCooldownMs;
  globalRateLimitFailure = { error, retryAt };
  return retryAt;
};

const clearGlobalRateLimit = (): void => {
  globalRateLimitFailure = null;
  globalRateLimitCooldownMs = 0;
};

const activeGlobalRateLimitFailure = (): Error | null => {
  if (!globalRateLimitFailure) {
    return null;
  }

  if (globalRateLimitFailure.retryAt <= Date.now()) {
    globalRateLimitFailure = null;
    return null;
  }

  return rateLimitCooldownError(globalRateLimitFailure.retryAt);
};

export const scheduleBaseRpcRead = async <T>(label: string, loader: () => Promise<T>): Promise<T> => {
  const read = baseRpcQueue.then(async () => {
    const globalRateLimit = activeGlobalRateLimitFailure();
    if (globalRateLimit) {
      throw globalRateLimit;
    }

    const waitMs = Math.max(0, baseRpcNextReadAt - Date.now());
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    try {
      const value = await loader();
      clearGlobalRateLimit();
      return value;
    } catch (error) {
      if (isRateLimitError(error)) {
        recordGlobalRateLimit(error);
      }
      throw error;
    } finally {
      baseRpcNextReadAt = Date.now() + BASE_RPC_QUEUE_MIN_DELAY_MS;
    }
  });

  baseRpcQueue = read.catch(() => undefined);
  try {
    return (await read) as T;
  } catch (error) {
    if (isRateLimitError(error)) {
      throw rateLimitCooldownError(globalRateLimitFailure?.retryAt ?? Date.now() + INITIAL_RATE_LIMIT_COOLDOWN_MS);
    }
    throw new Error(`${label} failed: ${errorMessage(error)}`);
  }
};

export class RpcReadCache {
  private readonly values = new Map<string, CachedRecord<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly failures = new Map<string, FailureRecord>();

  get<T>(key: string): T | null {
    const hit = this.values.get(key);
    if (!hit || hit.expiresAt <= Date.now()) {
      return null;
    }

    return hit.value as T;
  }

  getStale<T>(key: string): T | null {
    return (this.values.get(key)?.value as T | undefined) ?? null;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.values.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    this.failures.delete(key);
    return value;
  }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const globalRateLimit = activeGlobalRateLimitFailure();
    if (globalRateLimit) {
      throw globalRateLimit;
    }

    const failure = this.failures.get(key);
    if (failure && failure.retryAt > Date.now()) {
      throw failure.error;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = loader()
      .then((value) => this.set(key, value, ttlMs))
      .catch((error) => {
        const rateLimited = isRateLimitError(error);
        const retryAt = rateLimited ? recordGlobalRateLimit(error) : Date.now() + ERROR_COOLDOWN_MS;
        this.failures.set(key, {
          error,
          retryAt
        });
        throw error;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  delete(key: string): void {
    this.values.delete(key);
    this.failures.delete(key);
  }

  clear(): void {
    this.values.clear();
    this.failures.clear();
  }
}
