import { Contract, getAddress, isAddress } from "ethers";

import { chainConfig } from "../config/chains";
import { authController } from "../services";
import { appLog } from "../lib/logger";
import { RpcReadCache, isRateLimitError } from "../lib/rpcReadCache";
import { normalizeAddress } from "../lib/utils";
import type { HexString } from "../types/domain";

import { createBaseReadProvider } from "./rpcProvider";

export type ManagedContractKey = "index" | "bond" | "treasury";

export type ManagedContractOwner = {
  key: ManagedContractKey;
  label: string;
  address: HexString | "";
  owner: HexString | null;
  isOwner: boolean;
  errorMessage: string | null;
};

export type ContractOwnerAccess = {
  account: HexString | null;
  isAnyOwner: boolean;
  isFullOwner: boolean;
  contracts: ManagedContractOwner[];
};

export type ManageSnapshot = {
  ownership: ContractOwnerAccess;
  index: {
    bondVault: HexString | null;
    treasuryVault: HexString | null;
    brokers: HexString[];
    admins: HexString[];
    truncated: boolean;
  };
  bond: {
    treasury: HexString | null;
  };
  treasury: {
    index: HexString | null;
    standardPayoutDivisor: bigint | null;
    brokers: HexString[];
    truncated: boolean;
  };
  errorMessage: string | null;
};

export type ManageAction =
  | "index-set-broker"
  | "index-set-admin"
  | "index-set-bond-vault"
  | "index-set-treasury-vault"
  | "index-transfer-ownership"
  | "bond-set-slasher"
  | "bond-set-treasury"
  | "bond-transfer-ownership"
  | "treasury-set-broker"
  | "treasury-set-index"
  | "treasury-set-payout-divisor"
  | "treasury-transfer-ownership";

export type ManageActionInput = {
  action: ManageAction;
  address?: string;
  allowed?: boolean;
  divisor?: string;
};

export type ManageActionResult = {
  label: string;
  txHash: HexString;
};

export const cheapBugsOwnableAbi = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)"
];

export const cheapBugsBugIndexManageAbi = [
  ...cheapBugsOwnableAbi,
  "function bondVault() view returns (address)",
  "function treasuryVault() view returns (address)",
  "function setBondVault(address newBondVault)",
  "function setTreasuryVault(address newTreasuryVault)",
  "function setBroker(address broker,bool allowed)",
  "function setAdmin(address admin,bool allowed)",
  "function brokerCount() view returns (uint256)",
  "function brokerAt(uint256 index) view returns (address)",
  "function adminCount() view returns (uint256)",
  "function adminAt(uint256 index) view returns (address)"
];

export const cheapBugsBondVaultManageAbi = [
  ...cheapBugsOwnableAbi,
  "function treasury() view returns (address)",
  "function setTreasury(address treasuryAddress)",
  "function setSlasher(address slasher,bool allowed)"
];

export const cheapBugsTreasuryVaultManageAbi = [
  ...cheapBugsOwnableAbi,
  "function index() view returns (address)",
  "function setIndex(address indexAddress)",
  "function setBroker(address broker,bool allowed)",
  "function setStandardPayoutDivisor(uint256 divisor)",
  "function standardPayoutDivisor() view returns (uint256)",
  "function brokerCount() view returns (uint256)",
  "function brokerAt(uint256 brokerIndex) view returns (address)"
];

const readProvider = createBaseReadProvider();
const readCache = new RpcReadCache();
const OWNER_READ_TTL_MS = 30_000;
const SNAPSHOT_TTL_MS = 20_000;
const READ_TIMEOUT_MS = 4_000;
const ROLE_LIST_LIMIT = 50;

const managedContracts = () =>
  [
    {
      key: "index" as const,
      label: "CheapBugsBugIndex",
      address: chainConfig.bugIndexAddress || "",
      abi: cheapBugsBugIndexManageAbi
    },
    {
      key: "bond" as const,
      label: "CheapBugsBondVault",
      address: chainConfig.bugBondVaultAddress || "",
      abi: cheapBugsBondVaultManageAbi
    },
    {
      key: "treasury" as const,
      label: "CheapBugsTreasuryVault",
      address: chainConfig.bugTreasuryVaultAddress || "",
      abi: cheapBugsTreasuryVaultManageAbi
    }
  ];

const readContract = (address: HexString, abi: readonly string[]) => new Contract(address, abi, readProvider);

