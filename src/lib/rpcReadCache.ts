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

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const isRateLimitError = (error: unknown): boolean =>
  /\b429\b|too many requests|rate.?limit/i.test(errorMessage(error));

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
        this.failures.set(key, {
          error,
          retryAt: Date.now() + (isRateLimitError(error) ? RATE_LIMIT_COOLDOWN_MS : ERROR_COOLDOWN_MS)
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
