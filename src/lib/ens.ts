import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import { env } from "../config/env";
import type { SessionState } from "../types/app";

export const ENS_APP_URL = "https://app.ens.domains/";
export const ENS_REGISTER_URL = ENS_APP_URL;

export const ensProfileUrl = (name: string): string => `${ENS_APP_URL}${encodeURIComponent(name)}`;

type EnsProfile = Pick<SessionState, "ensName" | "ensAvatarUrl" | "ensLookupStatus">;
type CachedEnsProfile = EnsProfile & {
  updatedAt: string;
};
type StoredEnsProfileCache = {
  version: "1";
  entries: Record<string, CachedEnsProfile>;
};

const ENS_PROFILE_CACHE_KEY = "cheapbugs.ensProfileCache.v1";
const ENS_PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(env.ensRpcUrl)
});

const ensCache = new Map<string, CachedEnsProfile>();

const cacheKey = (address: `0x${string}`): string => address.toLowerCase();

const hasStorage = (): boolean => typeof window !== "undefined" && Boolean(window.localStorage);

const isFresh = (updatedAt: string): boolean => {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs < ENS_PROFILE_CACHE_TTL_MS;
};

const profileFromCached = (profile: CachedEnsProfile): EnsProfile => ({
  ensName: profile.ensName,
  ensAvatarUrl: profile.ensAvatarUrl,
  ensLookupStatus: profile.ensLookupStatus
});

const parseCachedProfile = (value: unknown): CachedEnsProfile | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const profile = value as Partial<CachedEnsProfile>;
  const ensLookupStatus = profile.ensLookupStatus;
  const updatedAt = profile.updatedAt;
  const validStatus = ensLookupStatus === "resolved" || ensLookupStatus === "missing";
  const validName = profile.ensName === null || typeof profile.ensName === "string";
  const validAvatar = profile.ensAvatarUrl === null || typeof profile.ensAvatarUrl === "string";
  const validUpdatedAt = typeof updatedAt === "string" && isFresh(updatedAt);
  if (!validStatus || !validName || !validAvatar || !validUpdatedAt) {
    return null;
  }

  return {
    ensName: profile.ensName ?? null,
    ensAvatarUrl: profile.ensAvatarUrl ?? null,
    ensLookupStatus,
    updatedAt
  };
};

const readStoredCache = (): StoredEnsProfileCache => {
  if (!hasStorage()) {
    return { version: "1", entries: {} };
  }

  try {
    const raw = window.localStorage.getItem(ENS_PROFILE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredEnsProfileCache>) : null;
    if (parsed?.version !== "1" || !parsed.entries || typeof parsed.entries !== "object") {
      return { version: "1", entries: {} };
    }

    return {
      version: "1",
      entries: Object.fromEntries(
        Object.entries(parsed.entries)
          .map(([address, profile]) => [address, parseCachedProfile(profile)] as const)
          .filter((entry): entry is [string, CachedEnsProfile] => entry[1] !== null)
      )
    };
  } catch {
    return { version: "1", entries: {} };
  }
};

const writeStoredCacheEntry = (address: `0x${string}`, profile: CachedEnsProfile): void => {
  if (!hasStorage()) {
    return;
  }

  const stored = readStoredCache();
  stored.entries[cacheKey(address)] = profile;
  window.localStorage.setItem(ENS_PROFILE_CACHE_KEY, JSON.stringify(stored));
};

const readCachedProfile = (address: `0x${string}`): EnsProfile | null => {
  const key = cacheKey(address);
  const memoryCached = ensCache.get(key);
  if (memoryCached && isFresh(memoryCached.updatedAt)) {
    return profileFromCached(memoryCached);
  }

  const storedCached = readStoredCache().entries[key] ?? null;
  if (!storedCached) {
    ensCache.delete(key);
    return null;
  }

  ensCache.set(key, storedCached);
  return profileFromCached(storedCached);
};

const cacheProfile = (address: `0x${string}`, profile: EnsProfile): void => {
  if (profile.ensLookupStatus !== "resolved" && profile.ensLookupStatus !== "missing") {
    return;
  }

  const cached: CachedEnsProfile = {
    ...profile,
    updatedAt: new Date().toISOString()
  };
  ensCache.set(cacheKey(address), cached);
  writeStoredCacheEntry(address, cached);
};

const toIpfsGatewayUrl = (value: string): string => {
  const path = value.replace(/^ipfs:\/\//, "").replace(/^ipfs\//, "");
  return `https://ipfs.io/ipfs/${path}`;
};

const sanitizeAvatarUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const normalized = trimmed.startsWith("ipfs://") ? toIpfsGatewayUrl(trimmed) : trimmed;

  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const resolveEnsAvatarUrl = async (ensName: string): Promise<string | null> => {
  try {
    return sanitizeAvatarUrl(await ensClient.getEnsText({ name: ensName, key: "avatar" }));
  } catch {
    return null;
  }
};

export const emptyEnsProfile = (
  status: SessionState["ensLookupStatus"] = "idle"
): EnsProfile => ({
  ensName: null,
  ensAvatarUrl: null,
  ensLookupStatus: status
});

export const resolveEnsProfile = async (
  address: `0x${string}`,
  options: { refresh?: boolean } = {}
): Promise<EnsProfile> => {
  if (!options.refresh) {
    const cached = readCachedProfile(address);
    if (cached) {
      return cached;
    }
  }

  try {
    const ensName = await ensClient.getEnsName({ address });
    if (!ensName) {
      const profile = emptyEnsProfile("missing");
      cacheProfile(address, profile);
      return profile;
    }

    const profile: EnsProfile = {
      ensName,
      ensAvatarUrl: await resolveEnsAvatarUrl(ensName),
      ensLookupStatus: "resolved"
    };

    cacheProfile(address, profile);
    return profile;
  } catch {
    const cached = readCachedProfile(address);
    if (cached && !options.refresh) {
      return cached;
    }
    return emptyEnsProfile("error");
  }
};

export const refreshEnsProfile = async (address: `0x${string}`): Promise<EnsProfile> =>
  resolveEnsProfile(address, { refresh: true });