const writeContract = async (address: HexString, abi: readonly string[]) =>
  new Contract(address, abi, await authController.getSigner());

const withReadTimeout = async <T>(read: Promise<T>, label: string): Promise<T> => {
  const timeout = new Promise<never>((_resolve, reject) => {
    globalThis.setTimeout(() => reject(new Error(`${label} timed out.`)), READ_TIMEOUT_MS);
  });
  return Promise.race([read, timeout]);
};

const toHex = (value: string): HexString => value.toLowerCase() as HexString;

const txHash = (value: string | null | undefined): HexString => toHex(value ?? "0x");

const parseAddress = (value: string | undefined, label: string): HexString => {
  const raw = (value ?? "").trim();
  if (!isAddress(raw)) {
    throw new Error(`${label} must be a valid EVM address.`);
  }
  return normalizeAddress(getAddress(raw));
};

const shortenError = (message: string): string => (message.length > 260 ? `${message.slice(0, 257)}...` : message);

const actionErrorMessage = (label: string, error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  if (/user rejected|denied transaction|rejected the request/i.test(raw)) {
    return `${label} was rejected in the wallet.`;
  }
  if (/insufficient funds|insufficient.*gas/i.test(raw)) {
    return `${label} needs more Base ETH for gas.`;
  }
  if (/OwnableUnauthorizedAccount|not owner|caller is not the owner/i.test(raw)) {
    return `${label} failed because the connected wallet is not the current owner.`;
  }
  return `${label} failed: ${shortenError(raw)}`;
};

const ownerOf = async (address: HexString, abi: readonly string[], label: string): Promise<HexString> =>
  normalizeAddress(await withReadTimeout(readContract(address, abi).owner() as Promise<string>, `${label} owner`));

const emptyOwner = (
  key: ManagedContractKey,
  label: string,
  address: HexString | "",
  account: HexString | null,
  errorMessage: string | null
): ManagedContractOwner => ({
  key,
  label,
  address,
  owner: null,
  isOwner: false,
  errorMessage: account ? errorMessage : null
});

export const clearCheapBugsSuiteCache = (): void => {
  readCache.clear();
};

