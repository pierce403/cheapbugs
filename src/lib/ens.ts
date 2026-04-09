import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import { env } from "../config/env";
import type { SessionState } from "../types/app";

import { toGatewayUrl } from "./ipfs";

export const ENS_APP_URL = "https://app.ens.domains/";

type EnsProfile = Pick<SessionState, "ensName" | "ensAvatarUrl" | "ensLookupStatus">;

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(env.ensRpcUrl)
});

const ensCache = new Map<string, EnsProfile>();

const sanitizeAvatarUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.startsWith("ipfs://") ? toGatewayUrl(value) : value;

  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : null;
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
      ensAvatarUrl: sanitizeAvatarUrl(await ensClient.getEnsAvatar({ name: ensName })),
      ensLookupStatus: "resolved"
    };

    ensCache.set(address, profile);
    return profile;
  } catch {
    return emptyEnsProfile("error");
  }
};
