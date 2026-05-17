import type { SessionState } from "./app";
import type { HexString } from "./domain";

export type TokenDashboard = {
  isConfigured: boolean;
  tokenAddress: HexString | "";
  treasuryAddress: HexString | "";
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint | null;
  connectedBalance: bigint | null;
  treasuryTokenBalance: bigint | null;
  treasuryNativeBalance: bigint | null;
  marketUrl: string;
  holdersUrl: string;
  patronScanReady: boolean;
  patronScanStatus: string;
  errorMessage: string | null;
};

export type PatronEntry = {
  address: HexString;
  balance: bigint;
  ensName: string | null;
  ensAvatarUrl: string | null;
  ensLookupStatus: SessionState["ensLookupStatus"];
};

export type PatronLeaderboard = {
  entries: PatronEntry[];
  sourceLabel: string;
  updatedAt: number | null;
  nextRefreshAt: number | null;
  holdersUrl: string;
  holderApiKeyUrl: string;
  holderApiDocsUrl: string;
  isHolderApiConfigured: boolean;
  errorMessage: string | null;
};
