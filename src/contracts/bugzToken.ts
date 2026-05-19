import { Contract, Interface, parseUnits } from "ethers";

import { chainConfig } from "../config/chains";
import { QueryCache } from "../lib/cache";
import { ZERO_ADDRESS } from "../lib/constants";
import { appLog } from "../lib/logger";
import { RpcReadCache } from "../lib/rpcReadCache";
import { normalizeAddress } from "../lib/utils";

import { bugzTokenAbi } from "./bugzTokenAbi";
import { createBaseReadProvider } from "./rpcProvider";

type TokenMetadata = {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
};

type TreasurySnapshot = {
  address: `0x${string}`;
  tokenBalance: bigint;
  nativeBalance: bigint;
};

type TreasuryTokenSnapshot = {
  address: `0x${string}`;
  tokenBalance: bigint;
};

type HolderBalance = {
  address: `0x${string}`;
  balance: bigint;
};

export type HolderBalanceSource = "etherscan" | "transfer-log";

export type HolderBalanceSnapshot = {
  holders: HolderBalance[];
  source: HolderBalanceSource;
  updatedAt: number;
  nextRefreshAt: number;
  latestBlock?: number;
};

type SerializedHolderBalance = {
  address: `0x${string}`;
  balance: string;
};

type SerializedHolderBalanceSnapshot = Omit<HolderBalanceSnapshot, "holders"> & {
  holders: SerializedHolderBalance[];
};

const TTL_MS = 30_000;
const HOLDER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const HOLDER_SCAN_BLOCK_STEP = 10_000;
const HOLDER_API_OFFSET = 100;
const readCache = new RpcReadCache();
const holderLocalCache = new QueryCache("cheapbugs.patrons.v1");
const readProvider = createBaseReadProvider();
const transferInterface = new Interface(bugzTokenAbi);
const transferEvent = transferInterface.getEvent("Transfer");

if (!transferEvent) {
  throw new Error("BUGZ token ABI is missing the Transfer event.");
}

const transferTopic = transferEvent.topicHash;

export const clearBugzTokenCache = (): void => {
  readCache.clear();
};

const bugzTokenAddress = (): `0x${string}` => {
  if (!chainConfig.bugzTokenAddress) {
    throw new Error("Set VITE_BUGZ_TOKEN_ADDRESS to the live BUGZ token address.");
  }

  return chainConfig.bugzTokenAddress;
};

const readContract = () => new Contract(bugzTokenAddress(), bugzTokenAbi, readProvider);

export const isBugzTokenConfigured = (): boolean => Boolean(chainConfig.bugzTokenAddress);

const isBugzHolderApiConfigured = (): boolean => Boolean(chainConfig.bugzTokenAddress && chainConfig.etherscanApiKey);

const isBugzTransferScanConfigured = (): boolean =>
  Boolean(chainConfig.bugzTokenAddress && chainConfig.bugzTokenDeploymentBlock > 0);

export const isBugzPatronScanConfigured = (): boolean =>
  Boolean(isBugzHolderApiConfigured() || isBugzTransferScanConfigured());

export const getBugzTokenMetadata = async (): Promise<TokenMetadata | null> => {
  if (!isBugzTokenConfigured()) {
    return null;
  }

  const key = `metadata:${bugzTokenAddress()}`;
  return readCache.getOrLoad(
    key,
    TTL_MS,
    async () => {
      const contract = readContract();
      const [name, symbol, decimals, totalSupply] = await Promise.all([
        contract.name() as Promise<string>,
        contract.symbol() as Promise<string>,
        contract.decimals() as Promise<bigint>,
        contract.totalSupply() as Promise<bigint>
      ]);

      return {
        name,
        symbol,
        decimals: Number(decimals),
        totalSupply
      };
    }
  );
};

export const getBugzTokenBalance = async (address: `0x${string}`): Promise<bigint | null> => {
  if (!isBugzTokenConfigured()) {
    return null;
  }

  const key = `balance:${bugzTokenAddress()}:${address}`;
  return readCache.getOrLoad(key, TTL_MS, async () => (await readContract().balanceOf(address)) as bigint);
};

export const getBugzTreasurySnapshot = async (): Promise<TreasurySnapshot | null> => {
  if (!isBugzTokenConfigured() || !chainConfig.bugzTreasuryAddress) {
    return null;
  }

  const treasuryAddress = chainConfig.bugzTreasuryAddress;
  const key = `treasury:${bugzTokenAddress()}:${treasuryAddress}`;
  return readCache.getOrLoad(key, TTL_MS, async () => {
    const [tokenBalance, nativeBalance] = await Promise.all([
      readContract().balanceOf(treasuryAddress) as Promise<bigint>,
      readProvider.getBalance(treasuryAddress)
    ]);

    return {
      address: treasuryAddress,
      tokenBalance,
      nativeBalance
    };
  });
};

