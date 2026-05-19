import { Contract } from "ethers";

import { chainConfig } from "../config/chains";
import { RpcReadCache } from "../lib/rpcReadCache";
import { normalizeAddress } from "../lib/utils";

import { createBaseReadProvider } from "./rpcProvider";

export type EthUsdPrice = {
  feedAddress: `0x${string}`;
  answer: bigint;
  decimals: number;
  updatedAt: number;
};

const priceFeedAbi = [
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)"
];

const TTL_MS = 60_000;
const readCache = new RpcReadCache();
const readProvider = createBaseReadProvider();

export const getEthUsdPrice = async (): Promise<EthUsdPrice | null> => {
  if (!chainConfig.ethUsdFeedAddress) {
    return null;
  }

  const feedAddress = normalizeAddress(chainConfig.ethUsdFeedAddress);
  return readCache.getOrLoad(`eth-usd:${chainConfig.id}:${feedAddress}`, TTL_MS, async () => {
    const contract = new Contract(feedAddress, priceFeedAbi, readProvider);
    const [decimals, roundData] = (await Promise.all([
      contract.decimals() as Promise<bigint>,
      contract.latestRoundData() as Promise<[bigint, bigint, bigint, bigint, bigint]>
    ])) as [bigint, [bigint, bigint, bigint, bigint, bigint]];
    const answer = roundData[1];
    const updatedAt = Number(roundData[3]);

    if (answer <= 0n || updatedAt <= 0) {
      throw new Error("ETH/USD feed returned an invalid price.");
    }

    return {
      feedAddress,
      answer,
      decimals: Number(decimals),
      updatedAt
    };
  });
};
