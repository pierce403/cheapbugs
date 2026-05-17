import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import { env } from "../config/env";
import type { SessionState } from "../types/app";

export const ENS_APP_URL = "https://app.ens.domains/";
export const ENS_REGISTER_URL = ENS_APP_URL;

export const ensProfileUrl = (name: string): string => `${ENS_APP_URL}${encodeURIComponent(name)}`;

type EnsProfile = Pick<SessionState, "ensName" | "ensAvatarUrl" | "ensLookupStatus">;

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(env.ensRpcUrl)
});

const ensCache = new Map<string, EnsProfile>();

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

export const resolveEnsProfile = async (address: `0x${string}`): Promise<EnsProfile> => {
  const cached = ensCache.get(address);
  if (cached) {
    return cached;
  }

  try {
    const ensName = await ensClient.getEnsName({ address });
    if (!ensName) {
      const profile = emptyEnsProfile("missing");
      ensCache.set(address, profile);
      return profile;
    }

    const profile: EnsProfile = {
      ensName,
      ensAvatarUrl: await resolveEnsAvatarUrl(ensName),
      ensLookupStatus: "resolved"
    };

    ensCache.set(address, profile);
    return profile;
  } catch {
    return emptyEnsProfile("error");
  }
};