export const getBugzTreasuryTokenBalance = async (): Promise<TreasuryTokenSnapshot | null> => {
  if (!isBugzTokenConfigured() || !chainConfig.bugzTreasuryAddress) {
    return null;
  }

  const treasuryAddress = chainConfig.bugzTreasuryAddress;
  const key = `treasury-token:${bugzTokenAddress()}:${treasuryAddress}`;
  return readCache.getOrLoad(key, TTL_MS, async () => ({
    address: treasuryAddress,
    tokenBalance: (await readContract().balanceOf(treasuryAddress)) as bigint
  }));
};

export const getCachedBugzTokenMetadata = (): TokenMetadata | null => {
  if (!isBugzTokenConfigured()) {
    return null;
  }

  return readCache.get<TokenMetadata>(`metadata:${bugzTokenAddress()}`);
};

const holderCacheKey = (): string => {
  const address = bugzTokenAddress();
  const fromBlock = chainConfig.bugzTokenDeploymentBlock;
  const source = isBugzHolderApiConfigured() ? "etherscan" : "transfer-log";
  return `holders:${chainConfig.id}:${address}:${source}:${fromBlock}:${HOLDER_API_OFFSET}`;
};

const serializeHolderSnapshot = (snapshot: HolderBalanceSnapshot): SerializedHolderBalanceSnapshot => ({
  ...snapshot,
  holders: snapshot.holders.map((holder) => ({
    address: holder.address,
    balance: holder.balance.toString()
  }))
});

const deserializeHolderSnapshot = (snapshot: SerializedHolderBalanceSnapshot): HolderBalanceSnapshot => ({
  ...snapshot,
  holders: snapshot.holders.map((holder) => ({
    address: holder.address,
    balance: BigInt(holder.balance)
  }))
});

const toSnapshot = (
  holders: HolderBalance[],
  source: HolderBalanceSource,
  options: { latestBlock?: number } = {}
): HolderBalanceSnapshot => {
  const updatedAt = Date.now();
  return {
    holders,
    source,
    updatedAt,
    nextRefreshAt: updatedAt + HOLDER_CACHE_TTL_MS,
    ...options
  };
};

const emptyHolderSnapshot = (): HolderBalanceSnapshot => ({
  holders: [],
  source: isBugzHolderApiConfigured() ? "etherscan" : "transfer-log",
  updatedAt: 0,
  nextRefreshAt: 0
});

const isHexAddress = (value: string): value is `0x${string}` => /^0x[a-fA-F0-9]{40}$/.test(value);

const parseHolderQuantity = (value: unknown, decimals: number): bigint => {
  const raw = String(value ?? "").trim().replaceAll(",", "");
  if (!raw) {
    return 0n;
  }

  return raw.includes(".") ? parseUnits(raw, decimals) : BigInt(raw);
};

const sortHolders = (holders: HolderBalance[]): HolderBalance[] =>
  holders
    .filter((holder) => holder.balance > 0n && holder.address !== ZERO_ADDRESS)
    .sort((left, right) => (right.balance > left.balance ? 1 : right.balance < left.balance ? -1 : 0));

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const transferLogScanError = (error: unknown): Error => {
  const raw = errorText(error);
  if (
    raw.includes("eth_getLogs") ||
    raw.includes("-32614") ||
    raw.includes("10,000 range") ||
    raw.includes("10000 range") ||
    raw.includes("query returned more than")
  ) {
    return new Error(
      `The configured Base RPC rejected the BUGZ holder scan. The static fallback scans in ${HOLDER_SCAN_BLOCK_STEP.toLocaleString()}-block pages, but this RPC still refused a log page. Add VITE_ETHERSCAN_API_KEY or VITE_BASESCAN_API_KEY to use the Etherscan holder API, or set VITE_CHAIN_RPC_URL to a Base RPC with eth_getLogs support.`
    );
  }

  return new Error(`BUGZ holder scan failed on the configured Base RPC: ${raw.slice(0, 220)}`);
};

const getBugzEtherscanPatronBalances = async (): Promise<HolderBalanceSnapshot> => {
  const metadata = await getBugzTokenMetadata();
  const decimals = metadata?.decimals ?? 18;
  const url = new URL(chainConfig.etherscanApiUrl);
  url.searchParams.set("chainid", String(chainConfig.id));
  url.searchParams.set("module", "token");
  url.searchParams.set("action", "tokenholderlist");
  url.searchParams.set("contractaddress", bugzTokenAddress());
  url.searchParams.set("page", "1");
  url.searchParams.set("offset", String(HOLDER_API_OFFSET));
  url.searchParams.set("apikey", chainConfig.etherscanApiKey);

  appLog.info("token: fetching BUGZ holders from Etherscan API", {
    chainId: chainConfig.id,
    token: bugzTokenAddress(),
    offset: HOLDER_API_OFFSET
  });

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Etherscan holder API failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as {
    status?: string;
    message?: string;
    result?: unknown;
  };

  if (payload.status !== "1" || !Array.isArray(payload.result)) {
    const message =
      typeof payload.result === "string"
        ? payload.result
        : payload.message || "Etherscan holder API did not return holder rows.";
    throw new Error(message);
  }

  const holders = payload.result.flatMap((entry): HolderBalance[] => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const row = entry as Record<string, unknown>;
    const address = String(row.TokenHolderAddress ?? row.tokenHolderAddress ?? row.address ?? "");
    const quantity = row.TokenHolderQuantity ?? row.tokenHolderQuantity ?? row.balance;

    if (!isHexAddress(address)) {
      return [];
    }

    return [
      {
        address: normalizeAddress(address),
        balance: parseHolderQuantity(quantity, decimals)
      }
    ];
  });

  return toSnapshot(sortHolders(holders), "etherscan");
};

