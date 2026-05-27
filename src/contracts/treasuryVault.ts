import { Contract, type ContractRunner } from "ethers";

import { chainConfig } from "../config/chains";
import { authController } from "../services";
import { RpcReadCache, scheduleBaseRpcRead } from "../lib/rpcReadCache";
import { normalizeAddress, timestampToIso } from "../lib/utils";
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

export type DetailKeyBuyer = {
  buyer: HexString;
  totalPaid: bigint;
  purchaseCount: number;
  latestPurchasedAt: string;
};

const treasuryVaultAbi = [
  "function standardPayoutDivisor() view returns (uint256)",
  "function calculateRewardAmount(uint8 multiplier) view returns (uint256)",
  "function detailKeyPayments(bytes32 reportHash,address buyer) view returns (uint256)",
  "function detailKeyPurchaseCount() view returns (uint256)",
  "function detailKeyPurchaseAt(uint256 purchaseIndex) view returns (tuple(bytes32 reportHash,address buyer,uint256 amount,uint256 totalPaid,uint64 createdAt))",
  "function purchaseDetailKey(bytes32 reportHash,uint256 amount)",
  "error InvalidAmount()",
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientAllowance(address spender,uint256 allowance,uint256 needed)",
  "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)"
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

const readToken = (runner: ContractRunner | null = readProvider) => new Contract(tokenAddress(), bugzTokenAbi, runner);

const txHash = (value: string | null | undefined): HexString => (value ?? "0x").toLowerCase() as HexString;

const shortenError = (message: string): string => (message.length > 240 ? `${message.slice(0, 237)}...` : message);

const errorText = (error: unknown): string => {
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (!value) {
      return;
    }
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (value instanceof Error) {
      parts.push(value.message);
    }
    if (typeof value !== "object") {
      parts.push(String(value));
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of ["shortMessage", "reason", "data", "error", "info", "revert", "cause"]) {
      if (record[key] !== value) {
        visit(record[key]);
      }
    }
  };
  visit(error);
  return parts.filter(Boolean).join(" ");
};

const toBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" || typeof value === "string") {
    return BigInt(value);
  }
  return BigInt(String(value ?? 0));
};

const detailPaymentError = (label: string, error: unknown): Error => {
  const raw = errorText(error);
  if (/user rejected|denied transaction|rejected the request/i.test(raw)) {
    return new Error(`${label} was rejected in the wallet.`);
  }
  if (/insufficient funds|insufficient.*gas/i.test(raw)) {
    return new Error(`${label} needs more Base ETH for gas.`);
  }
  if (/allowance|transfer amount exceeds allowance|ERC20InsufficientAllowance|0xfb8f41b2/i.test(raw)) {
    return new Error(`${label} needs a larger BUGZ approval for the treasury vault.`);
  }
  if (/balance|ERC20InsufficientBalance|0xe450d38c/i.test(raw)) {
    return new Error(`${label} needs more BUGZ.`);
  }
  return new Error(`${label} failed: ${shortenError(raw)}`);
};

const connectedAccount = (): HexString => {
  const account = authController.getSession().address;
  if (!account) {
    throw new Error("Connect a wallet before unlocking early access.");
  }
  return account;
};

const connectedSigner = async (): Promise<{ signer: Awaited<ReturnType<typeof authController.getSigner>>; account: HexString }> => {
  const account = connectedAccount();
  const signer = await authController.getSigner();
  const signerAddress = normalizeAddress(await signer.getAddress());
  if (signerAddress !== account) {
    throw new Error("Connected wallet and transaction signer do not match. Reconnect the wallet and try again.");
  }
  return { signer, account };
};

const readTreasuryAllowance = async (account: HexString, runner: ContractRunner | null = readProvider): Promise<bigint> =>
  scheduleBaseRpcRead("treasury BUGZ allowance", () =>
    readToken(runner).allowance(account, treasuryVaultAddress()) as Promise<bigint>
  );

