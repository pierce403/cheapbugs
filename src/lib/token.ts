import { chainConfig } from "../config/chains";
import {
  clearBugzPatronCache,
  getBaseNativeBalance,
  getCachedBugzTokenMetadata,
  getBugzPatronBalances,
  getBugzTokenBalance,
  getBugzTokenMetadata,
  getBugzTreasurySnapshot,
  isBugzPatronScanConfigured,
  isBugzTokenConfigured
} from "../contracts/bugzToken";
import { resolveEnsProfile } from "./ens";
import { appLog } from "./logger";
import { isRateLimitError } from "./rpcReadCache";

import type { PatronLeaderboard, TokenDashboard } from "../types/token";

type DashboardRead<T> = {
  value: T | null;
  errorMessage: string | null;
};

export type HeaderBugzBalance = Pick<TokenDashboard, "connectedBalance" | "decimals" | "symbol" | "errorMessage">;
export type BugzAddressBalance = HeaderBugzBalance;

const shortenError = (message: string): string => (message.length > 220 ? `${message.slice(0, 217)}...` : message);

const holderApiFields = () => ({
  holdersUrl: chainConfig.bugzHoldersUrl,
  holderApiKeyUrl: chainConfig.etherscanApiKeyUrl,
  holderApiDocsUrl: chainConfig.etherscanTokenHolderDocsUrl,
  isHolderApiConfigured: Boolean(chainConfig.etherscanApiKey)
});

const retryDelay = (ms: number): Promise<void> => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

const tokenReadErrorMessage = (label: string, error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  if (isRateLimitError(error)) {
    return `${label} failed: Base RPC is temporarily rate-limiting reads. Try again shortly.`;
  }

  if (
    raw.includes("CALL_EXCEPTION") ||
    raw.includes("missing revert data") ||
    raw.includes("could not decode result data")
  ) {
    return `${label} failed on the configured RPC. Check that VITE_CHAIN_RPC_URL points to Base mainnet and VITE_BUGZ_TOKEN_ADDRESS is correct.`;
  }

  return `${label} failed: ${shortenError(raw)}`;
};

const readDashboardValue = async <T>(label: string, read: () => Promise<T | null>): Promise<DashboardRead<T>> => {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const value = await read();
      if (attempt > 1) {
        appLog.info("token: dashboard read recovered after retry", { label, attempt });
      }
      return {
        value,
        errorMessage: null
      };
    } catch (error) {
      lastError = error;
      appLog.warn("token: dashboard read failed", {
        label,
        attempt,
        errorMessage: tokenReadErrorMessage(label, error),
        error
      });
      if (attempt < 2 && !isRateLimitError(error)) {
        await retryDelay(450);
      } else {
        break;
      }
    }
  }

  return {
    value: null,
    errorMessage: tokenReadErrorMessage(label, lastError)
  };
};

export const loadBugzAddressBalance = async (address: `0x${string}`): Promise<BugzAddressBalance> => {
  if (!isBugzTokenConfigured()) {
    return {
      connectedBalance: null,
      decimals: 18,
      symbol: "BUGZ",
      errorMessage: null
    };
  }

  const metadata = getCachedBugzTokenMetadata();
  const balanceRead = await readDashboardValue("BUGZ balance read", () => getBugzTokenBalance(address));

  return {
    connectedBalance: balanceRead.value,
    decimals: metadata?.decimals ?? 18,
    symbol: metadata?.symbol ?? "BUGZ",
    errorMessage: balanceRead.errorMessage
  };
};

export const loadBugzHeaderBalance = async (connectedAddress: `0x${string}`): Promise<HeaderBugzBalance> =>
  loadBugzAddressBalance(connectedAddress);