const getBugzTransferLogPatronBalances = async (): Promise<HolderBalanceSnapshot> => {
  if (!isBugzTransferScanConfigured()) {
    throw new Error("Set VITE_BUGZ_TOKEN_DEPLOYMENT_BLOCK or VITE_ETHERSCAN_API_KEY to enable BUGZ holder scans.");
  }

  const address = bugzTokenAddress();
  const fromBlock = chainConfig.bugzTokenDeploymentBlock;
  const latestBlock = await readProvider.getBlockNumber();
  const balances = new Map<string, bigint>();

  appLog.info("token: reconstructing BUGZ holders from Transfer logs", {
    token: address,
    fromBlock,
    latestBlock,
    step: HOLDER_SCAN_BLOCK_STEP
  });

  for (let start = fromBlock; start <= latestBlock; start += HOLDER_SCAN_BLOCK_STEP) {
    const end = Math.min(latestBlock, start + HOLDER_SCAN_BLOCK_STEP - 1);
    let logs: Awaited<ReturnType<typeof readProvider.getLogs>>;
    try {
      logs = await readProvider.getLogs({
        address,
        topics: [transferTopic],
        fromBlock: start,
        toBlock: end
      });
    } catch (error) {
      throw transferLogScanError(error);
    }

    logs.forEach((log) => {
      try {
        const parsed = transferInterface.parseLog(log);
        if (!parsed) {
          return;
        }
        const from = normalizeAddress(String(parsed.args.from));
        const to = normalizeAddress(String(parsed.args.to));
        const value = parsed.args.value as bigint;

        if (from !== ZERO_ADDRESS) {
          balances.set(from, (balances.get(from) ?? 0n) - value);
        }

        if (to !== ZERO_ADDRESS) {
          balances.set(to, (balances.get(to) ?? 0n) + value);
        }
      } catch {
        // Ignore logs that fail to decode cleanly.
      }
    });
  }

  const holders = Array.from(balances.entries())
    .map(([holderAddress, balance]) => ({
      address: normalizeAddress(holderAddress),
      balance
    }));

  return toSnapshot(sortHolders(holders), "transfer-log", { latestBlock });
};

const loadFreshHolderSnapshot = async (): Promise<HolderBalanceSnapshot> => {
  if (isBugzHolderApiConfigured()) {
    try {
      return await getBugzEtherscanPatronBalances();
    } catch (error) {
      appLog.warn("token: Etherscan holder API failed; falling back to Transfer logs when available", { error });
      if (!isBugzTransferScanConfigured()) {
        throw error;
      }
    }
  }

  return getBugzTransferLogPatronBalances();
};

export const clearBugzPatronCache = (): void => {
  if (!isBugzTokenConfigured()) {
    return;
  }

  const key = holderCacheKey();
  readCache.delete(key);
  holderLocalCache.clear(key);
};

export const getBugzPatronBalances = async (
  options: { forceRefresh?: boolean; cachedOnly?: boolean } = {}
): Promise<HolderBalanceSnapshot> => {
  if (!isBugzPatronScanConfigured()) {
    return emptyHolderSnapshot();
  }

  const key = holderCacheKey();
  const cachedMemory = options.forceRefresh ? null : readCache.get<HolderBalanceSnapshot>(key);
  if (cachedMemory) {
    return cachedMemory;
  }

  if (!options.forceRefresh) {
    const cachedLocal = holderLocalCache.get<SerializedHolderBalanceSnapshot>(key);
    if (cachedLocal) {
      const snapshot = deserializeHolderSnapshot(cachedLocal);
      appLog.info("token: loaded BUGZ holders from localStorage cache", {
        source: snapshot.source,
        updatedAt: snapshot.updatedAt,
        count: snapshot.holders.length
      });
      return readCache.set(key, snapshot, Math.max(snapshot.nextRefreshAt - Date.now(), TTL_MS));
    }
  }

  if (options.cachedOnly) {
    return emptyHolderSnapshot();
  }

  const fresh = await loadFreshHolderSnapshot();
  holderLocalCache.set(key, serializeHolderSnapshot(fresh), HOLDER_CACHE_TTL_MS);
  return readCache.set(key, fresh, HOLDER_CACHE_TTL_MS);
};
