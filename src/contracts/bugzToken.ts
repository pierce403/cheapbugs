import { Contract, Interface, JsonRpcProvider } from "ethers";

import { chainConfig } from "../config/chains";
import { ZERO_ADDRESS } from "../lib/constants";
import { normalizeAddress } from "../lib/utils";

import { bugzTokenAbi } from "./bugzTokenAbi";

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

type HolderBalance = {
  address: `0x${string}`;
  balance: bigint;
};

type MemoryRecord<T> = {
  value: T;
  expiresAt: number;
};

const TTL_MS = 30_000;
const HOLDER_SCAN_TTL_MS = 60_000;
const HOLDER_SCAN_BLOCK_STEP = 50_000;
const cache = new Map<string, MemoryRecord<unknown>>();
const readProvider = new JsonRpcProvider(chainConfig.rpcUrl, chainConfig.id);
const transferInterface = new Interface(bugzTokenAbi);
const transferEvent = transferInterface.getEvent("Transfer");

if (!transferEvent) {
  throw new Error("BUGZ token ABI is missing the Transfer event.");
}

const transferTopic = transferEvent.topicHash;

const getCached = <T>(key: string): T | null => {
  const hit = cache.get(key);
  if (!hit || hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return hit.value as T;
};

const setCached = <T>(key: string, value: T, ttlMs: number): T => {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
  return value;
};

const bugzTokenAddress = (): `0x${string}` => {
  if (!chainConfig.bugzTokenAddress) {
    throw new Error("Set VITE_BUGZ_TOKEN_ADDRESS to the deployed BUGZ token contract.");
  }

  return chainConfig.bugzTokenAddress;
};

const readContract = () => new Contract(bugzTokenAddress(), bugzTokenAbi, readProvider);

export const isBugzTokenConfigured = (): boolean => Boolean(chainConfig.bugzTokenAddress);

export const isBugzPatronScanConfigured = (): boolean =>
  Boolean(chainConfig.bugzTokenAddress && chainConfig.bugzTokenDeploymentBlock > 0);

export const getBugzTokenMetadata = async (): Promise<TokenMetadata | null> => {
  if (!isBugzTokenConfigured()) {
    return null;
  }

  const key = `metadata:${bugzTokenAddress()}`;
  const cached = getCached<TokenMetadata>(key);
  if (cached) {
    return cached;
  }

  const contract = readContract();
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    contract.name() as Promise<string>,
    contract.symbol() as Promise<string>,
    contract.decimals() as Promise<bigint>,
    contract.totalSupply() as Promise<bigint>
  ]);

  return setCached(
    key,
    {
      name,
      symbol,
      decimals: Number(decimals),
      totalSupply
    },
    TTL_MS
  );
};

export const getBugzTokenBalance = async (address: `0x${string}`): Promise<bigint | null> => {
  if (!isBugzTokenConfigured()) {
    return null;
  }

  const key = `balance:${bugzTokenAddress()}:${address}`;
  const cached = getCached<bigint>(key);
  if (cached !== null) {
    return cached;
  }

  const balance = (await readContract().balanceOf(address)) as bigint;
  return setCached(key, balance, TTL_MS);
};

export const getBugzTreasurySnapshot = async (): Promise<TreasurySnapshot | null> => {
  if (!isBugzTokenConfigured() || !chainConfig.bugzTreasuryAddress) {
    return null;
  }

  const treasuryAddress = chainConfig.bugzTreasuryAddress;
  const key = `treasury:${bugzTokenAddress()}:${treasuryAddress}`;
  const cached = getCached<TreasurySnapshot>(key);
  if (cached) {
    return cached;
  }

  const [tokenBalance, nativeBalance] = await Promise.all([
    readContract().balanceOf(treasuryAddress) as Promise<bigint>,
    readProvider.getBalance(treasuryAddress)
  ]);

  return setCached(
    key,
    {
      address: treasuryAddress,
      tokenBalance,
      nativeBalance
    },
    TTL_MS
  );
};

export const getBugzPatronBalances = async (): Promise<HolderBalance[]> => {
  if (!isBugzPatronScanConfigured()) {
    return [];
  }

  const address = bugzTokenAddress();
  const fromBlock = chainConfig.bugzTokenDeploymentBlock;
  const key = `holders:${address}:${fromBlock}`;
  const cached = getCached<HolderBalance[]>(key);
  if (cached) {
    return cached;
  }

  const latestBlock = await readProvider.getBlockNumber();
  const balances = new Map<string, bigint>();

  for (let start = fromBlock; start <= latestBlock; start += HOLDER_SCAN_BLOCK_STEP) {
    const end = Math.min(latestBlock, start + HOLDER_SCAN_BLOCK_STEP - 1);
    const logs = await readProvider.getLogs({
      address,
      topics: [transferTopic],
      fromBlock: start,
      toBlock: end
    });

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
    .filter(([, balance]) => balance > 0n)
    .map(([holderAddress, balance]) => ({
      address: normalizeAddress(holderAddress),
      balance
    }))
    .sort((left, right) => (right.balance > left.balance ? 1 : right.balance < left.balance ? -1 : 0));

  return setCached(key, holders, HOLDER_SCAN_TTL_MS);
};
