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
  referenceUsdValue: bigint;
  usdDecimals: number;
  tokenDecimals: number;
  sourceLabel: string;
  sourceUrl: string;
  fetchedAt: number;
  feedAddress?: `0x${string}`;
  feedUpdatedAt?: number;
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

const USD_QUOTE_TTL_MS = 10 * 60_000;
const DASHBOARD_TTL_MS = 30_000;
const DEFAULT_PAYOUT_DIVISOR = 1_000n;
const MAX_PAYOUT_MULTIPLIER = 10n;
const BUGZ_PRICE_REFERENCE = "1000";
const WEI_PER_ETH = 10n ** 18n;
const USD_DECIMALS = 8;
const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";
const DEXSCREENER_BASE_CHAIN_ID = "base";
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

type SerializedBugzUsdQuote = Omit<
  BugzUsdQuote,
  "referenceBugzAmount" | "referenceUsdValue" | "feedAddress"
> & {
  referenceBugzAmount: string;
  referenceUsdValue: string;
  feedAddress?: `0x${string}`;
};

type DexScreenerPair = {
  chainId?: string;
  url?: string;
  priceUsd?: string | null;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  liquidity?: { usd?: number | string | null } | null;
};

const usdQuoteStorageKey = (): string =>
  `cheapbugs.bugzUsdQuote.v1:${chainConfig.id}:${chainConfig.bugzTokenAddress?.toLowerCase() ?? "unconfigured"}`;

const serializeBugzUsdQuote = (quote: BugzUsdQuote): SerializedBugzUsdQuote => ({
  ...quote,
  referenceBugzAmount: quote.referenceBugzAmount.toString(),
  referenceUsdValue: quote.referenceUsdValue.toString()
});

const deserializeBugzUsdQuote = (quote: SerializedBugzUsdQuote): BugzUsdQuote => ({
  ...quote,
  referenceBugzAmount: BigInt(quote.referenceBugzAmount),
  referenceUsdValue: BigInt(quote.referenceUsdValue)
});

const readCachedBugzUsdQuote = (allowStale = false): BugzUsdQuote | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(usdQuoteStorageKey());
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as SerializedBugzUsdQuote;
    const quote = deserializeBugzUsdQuote(parsed);
    if (!allowStale && Date.now() - quote.fetchedAt > USD_QUOTE_TTL_MS) {
      return null;
    }
    return quote;
  } catch {
    window.localStorage.removeItem(usdQuoteStorageKey());
    return null;
  }
};

const writeCachedBugzUsdQuote = (quote: BugzUsdQuote): BugzUsdQuote => {
  if (typeof window === "undefined") {
    return quote;
  }

  try {
    window.localStorage.setItem(usdQuoteStorageKey(), JSON.stringify(serializeBugzUsdQuote(quote)));
  } catch {
    // Keep the dashboard usable even when browser storage is unavailable.
  }
  return quote;
};

const parseUsdDecimal = (raw: string): bigint => {
  const value = raw.trim();
  const decimalMatch = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (decimalMatch) {
    const whole = BigInt(decimalMatch[1]);
    const fraction = (decimalMatch[2] ?? "").slice(0, USD_DECIMALS).padEnd(USD_DECIMALS, "0");
    return whole * 10n ** BigInt(USD_DECIMALS) + BigInt(fraction || "0");
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Dex Screener returned an invalid BUGZ/USD price.");
  }
  return BigInt(Math.round(numeric * Number(10n ** BigInt(USD_DECIMALS))));
};

const dexScreenerChainId = (): string | null => (chainConfig.id === 8453 ? DEXSCREENER_BASE_CHAIN_ID : null);

const pairLiquidityUsd = (pair: DexScreenerPair): number => {
  const raw = pair.liquidity?.usd;
  const value = typeof raw === "string" ? Number(raw) : raw;
  return Number.isFinite(value) ? Number(value) : 0;
};

const selectDexScreenerPair = (pairs: DexScreenerPair[]): DexScreenerPair | null => {
  const chainId = dexScreenerChainId();
  const tokenAddress = chainConfig.bugzTokenAddress.toLowerCase();
  const candidates = pairs.filter((pair) => {
    const pairChain = pair.chainId?.toLowerCase();
    const baseAddress = pair.baseToken?.address?.toLowerCase();
    const quoteAddress = pair.quoteToken?.address?.toLowerCase();
    return (
      pair.priceUsd &&
      (!chainId || pairChain === chainId) &&
      (baseAddress === tokenAddress || quoteAddress === tokenAddress)
    );
  });

  candidates.sort((left, right) => pairLiquidityUsd(right) - pairLiquidityUsd(left));
  return candidates[0] ?? null;
};

const loadDexScreenerBugzUsdQuote = async (tokenDecimals: number): Promise<BugzUsdQuote> => {
  const chainId = dexScreenerChainId();
  if (!chainId) {
    throw new Error("Dex Screener BUGZ/USD pricing is only configured for Base.");
  }

  const response = await fetch(`${DEXSCREENER_BASE_URL}/token-pairs/v1/${chainId}/${chainConfig.bugzTokenAddress}`, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`Dex Screener BUGZ/USD price failed with HTTP ${response.status}.`);
  }

  const pairs = (await response.json()) as DexScreenerPair[];
  if (!Array.isArray(pairs)) {
    throw new Error("Dex Screener BUGZ/USD price returned an unexpected payload.");
  }

  const pair = selectDexScreenerPair(pairs);
  if (!pair?.priceUsd) {
    throw new Error("Dex Screener did not return a BUGZ/USD price.");
  }

  const referenceUsdValue = parseUsdDecimal(pair.priceUsd);
  if (referenceUsdValue <= 0n) {
    throw new Error("Dex Screener returned a zero BUGZ/USD price.");
  }

  return {
    referenceBugzAmount: 10n ** BigInt(tokenDecimals),
    referenceUsdValue,
    usdDecimals: USD_DECIMALS,
    tokenDecimals,
    sourceLabel: "Dex Screener BUGZ/USD token-pairs API",
    sourceUrl: pair.url || `${DEXSCREENER_BASE_URL}/token-pairs/v1/${chainId}/${chainConfig.bugzTokenAddress}`,
    fetchedAt: Date.now()
  };
};