export const loadContractOwnerAccess = async (account: HexString | null): Promise<ContractOwnerAccess> => {
  const normalizedAccount = account ? normalizeAddress(account) : null;
  const key = `owners:${normalizedAccount ?? "anonymous"}:${managedContracts()
    .map((contract) => contract.address)
    .join(":")}`;

  return readCache.getOrLoad(key, OWNER_READ_TTL_MS, async () => {
    const contracts: ManagedContractOwner[] = [];
    let rateLimitMessage: string | null = null;

    for (const contract of managedContracts()) {
      if (!contract.address) {
        contracts.push(emptyOwner(contract.key, contract.label, "", normalizedAccount, "Contract address is not configured."));
        continue;
      }

      const address = normalizeAddress(contract.address);
      if (rateLimitMessage) {
        contracts.push(emptyOwner(contract.key, contract.label, address, normalizedAccount, rateLimitMessage));
        continue;
      }

      try {
        const owner = await ownerOf(address, contract.abi, contract.label);
        contracts.push({
          key: contract.key,
          label: contract.label,
          address,
          owner,
          isOwner: Boolean(normalizedAccount && owner === normalizedAccount),
          errorMessage: null
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Owner read failed.";
        appLog.warn("manage: owner read failed", { contract: contract.label, error });
        contracts.push(emptyOwner(contract.key, contract.label, address, normalizedAccount, errorMessage));
        if (isRateLimitError(error)) {
          rateLimitMessage = errorMessage;
        }
      }
    }

    return {
      account: normalizedAccount,
      contracts,
      isAnyOwner: contracts.some((contract) => contract.isOwner),
      isFullOwner: contracts.every((contract) => contract.isOwner)
    };
  });
};

const configuredAddress = (key: ManagedContractKey): HexString => {
  const contract = managedContracts().find((entry) => entry.key === key);
  if (!contract?.address) {
    throw new Error(`${key} contract address is not configured.`);
  }
  return normalizeAddress(contract.address);
};

const readAddressList = async (
  contract: Contract,
  countMethod: "brokerCount" | "adminCount",
  atMethod: "brokerAt" | "adminAt"
): Promise<{ entries: HexString[]; truncated: boolean }> => {
  const rawCount = (await contract[countMethod]()) as bigint;
  const count = Math.min(Number(rawCount), ROLE_LIST_LIMIT);
  const entries = await Promise.all(
    Array.from({ length: count }, (_item, index) => contract[atMethod](BigInt(index)) as Promise<string>)
  );
  return {
    entries: entries.map((entry) => normalizeAddress(entry)),
    truncated: rawCount > BigInt(ROLE_LIST_LIMIT)
  };
};

export const loadManageSnapshot = async (account: HexString | null): Promise<ManageSnapshot> => {
  const normalizedAccount = account ? normalizeAddress(account) : null;
  const key = `manage:${normalizedAccount ?? "anonymous"}:${managedContracts()
    .map((contract) => contract.address)
    .join(":")}`;

  return readCache.getOrLoad(key, SNAPSHOT_TTL_MS, async () => {
    const ownership = await loadContractOwnerAccess(normalizedAccount);
    let errorMessage: string | null = null;

    const indexDefaults = { bondVault: null, treasuryVault: null, brokers: [] as HexString[], admins: [] as HexString[], truncated: false };
    const treasuryDefaults = { index: null, standardPayoutDivisor: null, brokers: [] as HexString[], truncated: false };
    const bondDefaults = { treasury: null };

    try {
      const index = readContract(configuredAddress("index"), cheapBugsBugIndexManageAbi);
      const treasury = readContract(configuredAddress("treasury"), cheapBugsTreasuryVaultManageAbi);
      const bond = readContract(configuredAddress("bond"), cheapBugsBondVaultManageAbi);

      const [indexBondVault, indexTreasuryVault, indexBrokers, indexAdmins, treasuryIndex, payoutDivisor, treasuryBrokers, bondTreasury] =
        await withReadTimeout(
          Promise.all([
            index.bondVault() as Promise<string>,
            index.treasuryVault() as Promise<string>,
            readAddressList(index, "brokerCount", "brokerAt"),
            readAddressList(index, "adminCount", "adminAt"),
            treasury.index() as Promise<string>,
            treasury.standardPayoutDivisor() as Promise<bigint>,
            readAddressList(treasury, "brokerCount", "brokerAt"),
            bond.treasury() as Promise<string>
          ]),
          "Manage snapshot"
        );

      return {
        ownership,
        index: {
          bondVault: normalizeAddress(indexBondVault),
          treasuryVault: normalizeAddress(indexTreasuryVault),
          brokers: indexBrokers.entries,
          admins: indexAdmins.entries,
          truncated: indexBrokers.truncated || indexAdmins.truncated
        },
        treasury: {
          index: normalizeAddress(treasuryIndex),
          standardPayoutDivisor: payoutDivisor,
          brokers: treasuryBrokers.entries,
          truncated: treasuryBrokers.truncated
        },
        bond: {
          treasury: normalizeAddress(bondTreasury)
        },
        errorMessage: null
      };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Manage snapshot read failed.";
      appLog.warn("manage: snapshot read failed", { error });
    }

    return {
      ownership,
      index: indexDefaults,
      treasury: treasuryDefaults,
      bond: bondDefaults,
      errorMessage
    };
  });
};

const assertOwner = async (contractKey: ManagedContractKey, label: string): Promise<void> => {
  const account = authController.getSession().address;
  if (!account) {
    throw new Error("Connect the owner wallet first.");
  }

  const access = await loadContractOwnerAccess(account);
  const contract = access.contracts.find((entry) => entry.key === contractKey);
  if (!contract?.isOwner) {
    throw new Error(`${label} requires the owner of ${contract?.label ?? contractKey}.`);
  }
};

const sendTx = async (label: string, txPromise: Promise<{ hash: string; wait: () => Promise<{ hash?: string } | null> }>): Promise<ManageActionResult> => {
  try {
    const tx = await txPromise;
    const receipt = await tx.wait();
    clearCheapBugsSuiteCache();
    return {
      label,
      txHash: txHash(receipt?.hash ?? tx.hash)
    };
  } catch (error) {
    throw new Error(actionErrorMessage(label, error));
  }
};

const parseDivisor = (value: string | undefined): bigint => {
  const raw = (value ?? "").trim();
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error("Standard payout divisor must be a positive integer.");
  }
  const divisor = BigInt(raw);
  if (divisor <= 0n) {
    throw new Error("Standard payout divisor must be greater than zero.");
  }
  return divisor;
};

export const executeManageAction = async (input: ManageActionInput): Promise<ManageActionResult> => {
  switch (input.action) {
    case "index-set-broker": {
      await assertOwner("index", "Index broker update");
      const contract = await writeContract(configuredAddress("index"), cheapBugsBugIndexManageAbi);
      const broker = parseAddress(input.address, "Index broker");
      return sendTx("Index broker update", contract.setBroker(broker, Boolean(input.allowed)));
    }
    case "index-set-admin": {
      await assertOwner("index", "Index admin update");
      const contract = await writeContract(configuredAddress("index"), cheapBugsBugIndexManageAbi);
      const admin = parseAddress(input.address, "Index admin");
      return sendTx("Index admin update", contract.setAdmin(admin, Boolean(input.allowed)));
    }
    case "index-set-bond-vault": {
      await assertOwner("index", "Index bond-vault update");
      const contract = await writeContract(configuredAddress("index"), cheapBugsBugIndexManageAbi);
      const bondVault = parseAddress(input.address, "Bond vault");
      return sendTx("Index bond-vault update", contract.setBondVault(bondVault));
    }
    case "index-set-treasury-vault": {
      await assertOwner("index", "Index treasury-vault update");
      const contract = await writeContract(configuredAddress("index"), cheapBugsBugIndexManageAbi);
      const treasuryVault = parseAddress(input.address, "Treasury vault");
      return sendTx("Index treasury-vault update", contract.setTreasuryVault(treasuryVault));
    }
    case "index-transfer-ownership": {
      await assertOwner("index", "Index ownership transfer");
      const contract = await writeContract(configuredAddress("index"), cheapBugsBugIndexManageAbi);
      const newOwner = parseAddress(input.address, "New index owner");
      return sendTx("Index ownership transfer", contract.transferOwnership(newOwner));
    }
    case "bond-set-slasher": {
      await assertOwner("bond", "Bond slasher update");
      const contract = await writeContract(configuredAddress("bond"), cheapBugsBondVaultManageAbi);
      const slasher = parseAddress(input.address, "Bond slasher");
      return sendTx("Bond slasher update", contract.setSlasher(slasher, Boolean(input.allowed)));
    }
    case "bond-set-treasury": {
      await assertOwner("bond", "Bond slash-treasury update");
      const contract = await writeContract(configuredAddress("bond"), cheapBugsBondVaultManageAbi);
      const treasury = parseAddress(input.address, "Slash treasury");
      return sendTx("Bond slash-treasury update", contract.setTreasury(treasury));
    }
    case "bond-transfer-ownership": {
      await assertOwner("bond", "Bond ownership transfer");
      const contract = await writeContract(configuredAddress("bond"), cheapBugsBondVaultManageAbi);
      const newOwner = parseAddress(input.address, "New bond-vault owner");
      return sendTx("Bond ownership transfer", contract.transferOwnership(newOwner));
    }
    case "treasury-set-broker": {
      await assertOwner("treasury", "Treasury broker update");
      const contract = await writeContract(configuredAddress("treasury"), cheapBugsTreasuryVaultManageAbi);
      const broker = parseAddress(input.address, "Treasury broker");
      return sendTx("Treasury broker update", contract.setBroker(broker, Boolean(input.allowed)));
    }
    case "treasury-set-index": {
      await assertOwner("treasury", "Treasury index update");
      const contract = await writeContract(configuredAddress("treasury"), cheapBugsTreasuryVaultManageAbi);
      const index = parseAddress(input.address, "Treasury index");
      return sendTx("Treasury index update", contract.setIndex(index));
    }
    case "treasury-set-payout-divisor": {
      await assertOwner("treasury", "Treasury payout-divisor update");
      const contract = await writeContract(configuredAddress("treasury"), cheapBugsTreasuryVaultManageAbi);
      return sendTx("Treasury payout-divisor update", contract.setStandardPayoutDivisor(parseDivisor(input.divisor)));
    }
    case "treasury-transfer-ownership": {
      await assertOwner("treasury", "Treasury ownership transfer");
      const contract = await writeContract(configuredAddress("treasury"), cheapBugsTreasuryVaultManageAbi);
      const newOwner = parseAddress(input.address, "New treasury owner");
      return sendTx("Treasury ownership transfer", contract.transferOwnership(newOwner));
    }
    default:
      throw new Error("Unknown manage action.");
  }
};