export const loadTokenDashboard = async (
  connectedAddress: `0x${string}` | null,
  options: { includeTreasury?: boolean; includeNativeBalance?: boolean } = {}
): Promise<TokenDashboard> => {
  const includeTreasury = options.includeTreasury ?? true;
  const includeNativeBalance = options.includeNativeBalance ?? false;
  const patronScanStatus = !chainConfig.bugzTokenAddress
    ? "waiting for BUGZ deployment"
    : chainConfig.etherscanApiKey
      ? "ready via Etherscan V2 holder API; cached daily"
      : isBugzPatronScanConfigured()
        ? `ready via Transfer logs from block ${chainConfig.bugzTokenDeploymentBlock}; cached daily`
        : "set VITE_ETHERSCAN_API_KEY or VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK to enable holder scans";

  if (!isBugzTokenConfigured()) {
    return {
      isConfigured: false,
      tokenAddress: "",
      treasuryAddress: chainConfig.bugzTreasuryAddress || "",
      name: "CheapBugs Token",
      symbol: "BUGZ",
      decimals: 18,
      totalSupply: null,
      connectedBalance: null,
      connectedNativeBalance: null,
      treasuryTokenBalance: null,
      treasuryNativeBalance: null,
      marketUrl: chainConfig.bugzMarketUrl,
      holdersUrl: chainConfig.bugzHoldersUrl,
      patronScanReady: false,
      patronScanStatus,
      errorMessage: null
    };
  }

  const [metadataRead, connectedBalanceRead, connectedNativeBalanceRead, treasuryRead] = await Promise.all([
    readDashboardValue("BUGZ metadata read", getBugzTokenMetadata),
    connectedAddress
      ? readDashboardValue("BUGZ balance read", () => getBugzTokenBalance(connectedAddress))
      : Promise.resolve({ value: null, errorMessage: null }),
    connectedAddress && includeNativeBalance
      ? readDashboardValue("Base ETH balance read", () => getBaseNativeBalance(connectedAddress))
      : Promise.resolve({ value: null, errorMessage: null }),
    includeTreasury && chainConfig.bugzTreasuryAddress
      ? readDashboardValue("BUGZ treasury read", getBugzTreasurySnapshot)
      : Promise.resolve({ value: null, errorMessage: null })
  ]);

  const metadata = metadataRead.value;
  const treasury = treasuryRead.value;
  const errorMessages = [
    metadataRead.errorMessage,
    connectedBalanceRead.errorMessage,
    connectedNativeBalanceRead.errorMessage,
    treasuryRead.errorMessage
  ].filter(Boolean);

  return {
    isConfigured: true,
    tokenAddress: chainConfig.bugzTokenAddress,
    treasuryAddress: treasury?.address ?? chainConfig.bugzTreasuryAddress ?? "",
    name: metadata?.name ?? "CheapBugs Token",
    symbol: metadata?.symbol ?? "BUGZ",
    decimals: metadata?.decimals ?? 18,
    totalSupply: metadata?.totalSupply ?? null,
    connectedBalance: connectedBalanceRead.value,
    connectedNativeBalance: connectedNativeBalanceRead.value,
    treasuryTokenBalance: treasury?.tokenBalance ?? null,
    treasuryNativeBalance: treasury?.nativeBalance ?? null,
    marketUrl: chainConfig.bugzMarketUrl,
    holdersUrl: chainConfig.bugzHoldersUrl,
    patronScanReady: isBugzPatronScanConfigured(),
    patronScanStatus,
    errorMessage: errorMessages.length ? errorMessages.join(" ") : null
  };
};

export const loadPatronLeaderboard = async (
  limit = 50,
  options: { cachedOnly?: boolean } = {}
): Promise<PatronLeaderboard> => {
  if (!isBugzTokenConfigured() || !isBugzPatronScanConfigured()) {
    return {
      entries: [],
      sourceLabel: "not configured",
      updatedAt: null,
      nextRefreshAt: null,
      ...holderApiFields(),
      errorMessage: null
    };
  }

  try {
    const snapshot = await getBugzPatronBalances({ cachedOnly: options.cachedOnly });
    const entries = await Promise.all(
      snapshot.holders.slice(0, limit).map(async ({ address, balance }) => ({
        address,
        balance,
        ...(await resolveEnsProfile(address))
      }))
    );

    return {
      entries,
      sourceLabel: snapshot.source === "etherscan" ? "Etherscan V2 holder API" : "Base Transfer log scan",
      updatedAt: snapshot.updatedAt,
      nextRefreshAt: snapshot.nextRefreshAt,
      ...holderApiFields(),
      errorMessage: null
    };
  } catch (error) {
    return {
      entries: [],
      sourceLabel: chainConfig.etherscanApiKey ? "Etherscan V2 holder API" : "Base Transfer log scan",
      updatedAt: null,
      nextRefreshAt: null,
      ...holderApiFields(),
      errorMessage: error instanceof Error ? error.message : "Patron leaderboard query failed."
    };
  }
};

export const refreshPatronLeaderboard = (): void => {
  clearBugzPatronCache();
};
