type CachedRecord<T> = {
  value: T;
  expiresAt: number;
};

type FailureRecord = {
  error: unknown;
  retryAt: number;
};

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const ERROR_COOLDOWN_MS = 10_000;

let globalRateLimitFailure: FailureRecord | null = null;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const isRateLimitError = (error: unknown): boolean =>
  /\b429\b|too many requests|rate.?limit/i.test(errorMessage(error));

const rateLimitCooldownError = (retryAt: number): Error => {
  const retrySeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1_000));
  return new Error(`Base RPC is temporarily rate-limiting reads. Try again in ${retrySeconds}s.`);
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
        const retryAt = Date.now() + (rateLimited ? RATE_LIMIT_COOLDOWN_MS : ERROR_COOLDOWN_MS);
        if (rateLimited) {
          globalRateLimitFailure = { error, retryAt };
        }
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
