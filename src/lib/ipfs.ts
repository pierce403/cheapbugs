import type { StorageProvider, StoredJson } from "../types/storage";

import { QueryCache } from "./cache";
import { STORAGE_KEYS } from "./constants";

const cache = new QueryCache("cheapbugs.ipfs");
const JSON_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const inflightJson = new Map<string, Promise<unknown>>();

export const normalizeIpfsUri = (value: string): string => {
  if (value.startsWith("ipfs://")) {
    return value;
  }

  if (value.startsWith("https://")) {
    return value;
  }

  return `ipfs://${value.replace(/^ipfs\//, "")}`;
};

export const extractCid = (value: string): string => normalizeIpfsUri(value).replace("ipfs://", "").split("/")[0] ?? "";

export const toGatewayUrl = (value: string): string => {
  if (value.startsWith("https://")) {
    return value;
  }

  return `https://ipfs.io/ipfs/${extractCid(value)}`;
};

export const uploadJson = async <T>(
  provider: StorageProvider,
  payload: T,
  name: string
): Promise<StoredJson> => {
  const result = await provider.uploadJson(payload, { name });
  window.localStorage.setItem(STORAGE_KEYS.lastUsedStorage, provider.id);
  return result;
};

export const downloadJson = async <T>(provider: StorageProvider, uri: string): Promise<T> => {
  const normalized = normalizeIpfsUri(uri);
  const key = `${provider.id}:${normalized}`;
  const stale = cache.getStale<T>(key);
  const cached = cache.get<T>(key);
  if (cached !== null) {
    return cached;
  }

  const existing = inflightJson.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const load = provider
    .downloadJson<T>(normalized)
    .then((value) => cache.set(key, value, JSON_CACHE_TTL))
    .catch((error) => {
      if (stale !== null) {
        return cache.set(key, stale, JSON_CACHE_TTL);
      }
      throw error;
    })
    .finally(() => {
      inflightJson.delete(key);
    });

  inflightJson.set(key, load);
  return load;
};
