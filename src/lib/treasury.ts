import { parseUnits } from "ethers";

import { chainConfig } from "../config/chains";
import { getEthUsdPrice } from "../contracts/priceFeeds";
import { getTreasuryPayoutSnapshot } from "../contracts/treasuryVault";
import {
  getBugzTokenMetadata,
  getBugzTreasuryTokenBalance,
  isBugzTokenConfigured
} from "../contracts/bugzToken";
import { quoteBugzTrade } from "../contracts/bugzTrade";
import { RpcReadCache } from "./rpcReadCache";

type TreasuryRead<T> = {
  value: T | null;
  errorMessage: string | null;
};

export type BugzUsdQuote = {
  referenceBugzAmount: bigint;
  quotedEthAmount: bigint;
  ethUsdAnswer: bigint;
  ethUsdDecimals: number;
  feedAddress: `0x${string}`;
  feedUpdatedAt: number;
};

export type TreasuryDashboard = {
  isConfigured: boolean;
  tokenAddress: `0x${string}` | "";
  treasuryAddress: `0x${string}` | "";
  symbol: string;
  decimals: number;
  treasuryBalance: bigint | null;
  minPayout: bigint | null;
  maxPayout: bigint | null;
  standardPayoutDivisor: bigint | null;
  usdQuote: BugzUsdQuote | null;
  priceSourceLabel: string;
  priceSourceUrl: string;
  marketUrl: string;
  errorMessage: string | null;
};

const USD_QUOTE_TTL_MS = 60_000;
const DEFAULT_PAYOUT_DIVISOR = 1_000n;
const MAX_PAYOUT_MULTIPLIER = 10n;
const BUGZ_PRICE_REFERENCE = "1000";
const WEI_PER_ETH = 10n ** 18n;
const treasuryCache = new RpcReadCache();

const shortenError = (message: string): string => (message.length > 220 ? `${message.slice(0, 217)}...` : message);

const readTreasuryValue = async <T>(label: string, read: () => Promise<T | null>): Promise<TreasuryRead<T>> => {
  try {
    return {
      value: await read(),
      errorMessage: null
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    return {
      value: null,
      errorMessage: `${label} failed: ${shortenError(raw)}`
    };
  }
};

const fallbackPayout = (
  balance: bigint | null
): Pick<TreasuryDashboard, "minPayout" | "maxPayout" | "standardPayoutDivisor"> => ({
  minPayout: balance !== null ? balance / DEFAULT_PAYOUT_DIVISOR : null,
  maxPayout: balance !== null ? (balance * MAX_PAYOUT_MULTIPLIER) / DEFAULT_PAYOUT_DIVISOR : null,
  standardPayoutDivisor: DEFAULT_PAYOUT_DIVISOR
});

const loadBugzUsdQuote = async (tokenDecimals: number): Promise<BugzUsdQuote | null> => {
  if (!chainConfig.ethUsdFeedAddress) {
    return null;
  }

  return treasuryCache.getOrLoad(`bugz-usd:${chainConfig.id}:${chainConfig.bugzTokenAddress}`, USD_QUOTE_TTL_MS, async () => {
    const [quote, ethUsd] = await Promise.all([
      quoteBugzTrade("sell", BUGZ_PRICE_REFERENCE, "1"),
      getEthUsdPrice()
    ]);

    if (!ethUsd) {
      return null;
    }

    return {
      referenceBugzAmount: parseUnits(BUGZ_PRICE_REFERENCE, tokenDecimals),
      quotedEthAmount: quote.amountOut,
      ethUsdAnswer: ethUsd.answer,
      ethUsdDecimals: ethUsd.decimals,
      feedAddress: ethUsd.feedAddress,
      feedUpdatedAt: ethUsd.updatedAt
    };
  });
};

export const usdValueForBugz = (amount: bigint | null, quote: BugzUsdQuote | null): bigint | null => {
  if (amount === null || !quote) {
    return null;
  }

  if (amount === 0n || quote.referenceBugzAmount === 0n || quote.quotedEthAmount === 0n) {
    return 0n;
  }

  return (amount * quote.quotedEthAmount * quote.ethUsdAnswer) / quote.referenceBugzAmount / WEI_PER_ETH;
};

export const loadTreasuryDashboard = async (): Promise<TreasuryDashboard> => {
  if (!isBugzTokenConfigured() || !chainConfig.bugzTreasuryAddress) {
    return {
      isConfigured: false,
      tokenAddress: chainConfig.bugzTokenAddress || "",
      treasuryAddress: chainConfig.bugzTreasuryAddress || "",
      symbol: "BUGZ",
      decimals: 18,
      treasuryBalance: null,
      minPayout: null,
      maxPayout: null,
      standardPayoutDivisor: null,
      usdQuote: null,
      priceSourceLabel: "BUGZ/USD pricing unavailable until BUGZ and treasury are configured",
      priceSourceUrl: chainConfig.ethUsdFeedUrl,
      marketUrl: chainConfig.bugzMarketUrl,
      errorMessage: null
    };
  }

  const [metadataRead, balanceRead, payoutRead] = await Promise.all([
    readTreasuryValue("BUGZ metadata read", getBugzTokenMetadata),
    readTreasuryValue("treasury BUGZ balance read", getBugzTreasuryTokenBalance),
    readTreasuryValue("treasury payout read", getTreasuryPayoutSnapshot)
  ]);
  const metadata = metadataRead.value;
  const decimals = metadata?.decimals ?? 18;
  const symbol = metadata?.symbol ?? "BUGZ";
  const treasuryBalance = balanceRead.value?.tokenBalance ?? null;
  const payoutFallback = fallbackPayout(treasuryBalance);
  const payout = payoutRead.value;
  const usdRead = await readTreasuryValue("BUGZ/USD price read", () => loadBugzUsdQuote(decimals));
  const errorMessages = [
    metadataRead.errorMessage,
    balanceRead.errorMessage,
    payoutRead.errorMessage,
    usdRead.errorMessage
  ].filter(Boolean);

  return {
    isConfigured: true,
    tokenAddress: chainConfig.bugzTokenAddress,
    treasuryAddress: balanceRead.value?.address ?? chainConfig.bugzTreasuryAddress,
    symbol,
    decimals,
    treasuryBalance,
    minPayout: payout?.minReward ?? payoutFallback.minPayout,
    maxPayout: payout?.maxReward ?? payoutFallback.maxPayout,
    standardPayoutDivisor: payout?.standardPayoutDivisor ?? payoutFallback.standardPayoutDivisor,
    usdQuote: usdRead.value,
    priceSourceLabel: usdRead.value
      ? "Uniswap v4 BUGZ/WETH quote plus Chainlink ETH/USD"
      : "BUGZ/USD price unavailable",
    priceSourceUrl: chainConfig.ethUsdFeedUrl,
    marketUrl: chainConfig.bugzMarketUrl,
    errorMessage: errorMessages.length ? errorMessages.join(" ") : null
  };
};
