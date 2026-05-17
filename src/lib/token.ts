import { chainConfig } from "../config/chains";
import {
  getBugzPatronBalances,
  getBugzTokenBalance,
  getBugzTokenMetadata,
  getBugzTreasurySnapshot,
  isBugzPatronScanConfigured,
  isBugzTokenConfigured
} from "../contracts/bugzToken";
import { resolveEnsProfile } from "./ens";

import type { PatronEntry, TokenDashboard } from "../types/token";

type DashboardRead<T> = {
  value: T | null;
  errorMessage: string | null;
};

const shortenError = (message: string): string => (message.length > 220 ? `${message.slice(0, 217)}...` : message);

const tokenReadErrorMessage = (label: string, error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
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
  try {
    return {
      value: await read(),
      errorMessage: null
    };
  } catch (error) {
    return {
      value: null,
      errorMessage: tokenReadErrorMessage(label, error)
    };
  }
};

export const loadTokenDashboard = async (connectedAddress: `0x${string}` | null): Promise<TokenDashboard> => {
  const patronScanStatus = isBugzPatronScanConfigured()
    ? `ready from block ${chainConfig.bugzTokenDeploymentBlock}`
    : chainConfig.bugzTokenAddress
      ? "set VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK after deployment to enable full holder scans"
      : "waiting for BUGZ deployment";

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
      treasuryTokenBalance: null,
      treasuryNativeBalance: null,
      marketUrl: chainConfig.bugzMarketUrl,
      patronScanReady: false,
      patronScanStatus,
      errorMessage: null
    };
  }

  const [metadataRead, connectedBalanceRead, treasuryRead] = await Promise.all([
    readDashboardValue("BUGZ metadata read", getBugzTokenMetadata),
    connectedAddress
      ? readDashboardValue("BUGZ balance read", () => getBugzTokenBalance(connectedAddress))
      : Promise.resolve({ value: null, errorMessage: null }),
    chainConfig.bugzTreasuryAddress
      ? readDashboardValue("BUGZ treasury read", getBugzTreasurySnapshot)
      : Promise.resolve({ value: null, errorMessage: null })
  ]);

  const metadata = metadataRead.value;
  const treasury = treasuryRead.value;
  const errorMessages = [
    metadataRead.errorMessage,
    connectedBalanceRead.errorMessage,
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
    treasuryTokenBalance: treasury?.tokenBalance ?? null,
    treasuryNativeBalance: treasury?.nativeBalance ?? null,
    marketUrl: chainConfig.bugzMarketUrl,
    patronScanReady: isBugzPatronScanConfigured(),
    patronScanStatus,
    errorMessage: errorMessages.length ? errorMessages.join(" ") : null
  };
};

export const loadPatronLeaderboard = async (
  limit = 50
): Promise<{ entries: PatronEntry[]; errorMessage: string | null }> => {
  if (!isBugzTokenConfigured() || !isBugzPatronScanConfigured()) {
    return {
      entries: [],
      errorMessage: null
    };
  }

  try {
    const balances = await getBugzPatronBalances();
    const entries = await Promise.all(
      balances.slice(0, limit).map(async ({ address, balance }) => ({
        address,
        balance,
        ...(await resolveEnsProfile(address))
      }))
    );

    return {
      entries,
      errorMessage: null
    };
  } catch (error) {
    return {
      entries: [],
      errorMessage: error instanceof Error ? error.message : "Patron leaderboard query failed."
    };
  }
};