export const getTreasuryDetailKeyAllowance = async (buyer?: HexString): Promise<bigint> => {
  const account = buyer ? normalizeAddress(buyer) : connectedAccount();
  return readTreasuryAllowance(account);
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

export const getReportDetailKeyBuyers = async (reportHash: HexString): Promise<DetailKeyBuyer[]> => {
  if (!chainConfig.bugTreasuryVaultAddress) {
    return [];
  }

  const address = treasuryVaultAddress();
  const normalizedReportHash = reportHash.toLowerCase() as HexString;
  const key = `detail-buyers:${chainConfig.id}:${address}:${normalizedReportHash}`;

  return readCache.getOrLoad(key, TTL_MS, async () => {
    const vault = readVault();
    const count = await scheduleBaseRpcRead(
      "detail key purchase count",
      () => vault.detailKeyPurchaseCount() as Promise<bigint>
    );
    const buyers = new Map<
      HexString,
      {
        buyer: HexString;
        totalPaid: bigint;
        purchaseCount: number;
        latestPurchasedAt: number;
      }
    >();

    for (let index = 0n; index < count; index += 1n) {
      const raw = (await scheduleBaseRpcRead("detail key purchase record", () =>
        vault.detailKeyPurchaseAt(index) as Promise<readonly unknown[] & Record<string, unknown>>
      )) as readonly unknown[] & Record<string, unknown>;
      const purchaseReportHash = String(raw.reportHash ?? raw[0] ?? "").toLowerCase();
      if (purchaseReportHash !== normalizedReportHash) {
        continue;
      }

      const buyer = normalizeAddress(String(raw.buyer ?? raw[1] ?? ""));
      const totalPaid = toBigInt(raw.totalPaid ?? raw[3]);
      const createdAt = Number(toBigInt(raw.createdAt ?? raw[4]));
      const existing = buyers.get(buyer);
      if (!existing) {
        buyers.set(buyer, {
          buyer,
          totalPaid,
          purchaseCount: 1,
          latestPurchasedAt: createdAt
        });
        continue;
      }

      existing.purchaseCount += 1;
      if (createdAt >= existing.latestPurchasedAt) {
        existing.latestPurchasedAt = createdAt;
        existing.totalPaid = totalPaid;
      } else if (totalPaid > existing.totalPaid) {
        existing.totalPaid = totalPaid;
      }
    }

    return [...buyers.values()]
      .sort((left, right) => right.latestPurchasedAt - left.latestPurchasedAt)
      .map((buyer) => ({
        buyer: buyer.buyer,
        totalPaid: buyer.totalPaid,
        purchaseCount: buyer.purchaseCount,
        latestPurchasedAt: timestampToIso(buyer.latestPurchasedAt)
      }));
  });
};

export const approveTreasuryForDetailKeyPayment = async (
  amount: bigint
): Promise<{ txHash: HexString | null; skipped?: boolean }> => {
  const { signer, account } = await connectedSigner();
  const treasuryAddress = treasuryVaultAddress();
  const currentAllowance = await readTreasuryAllowance(account, signer);
  if (currentAllowance >= amount) {
    return {
      txHash: null,
      skipped: true
    };
  }

  const token = new Contract(tokenAddress(), bugzTokenAbi, signer);
  return sendTx("Treasury detail-key approval", token.approve(treasuryAddress, amount));
};

export const purchaseDetailKey = async (
  reportHash: HexString,
  amount: bigint,
  options: { skipAllowancePreflight?: boolean } = {}
): Promise<{ txHash: HexString }> => {
  const { signer, account } = await connectedSigner();
  if (!/^0x[a-fA-F0-9]{64}$/.test(reportHash)) {
    throw new Error("Detail-key payment needs a valid report hash.");
  }
  if (amount <= 0n) {
    throw new Error("Detail-key payment amount must be greater than zero.");
  }

  if (!options.skipAllowancePreflight) {
    const currentAllowance = await readTreasuryAllowance(account, signer);
    if (currentAllowance < amount) {
      throw new Error("Detail-key payment needs a larger BUGZ approval for the treasury vault.");
    }
  }

  const vault = new Contract(treasuryVaultAddress(), treasuryVaultAbi, signer);
  return sendTx("Detail-key payment", vault.purchaseDetailKey(reportHash, amount));
};
