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

  try {
    const [metadata, connectedBalance, treasury] = await Promise.all([
      getBugzTokenMetadata(),
      connectedAddress ? getBugzTokenBalance(connectedAddress) : Promise.resolve(null),
      getBugzTreasurySnapshot()
    ]);

    return {
      isConfigured: true,
      tokenAddress: chainConfig.bugzTokenAddress,
      treasuryAddress: treasury?.address ?? chainConfig.bugzTreasuryAddress ?? "",
      name: metadata?.name ?? "CheapBugs Token",
      symbol: metadata?.symbol ?? "BUGZ",
      decimals: metadata?.decimals ?? 18,
      totalSupply: metadata?.totalSupply ?? null,
      connectedBalance,
      treasuryTokenBalance: treasury?.tokenBalance ?? null,
      treasuryNativeBalance: treasury?.nativeBalance ?? null,
      marketUrl: chainConfig.bugzMarketUrl,
      patronScanReady: isBugzPatronScanConfigured(),
      patronScanStatus,
      errorMessage: null
    };
  } catch (error) {
    return {
      isConfigured: true,
      tokenAddress: chainConfig.bugzTokenAddress,
      treasuryAddress: chainConfig.bugzTreasuryAddress ?? "",
      name: "CheapBugs Token",
      symbol: "BUGZ",
      decimals: 18,
      totalSupply: null,
      connectedBalance: null,
      treasuryTokenBalance: null,
      treasuryNativeBalance: null,
      marketUrl: chainConfig.bugzMarketUrl,
      patronScanReady: isBugzPatronScanConfigured(),
      patronScanStatus,
      errorMessage: error instanceof Error ? error.message : "Token reads failed."
    };
  }
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
