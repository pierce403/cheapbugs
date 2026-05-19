import { Contract, parseUnits } from "ethers";

import { chainConfig } from "../config/chains";
import { authController } from "../services";
import { appLog } from "../lib/logger";
import { RpcReadCache } from "../lib/rpcReadCache";
import { normalizeAddress } from "../lib/utils";
import type { HexString } from "../types/domain";

import { bugzTokenAbi } from "./bugzTokenAbi";
import { clearBugzTokenCache, getBugzTokenBalance, getBugzTokenMetadata, isBugzTokenConfigured } from "./bugzToken";
import { createBaseReadProvider } from "./rpcProvider";

export type BondVaultDashboard = {
  isConfigured: boolean;
  vaultAddress: HexString | "";
  tokenAddress: HexString | "";
  account: HexString;
  active: bigint;
  pendingWithdrawal: bigint;
  totalBond: bigint;
  withdrawAvailableAt: number;
  withdrawalDelaySeconds: number;
  level: number;
  tokenBalance: bigint | null;
  allowance: bigint | null;
  decimals: number;
  symbol: string;
  errorMessage: string | null;
};

export type BondActionResult = {
  label: string;
  txHash: HexString | null;
  skipped?: boolean;
};

type BondAccountTuple = {
  active?: bigint;
  pendingWithdrawal?: bigint;
  withdrawAvailableAt?: bigint;
  0: bigint;
  1: bigint;
  2: bigint;
};

export const cheapBugsBondVaultAbi = [
  "function accountOf(address accountAddress) view returns (tuple(uint256 active,uint256 pendingWithdrawal,uint64 withdrawAvailableAt))",
  "function activeBondOf(address accountAddress) view returns (uint256)",
  "function pendingWithdrawalOf(address accountAddress) view returns (uint256)",
  "function withdrawAvailableAt(address accountAddress) view returns (uint64)",
  "function bondOf(address accountAddress) view returns (uint256)",
  "function getLevel(address accountAddress) view returns (uint8)",
  "function WITHDRAWAL_DELAY() view returns (uint256)",
  "function bond(uint256 amount)",
  "function requestWithdrawal(uint256 amount)",
  "function withdraw()"
];

const readProvider = createBaseReadProvider();
const readCache = new RpcReadCache();
const READ_TTL_MS = 15_000;
const READ_TIMEOUT_MS = 4_000;
const DEFAULT_WITHDRAWAL_DELAY_SECONDS = 7 * 24 * 60 * 60;

const bondVaultAddress = (): HexString => {
  if (!chainConfig.bugBondVaultAddress) {
    throw new Error("Set VITE_BUG_BOND_VAULT_ADDRESS to the deployed CheapBugsBondVault contract.");
  }
  return normalizeAddress(chainConfig.bugBondVaultAddress);
};

const tokenAddress = (): HexString => {
  if (!chainConfig.bugzTokenAddress) {
    throw new Error("Set VITE_BUGZ_TOKEN_ADDRESS to the live BUGZ token.");
  }
  return normalizeAddress(chainConfig.bugzTokenAddress);
};

const readVault = () => new Contract(bondVaultAddress(), cheapBugsBondVaultAbi, readProvider);

const readToken = () => new Contract(tokenAddress(), bugzTokenAbi, readProvider);

const writeVault = async () => new Contract(bondVaultAddress(), cheapBugsBondVaultAbi, await authController.getSigner());

const writeToken = async () => new Contract(tokenAddress(), bugzTokenAbi, await authController.getSigner());

const withReadTimeout = async <T>(read: Promise<T>, label: string): Promise<T> => {
  const timeout = new Promise<never>((_resolve, reject) => {
    globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), READ_TIMEOUT_MS);
  });
  return Promise.race([read, timeout]);
};

const toHex = (value: string): HexString => value.toLowerCase() as HexString;

const txHash = (value: string | null | undefined): HexString => toHex(value ?? "0x");

const shortenError = (message: string): string => (message.length > 240 ? `${message.slice(0, 237)}...` : message);

const bondErrorMessage = (label: string, error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  if (/user rejected|denied transaction|rejected the request/i.test(raw)) {
    return `${label} was rejected in the wallet.`;
  }
  if (/insufficient funds|insufficient.*gas/i.test(raw)) {
    return `${label} needs more Base ETH for gas.`;
  }
  if (/allowance|transfer amount exceeds allowance|ERC20InsufficientAllowance/i.test(raw)) {
    return `${label} needs a larger BUGZ approval for the bond vault.`;
  }
  if (/InsufficientActiveBond/i.test(raw)) {
    return `${label} is larger than the active bond.`;
  }
  if (/WithdrawalNotReady/i.test(raw)) {
    return `${label} is not ready yet. Wait for the countdown to finish.`;
  }
  return `${label} failed: ${shortenError(raw)}`;
};

const parseAmount = async (rawAmount: string): Promise<bigint> => {
  const raw = rawAmount.trim();
  if (!raw) {
    throw new Error("Enter a BUGZ amount.");
  }
  const metadata = await getBugzTokenMetadata().catch(() => null);
  const amount = parseUnits(raw, metadata?.decimals ?? 18);
  if (amount <= 0n) {
    throw new Error("Enter a BUGZ amount greater than zero.");
  }
  return amount;
};

