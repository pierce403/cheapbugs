import type { HexString } from "../types/domain";

import { emptyEnsProfile, resolveEnsProfile } from "./ens";
import { normalizeAddress, shortHash } from "./utils";

const ENS_AUTHOR_DISPLAY_TIMEOUT_MS = 2_000;

export type AuthorDisplay = {
  address: HexString;
  label: string;
  ensName: string | null;
  ensAvatarUrl: string | null;
  ensLookupStatus: "idle" | "loading" | "resolved" | "missing" | "error";
};

export const loadAuthorDisplay = async (address: HexString): Promise<AuthorDisplay> => {
  const normalizedAddress = normalizeAddress(address);
  const profile = await Promise.race([
    resolveEnsProfile(normalizedAddress).catch(() => emptyEnsProfile("error")),
    new Promise<ReturnType<typeof emptyEnsProfile>>((resolve) => {
      window.setTimeout(() => resolve(emptyEnsProfile("idle")), ENS_AUTHOR_DISPLAY_TIMEOUT_MS);
    })
  ]);

  return {
    address: normalizedAddress,
    label: profile.ensName ?? shortHash(normalizedAddress, 12, 6),
    ...profile
  };
};

export const loadAuthorDisplayMap = async (addresses: HexString[]): Promise<Map<string, AuthorDisplay>> => {
  const normalizedAddresses = [...new Set(addresses.map((address) => normalizeAddress(address)))];
  const entries = await Promise.all(
    normalizedAddresses.map(async (address) => [address, await loadAuthorDisplay(address)] as const)
  );
  return new Map(entries);
};

export const authorDisplayFromMap = (authors: Map<string, AuthorDisplay>, address: HexString): AuthorDisplay => {
  const normalizedAddress = normalizeAddress(address);
  return (
    authors.get(normalizedAddress) ?? {
      address: normalizedAddress,
      label: shortHash(normalizedAddress, 12, 6),
      ...emptyEnsProfile("idle")
    }
  );
};