const loadOnchainBugzUsdQuote = async (tokenDecimals: number): Promise<BugzUsdQuote | null> => {
  if (!chainConfig.ethUsdFeedAddress) {
    return null;
  }

  const quote = await quoteBugzTrade("sell", BUGZ_PRICE_REFERENCE, "1");
  const ethUsd = await getEthUsdPrice();

  if (!ethUsd) {
    return null;
  }

  const referenceUsdValue = (quote.amountOut * ethUsd.answer) / WEI_PER_ETH;
  if (referenceUsdValue <= 0n) {
    throw new Error("BUGZ/USD onchain quote returned an invalid price.");
  }

  return {
    referenceBugzAmount: quote.amountIn || parseUnits(BUGZ_PRICE_REFERENCE, tokenDecimals),
    referenceUsdValue,
    usdDecimals: ethUsd.decimals,
    tokenDecimals,
    sourceLabel: "Uniswap v4 BUGZ/WETH quote plus Chainlink ETH/USD",
    sourceUrl: chainConfig.ethUsdFeedUrl,
    fetchedAt: Date.now(),
    feedAddress: ethUsd.feedAddress,
    feedUpdatedAt: ethUsd.updatedAt
  };
};

const loadBugzUsdQuote = async (
  tokenDecimals: number,
  options: { allowOnchainFallback?: boolean } = {}
): Promise<BugzUsdQuote | null> => {
  const cached = readCachedBugzUsdQuote();
  if (cached && cached.tokenDecimals === tokenDecimals) {
    return cached;
  }

  try {
    return await treasuryCache.getOrLoad(
      `bugz-usd-dex:${chainConfig.id}:${chainConfig.bugzTokenAddress}:${tokenDecimals}`,
      USD_QUOTE_TTL_MS,
      async () => writeCachedBugzUsdQuote(await loadDexScreenerBugzUsdQuote(tokenDecimals))
    );
  } catch (dexError) {
    if (!options.allowOnchainFallback) {
      throw dexError;
    }

    const onchainQuote = await treasuryCache.getOrLoad(
      `bugz-usd-onchain:${chainConfig.id}:${chainConfig.bugzTokenAddress}:${tokenDecimals}`,
      USD_QUOTE_TTL_MS,
      async () => loadOnchainBugzUsdQuote(tokenDecimals)
    );
    if (onchainQuote) {
      return writeCachedBugzUsdQuote(onchainQuote);
    }
    throw dexError;
  }
};

export const usdValueForBugz = (amount: bigint | null, quote: BugzUsdQuote | null): bigint | null => {
  if (amount === null || !quote) {
    return null;
  }

  if (amount === 0n || quote.referenceBugzAmount === 0n || quote.referenceUsdValue === 0n) {
    return 0n;
  }

  return (amount * quote.referenceUsdValue) / quote.referenceBugzAmount;
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

  const earlyUsdReadPromise = readTreasuryValue("BUGZ/USD price read", () =>
    loadBugzUsdQuote(18, { allowOnchainFallback: false })
  );
  const metadataRead = await readTreasuryValue("BUGZ metadata read", getBugzTokenMetadata);
  const balanceRead = await readTreasuryValue("treasury BUGZ balance read", getBugzTreasuryTokenBalance);
  const payoutRead = await readTreasuryValue("treasury payout read", getTreasuryPayoutSnapshot);
  const earlyUsdRead = await earlyUsdReadPromise;
  const metadata = metadataRead.value;
  const decimals = metadata?.decimals ?? 18;
  const symbol = metadata?.symbol ?? "BUGZ";
  const treasuryBalance = balanceRead.value?.tokenBalance ?? null;
  const payoutFallback = fallbackPayout(treasuryBalance);
  const payout = payoutRead.value;
  const usdRead =
    earlyUsdRead.value?.tokenDecimals === decimals
      ? earlyUsdRead
      : await readTreasuryValue("BUGZ/USD price read", () => loadBugzUsdQuote(decimals, { allowOnchainFallback: true }));
  const staleUsdQuote = usdRead.value ? null : readCachedBugzUsdQuote(true);
  const usdQuote = usdRead.value ?? (staleUsdQuote?.tokenDecimals === decimals ? staleUsdQuote : null);
  const errorMessages = [
    metadataRead.errorMessage,
    balanceRead.errorMessage,
    payoutRead.errorMessage,
    usdRead.value ? null : usdRead.errorMessage
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
    usdQuote,
    priceSourceLabel: usdQuote
      ? `${usdQuote.sourceLabel}${usdRead.value ? "" : " (cached)"}`
      : "BUGZ/USD price unavailable",
    priceSourceUrl: usdQuote?.sourceUrl ?? chainConfig.ethUsdFeedUrl,
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
