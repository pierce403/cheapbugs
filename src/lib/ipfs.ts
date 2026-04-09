import type { StorageProvider, StoredJson } from "../types/storage";

import { QueryCache } from "./cache";
import { STORAGE_KEYS } from "./constants";

const cache = new QueryCache("cheapbugs.ipfs");
const JSON_CACHE_TTL = 60_000;

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
  return cache.getOrLoad(key, JSON_CACHE_TTL, () => provider.downloadJson<T>(normalized));
};
