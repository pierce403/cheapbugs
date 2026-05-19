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

type TreasuryDashboardLoadOptions = {
  background?: boolean;
  onUpdate?: () => void | Promise<void>;
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
const DASHBOARD_TTL_MS = 30_000;
const DEFAULT_PAYOUT_DIVISOR = 1_000n;
const MAX_PAYOUT_MULTIPLIER = 10n;
const BUGZ_PRICE_REFERENCE = "1000";
const WEI_PER_ETH = 10n ** 18n;
const treasuryCache = new RpcReadCache();
let dashboardCache: { value: TreasuryDashboard; expiresAt: number } | null = null;
let dashboardRefresh: Promise<TreasuryDashboard> | null = null;
const dashboardRefreshCallbacks = new Set<() => void | Promise<void>>();

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
    const quote = await quoteBugzTrade("sell", BUGZ_PRICE_REFERENCE, "1");
    const ethUsd = await getEthUsdPrice();

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

const unconfiguredDashboard = (): TreasuryDashboard => ({
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
});

const loadingDashboard = (): TreasuryDashboard => ({
  isConfigured: true,
  tokenAddress: chainConfig.bugzTokenAddress,
  treasuryAddress: chainConfig.bugzTreasuryAddress,
  symbol: "BUGZ",
  decimals: 18,
  treasuryBalance: null,
  minPayout: null,
  maxPayout: null,
  standardPayoutDivisor: DEFAULT_PAYOUT_DIVISOR,
  usdQuote: null,
  priceSourceLabel: "BUGZ/USD price loading",
  priceSourceUrl: chainConfig.ethUsdFeedUrl,
  marketUrl: chainConfig.bugzMarketUrl,
  errorMessage: "Treasury data is loading from Base with throttled background reads."
});

const buildTreasuryDashboard = async (): Promise<TreasuryDashboard> => {
  if (!isBugzTokenConfigured() || !chainConfig.bugzTreasuryAddress) {
    return unconfiguredDashboard();
  }

  const metadataRead = await readTreasuryValue("BUGZ metadata read", getBugzTokenMetadata);
  const balanceRead = await readTreasuryValue("treasury BUGZ balance read", getBugzTreasuryTokenBalance);
  const payoutRead = await readTreasuryValue("treasury payout read", getTreasuryPayoutSnapshot);
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

const notifyDashboardRefreshCallbacks = async (): Promise<void> => {
  const callbacks = Array.from(dashboardRefreshCallbacks);
  dashboardRefreshCallbacks.clear();
  await Promise.all(callbacks.map((callback) => Promise.resolve(callback()).catch(() => undefined)));
};

const refreshTreasuryDashboard = (onUpdate?: () => void | Promise<void>): Promise<TreasuryDashboard> => {
  if (onUpdate) {
    dashboardRefreshCallbacks.add(onUpdate);
  }
  if (dashboardRefresh) {
    return dashboardRefresh;
  }

  dashboardRefresh = buildTreasuryDashboard()
    .then((dashboard) => {
      dashboardCache = {
        value: dashboard,
        expiresAt: Date.now() + DASHBOARD_TTL_MS
      };
      return dashboard;
    })
    .finally(async () => {
      dashboardRefresh = null;
      await notifyDashboardRefreshCallbacks();
    });
  return dashboardRefresh;
};

export const loadTreasuryDashboard = async (
  options: TreasuryDashboardLoadOptions = {}
): Promise<TreasuryDashboard> => {
  if (!isBugzTokenConfigured() || !chainConfig.bugzTreasuryAddress) {
    return unconfiguredDashboard();
  }

  if (!options.background) {
    return refreshTreasuryDashboard();
  }

  const now = Date.now();
  if (dashboardCache && dashboardCache.expiresAt > now) {
    return dashboardCache.value;
  }

  void refreshTreasuryDashboard(options.onUpdate).catch(() => undefined);
  return dashboardCache?.value ?? loadingDashboard();
};
