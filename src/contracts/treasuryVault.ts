import { Contract } from "ethers";

import { chainConfig } from "../config/chains";
import { authController } from "../services";
import { RpcReadCache, scheduleBaseRpcRead } from "../lib/rpcReadCache";
import { normalizeAddress } from "../lib/utils";
import type { HexString } from "../types/domain";

import { bugzTokenAbi } from "./bugzTokenAbi";
import { clearBugzTokenCache } from "./bugzToken";
import { createBaseReadProvider } from "./rpcProvider";

export type TreasuryPayoutSnapshot = {
  address: `0x${string}`;
  standardPayoutDivisor: bigint;
  minReward: bigint;
  maxReward: bigint;
};

const treasuryVaultAbi = [
  "function standardPayoutDivisor() view returns (uint256)",
  "function calculateRewardAmount(uint8 multiplier) view returns (uint256)",
  "function detailKeyPayments(bytes32 reportHash,address buyer) view returns (uint256)",
  "function purchaseDetailKey(bytes32 reportHash,uint256 amount)"
];

const TTL_MS = 30_000;
const readCache = new RpcReadCache();
const readProvider = createBaseReadProvider();

const treasuryVaultAddress = (): HexString => {
  if (!chainConfig.bugTreasuryVaultAddress) {
    throw new Error("Set VITE_BUG_TREASURY_VAULT_ADDRESS to the deployed CheapBugsTreasuryVault contract.");
  }
  return normalizeAddress(chainConfig.bugTreasuryVaultAddress);
};

const tokenAddress = (): HexString => {
  if (!chainConfig.bugzTokenAddress) {
    throw new Error("Set VITE_BUGZ_TOKEN_ADDRESS to the live BUGZ token.");
  }
  return normalizeAddress(chainConfig.bugzTokenAddress);
};

const readVault = () => new Contract(treasuryVaultAddress(), treasuryVaultAbi, readProvider);

const readToken = () => new Contract(tokenAddress(), bugzTokenAbi, readProvider);

const writeVault = async () => new Contract(treasuryVaultAddress(), treasuryVaultAbi, await authController.getSigner());

const writeToken = async () => new Contract(tokenAddress(), bugzTokenAbi, await authController.getSigner());

const txHash = (value: string | null | undefined): HexString => (value ?? "0x").toLowerCase() as HexString;

const shortenError = (message: string): string => (message.length > 240 ? `${message.slice(0, 237)}...` : message);

const detailPaymentError = (label: string, error: unknown): Error => {
  const raw = error instanceof Error ? error.message : String(error);
  if (/user rejected|denied transaction|rejected the request/i.test(raw)) {
    return new Error(`${label} was rejected in the wallet.`);
  }
  if (/insufficient funds|insufficient.*gas/i.test(raw)) {
    return new Error(`${label} needs more Base ETH for gas.`);
  }
  if (/allowance|transfer amount exceeds allowance|ERC20InsufficientAllowance/i.test(raw)) {
    return new Error(`${label} needs a larger BUGZ approval for the treasury vault.`);
  }
  if (/balance|ERC20InsufficientBalance/i.test(raw)) {
    return new Error(`${label} needs more BUGZ.`);
  }
  return new Error(`${label} failed: ${shortenError(raw)}`);
};

const connectedAccount = (): HexString => {
  const account = authController.getSession().address;
  if (!account) {
    throw new Error("Connect a wallet before buying detail access.");
  }
  return account;
};

const sendTx = async (
  label: string,
  txPromise: Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>
): Promise<{ txHash: HexString; skipped?: boolean }> => {
  try {
    const tx = await txPromise;
    const receipt = await tx.wait();
    readCache.clear();
    clearBugzTokenCache();
    return {
      txHash: txHash(receipt?.hash ?? tx.hash)
    };
  } catch (error) {
    throw detailPaymentError(label, error);
  }
};

export const getTreasuryPayoutSnapshot = async (): Promise<TreasuryPayoutSnapshot | null> => {
  if (!chainConfig.bugTreasuryVaultAddress) {
    return null;
  }

  const address = treasuryVaultAddress();
  return readCache.getOrLoad(`treasury-payout:${chainConfig.id}:${address}`, TTL_MS, async () => {
    const contract = readVault();
    const standardPayoutDivisor = await scheduleBaseRpcRead(
      "treasury standard payout divisor",
      () => contract.standardPayoutDivisor() as Promise<bigint>
    );
    const minReward = await scheduleBaseRpcRead(
      "treasury base reward",
      () => contract.calculateRewardAmount(1) as Promise<bigint>
    );
    const maxReward = await scheduleBaseRpcRead(
      "treasury max reward",
      () => contract.calculateRewardAmount(10) as Promise<bigint>
    );

    return {
      address,
      standardPayoutDivisor,
      minReward,
      maxReward
    };
  });
};

export const getDetailKeyPayment = async (reportHash: HexString, buyer: HexString): Promise<bigint> => {
  const address = treasuryVaultAddress();
  const normalizedBuyer = normalizeAddress(buyer);
  const key = `detail-payment:${chainConfig.id}:${address}:${reportHash}:${normalizedBuyer}`;
  return readCache.getOrLoad(key, TTL_MS, async () =>
    scheduleBaseRpcRead("detail key payment read", () =>
      readVault().detailKeyPayments(reportHash, normalizedBuyer) as Promise<bigint>
    )
  );
};

export const approveTreasuryForDetailKeyPayment = async (
  amount: bigint
): Promise<{ txHash: HexString | null; skipped?: boolean }> => {
  const account = connectedAccount();
  const treasuryAddress = treasuryVaultAddress();
  const currentAllowance = await scheduleBaseRpcRead("treasury BUGZ allowance", () =>
    readToken().allowance(account, treasuryAddress) as Promise<bigint>
  );
  if (currentAllowance >= amount) {
    return {
      txHash: null,
      skipped: true
    };
  }

  const token = await writeToken();
  return sendTx("Treasury detail-key approval", token.approve(treasuryAddress, amount));
};

export const purchaseDetailKey = async (
  reportHash: HexString,
  amount: bigint
): Promise<{ txHash: HexString }> => {
  connectedAccount();
  if (!/^0x[a-fA-F0-9]{64}$/.test(reportHash)) {
    throw new Error("Detail-key payment needs a valid report hash.");
  }
  if (amount <= 0n) {
    throw new Error("Detail-key payment amount must be greater than zero.");
  }

  const vault = await writeVault();
  return sendTx("Detail-key payment", vault.purchaseDetailKey(reportHash, amount));
};