const sendTx = async (
  label: string,
  txPromise: Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>
): Promise<BondActionResult> => {
  try {
    const tx = await txPromise;
    const receipt = await tx.wait();
    readCache.clear();
    clearBugzTokenCache();
    return {
      label,
      txHash: txHash(receipt?.hash ?? tx.hash)
    };
  } catch (error) {
    throw new Error(bondErrorMessage(label, error));
  }
};

export const clearBondVaultCache = (): void => {
  readCache.clear();
};

export const isBondVaultConfigured = (): boolean =>
  Boolean(chainConfig.bugBondVaultAddress && chainConfig.bugzTokenAddress);

export const getBondVaultAddress = (): HexString => bondVaultAddress();

export const loadBondVaultDashboard = async (account: HexString): Promise<BondVaultDashboard> => {
  const normalizedAccount = normalizeAddress(account);
  if (!isBondVaultConfigured() || !isBugzTokenConfigured()) {
    return {
      isConfigured: false,
      vaultAddress: chainConfig.bugBondVaultAddress || "",
      tokenAddress: chainConfig.bugzTokenAddress || "",
      account: normalizedAccount,
      active: 0n,
      pendingWithdrawal: 0n,
      totalBond: 0n,
      withdrawAvailableAt: 0,
      withdrawalDelaySeconds: DEFAULT_WITHDRAWAL_DELAY_SECONDS,
      level: 0,
      tokenBalance: null,
      allowance: null,
      decimals: 18,
      symbol: "BUGZ",
      errorMessage: null
    };
  }

  const key = `bond-dashboard:${bondVaultAddress()}:${tokenAddress()}:${normalizedAccount}`;
  return readCache.getOrLoad(key, READ_TTL_MS, async () => {
    const metadata = await getBugzTokenMetadata().catch((error) => {
      appLog.warn("stake: BUGZ metadata read failed", { error });
      return null;
    });
    const decimals = metadata?.decimals ?? 18;
    const symbol = metadata?.symbol ?? "BUGZ";
    const vault = readVault();
    const token = readToken();

    try {
      const [accountTuple, levelRaw, withdrawalDelayRaw, tokenBalance, allowance] = await withReadTimeout(
        Promise.all([
          vault.accountOf(normalizedAccount) as Promise<BondAccountTuple>,
          vault.getLevel(normalizedAccount) as Promise<bigint>,
          vault.WITHDRAWAL_DELAY() as Promise<bigint>,
          getBugzTokenBalance(normalizedAccount),
          token.allowance(normalizedAccount, bondVaultAddress()) as Promise<bigint>
        ]),
        "Bond vault dashboard"
      );
      const active = accountTuple.active ?? accountTuple[0];
      const pendingWithdrawal = accountTuple.pendingWithdrawal ?? accountTuple[1];
      const withdrawAvailableAt = accountTuple.withdrawAvailableAt ?? accountTuple[2];

      return {
        isConfigured: true,
        vaultAddress: bondVaultAddress(),
        tokenAddress: tokenAddress(),
        account: normalizedAccount,
        active,
        pendingWithdrawal,
        totalBond: active + pendingWithdrawal,
        withdrawAvailableAt: Number(withdrawAvailableAt),
        withdrawalDelaySeconds: Number(withdrawalDelayRaw || BigInt(DEFAULT_WITHDRAWAL_DELAY_SECONDS)),
        level: Number(levelRaw),
        tokenBalance,
        allowance,
        decimals,
        symbol,
        errorMessage: null
      };
    } catch (error) {
      return {
        isConfigured: true,
        vaultAddress: bondVaultAddress(),
        tokenAddress: tokenAddress(),
        account: normalizedAccount,
        active: 0n,
        pendingWithdrawal: 0n,
        totalBond: 0n,
        withdrawAvailableAt: 0,
        withdrawalDelaySeconds: DEFAULT_WITHDRAWAL_DELAY_SECONDS,
        level: 0,
        tokenBalance: null,
        allowance: null,
        decimals,
        symbol,
        errorMessage: error instanceof Error ? error.message : "Bond vault dashboard read failed."
      };
    }
  });
};

const connectedAccount = (): HexString => {
  const account = authController.getSession().address;
  if (!account) {
    throw new Error("Connect a wallet before staking BUGZ.");
  }
  return account;
};

export const approveBondVault = async (rawAmount: string): Promise<BondActionResult> => {
  const account = connectedAccount();
  const amount = await parseAmount(rawAmount);
  const currentAllowance = (await readToken().allowance(account, bondVaultAddress())) as bigint;
  if (currentAllowance >= amount) {
    return {
      label: "Bond vault approval",
      txHash: null,
      skipped: true
    };
  }

  const token = await writeToken();
  return sendTx("Bond vault approval", token.approve(bondVaultAddress(), amount));
};

export const bondBugz = async (rawAmount: string): Promise<BondActionResult> => {
  connectedAccount();
  const amount = await parseAmount(rawAmount);
  const vault = await writeVault();
  return sendTx("BUGZ bond", vault.bond(amount));
};

export const requestBondWithdrawal = async (rawAmount: string): Promise<BondActionResult> => {
  connectedAccount();
  const amount = await parseAmount(rawAmount);
  const vault = await writeVault();
  return sendTx("Withdrawal request", vault.requestWithdrawal(amount));
};

export const withdrawBond = async (): Promise<BondActionResult> => {
  connectedAccount();
  const vault = await writeVault();
  return sendTx("Bond withdrawal", vault.withdraw());
};
