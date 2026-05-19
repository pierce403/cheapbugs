import { Contract } from "ethers";

import { chainConfig } from "../config/chains";
import { RpcReadCache } from "../lib/rpcReadCache";
import { normalizeAddress } from "../lib/utils";

import { createBaseReadProvider } from "./rpcProvider";

export type TreasuryPayoutSnapshot = {
  address: `0x${string}`;
  standardPayoutDivisor: bigint;
  minReward: bigint;
  maxReward: bigint;
};

const treasuryVaultAbi = [
  "function standardPayoutDivisor() view returns (uint256)",
  "function calculateRewardAmount(uint8 multiplier) view returns (uint256)"
];

const TTL_MS = 30_000;
const readCache = new RpcReadCache();
const readProvider = createBaseReadProvider();

export const getTreasuryPayoutSnapshot = async (): Promise<TreasuryPayoutSnapshot | null> => {
  if (!chainConfig.bugTreasuryVaultAddress) {
    return null;
  }

  const address = normalizeAddress(chainConfig.bugTreasuryVaultAddress);
  return readCache.getOrLoad(`treasury-payout:${chainConfig.id}:${address}`, TTL_MS, async () => {
    const contract = new Contract(address, treasuryVaultAbi, readProvider);
    const [standardPayoutDivisor, minReward, maxReward] = await Promise.all([
      contract.standardPayoutDivisor() as Promise<bigint>,
      contract.calculateRewardAmount(1) as Promise<bigint>,
      contract.calculateRewardAmount(10) as Promise<bigint>
    ]);

    return {
      address,
      standardPayoutDivisor,
      minReward,
      maxReward
    };
  });
};
