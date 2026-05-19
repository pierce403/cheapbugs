import { STORAGE_KEYS } from "./constants";

type CachedRecord<T> = {
  value: T;
  expiresAt: number;
};

export class QueryCache {
  private readonly memory = new Map<string, CachedRecord<unknown>>();

  constructor(private readonly namespace: string = STORAGE_KEYS.cachePrefix) {}

  private storageKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  get<T>(key: string): T | null {
    const memoryHit = this.memory.get(key);
    if (memoryHit && memoryHit.expiresAt > Date.now()) {
      return memoryHit.value as T;
    }

    const raw = window.localStorage.getItem(this.storageKey(key));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CachedRecord<T>;
      if (parsed.expiresAt <= Date.now()) {
        window.localStorage.removeItem(this.storageKey(key));
        return null;
      }

      this.memory.set(key, parsed as CachedRecord<unknown>);
      return parsed.value;
    } catch {
      window.localStorage.removeItem(this.storageKey(key));
      return null;
    }
  }

  getStale<T>(key: string): T | null {
    const memoryHit = this.memory.get(key);
    if (memoryHit) {
      return memoryHit.value as T;
    }

    const raw = window.localStorage.getItem(this.storageKey(key));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as CachedRecord<T>;
      this.memory.set(key, parsed as CachedRecord<unknown>);
      return parsed.value;
    } catch {
      window.localStorage.removeItem(this.storageKey(key));
      return null;
    }
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    const record: CachedRecord<T> = {
      value,
      expiresAt: Date.now() + ttlMs
    };

    this.memory.set(key, record as CachedRecord<unknown>);
    try {
      window.localStorage.setItem(this.storageKey(key), JSON.stringify(record));
    } catch {
      // Keep the in-memory copy even when localStorage quota or browser policy blocks persistence.
    }
    return value;
  }

  async getOrLoad<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await loader();
    return this.set(key, value, ttlMs);
  }

  clear(key: string): void {
    this.memory.delete(key);
    window.localStorage.removeItem(this.storageKey(key));
  }
}
