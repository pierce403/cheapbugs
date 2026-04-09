import { env } from "./env";

const normalizeAddress = (address: string): `0x${string}` => address.toLowerCase() as `0x${string}`;

export const reviewerAllowlist = env.reviewerAddresses.map(normalizeAddress);
export const reviewerSet = new Set(reviewerAllowlist);

export const isTrustedReviewer = (address: string | null | undefined): boolean => {
  if (!address) {
    return false;
  }

  return reviewerSet.has(normalizeAddress(address));
};
